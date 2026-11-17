-- Cupom fiscal (NFC-e modelo 65). Tabelas próprias (não existem no Lovable; todas em TABELAS_SO_NOSSAS do importador).
-- Nasce tudo desligado: `nfce_ambientes.emissao_ligada = false` nos dois ambientes, e a API ainda exige `NFCE_AMBIENTE`.
-- Dinheiro em NUMERIC(15,2) e quantidade em NUMERIC(15,4) (no domínio, inteiros); `n_prot` é texto (17 dígitos passam de 2^53);
-- nenhuma coluna `date` nova (o DATE_ONLY_KEYS não muda). Desenho: docs/superpowers/specs/2026-11-17-cupom-fiscal-design.md §8.1.

-- Emitente (uma linha, id = 1): o que a NFC-e precisa além de CNPJ/razão social/nome fantasia, que continuam em `configuracoes`.
-- `cupom_lanca_venda` nulo = não respondido (ligar em produção exige a resposta). Fora de `configuracoes` de propósito: a loja lê
-- `configuracoes` inteira.
CREATE TABLE "nfce_emitente" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ie" TEXT,
    "crt" SMALLINT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cep" CHAR(8),
    "cod_municipio" CHAR(7) NOT NULL DEFAULT '3556206',
    "municipio" TEXT NOT NULL DEFAULT 'Valinhos',
    "uf" CHAR(2) NOT NULL DEFAULT 'SP',
    "telefone" TEXT,
    "nat_op" TEXT NOT NULL DEFAULT 'VENDA',
    "inf_cpl" TEXT,
    "resp_tec_cnpj" CHAR(14),
    "resp_tec_contato" TEXT,
    "resp_tec_email" TEXT,
    "resp_tec_fone" TEXT,
    "series_outro_sistema" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
    "sem_outro_sistema" BOOLEAN NOT NULL DEFAULT false,
    "cupom_lanca_venda" BOOLEAN,
    "cupom_lanca_venda_por" UUID,
    "cupom_lanca_venda_por_nome" TEXT,
    "cupom_lanca_venda_em" TIMESTAMPTZ(6),
    "tp_regime_ibscbs" SMALLINT,
    "atualizado_por" UUID,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMPTZ(6),
    CONSTRAINT "nfce_emitente_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_emitente_id" CHECK ("id" = 1),
    CONSTRAINT "nfce_emitente_ie" CHECK ("ie" IS NULL OR "ie" ~ '^[0-9]{1,14}$'),
    CONSTRAINT "nfce_emitente_crt" CHECK ("crt" IS NULL OR "crt" IN (1, 2, 3, 4)),
    CONSTRAINT "nfce_emitente_cep" CHECK ("cep" IS NULL OR "cep" ~ '^[0-9]{8}$'),
    CONSTRAINT "nfce_emitente_cod_municipio" CHECK ("cod_municipio" ~ '^[0-9]{7}$'),
    CONSTRAINT "nfce_emitente_uf" CHECK ("uf" ~ '^[A-Z]{2}$'),
    CONSTRAINT "nfce_emitente_nat_op" CHECK (char_length("nat_op") BETWEEN 1 AND 60),
    CONSTRAINT "nfce_emitente_inf_cpl" CHECK ("inf_cpl" IS NULL OR char_length("inf_cpl") <= 500),
    CONSTRAINT "nfce_emitente_resp_tec_cnpj" CHECK ("resp_tec_cnpj" IS NULL OR "resp_tec_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "nfce_emitente_resp_tec_tudo_ou_nada" CHECK (num_nulls("resp_tec_cnpj", "resp_tec_contato", "resp_tec_email", "resp_tec_fone") IN (0, 4)),
    CONSTRAINT "nfce_emitente_series_outro_sistema" CHECK (0 <= ALL ("series_outro_sistema") AND 889 >= ALL ("series_outro_sistema")),
    CONSTRAINT "nfce_emitente_sem_outro_sistema" CHECK (NOT "sem_outro_sistema" OR cardinality("series_outro_sistema") = 0)
);

