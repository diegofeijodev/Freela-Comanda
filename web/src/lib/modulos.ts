// Telas que o admin da loja pode liberar ao colaborador. Mesmas chaves de `MODULOS` em
// api/src/common/decorators/permissao.decorator.ts — mudar uma = mudar a outra.
// `loja: true` = a tela tem a "visão da loja" (contagem cega, fichas e listas sem custo, só o terminal do ponto): o colaborador vê
// essa visão. As demais abrem a tela inteira, com custos, preços e financeiro — liberar é decisão do admin.
export const MODULOS = [
  { chave: 'painel', label: 'Início', loja: true },
  { chave: 'vendas', label: 'Vendas', loja: false },
  { chave: 'cupom', label: 'Cupom Fiscal', loja: false },
  { chave: 'fichas', label: 'Fichas Técnicas', loja: true },
  { chave: 'inventario', label: 'Inventário', loja: true },
  { chave: 'estoque', label: 'Estoque & Movimentações', loja: false },
  { chave: 'objetivo', label: 'Estoque Objetivo', loja: false },
  { chave: 'compras', label: 'Lista de Compras', loja: true },
  { chave: 'notas', label: 'Entrada de Notas', loja: false },
  { chave: 'contas', label: 'Contas a Pagar', loja: false },
  { chave: 'caixa', label: 'Conciliação de Caixa', loja: false },
  { chave: 'ponto', label: 'Ponto (terminal)', loja: true },
  { chave: 'dre', label: 'DRE', loja: false },
  { chave: 'importar', label: 'Importar Dados', loja: false },
] as const;
export type Modulo = (typeof MODULOS)[number]['chave'];

/** As telas que a loja sempre viu (padrão de um colaborador novo). */
export const MODULOS_PADRAO: Modulo[] = ['painel', 'fichas', 'inventario', 'compras', 'ponto'];

export const nomeEmpresa = (e: { nome_fantasia: string | null; razao_social: string }) => e.nome_fantasia || e.razao_social;
