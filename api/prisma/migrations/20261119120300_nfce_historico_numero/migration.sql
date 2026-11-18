-- Onda final do cupom fiscal (item 2): o número pulado à mão deixa rastro. Cada troca do "Número do próximo cupom" em Configurações grava
-- no histórico a série que vale depois dela e o próximo número de antes e de depois (número não é segredo; o CSC continua só pelo nome),
-- e o `numeros-nao-usados.csv` do zip do mês lista a faixa pulada. Migração própria: as anteriores não mudam. Colunas nulas, sem padrão:
-- as linhas antigas (e as de CSC, IdCSC, ligar e desligar) ficam sem os números.
ALTER TABLE "nfce_ambientes_historico" ADD COLUMN "serie" INTEGER;
ALTER TABLE "nfce_ambientes_historico" ADD COLUMN "numero_antes" BIGINT;
ALTER TABLE "nfce_ambientes_historico" ADD COLUMN "numero_depois" BIGINT;
-- os dois números juntos, com a série, na faixa do próximo número (o mesmo CHECK de `nfce_ambientes`)
ALTER TABLE "nfce_ambientes_historico" ADD CONSTRAINT "nfce_ambientes_historico_numero" CHECK (
    ("numero_antes" IS NULL AND "numero_depois" IS NULL)
    OR ("serie" IS NOT NULL AND "numero_antes" BETWEEN 1 AND 999999999 AND "numero_depois" BETWEEN 1 AND 999999999)
);
