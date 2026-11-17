-- Índices das duas chaves estrangeiras de `sefaz_manifestacoes` (revisão da Tarefa 1): a caixa e a fila leem os eventos por nota, e o
-- `jaEnviada` e a T2 olham o lote. Migração própria: a `20261118120000_notas_sefaz_respostas` não muda.
CREATE INDEX "sefaz_manifestacoes_nota_sefaz_id_idx" ON "sefaz_manifestacoes"("nota_sefaz_id");
CREATE INDEX "sefaz_manifestacoes_lote_id_idx" ON "sefaz_manifestacoes"("lote_id");
