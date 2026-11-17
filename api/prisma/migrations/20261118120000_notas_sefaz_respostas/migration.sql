-- Respostas à SEFAZ (ciência automática, confirmação ao lançar, "Não reconheço", "A compra não aconteceu"). Nasce tudo desligado.
-- `sefaz_manifestacao` = uma linha por (ambiente, CNPJ) com a chave "Ligar as respostas" e a agenda; `sefaz_eventos_lotes` = diário de cada
-- lote enviado; `sefaz_manifestacoes` = uma linha por evento (a situação muda, o resto não).
CREATE TABLE "sefaz_manifestacao" (
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "ligada" BOOLEAN NOT NULL DEFAULT false,
    "situacao" TEXT NOT NULL DEFAULT 'ok',
    "mensagem" TEXT,
    "pausa_ate" TIMESTAMPTZ(6),
    "falhas_seguidas" INTEGER NOT NULL DEFAULT 0,
    "ligada_em" TIMESTAMPTZ(6),
    "alterada_por" UUID,
    "alterada_por_nome" TEXT,
    "alterada_em" TIMESTAMPTZ(6),
    "criada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sefaz_manifestacao_pkey" PRIMARY KEY ("ambiente", "cnpj"),
    CONSTRAINT "sefaz_manifestacao_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_manifestacao_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_manifestacao_situacao" CHECK ("situacao" IN ('ok', 'parada_certificado', 'parada_configuracao', 'parada_656', 'parada_relogio'))
);

-- Diário dos lotes de evento: aberto antes de enviar (resultado nulo) e fechado na própria linha. Fica fora de `sefaz_consultas`,
-- cuja agenda conta toda linha do (ambiente, CNPJ).
CREATE TABLE "sefaz_eventos_lotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "id_lote" BIGINT NOT NULL,
    "iniciado_em" TIMESTAMPTZ(6) NOT NULL,
    "terminado_em" TIMESTAMPTZ(6),
    "resultado" TEXT,
    "c_stat" INTEGER,
    "x_motivo" TEXT,
    "eventos" INTEGER,
    "erro_code" TEXT,
    CONSTRAINT "sefaz_eventos_lotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_eventos_lotes_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_eventos_lotes_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_eventos_lotes_id_lote" CHECK ("id_lote" BETWEEN 1 AND 999999999999999),
    CONSTRAINT "sefaz_eventos_lotes_resultado" CHECK ("resultado" IS NULL OR "resultado" IN ('respondida', 'falha_antes_de_enviar', 'sem_resposta', 'interrompida'))
);

CREATE INDEX "sefaz_eventos_lotes_ambiente_cnpj_iniciado_em_idx" ON "sefaz_eventos_lotes"("ambiente", "cnpj", "iniciado_em" DESC);

-- Um evento por linha. 210200 confirmação, 210210 ciência, 210220 não reconheço, 210240 a compra não aconteceu (só ele leva `x_just`).
-- `dh_evento` e `dh_reg_evento` guardam o texto como foi assinado/veio; `xml_evento` (assinado) traz o certificado público da folha:
-- nunca vai para log nem para resposta da API.
CREATE TABLE "sefaz_manifestacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nota_sefaz_id" UUID NOT NULL,
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "chave" VARCHAR(44) NOT NULL,
    "tp_evento" TEXT NOT NULL,
    "n_seq" SMALLINT NOT NULL DEFAULT 1,
    "x_just" TEXT,
    "origem" TEXT NOT NULL,
    "pedida_por" UUID,
    "pedida_por_nome" TEXT,
    "pedida_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviar_apos" TIMESTAMPTZ(6) NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'na_fila',
    "tentativas" SMALLINT NOT NULL DEFAULT 0,
    "lote_id" UUID,
    "dh_evento" TEXT,
    "c_stat" INTEGER,
    "x_motivo" TEXT,
    "n_prot" TEXT,
    "dh_reg_evento" TEXT,
    "xml_evento" TEXT,
    "xml_retorno" TEXT,
    "impressao_digital" CHAR(64),
    "criada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sefaz_manifestacoes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_manifestacoes_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_manifestacoes_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_manifestacoes_chave" CHECK ("chave" ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
    CONSTRAINT "sefaz_manifestacoes_tp_evento" CHECK ("tp_evento" IN ('210200', '210210', '210220', '210240')),
    CONSTRAINT "sefaz_manifestacoes_n_seq" CHECK ("n_seq" BETWEEN 1 AND 2),
    CONSTRAINT "sefaz_manifestacoes_x_just" CHECK (("tp_evento" = '210240') = ("x_just" IS NOT NULL) AND ("x_just" IS NULL OR char_length("x_just") BETWEEN 15 AND 255)),
    CONSTRAINT "sefaz_manifestacoes_origem" CHECK ("origem" IN ('ciencia_automatica', 'dar_entrada', 'admin')),
    CONSTRAINT "sefaz_manifestacoes_situacao" CHECK ("situacao" IN ('na_fila', 'enviando', 'registrada', 'recusada', 'falhou', 'cancelada')),
    CONSTRAINT "sefaz_manifestacoes_tentativas" CHECK ("tentativas" BETWEEN 0 AND 3),
    CONSTRAINT "sefaz_manifestacoes_c_stat" CHECK ("c_stat" IS NULL OR "c_stat" BETWEEN 100 AND 9999),
    CONSTRAINT "sefaz_manifestacoes_n_prot" CHECK ("n_prot" IS NULL OR "n_prot" ~ '^[0-9]{15}([0-9]{2})?$')
);

-- Um mesmo evento só uma vez (fora os cancelados) e UMA resposta final ativa por chave (a ciência 210210 não conta como final).
CREATE UNIQUE INDEX "sefaz_manifestacoes_evento_ativo" ON "sefaz_manifestacoes"("ambiente", "chave", "tp_evento", "n_seq") WHERE "situacao" <> 'cancelada';
CREATE UNIQUE INDEX "sefaz_manifestacoes_uma_final" ON "sefaz_manifestacoes"("ambiente", "chave") WHERE "tp_evento" <> '210210' AND "situacao" IN ('na_fila', 'enviando', 'registrada', 'falhou');
CREATE INDEX "sefaz_manifestacoes_ambiente_cnpj_situacao_enviar_apos_idx" ON "sefaz_manifestacoes"("ambiente", "cnpj", "situacao", "enviar_apos");

ALTER TABLE "sefaz_manifestacoes" ADD CONSTRAINT "sefaz_manifestacoes_nota_sefaz_id_fkey" FOREIGN KEY ("nota_sefaz_id") REFERENCES "notas_sefaz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sefaz_manifestacoes" ADD CONSTRAINT "sefaz_manifestacoes_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "sefaz_eventos_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trocas de CHECK (mesmo nome, lista maior).
ALTER TABLE "sefaz_distribuicao_historico" DROP CONSTRAINT "sefaz_distribuicao_historico_evento",
  ADD CONSTRAINT "sefaz_distribuicao_historico_evento" CHECK ("evento" IN ('ligada', 'desligada', 'parada_automatica', 'respostas_ligadas', 'respostas_desligadas', 'respostas_paradas'));
ALTER TABLE "notas_sefaz" DROP CONSTRAINT "notas_sefaz_motivo",
  ADD CONSTRAINT "notas_sefaz_motivo" CHECK ("motivo_ignorar" IS NULL OR "motivo_ignorar" IN ('lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco', 'compra_nao_aconteceu', 'cancelamento_conferido', 'outro'));