-- Um ambiente por linha; é a linha travada com FOR UPDATE na reserva do número (T1), que põe na fila a numeração e as travas do 656.
-- O CSC fica cifrado (AES-256-GCM, CERTIFICADO_SECRET, rótulo `nfce-csc`); só os 4 últimos caracteres voltam (`csc_dica`).
CREATE TABLE "nfce_ambientes" (
    "ambiente" TEXT NOT NULL,
    "emissao_ligada" BOOLEAN NOT NULL DEFAULT false,
    "ligada_cnpj" CHAR(14),
    "ligada_serie" SMALLINT,
    "serie" SMALLINT,
    "proximo_numero" BIGINT NOT NULL DEFAULT 1,
    "csc_cifrado" TEXT,
    "csc_dica" CHAR(4),
    "id_csc" INTEGER,
    "situacao" TEXT NOT NULL DEFAULT 'ok',
    "mensagem" TEXT,
    "bloqueado_ate" TIMESTAMPTZ(6),
    "ultimo_656_em" TIMESTAMPTZ(6),
    "ultimo_status_em" TIMESTAMPTZ(6),
    "alterada_por" UUID,
    "alterada_por_nome" TEXT,
    "alterada_em" TIMESTAMPTZ(6),
    CONSTRAINT "nfce_ambientes_pkey" PRIMARY KEY ("ambiente"),
    CONSTRAINT "nfce_ambientes_ambiente" CHECK ("ambiente" IN ('homologacao', 'producao')),
    CONSTRAINT "nfce_ambientes_ligada" CHECK (NOT "emissao_ligada" OR ("ligada_cnpj" IS NOT NULL AND "ligada_serie" IS NOT NULL)),
    CONSTRAINT "nfce_ambientes_ligada_cnpj" CHECK ("ligada_cnpj" IS NULL OR "ligada_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "nfce_ambientes_ligada_serie" CHECK ("ligada_serie" IS NULL OR "ligada_serie" BETWEEN 0 AND 889),
    CONSTRAINT "nfce_ambientes_serie" CHECK ("serie" IS NULL OR "serie" BETWEEN 0 AND 889),
    CONSTRAINT "nfce_ambientes_proximo_numero" CHECK ("proximo_numero" BETWEEN 1 AND 999999999),
    CONSTRAINT "nfce_ambientes_csc" CHECK (("csc_cifrado" IS NULL) = ("csc_dica" IS NULL)),
    CONSTRAINT "nfce_ambientes_id_csc" CHECK ("id_csc" IS NULL OR "id_csc" BETWEEN 1 AND 999999),
    CONSTRAINT "nfce_ambientes_situacao" CHECK ("situacao" IN ('ok', 'parada_656', 'parada_certificado', 'parada_configuracao', 'parada_serie_em_uso'))
);

-- Trilha (só inserção) de ligar, desligar, paradas automáticas e mudanças de configuração. `campos` = nomes dos campos mudados,
-- nunca o valor do CSC. `feito_por*` nulos na parada automática.
CREATE TABLE "nfce_ambientes_historico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "campos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "situacao" TEXT NOT NULL,
    "c_stat" INTEGER,
    "mensagem" TEXT,
    "feito_por" UUID,
    "feito_por_nome" TEXT,
    "feito_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfce_ambientes_historico_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_ambientes_historico_ambiente" CHECK ("ambiente" IN ('homologacao', 'producao')),
    CONSTRAINT "nfce_ambientes_historico_evento" CHECK ("evento" IN ('ligada', 'desligada', 'parada_automatica', 'configuracao')),
    CONSTRAINT "nfce_ambientes_historico_situacao" CHECK ("situacao" IN ('ok', 'parada_656', 'parada_certificado', 'parada_configuracao', 'parada_serie_em_uso'))
);

CREATE INDEX "nfce_ambientes_historico_ambiente_feito_em_idx" ON "nfce_ambientes_historico"("ambiente", "feito_em" DESC);

