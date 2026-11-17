-- Quando o lote de um evento saiu para a SEFAZ (revisão final da entrega 3, decisão do controlador): a T2 grava `saiu_em` em todo evento de
-- um lote que pode ter chegado lá (respondido ou sem resposta útil) e a T1 no lote interrompido; nunca é apagado. É a prova de que o evento
-- já saiu mesmo depois de um "Tentar de novo" (tentativas zeradas) seguido de um lote que falhou antes de enviar (que troca o `lote_id`).
-- Migração própria: as anteriores não mudam. Coluna nula, sem padrão: as linhas antigas ficam nulas (a regra também olha o lote).
ALTER TABLE "sefaz_manifestacoes" ADD COLUMN "saiu_em" TIMESTAMPTZ(6);
