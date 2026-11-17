-- Aviso de nota repetida: `repetida_de` guarda o id da nota parecida que o admin confirmou ser outra nota (rastro da confirmação).
-- O índice por CNPJ do fornecedor atende a consulta prévia e a conferência no lançamento.
ALTER TABLE "notas_entrada" ADD COLUMN "repetida_de" UUID;

ALTER TABLE "notas_entrada" ADD CONSTRAINT "notas_entrada_repetida_de_fkey" FOREIGN KEY ("repetida_de") REFERENCES "notas_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notas_entrada_fornecedor_cnpj_idx" ON "notas_entrada"("fornecedor_cnpj");