-- Perfil fiscal: a combinação de impostos que o contador define uma vez (prato da casa, revenda, bebida com ST…). CSOSN (Simples) ou
-- CST do ICMS (Regime Normal), nunca os dois. As combinações CFOP × CSOSN e CRT × grupo ficam no domínio (dependem do CRT do emitente).
-- Os campos do IBS/CBS só são guardados (o XML ainda não os leva). Perfil em uso só é desativado, nunca apagado.
CREATE TABLE "nfce_perfis_fiscais" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "cfop" CHAR(4) NOT NULL,
    "csosn" CHAR(3),
    "cst_icms" CHAR(2),
    "aliq_icms" NUMERIC(5,2),
    "pis_cst" CHAR(2),
    "cofins_cst" CHAR(2),
    "c_ativ_sn" CHAR(2),
    "ibs_sn_aliq" NUMERIC(7,4),
    "cbs_sn_aliq" NUMERIC(7,4),
    "ibscbs_cst" CHAR(3),
    "ibscbs_cclass_trib" CHAR(6),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por" UUID,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMPTZ(6),
    CONSTRAINT "nfce_perfis_fiscais_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_perfis_fiscais_nome" CHECK (char_length(btrim("nome")) >= 1),
    CONSTRAINT "nfce_perfis_fiscais_cfop" CHECK ("cfop" ~ '^[0-9]{4}$'),
    CONSTRAINT "nfce_perfis_fiscais_icms" CHECK (("csosn" IS NULL) <> ("cst_icms" IS NULL)),
    CONSTRAINT "nfce_perfis_fiscais_csosn" CHECK ("csosn" IS NULL OR "csosn" ~ '^[0-9]{3}$'),
    CONSTRAINT "nfce_perfis_fiscais_cst_icms" CHECK ("cst_icms" IS NULL OR "cst_icms" ~ '^[0-9]{2}$'),
    CONSTRAINT "nfce_perfis_fiscais_aliq_icms" CHECK ("aliq_icms" IS NULL OR "aliq_icms" BETWEEN 0 AND 100),
    CONSTRAINT "nfce_perfis_fiscais_pis_cst" CHECK ("pis_cst" IS NULL OR "pis_cst" ~ '^[0-9]{2}$'),
    CONSTRAINT "nfce_perfis_fiscais_cofins_cst" CHECK ("cofins_cst" IS NULL OR "cofins_cst" ~ '^[0-9]{2}$'),
    CONSTRAINT "nfce_perfis_fiscais_c_ativ_sn" CHECK ("c_ativ_sn" IS NULL OR "c_ativ_sn" ~ '^[0-9]{2}$'),
    CONSTRAINT "nfce_perfis_fiscais_ibs_sn_aliq" CHECK ("ibs_sn_aliq" IS NULL OR "ibs_sn_aliq" BETWEEN 0 AND 100),
    CONSTRAINT "nfce_perfis_fiscais_cbs_sn_aliq" CHECK ("cbs_sn_aliq" IS NULL OR "cbs_sn_aliq" BETWEEN 0 AND 100),
    CONSTRAINT "nfce_perfis_fiscais_ibscbs_cst" CHECK ("ibscbs_cst" IS NULL OR "ibscbs_cst" ~ '^[0-9]{3}$'),
    CONSTRAINT "nfce_perfis_fiscais_ibscbs_cclass_trib" CHECK ("ibscbs_cclass_trib" IS NULL OR "ibscbs_cclass_trib" ~ '^[0-9]{6}$')
);

CREATE UNIQUE INDEX "nfce_perfis_fiscais_nome_key" ON "nfce_perfis_fiscais"("nome");

-- Dados fiscais do item do cardápio (1 para 1). NCM ou perfil nulo = cadastro incompleto. GTIN nulo = "SEM GTIN".
-- "Pronto para o cupom" é derivado (item ativo + preço > 0 + NCM + perfil ativo e compatível com o regime), não é coluna.
CREATE TABLE "nfce_itens" (
    "item_cardapio_id" UUID NOT NULL,
    "perfil_fiscal_id" UUID,
    "ncm" CHAR(8),
    "cest" CHAR(7),
    "gtin" VARCHAR(14),
    "origem" SMALLINT NOT NULL DEFAULT 0,
    "descricao_cupom" VARCHAR(120),
    "unidade" VARCHAR(6),
    "atualizado_por" UUID,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMPTZ(6),
    CONSTRAINT "nfce_itens_pkey" PRIMARY KEY ("item_cardapio_id"),
    CONSTRAINT "nfce_itens_ncm" CHECK ("ncm" IS NULL OR "ncm" ~ '^[0-9]{8}$'),
    CONSTRAINT "nfce_itens_cest" CHECK ("cest" IS NULL OR "cest" ~ '^[0-9]{7}$'),
    CONSTRAINT "nfce_itens_gtin" CHECK ("gtin" IS NULL OR "gtin" ~ '^([0-9]{8}|[0-9]{12,14})$'),
    CONSTRAINT "nfce_itens_origem" CHECK ("origem" BETWEEN 0 AND 8),
    CONSTRAINT "nfce_itens_unidade" CHECK ("unidade" IS NULL OR char_length(btrim("unidade")) >= 1)
);

CREATE INDEX "nfce_itens_perfil_fiscal_id_idx" ON "nfce_itens"("perfil_fiscal_id");

