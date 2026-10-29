import { fichasResumo, listarVendas, type FichaResumo, type Venda } from './erp-api';

export type { Venda };
export type Ficha = { id: string; nome: string; categoria: string; custo_total: number; preco_venda: number | null };

export const carregarVendas = (ini: string, fim: string) => listarVendas(ini, fim);
export const carregarFichasResumo = (): Promise<FichaResumo[]> => fichasResumo();

export function resumo(vendas: Venda[], fichas: Map<string, Ficha>) {
  const fat = vendas.reduce((s, v) => s + Number(v.valor_total), 0);
  const pedidos = new Set(vendas.map((v) => v.pedido)).size;
  const itens = vendas.reduce((s, v) => s + Number(v.quantidade), 0);
  const cmv = vendas.reduce((s, v) => s + (v.item_cardapio_id ? (fichas.get(v.item_cardapio_id)?.custo_total ?? 0) * Number(v.quantidade) : 0), 0);
  return { fat, pedidos, itens, ticket: pedidos ? fat / pedidos : 0, itensPorPedido: pedidos ? itens / pedidos : 0, cmv, cmvPct: fat ? (cmv / fat) * 100 : 0 };
}

export const delta = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
