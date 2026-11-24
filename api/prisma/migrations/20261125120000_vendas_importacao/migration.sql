-- Importar vendas de outros sistemas (desenho 2026-11-24-importar-vendas-e-cana-design.md, Parte A). Só aditiva: nenhuma linha
-- existente muda. As 4.474 vendas de hoje continuam sendo da "Planilha padrão do Comanda" (origem nula; R4), sem backfill.
-- Estilo do Prisma (aspas, uma coluna por linha, FK em ALTER TABLE) para a guarda do importador do Lovable enxergar tudo.

-- Sistema de origem das vendas ("PDV Valinhos", "iFood"...). Nunca é apagado: parar de usar = ativo false.
-- O mapeamento das colunas da planilha fica aqui ("Lembrar para este sistema").
CREATE TABLE "vendas_origens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "formato_padrao" TEXT NOT NULL,
    "mapeamento" JSONB,
    "separador_decimal" TEXT NOT NULL DEFAULT 'virgula',
    "prefixo_pedido" TEXT NOT NULL DEFAULT '',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "atualizado_por" UUID,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "vendas_origens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendas_origens_nome_check" CHECK (length(btrim("nome")) BETWEEN 1 AND 60),
    CONSTRAINT "vendas_origens_formato_check" CHECK ("formato_padrao" IN ('planilha', 'xml', 'pdf')),
    CONSTRAINT "vendas_origens_separador_check" CHECK ("separador_decimal" IN ('virgula', 'ponto')),
    CONSTRAINT "vendas_origens_prefixo_check" CHECK (length("prefixo_pedido") <= 10)
);
-- A API compara sem caixa e sem acento antes de gravar (409 ORIGEM_REPETIDA); o banco garante pelo menos sem caixa.
CREATE UNIQUE INDEX "vendas_origens_nome_key" ON "vendas_origens" (lower("nome"));

-- Registro imutável dos cupons (NFC-e 65) e notas (NF-e 55) de venda importados por XML. A venda em `vendas` é uma projeção do documento
-- (como a do cupom do Comanda): cancelado o documento, as linhas de `vendas` dele são apagadas e o registro fica aqui, `cancelada`.
-- Sem o XML (*minha*): quem guarda é o sistema de origem e o contador.
CREATE TABLE "vendas_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chave" VARCHAR(44) NOT NULL,
    "modelo" SMALLINT NOT NULL,
    "serie" INTEGER NOT NULL,
    "numero" BIGINT NOT NULL,
    "emitente_cnpj" VARCHAR(14) NOT NULL,
    "dh_emi" TIMESTAMPTZ(6),
    "valor_total" DECIMAL(15,2),
    "situacao" TEXT NOT NULL,
    "importacao_id" UUID,
    "cancelado_em" TIMESTAMPTZ(6),
    "cancelamento_importacao_id" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "vendas_documentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendas_documentos_chave_check" CHECK ("chave" ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{2}(55|65)[0-9]{22}$'),
    CONSTRAINT "vendas_documentos_modelo_check" CHECK ("modelo" IN (55, 65)),
    CONSTRAINT "vendas_documentos_situacao_check" CHECK ("situacao" IN ('autorizada', 'cancelada')),
    CONSTRAINT "vendas_documentos_cancelado_check" CHECK (("situacao" = 'cancelada') = ("cancelado_em" IS NOT NULL)),
    -- só o cancelamento chega sem a venda: sem data nem valor (a venda que chegar depois é ignorada)
    CONSTRAINT "vendas_documentos_autorizada_check" CHECK ("situacao" = 'cancelada' OR ("dh_emi" IS NOT NULL AND "valor_total" IS NOT NULL))
);
CREATE UNIQUE INDEX "vendas_documentos_chave_key" ON "vendas_documentos" ("chave");
CREATE INDEX "vendas_documentos_importacao_id_idx" ON "vendas_documentos" ("importacao_id");

ALTER TABLE "vendas" ADD COLUMN "documento_id" UUID;
ALTER TABLE "importacoes" ADD COLUMN "origem_id" UUID;
ALTER TABLE "importacoes" ADD COLUMN "formato" TEXT;
ALTER TABLE "importacoes" ADD COLUMN "arquivo_sha256" CHAR(64);
ALTER TABLE "importacoes" ADD COLUMN "chave_idempotencia" UUID;
-- O 2º "Importar" com a mesma chave e o mesmo corpo devolve o resultado guardado (como o cupom fiscal); com outro corpo, 409.
ALTER TABLE "importacoes" ADD COLUMN "corpo_sha256" CHAR(64);
ALTER TABLE "importacoes" ADD COLUMN "resultado" JSONB;
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_formato_check" CHECK ("formato" IS NULL OR "formato" IN ('planilha', 'xml', 'pdf'));