-- Um cupom por linha; a única tabela com estado. A chave casa com série, número, `tp_emis` e `c_nf` (o DV é conferido no domínio).
-- `chave_idempotencia` + `pedido_hash` (SHA-256 do corpo normalizado): a mesma chave com outro corpo é recusada pela API.
-- `lanca_venda` = o `cupom_lanca_venda` do emitente fotografado na reserva; em homologação, sempre falso.
-- `numero_reaproveitavel` = falso no 539 (número usado por outra chave). `venda_*` = o marcador da venda no estoque (§3.3 do desenho):
-- `nfce_lancar_venda` grava `venda_lancada_em`, `nfce_desfazer_venda` grava `venda_desfeita_em`, as duas limpam `venda_erro`; a API grava
-- `venda_erro` quando a transação da venda falha (a autorização nunca é desfeita por isso).
-- Imutável depois de autorizado (gatilho nfce_cupons_imutavel, abaixo). Os índices únicos parciais só existem aqui (o Prisma não os expressa).
CREATE TABLE "nfce_cupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "serie" SMALLINT NOT NULL,
    "numero" BIGINT NOT NULL,
    "chave" VARCHAR(44) NOT NULL,
    "c_nf" CHAR(8) NOT NULL,
    "tp_emis" SMALLINT NOT NULL DEFAULT 1,
    "dh_cont" TIMESTAMPTZ(6),
    "x_just" TEXT,
    "dh_emi" TIMESTAMPTZ(6) NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'enviando',
    "numero_reaproveitavel" BOOLEAN NOT NULL DEFAULT true,
    "envios" SMALLINT NOT NULL DEFAULT 0,
    "chave_idempotencia" UUID NOT NULL,
    "pedido_hash" CHAR(64) NOT NULL,
    "lanca_venda" BOOLEAN NOT NULL,
    "consumidor_doc" VARCHAR(14),
    "valor_produtos" NUMERIC(15,2) NOT NULL,
    "valor_desconto" NUMERIC(15,2) NOT NULL DEFAULT 0,
    "valor_total" NUMERIC(15,2) NOT NULL,
    "valor_troco" NUMERIC(15,2) NOT NULL DEFAULT 0,
    "autorizada_em" TIMESTAMPTZ(6),
    "n_prot" VARCHAR(17),
    "c_stat" INTEGER,
    "x_motivo" TEXT,
    "alerta_c_msg" TEXT,
    "alerta_x_msg" TEXT,
    "dig_val" TEXT,
    "xml_autorizado" TEXT,
    "cancelado_em" TIMESTAMPTZ(6),
    "cancelamento_motivo" TEXT,
    "cancelamento_n_prot" VARCHAR(17),
    "cancelamento_pedido_em" TIMESTAMPTZ(6),
    "venda_lancada_em" TIMESTAMPTZ(6),
    "venda_desfeita_em" TIMESTAMPTZ(6),
    "venda_erro" TEXT,
    "descartado_em" TIMESTAMPTZ(6),
    "descarte_motivo" TEXT,
    "emitido_por" UUID,
    "emitido_por_nome" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfce_cupons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_cupons_ambiente" CHECK ("ambiente" IN ('homologacao', 'producao')),
    CONSTRAINT "nfce_cupons_serie" CHECK ("serie" BETWEEN 0 AND 889),
    CONSTRAINT "nfce_cupons_numero" CHECK ("numero" BETWEEN 1 AND 999999999),
    CONSTRAINT "nfce_cupons_chave" CHECK ("chave" ~ '^35[0-9]{4}[0-9A-Z]{12}[0-9]{2}65[0-9]{22}$'),
    CONSTRAINT "nfce_cupons_chave_partes" CHECK (substr("chave", 23, 3) = lpad("serie"::text, 3, '0') AND substr("chave", 26, 9) = lpad("numero"::text, 9, '0') AND substr("chave", 35, 1) = "tp_emis"::text AND substr("chave", 36, 8) = "c_nf"),
    CONSTRAINT "nfce_cupons_c_nf" CHECK ("c_nf" ~ '^[0-9]{8}$'),
    CONSTRAINT "nfce_cupons_tp_emis" CHECK ("tp_emis" IN (1, 9)),
    CONSTRAINT "nfce_cupons_situacao" CHECK ("situacao" IN ('enviando', 'nao_enviado', 'sem_resposta', 'nao_consta', 'rejeitado', 'autorizado', 'cancelando', 'denegado', 'cancelado', 'descartado')),
    CONSTRAINT "nfce_cupons_envios" CHECK ("envios" BETWEEN 0 AND 3),
    CONSTRAINT "nfce_cupons_pedido_hash" CHECK ("pedido_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "nfce_cupons_lanca_venda" CHECK ("ambiente" = 'producao' OR NOT "lanca_venda"),
    CONSTRAINT "nfce_cupons_consumidor_doc" CHECK ("consumidor_doc" IS NULL OR "consumidor_doc" ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
    CONSTRAINT "nfce_cupons_valores" CHECK ("valor_produtos" >= 0 AND "valor_desconto" >= 0 AND "valor_total" >= 0 AND "valor_troco" >= 0),
    CONSTRAINT "nfce_cupons_valor_total" CHECK ("valor_total" = "valor_produtos" - "valor_desconto"),
    CONSTRAINT "nfce_cupons_n_prot" CHECK ("n_prot" IS NULL OR "n_prot" ~ '^[0-9]{15}([0-9]{2})?$'),
    CONSTRAINT "nfce_cupons_cancelamento_n_prot" CHECK ("cancelamento_n_prot" IS NULL OR "cancelamento_n_prot" ~ '^[0-9]{15}([0-9]{2})?$'),
    CONSTRAINT "nfce_cupons_c_stat" CHECK ("c_stat" IS NULL OR "c_stat" BETWEEN 100 AND 9999)
);

CREATE UNIQUE INDEX "nfce_cupons_chave_idempotencia_key" ON "nfce_cupons"("chave_idempotencia");
CREATE INDEX "nfce_cupons_ambiente_criado_em_idx" ON "nfce_cupons"("ambiente", "criado_em" DESC);
-- Dois cupons vivos nunca têm o mesmo número nem a mesma chave; o descartado sai da conta (o número volta a ser usado, com chave nova).
CREATE UNIQUE INDEX "nfce_cupons_numero_vivo" ON "nfce_cupons"("ambiente", "serie", "numero") WHERE "situacao" <> 'descartado';
CREATE UNIQUE INDEX "nfce_cupons_chave_viva" ON "nfce_cupons"("chave") WHERE "situacao" <> 'descartado';
CREATE INDEX "nfce_cupons_pendentes" ON "nfce_cupons"("ambiente", "situacao") WHERE "situacao" IN ('enviando', 'nao_enviado', 'sem_resposta', 'nao_consta', 'rejeitado', 'cancelando');

-- Linhas do cupom: a fotografia do item no momento da emissão (mudar o cardápio ou o perfil depois não muda o cupom).
-- `nome_cardapio` = `itens_cardapio.nome` do momento (é o `produto_relatorio` da venda); `item_cardapio_id` vira nulo se o item for apagado.
CREATE TABLE "nfce_cupom_itens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cupom_id" UUID NOT NULL,
    "n_item" SMALLINT NOT NULL,
    "item_cardapio_id" UUID,
    "nome_cardapio" TEXT NOT NULL,
    "c_prod" VARCHAR(60) NOT NULL,
    "x_prod" VARCHAR(120) NOT NULL,
    "ncm" CHAR(8) NOT NULL,
    "cest" CHAR(7),
    "gtin" VARCHAR(14),
    "origem" SMALLINT NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "cfop" CHAR(4) NOT NULL,
    "csosn" CHAR(3),
    "cst_icms" CHAR(2),
    "aliq_icms" NUMERIC(5,2),
    "pis_cst" CHAR(2),
    "cofins_cst" CHAR(2),
    "c_ativ_sn" CHAR(2),
    "ibs_sn_aliq" NUMERIC(7,4),
    "cbs_sn_aliq" NUMERIC(7,4),
    "ibscbs_cst" CHAR(3),
    "ibscbs_cclass_trib" CHAR(6),
    "perfil_nome" TEXT NOT NULL,
    "quantidade" NUMERIC(15,4) NOT NULL,
    "valor_unitario" NUMERIC(15,2) NOT NULL,
    "valor_bruto" NUMERIC(15,2) NOT NULL,
    "valor_desconto" NUMERIC(15,2) NOT NULL DEFAULT 0,
    CONSTRAINT "nfce_cupom_itens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_cupom_itens_n_item" CHECK ("n_item" BETWEEN 1 AND 990),
    CONSTRAINT "nfce_cupom_itens_ncm" CHECK ("ncm" ~ '^[0-9]{8}$'),
    CONSTRAINT "nfce_cupom_itens_cfop" CHECK ("cfop" ~ '^[0-9]{4}$'),
    CONSTRAINT "nfce_cupom_itens_icms" CHECK (("csosn" IS NULL) <> ("cst_icms" IS NULL)),
    CONSTRAINT "nfce_cupom_itens_origem" CHECK ("origem" BETWEEN 0 AND 8),
    CONSTRAINT "nfce_cupom_itens_quantidade" CHECK ("quantidade" > 0),
    CONSTRAINT "nfce_cupom_itens_valores" CHECK ("valor_unitario" >= 0 AND "valor_bruto" >= 0 AND "valor_desconto" BETWEEN 0 AND "valor_bruto")
);

