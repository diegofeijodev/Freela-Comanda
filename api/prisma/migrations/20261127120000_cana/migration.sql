-- Controle da cana (desenho 2026-11-24-importar-vendas-e-cana-design.md, Parte B): recebimento em dúzias, produção de caldo em
-- litros e contagem do que sobrou. Módulo próprio: só LÊ vendas e itens_cardapio; não toca em movimentacoes, inventário nem CMV.
-- A conta da semana é a função pura api/src/modules/cana/apuracao.ts (2ª exceção à "regra em SQL", depois do ponto).
-- Multiempresa: esta migração roda em cada schema de empresa. Sem FK para users (os usuários só existem em public): quem lançou
-- fica como uuid + nome fotografado. Os parâmetros nascem no primeiro "Salvar" (sem semente). Só acrescenta.

-- Linha única (id = 1). Nulo = "não informado" (nada vem preenchido).
CREATE TABLE "cana_parametros" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "litros_por_duzia_esperado" DECIMAL(10,3),
    "rendimento_frozen" DECIMAL(10,4),
    "atualizado_por" UUID,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMPTZ(6),

    CONSTRAINT "cana_parametros_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cana_parametros_linha_unica" CHECK ("id" = 1),
    CONSTRAINT "cana_parametros_esperado_check" CHECK ("litros_por_duzia_esperado" IS NULL OR "litros_por_duzia_esperado" > 0),
    CONSTRAINT "cana_parametros_frozen_check" CHECK ("rendimento_frozen" IS NULL OR "rendimento_frozen" > 0)
);

-- Cada "Salvar os números" acrescenta uma linha (quem, quando, os dois valores). Nunca muda nem sai (gatilho).
CREATE TABLE "cana_parametros_historico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "litros_por_duzia_esperado" DECIMAL(10,3),
    "rendimento_frozen" DECIMAL(10,4),
    "alterado_por" UUID NOT NULL,
    "alterado_por_nome" TEXT NOT NULL,
    "alterado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "cana_parametros_historico_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cana_parametros_historico_alterado_em_idx" ON "cana_parametros_historico"("alterado_em");

-- Item do cardápio que leva caldo: ml de 1 unidade (no frozen, o tamanho do copo de frozen) e a marca frozen.
CREATE TABLE "cana_produtos" (
    "item_cardapio_id" UUID NOT NULL,
    "ml_por_unidade" DECIMAL(10,2) NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_por" UUID,
    "atualizado_por_nome" TEXT,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "cana_produtos_pkey" PRIMARY KEY ("item_cardapio_id"),
    CONSTRAINT "cana_produtos_ml_check" CHECK ("ml_por_unidade" > 0)
);
ALTER TABLE "cana_produtos" ADD CONSTRAINT "cana_produtos_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Livro só de acréscimo: corrigir = anular com motivo + lançar de novo com substitui_id (na mesma transação).
CREATE TABLE "cana_lancamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "duzias" DECIMAL(10,2),
    "litros_caldo" DECIMAL(10,3),
    "litros_frozen" DECIMAL(10,3),
    "fornecedor" TEXT,
    "observacao" TEXT,
    "substitui_id" UUID,
    "chave_idempotencia" UUID,
    "lancado_por" UUID NOT NULL,
    "lancado_por_nome" TEXT NOT NULL,
    "lancado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "anulado_em" TIMESTAMPTZ(6),
    "anulado_por" UUID,
    "anulado_por_nome" TEXT,
    "anulado_motivo" TEXT,

    CONSTRAINT "cana_lancamentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cana_lancamentos_tipo_check" CHECK ("tipo" IN ('recebimento', 'producao', 'contagem')),
    CONSTRAINT "cana_lancamentos_campos_check" CHECK (
      ("tipo" = 'recebimento' AND "duzias" IS NOT NULL AND "duzias" > 0 AND "litros_caldo" IS NULL AND "litros_frozen" IS NULL)
      OR ("tipo" = 'producao' AND "litros_caldo" IS NOT NULL AND "litros_caldo" > 0 AND ("duzias" IS NULL OR "duzias" > 0)
          AND "litros_frozen" IS NULL AND "fornecedor" IS NULL)
      OR ("tipo" = 'contagem' AND "duzias" IS NOT NULL AND "duzias" >= 0 AND "litros_caldo" IS NOT NULL AND "litros_caldo" >= 0
          AND ("litros_frozen" IS NULL OR "litros_frozen" >= 0) AND "fornecedor" IS NULL)
    ),
    CONSTRAINT "cana_lancamentos_anulacao_check" CHECK (
      ("anulado_em" IS NULL) = ("anulado_motivo" IS NULL) AND ("anulado_em" IS NULL) = ("anulado_por" IS NULL)
      AND ("anulado_motivo" IS NULL OR length(btrim("anulado_motivo")) >= 3)
    )
);
CREATE UNIQUE INDEX "cana_lancamentos_substitui_id_key" ON "cana_lancamentos"("substitui_id");
CREATE UNIQUE INDEX "cana_lancamentos_chave_idempotencia_key" ON "cana_lancamentos"("chave_idempotencia");
CREATE INDEX "cana_lancamentos_data_idx" ON "cana_lancamentos"("data");
CREATE INDEX "cana_lancamentos_lancado_por_lancado_em_idx" ON "cana_lancamentos"("lancado_por", "lancado_em");
ALTER TABLE "cana_lancamentos" ADD CONSTRAINT "cana_lancamentos_substitui_id_fkey" FOREIGN KEY ("substitui_id") REFERENCES "cana_lancamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Uma contagem ativa por dia (o Prisma não escreve índice parcial: um `prisma migrate dev` vai querer apagá-lo; não aceite).
CREATE UNIQUE INDEX "cana_uma_contagem_por_dia" ON "cana_lancamentos"("data") WHERE "tipo" = 'contagem' AND "anulado_em" IS NULL;

-- Sem DELETE; UPDATE só preenche a anulação, uma vez.
CREATE OR REPLACE FUNCTION cana_lancamentos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Lançamento da cana nunca é apagado: anule com motivo.';
  END IF;
  IF old.anulado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento da cana anulado não muda.';
  END IF;
  IF new.anulado_em IS NULL
     OR (new.id, new.tipo, new.data, new.duzias, new.litros_caldo, new.litros_frozen, new.fornecedor, new.observacao, new.substitui_id,
         new.chave_idempotencia, new.lancado_por, new.lancado_por_nome, new.lancado_em)
        IS DISTINCT FROM
        (old.id, old.tipo, old.data, old.duzias, old.litros_caldo, old.litros_frozen, old.fornecedor, old.observacao, old.substitui_id,
         old.chave_idempotencia, old.lancado_por, old.lancado_por_nome, old.lancado_em) THEN
    RAISE EXCEPTION 'Lançamento da cana: só a anulação muda o registro.';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER cana_lancamentos_imutavel BEFORE UPDATE OR DELETE ON cana_lancamentos FOR EACH ROW EXECUTE FUNCTION cana_lancamentos_imutavel();

CREATE OR REPLACE FUNCTION cana_parametros_historico_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico dos números da cana não muda nem sai.';
END $$;
CREATE TRIGGER cana_parametros_historico_imutavel BEFORE UPDATE OR DELETE ON cana_parametros_historico FOR EACH ROW EXECUTE FUNCTION cana_parametros_historico_imutavel();
