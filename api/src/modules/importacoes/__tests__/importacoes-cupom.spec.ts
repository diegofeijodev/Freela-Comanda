import type { PrismaService } from '../../../common/database/prisma.service';
import { dayToDb } from '../../../common/time/dates';
import { ImportacoesService } from '../importacoes.service';

// A venda do cupom fiscal (`vendas.nfce_cupom_id` preenchido) é lançada pelo cupom autorizado e só sai pelo cancelamento (desenho §3.3):
// o "Substituir" da importação de vendas e o `mapear` do de-para só mexem nas vendas que vieram da importação (`nfce_cupom_id` nulo).

function montar() {
  const tx = {
    importacoes: { create: jest.fn(async () => ({ id: 'imp-1' })) },
    itens_cardapio: { findMany: jest.fn(async () => [{ id: 'item-1', nome: 'Espetinho de carne' }]) },
    de_para_produtos: {
      findMany: jest.fn(async () => [{ produto_relatorio: 'ESPETO CARNE', item_cardapio_id: 'item-1' }]),
      createMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
    },
    vendas: {
      deleteMany: jest.fn(async () => ({ count: 4 })),
      createMany: jest.fn(async (a: { data: unknown[] }) => ({ count: a.data.length })),
      updateMany: jest.fn(async () => ({ count: 2 })),
    },
  };
  const prisma = {
    de_para_produtos: { findUnique: jest.fn(async () => ({ produto_relatorio: 'ESPETO CARNE', item_cardapio_id: null })) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { svc: new ImportacoesService(prisma as unknown as PrismaService), tx };
}

const linha = (data: string, pedido: string) => ({
  pedido,
  data,
  hora: '12:00',
  produto_relatorio: 'ESPETO CARNE',
  quantidade: '1',
  preco_unitario: '25,00',
  valor_total: '25,00',
});

describe('importação de vendas e a venda do cupom fiscal', () => {
  it('"Substituir" (rota antiga = planilha padrão, R4) apaga só as vendas da planilha padrão do período: nunca as do cupom, as de XML nem as de outro sistema', async () => {
    const { svc, tx } = montar();
    const r = await svc.vendas({ modo: 'substituir', linhas: [linha('2026-11-17', '10'), linha('2026-11-15', '11')] }, 'u-1');
    expect(tx.vendas.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.vendas.deleteMany).toHaveBeenCalledWith({
      where: {
        nfce_cupom_id: null,
        documento_id: null,
        OR: [{ importacao_id: null }, { importacoes: { is: { origem_id: null } } }],
        data: { gte: dayToDb('2026-11-15'), lte: dayToDb('2026-11-17') },
      },
    });
    expect(r.apagadas).toBe(4);
  });

  it('"Acrescentar" não apaga nada', async () => {
    const { svc, tx } = montar();
    await svc.vendas({ modo: 'acrescentar', linhas: [linha('2026-11-17', '10')] }, 'u-1');
    expect(tx.vendas.deleteMany).not.toHaveBeenCalled();
  });

  it('mapear reaponta só as vendas da importação (nfce_cupom_id nulo): a venda do cupom já nasce com o item certo', async () => {
    const { svc, tx } = montar();
    const r = await svc.mapear('ESPETO CARNE', 'item-2');
    expect(tx.vendas.updateMany).toHaveBeenCalledWith({
      where: { produto_relatorio: 'ESPETO CARNE', nfce_cupom_id: null },
      data: { item_cardapio_id: 'item-2' },
    });
    expect(r).toEqual({ vendas: 2 });
  });
});
