import { describe, expect, it } from 'vitest';
import { delta, resumo, type Ficha } from '../vendas';

const v = (pedido: string, item: string | null, quantidade: number, valor_total: number) => ({
  pedido, data: '2026-10-20', hora: null, produto_relatorio: 'X', item_cardapio_id: item, quantidade, valor_total, preco_unitario: 0,
});

describe('resumo de vendas', () => {
  const fichas = new Map<string, Ficha>([['a', { id: 'a', nome: 'A', categoria: 'C', custo_total: 4, preco_venda: 10 }]]);
  const r = resumo([v('1', 'a', 2, 20), v('1', null, 1, 15), v('2', 'a', 1, 10)], fichas);
  it('faturamento, pedidos e ticket', () => {
    expect(r.fat).toBe(45);
    expect(r.pedidos).toBe(2);
    expect(r.ticket).toBe(22.5);
  });
  it('CMV teórico só das vendas com ficha', () => {
    expect(r.cmv).toBe(12);
    expect(r.cmvPct).toBeCloseTo(26.67, 1);
  });
  it('variação contra o período anterior', () => {
    expect(delta(110, 100)).toBeCloseTo(10);
    expect(delta(1, 0)).toBeNull();
  });
});
