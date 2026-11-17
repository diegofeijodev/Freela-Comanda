-- Notas da SEFAZ (distribuição de DF-e, só leitura). Tabelas próprias: não existem no Lovable.
-- `sefaz_distribuicao` = uma linha por (ambiente, CNPJ) com o ponteiro NSU e a agenda; nasce desligada.
-- `sefaz_consultas` = diário de cada consulta (prova de que as esperas foram respeitadas); `sefaz_documentos` = guarda do XML recebido;
-- `notas_sefaz` = a caixa "Notas da SEFAZ" da Entrada de Notas.
CREATE TABLE "sefaz_distribuicao" (
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "busca_ligada" BOOLEAN NOT NULL DEFAULT false,
    "situacao" TEXT NOT NULL DEFAULT 'ok',
    "mensagem" TEXT,
    "aviso" TEXT,
    "ult_nsu" BIGINT NOT NULL DEFAULT 0,
    "max_nsu" BIGINT,
    "primeira_consulta_em" TIMESTAMPTZ(6),
    "ultima_consulta_em" TIMESTAMPTZ(6),
    "proxima_consulta_em" TIMESTAMPTZ(6),
    "bloqueado_ate" TIMESTAMPTZ(6),
    "em_andamento_desde" TIMESTAMPTZ(6),
    "falhas_seguidas" INTEGER NOT NULL DEFAULT 0,
    "alterada_por" UUID,
    "alterada_por_nome" TEXT,
    "alterada_em" TIMESTAMPTZ(6),
    "criada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sefaz_distribuicao_pkey" PRIMARY KEY ("ambiente", "cnpj"),
    CONSTRAINT "sefaz_distribuicao_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_distribuicao_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_distribuicao_situacao" CHECK ("situacao" IN ('ok', 'parada_certificado', 'parada_configuracao', 'parada_conflito', 'parada_656')),
    CONSTRAINT "sefaz_distribuicao_ult_nsu" CHECK ("ult_nsu" >= 0)
);

-- Trilha de quem ligou e desligou a busca (e das paradas automáticas). Só inserção.
CREATE TABLE "sefaz_distribuicao_historico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "evento" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "c_stat" INTEGER,
    "mensagem" TEXT,
    "feito_por" UUID,
    "feito_por_nome" TEXT,
    "feito_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sefaz_distribuicao_historico_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_distribuicao_historico_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_distribuicao_historico_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_distribuicao_historico_evento" CHECK ("evento" IN ('ligada', 'desligada', 'parada_automatica'))
);

CREATE INDEX "sefaz_distribuicao_historico_ambiente_cnpj_feito_em_idx" ON "sefaz_distribuicao_historico"("ambiente", "cnpj", "feito_em" DESC);

-- Diário das consultas: uma linha por pedido à SEFAZ, aberta antes de enviar (resultado nulo) e fechada na própria linha.
-- `ciclo_id` agrupa as páginas de um mesmo ciclo; `dh_resp` guarda o texto como veio, para nunca falhar.
CREATE TABLE "sefaz_consultas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ciclo_id" UUID NOT NULL,
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "servico" TEXT NOT NULL DEFAULT 'distNSU',
    "origem" TEXT NOT NULL,
    "iniciada_por" UUID,
    "iniciada_por_nome" TEXT,
    "ult_nsu_enviado" BIGINT NOT NULL,
    "iniciada_em" TIMESTAMPTZ(6) NOT NULL,
    "terminada_em" TIMESTAMPTZ(6),
    "resultado" TEXT,
    "c_stat" INTEGER,
    "x_motivo" TEXT,
    "dh_resp" TEXT,
    "ult_nsu" BIGINT,
    "max_nsu" BIGINT,
    "documentos" INTEGER,
    "erro_code" TEXT,
    CONSTRAINT "sefaz_consultas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_consultas_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_consultas_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_consultas_servico" CHECK ("servico" IN ('distNSU')),
    CONSTRAINT "sefaz_consultas_origem" CHECK ("origem" IN ('agendada', 'botao')),
    CONSTRAINT "sefaz_consultas_resultado" CHECK ("resultado" IS NULL OR "resultado" IN ('respondida', 'falha_antes_de_enviar', 'sem_resposta', 'interrompida'))
);

CREATE INDEX "sefaz_consultas_ambiente_cnpj_iniciada_em_idx" ON "sefaz_consultas"("ambiente", "cnpj", "iniciada_em" DESC);

-- Buracos na sequência de NSU (outro sistema consumiu a faixa, ou a resposta se perdeu).
CREATE TABLE "sefaz_lacunas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "nsu_de" BIGINT NOT NULL,
    "nsu_ate" BIGINT NOT NULL,
    "causa" TEXT NOT NULL,
    "consulta_id" UUID NOT NULL,
    "detectada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preenchida_em" TIMESTAMPTZ(6),
    CONSTRAINT "sefaz_lacunas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_lacunas_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_lacunas_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_lacunas_faixa" CHECK ("nsu_ate" >= "nsu_de"),
    CONSTRAINT "sefaz_lacunas_causa" CHECK ("causa" IN ('outro_sistema', 'resposta_perdida'))
);