CREATE UNIQUE INDEX "nfce_cupom_itens_cupom_id_n_item_key" ON "nfce_cupom_itens"("cupom_id", "n_item");
CREATE INDEX "nfce_cupom_itens_item_cardapio_id_idx" ON "nfce_cupom_itens"("item_cardapio_id");

-- Formas de pagamento do cupom (`tPag` aceitos agora: dinheiro, crédito, débito, vale-alimentação, vale-refeição e Pix).
CREATE TABLE "nfce_cupom_pagamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cupom_id" UUID NOT NULL,
    "ordem" SMALLINT NOT NULL,
    "t_pag" CHAR(2) NOT NULL,
    "valor" NUMERIC(15,2) NOT NULL,
    "tp_integra" SMALLINT,
    CONSTRAINT "nfce_cupom_pagamentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_cupom_pagamentos_ordem" CHECK ("ordem" >= 1),
    CONSTRAINT "nfce_cupom_pagamentos_t_pag" CHECK ("t_pag" IN ('01', '03', '04', '10', '11', '17')),
    CONSTRAINT "nfce_cupom_pagamentos_valor" CHECK ("valor" > 0),
    CONSTRAINT "nfce_cupom_pagamentos_tp_integra" CHECK ("tp_integra" IS NULL OR "tp_integra" IN (1, 2))
);

