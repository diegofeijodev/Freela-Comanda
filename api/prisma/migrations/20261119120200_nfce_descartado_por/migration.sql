-- Leva pré-final do cupom fiscal (antes da Tarefa 17; Ruling T14): quem descartou o cupom, para a tela mostrar "Descartado às 14h12 por
-- Ana" (UX 3.1). Migração própria: a 20261119120000_nfce não muda. Colunas nulas, sem padrão: os descartes antigos ficam sem o nome.
-- Sem chave estrangeira, como `emitido_por` (a conta pode sair; o nome fica).
ALTER TABLE "nfce_cupons" ADD COLUMN "descartado_por" UUID;
ALTER TABLE "nfce_cupons" ADD COLUMN "descartado_por_nome" TEXT;