-- Documentos recebidos (um por NSU). Só inserção; é também a guarda do XML. `conteudo_bruto` só existe quando o tipo é `ilegivel`.
CREATE TABLE "sefaz_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "nsu" BIGINT NOT NULL,
    "schema" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" VARCHAR(44),
    "tp_evento" VARCHAR(6),
    "xml" TEXT,
    "conteudo_bruto" TEXT,
    "consulta_id" UUID NOT NULL,
    "recebido_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMPTZ(6),
    "erro_processamento" TEXT,
    CONSTRAINT "sefaz_documentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sefaz_documentos_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "sefaz_documentos_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "sefaz_documentos_tipo" CHECK ("tipo" IN ('resNFe', 'procNFe', 'resEvento', 'procEventoNFe', 'outro', 'ilegivel')),
    CONSTRAINT "sefaz_documentos_ilegivel" CHECK (("tipo" = 'ilegivel') = ("conteudo_bruto" IS NOT NULL))
);

CREATE UNIQUE INDEX "sefaz_documentos_ambiente_cnpj_nsu_key" ON "sefaz_documentos"("ambiente", "cnpj", "nsu");
CREATE INDEX "sefaz_documentos_chave_idx" ON "sefaz_documentos"("chave");

-- A caixa "Notas da SEFAZ": uma linha por chave de acesso e ambiente. As colunas `ignorada_*`/`motivo_*` guardam a última ação do admin.
CREATE TABLE "notas_sefaz" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ambiente" TEXT NOT NULL,
    "cnpj_destinatario" CHAR(14) NOT NULL,
    "chave" VARCHAR(44) NOT NULL,
    "emitente_cnpj" VARCHAR(14) NOT NULL,
    "emitente_nome" TEXT NOT NULL DEFAULT '',
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "emitida_em" TIMESTAMPTZ(6),
    "autorizada_em" TIMESTAMPTZ(6),
    "valor_total" NUMERIC(15,2),
    "tp_nf" SMALLINT,
    "fin_nfe" SMALLINT,
    "nat_op" TEXT,
    "situacao_sefaz" TEXT NOT NULL,
    "cancelada_em" TIMESTAMPTZ(6),
    "resumo_id" UUID,
    "documento_completo_id" UUID,
    "ignorada_em" TIMESTAMPTZ(6),
    "ignorada_por" UUID,
    "ignorada_por_nome" TEXT,
    "motivo_ignorar" TEXT,
    "motivo_texto" TEXT,
    "criada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notas_sefaz_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notas_sefaz_ambiente" CHECK ("ambiente" IN ('producao', 'homologacao')),
    CONSTRAINT "notas_sefaz_cnpj_destinatario" CHECK ("cnpj_destinatario" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "notas_sefaz_chave" CHECK ("chave" ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
    CONSTRAINT "notas_sefaz_situacao" CHECK ("situacao_sefaz" IN ('autorizada', 'denegada', 'cancelada')),
    CONSTRAINT "notas_sefaz_motivo" CHECK ("motivo_ignorar" IS NULL OR "motivo_ignorar" IN ('lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco', 'cancelamento_conferido', 'outro')),
    CONSTRAINT "notas_sefaz_ignorada_motivo" CHECK (("ignorada_em" IS NULL) = ("motivo_ignorar" IS NULL)),
    CONSTRAINT "notas_sefaz_motivo_outro" CHECK ("motivo_ignorar" IS DISTINCT FROM 'outro' OR length(btrim(COALESCE("motivo_texto", ''))) > 0)
);

CREATE UNIQUE INDEX "notas_sefaz_ambiente_chave_key" ON "notas_sefaz"("ambiente", "chave");
CREATE INDEX "notas_sefaz_ambiente_emitida_em_idx" ON "notas_sefaz"("ambiente", "emitida_em" DESC);
CREATE INDEX "notas_sefaz_emitente_cnpj_numero_idx" ON "notas_sefaz"("emitente_cnpj", "numero");

ALTER TABLE "sefaz_lacunas" ADD CONSTRAINT "sefaz_lacunas_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "sefaz_consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sefaz_documentos" ADD CONSTRAINT "sefaz_documentos_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "sefaz_consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notas_sefaz" ADD CONSTRAINT "notas_sefaz_resumo_id_fkey" FOREIGN KEY ("resumo_id") REFERENCES "sefaz_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notas_sefaz" ADD CONSTRAINT "notas_sefaz_documento_completo_id_fkey" FOREIGN KEY ("documento_completo_id") REFERENCES "sefaz_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