CREATE UNIQUE INDEX "nfce_cupom_pagamentos_cupom_id_ordem_key" ON "nfce_cupom_pagamentos"("cupom_id", "ordem");

-- Diário de cada chamada NFC-e à SEFAZ (só inserção, mais o fechamento da própria linha, como `sefaz_consultas`): aberta antes de
-- enviar (`resultado` nulo), fechada depois. É a prova das travas do 656 e a guarda dos eventos. `xml_enviado` é o XML assinado (nunca
-- contém o CSC); `xml_retorno` é o conteúdo do `nfeResultMsg`. `cupom_id` nulo só no `status`. `id_lote` sai de `nfce_id_lote_seq`.
CREATE TABLE "nfce_envios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cupom_id" UUID,
    "servico" TEXT NOT NULL,
    "tentativa" SMALLINT,
    "id_lote" BIGINT,
    "iniciada_em" TIMESTAMPTZ(6) NOT NULL,
    "terminada_em" TIMESTAMPTZ(6),
    "resultado" TEXT,
    "c_stat_lote" INTEGER,
    "c_stat" INTEGER,
    "x_motivo" TEXT,
    "n_prot" VARCHAR(17),
    "dh_recbto" TEXT,
    "dig_val" TEXT,
    "rejeicao" BOOLEAN NOT NULL DEFAULT false,
    "erro_code" TEXT,
    "duracao_ms" INTEGER,
    "xml_enviado" TEXT,
    "xml_retorno" TEXT,
    "iniciada_por" UUID,
    "iniciada_por_nome" TEXT,
    "certificado_impressao" CHAR(64),
    CONSTRAINT "nfce_envios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nfce_envios_ambiente" CHECK ("ambiente" IN ('homologacao', 'producao')),
    CONSTRAINT "nfce_envios_servico" CHECK ("servico" IN ('autorizacao', 'consulta', 'cancelamento', 'status')),
    CONSTRAINT "nfce_envios_cupom" CHECK (("servico" = 'status') = ("cupom_id" IS NULL)),
    CONSTRAINT "nfce_envios_tentativa" CHECK ("tentativa" IS NULL OR "tentativa" >= 1),
    CONSTRAINT "nfce_envios_id_lote" CHECK ("id_lote" IS NULL OR "id_lote" BETWEEN 1 AND 999999999999999),
    CONSTRAINT "nfce_envios_resultado" CHECK ("resultado" IS NULL OR "resultado" IN ('respondida', 'falha_antes_de_enviar', 'sem_resposta', 'interrompida'))
);

CREATE INDEX "nfce_envios_ambiente_iniciada_em_idx" ON "nfce_envios"("ambiente", "iniciada_em" DESC);
CREATE INDEX "nfce_envios_cupom_id_idx" ON "nfce_envios"("cupom_id");

-- `idLote` do `enviNFe` e do `envEvento` (até 15 dígitos). Avulsa: não é padrão de coluna nenhuma (o importador não a toca).
CREATE SEQUENCE "nfce_id_lote_seq" AS BIGINT MINVALUE 1 MAXVALUE 999999999999999 NO CYCLE;

-- Venda lançada pelo cupom autorizado (§3.3): a linha de `vendas` aponta o cupom. A importação e o `mapear` não tocam essas linhas.
ALTER TABLE "vendas" ADD COLUMN "nfce_cupom_id" UUID;
CREATE INDEX "vendas_nfce_cupom_id_idx" ON "vendas"("nfce_cupom_id");