CREATE UNIQUE INDEX "importacoes_chave_idempotencia_key" ON "importacoes" ("chave_idempotencia");
CREATE INDEX "importacoes_origem_id_idx" ON "importacoes" ("origem_id");
-- o "Substituir" por origem e a conta por fonte filtram por aqui
CREATE INDEX "vendas_importacao_id_idx" ON "vendas" ("importacao_id");
CREATE INDEX "vendas_documento_id_idx" ON "vendas" ("documento_id");

ALTER TABLE "vendas" ADD CONSTRAINT "vendas_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "vendas_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "vendas_origens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendas_documentos" ADD CONSTRAINT "vendas_documentos_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendas_documentos" ADD CONSTRAINT "vendas_documentos_cancelamento_importacao_id_fkey" FOREIGN KEY ("cancelamento_importacao_id") REFERENCES "importacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Documento nunca é apagado; o único UPDATE é autorizada → cancelada (com as colunas do cancelamento).
CREATE OR REPLACE FUNCTION vendas_documentos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Documento de venda importado nunca é apagado: o cancelamento só marca.';
  END IF;
  IF old.situacao = 'cancelada' THEN
    RAISE EXCEPTION 'Documento de venda cancelado não muda.';
  END IF;
  IF new.situacao <> 'cancelada'
     OR (new.id, new.chave, new.modelo, new.serie, new.numero, new.emitente_cnpj, new.dh_emi, new.valor_total, new.importacao_id, new.criado_em)
        IS DISTINCT FROM
        (old.id, old.chave, old.modelo, old.serie, old.numero, old.emitente_cnpj, old.dh_emi, old.valor_total, old.importacao_id, old.criado_em) THEN
    RAISE EXCEPTION 'Documento de venda importado: só o cancelamento muda a situação.';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER vendas_documentos_imutavel BEFORE UPDATE OR DELETE ON vendas_documentos FOR EACH ROW EXECUTE FUNCTION vendas_documentos_imutavel();

-- Cancelamento de um documento de venda importado (A.4), idempotente, no estilo de `nfce_desfazer_venda`. Devolve as linhas de `vendas`
-- apagadas (as baixas de estoque caem em cascata: movimentacoes.venda_id ON DELETE CASCADE). Apagar, e não lançar estorno: o estorno
-- contaria um pedido a mais. Documento ainda não importado = grava já `cancelada`, só com o que a chave diz, para a venda que chegar
-- depois ser ignorada. A API confere antes o dígito da chave, o CNPJ da loja e que a chave não é de um cupom do próprio Comanda.
CREATE OR REPLACE FUNCTION vendas_documento_cancelar(_chave text, _importacao uuid, _quando timestamptz) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  d vendas_documentos%ROWTYPE;
  n int := 0;
BEGIN
  IF _chave IS NULL OR _chave !~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{2}(55|65)[0-9]{22}$' THEN
    RAISE EXCEPTION 'Chave de acesso inválida no cancelamento.';
  END IF;
  SELECT * INTO d FROM vendas_documentos WHERE chave = _chave FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO vendas_documentos (chave, modelo, serie, numero, emitente_cnpj, situacao, cancelado_em, cancelamento_importacao_id)
    VALUES (_chave, substr(_chave, 21, 2)::smallint, substr(_chave, 23, 3)::int, substr(_chave, 26, 9)::bigint, substr(_chave, 7, 14),
            'cancelada', coalesce(_quando, now()), _importacao);
    RETURN 0;
  END IF;
  IF d.situacao = 'cancelada' THEN
    RETURN 0;
  END IF;
  DELETE FROM vendas WHERE documento_id = d.id;
  GET DIAGNOSTICS n = row_count;
  UPDATE vendas_documentos SET situacao = 'cancelada', cancelado_em = coalesce(_quando, now()), cancelamento_importacao_id = _importacao
   WHERE id = d.id;
  RETURN n;
END $$;