ALTER TABLE "nfce_itens" ADD CONSTRAINT "nfce_itens_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfce_itens" ADD CONSTRAINT "nfce_itens_perfil_fiscal_id_fkey" FOREIGN KEY ("perfil_fiscal_id") REFERENCES "nfce_perfis_fiscais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nfce_cupom_itens" ADD CONSTRAINT "nfce_cupom_itens_cupom_id_fkey" FOREIGN KEY ("cupom_id") REFERENCES "nfce_cupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nfce_cupom_itens" ADD CONSTRAINT "nfce_cupom_itens_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfce_cupom_pagamentos" ADD CONSTRAINT "nfce_cupom_pagamentos_cupom_id_fkey" FOREIGN KEY ("cupom_id") REFERENCES "nfce_cupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nfce_envios" ADD CONSTRAINT "nfce_envios_cupom_id_fkey" FOREIGN KEY ("cupom_id") REFERENCES "nfce_cupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_nfce_cupom_id_fkey" FOREIGN KEY ("nfce_cupom_id") REFERENCES "nfce_cupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Imutável depois de autorizado (§5.1). Com o cupom em autorizado, cancelando, denegado ou cancelado, só passam:
--   situacao: autorizado → cancelando | cancelado; cancelando → autorizado | cancelado (a consulta decide);
--   os campos do cancelamento (cancelado_em, cancelamento_motivo, cancelamento_n_prot, cancelamento_pedido_em), só a partir de
--   autorizado ou cancelando; os da venda no estoque (venda_lancada_em, venda_desfeita_em, venda_erro); e atualizado_em.
-- Todo o resto (número, série, chave, valores, XML, protocolo, código e motivo da autorização…) é recusado. DELETE: sempre recusado.
CREATE OR REPLACE FUNCTION nfce_cupons_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  livres text[] := ARRAY['situacao', 'venda_lancada_em', 'venda_desfeita_em', 'venda_erro', 'atualizado_em'];
BEGIN
  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Cupom fiscal nunca é apagado: descarte ou cancele.';
  END IF;
  IF old.situacao NOT IN ('autorizado', 'cancelando', 'denegado', 'cancelado') THEN
    RETURN new;
  END IF;
  IF new.situacao IS DISTINCT FROM old.situacao AND NOT (
       (old.situacao = 'autorizado' AND new.situacao IN ('cancelando', 'cancelado'))
    OR (old.situacao = 'cancelando' AND new.situacao IN ('autorizado', 'cancelado'))) THEN
    RAISE EXCEPTION 'Cupom fiscal %: não passa para %.', old.situacao, new.situacao;
  END IF;
  IF old.situacao IN ('autorizado', 'cancelando') THEN
    livres := livres || ARRAY['cancelado_em', 'cancelamento_motivo', 'cancelamento_n_prot', 'cancelamento_pedido_em'];
  END IF;
  IF (to_jsonb(new) - livres) IS DISTINCT FROM (to_jsonb(old) - livres) THEN
    RAISE EXCEPTION 'Cupom fiscal %: é documento fiscal e não muda (só o cancelamento e a venda no estoque).', old.situacao;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER nfce_cupons_imutavel BEFORE UPDATE OR DELETE ON nfce_cupons FOR EACH ROW EXECUTE FUNCTION nfce_cupons_imutavel();

-- Itens e pagamentos: só mudam com o cupom fora de autorizado, cancelando, denegado e cancelado. A única passagem é o ON DELETE SET NULL
-- do cardápio (apagar o item do cardápio zera `item_cardapio_id`; a fotografia fica). FOR SHARE: espera quem estiver mudando o cupom.
CREATE OR REPLACE FUNCTION nfce_filhos_imutaveis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF tg_op = 'UPDATE' AND (to_jsonb(new) - 'item_cardapio_id') = (to_jsonb(old) - 'item_cardapio_id')
     AND to_jsonb(new) ->> 'item_cardapio_id' IS NULL THEN
    RETURN new;
  END IF;
  IF tg_op IN ('UPDATE', 'DELETE') THEN
    SELECT c.situacao INTO s FROM nfce_cupons c WHERE c.id = old.cupom_id FOR SHARE;
    IF s IN ('autorizado', 'cancelando', 'denegado', 'cancelado') THEN
      RAISE EXCEPTION 'Cupom fiscal %: itens e pagamentos não mudam.', s;
    END IF;
  END IF;
  IF tg_op IN ('INSERT', 'UPDATE') THEN
    SELECT c.situacao INTO s FROM nfce_cupons c WHERE c.id = new.cupom_id FOR SHARE;
    IF s IN ('autorizado', 'cancelando', 'denegado', 'cancelado') THEN
      RAISE EXCEPTION 'Cupom fiscal %: itens e pagamentos não mudam.', s;
    END IF;
    RETURN new;
  END IF;
  RETURN old;
END $$;
CREATE TRIGGER nfce_filhos_imutaveis BEFORE INSERT OR UPDATE OR DELETE ON nfce_cupom_itens FOR EACH ROW EXECUTE FUNCTION nfce_filhos_imutaveis();
CREATE TRIGGER nfce_filhos_imutaveis BEFORE INSERT OR UPDATE OR DELETE ON nfce_cupom_pagamentos FOR EACH ROW EXECUTE FUNCTION nfce_filhos_imutaveis();

-- ===== Venda no estoque pelo cupom (§3.3). Roda numa transação própria, DEPOIS da que grava a autorização (a venda nunca desfaz a
-- autorização). Só cupom de produção, autorizado e com `lanca_venda`. Uma linha de `vendas` por item do cardápio: agrupa por
-- (item_cardapio_id, nome_cardapio) e soma as linhas repetidas; `pedido` = 'NFC-e <série>-<número>'; data e hora = `dh_emi` em
-- Brasília. A baixa no estoque é a do gatilho `vendas_baixa`, sem mudança. Idempotente: com venda já lançada, devolve 0.
CREATE OR REPLACE FUNCTION nfce_lancar_venda(_cupom uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  c nfce_cupons%ROWTYPE;
  n int := 0;
BEGIN
  SELECT * INTO c FROM nfce_cupons WHERE id = _cupom FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cupom fiscal não encontrado.'; END IF;
  IF c.ambiente <> 'producao' THEN RAISE EXCEPTION 'Cupom de homologação (modo de teste) não lança venda no estoque.'; END IF;
  IF c.situacao <> 'autorizado' THEN RAISE EXCEPTION 'Só o cupom autorizado lança a venda no estoque (este está %).', c.situacao; END IF;
  IF NOT c.lanca_venda THEN RAISE EXCEPTION 'Este cupom não lança a venda no estoque: a venda dele vem da importação do outro sistema.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vendas WHERE nfce_cupom_id = _cupom) THEN
    INSERT INTO vendas (pedido, data, hora, produto_relatorio, item_cardapio_id, preco_unitario, quantidade, desconto, taxa, frete,
                        valor_total, importacao_id, nfce_cupom_id)
    SELECT 'NFC-e ' || c.serie || '-' || c.numero,
           (c.dh_emi AT TIME ZONE 'America/Sao_Paulo')::date,
           (c.dh_emi AT TIME ZONE 'America/Sao_Paulo')::time,
           i.nome_cardapio, i.item_cardapio_id, max(i.valor_unitario), sum(i.quantidade), sum(i.valor_desconto), 0, 0,
           sum(i.valor_bruto - i.valor_desconto), NULL, _cupom
      FROM nfce_cupom_itens i
     WHERE i.cupom_id = _cupom
     GROUP BY i.item_cardapio_id, i.nome_cardapio;
    GET DIAGNOSTICS n = row_count;
  END IF;
  UPDATE nfce_cupons SET venda_lancada_em = coalesce(venda_lancada_em, now()), venda_erro = NULL WHERE id = _cupom;
  RETURN n;
END $$;

-- Cancelamento (§3.3): apaga as linhas de `vendas` do cupom cancelado; as `movimentacoes` caem em cascata (venda_id ON DELETE CASCADE).
-- Apagar, e não lançar estorno: o estorno contaria como pedido a mais. O histórico imutável fica no cupom. Idempotente (devolve 0).
CREATE OR REPLACE FUNCTION nfce_desfazer_venda(_cupom uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  c nfce_cupons%ROWTYPE;
  n int;
BEGIN
  SELECT * INTO c FROM nfce_cupons WHERE id = _cupom FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cupom fiscal não encontrado.'; END IF;
  IF c.situacao <> 'cancelado' THEN RAISE EXCEPTION 'Só o cupom cancelado desfaz a venda no estoque (este está %).', c.situacao; END IF;
  DELETE FROM vendas WHERE nfce_cupom_id = _cupom;
  GET DIAGNOSTICS n = row_count;
  UPDATE nfce_cupons SET venda_desfeita_em = coalesce(venda_desfeita_em, now()), venda_erro = NULL WHERE id = _cupom;
  RETURN n;
END $$;

-- ===== Linhas fixas: o emitente (id = 1) e os dois ambientes, com a emissão desligada e sem série.
INSERT INTO "nfce_emitente" ("id") VALUES (1);
INSERT INTO "nfce_ambientes" ("ambiente") VALUES ('homologacao'), ('producao');

-- ===== Os 4 campos fiscais antigos do cardápio (texto livre do protótipo) deixam de ser fonte; ficam pelo 1:1 com o protótipo.
COMMENT ON COLUMN itens_cardapio.ncm IS 'DEPRECATED: dados do cupom em nfce_itens';
COMMENT ON COLUMN itens_cardapio.cfop IS 'DEPRECATED: dados do cupom em nfce_itens';
COMMENT ON COLUMN itens_cardapio.cst IS 'DEPRECATED: dados do cupom em nfce_itens';
COMMENT ON COLUMN itens_cardapio.aliquota IS 'DEPRECATED: dados do cupom em nfce_itens';

-- O NCM que já tem 8 dígitos vira o dado fiscal do item (sem perfil: o cadastro continua incompleto até o contador escolher o perfil).
INSERT INTO "nfce_itens" ("item_cardapio_id", "ncm")
SELECT "id", "ncm" FROM "itens_cardapio" WHERE "ncm" ~ '^[0-9]{8}$';
