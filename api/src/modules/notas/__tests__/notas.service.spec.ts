/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória, formato livre */
import type { PrismaService } from '../../../common/database/prisma.service';
import type { LancarNotaDto } from '../dto/notas.dto';
import { NotasService } from '../notas.service';

const VETOR = '35261112ABC34501DE35550010000044111000044116';
const VETOR_ENTRADA = '35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16';
const DV_ERRADO = '35261112ABC34501DE35550010000044111000044111';

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  numero: '000.004.411',
  serie: '001',
  fornecedor_nome: 'Atacadão Smoke',
  fornecedor_cnpj: '12ABC34501DE35',
  data_emissao: new Date('2026-11-03T00:00:00Z'),
  data_entrada: new Date('2026-11-03T00:00:00Z'),
  valor_total: 1234.56,
  origem: 'xml',
  created_at: new Date('2026-11-03T15:00:00Z'),
  ...extra,
});

function montar(existente = false, parecidas: any[] = []) {
  const chamadas: Record<string, any[]> = {
    findUnique: [],
    create: [],
    transaction: [],
    executeRaw: [],
    itensCreateMany: [],
    contasCreateMany: [],
    fornCreateMany: [],
    fornFindFirst: [],
    vinculos: [],
    findMany: [],
  };
  const tx = {
    notas_entrada: { create: async (a: any) => (chamadas.create.push(a), { id: 'n1' }) },
    itens_estoque: { findMany: async () => [] },
    subgrupos: { findMany: async () => [] },
    notas_entrada_itens: { createMany: async (a: any) => void chamadas.itensCreateMany.push(a) },
    contas_pagar: { createMany: async (a: any) => void chamadas.contasCreateMany.push(a) },
    fornecedores: {
      findFirst: async (a: any) => (chamadas.fornFindFirst.push(a), null),
      createMany: async (a: any) => void chamadas.fornCreateMany.push(a),
    },
    $executeRaw: async (...a: any[]) => void chamadas.executeRaw.push(a),
  };
  const prisma = {
    notas_entrada: {
      findUnique: async (a: any) => (chamadas.findUnique.push(a), existente ? { ...linha('x'), numero: '4411' } : null),
      findMany: async (a: any) => (chamadas.findMany.push(a), parecidas),
    },
    vinculos_produto: { findMany: async (a: any) => (chamadas.vinculos.push(a), []) },
    $transaction: async (cb: any) => (chamadas.transaction.push(1), cb(tx)),
  } as unknown as PrismaService;
  return { svc: new NotasService(prisma), chamadas };
}

const dto = (extra: Partial<LancarNotaDto> = {}): LancarNotaDto => ({
  chave: VETOR,
  numero: '4411',
  serie: '1',
  fornecedor_nome: 'Atacadão Smoke',
  fornecedor_cnpj: '12.abc.345/01de-35',
  data_entrada: '2026-11-16',
  valor_total: 10,
  forma_pagamento: 'pix',
  origem: 'xml',
  atualizar_preco: false,
  itens: [{ descricao: 'CAIXA', quantidade: 1, valor_unitario: 10 }],
  parcelas: [],
  ...extra,
});

describe('NotasService (CNPJ e chave com letras)', () => {
  it('DV errado: 400 CHAVE_INVALIDA sem tocar no Prisma', async () => {
    const { svc, chamadas } = montar();
    await expect(svc.lancar(dto({ chave: DV_ERRADO }), 'u1')).rejects.toMatchObject({
      status: 400,
      response: { code: 'CHAVE_INVALIDA', message: 'A chave de acesso da nota é inválida. Confira os 44 caracteres.' },
    });
    expect(Object.values(chamadas).flat()).toHaveLength(0);
  });

  it('chave do vetor em minúsculas e com espaços: findUnique e create recebem maiúsculas', async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(dto({ chave: VETOR_ENTRADA }), 'u1');
    expect(chamadas.findUnique[0].where.chave).toBe(VETOR);
    expect(chamadas.create[0].data.chave).toBe(VETOR);
  });

  it("chave '  ': sem findUnique e chave null", async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(dto({ chave: '  ' }), 'u1');
    expect(chamadas.findUnique).toHaveLength(0);
    expect(chamadas.create[0].data.chave).toBeNull();
  });

  it('ordem: boleto sem parcelas e chave inválida dão "Informe o vencimento de cada parcela"', async () => {
    const { svc } = montar();
    await expect(svc.lancar(dto({ chave: DV_ERRADO, forma_pagamento: 'boleto', parcelas: [] }), 'u1')).rejects.toMatchObject({
      response: { message: 'Informe o vencimento de cada parcela' },
    });
  });

  it('chave existente: 409 DUPLICADO', async () => {
    const { svc } = montar(true);
    await expect(svc.lancar(dto(), 'u1')).rejects.toMatchObject({ status: 409, response: { code: 'DUPLICADO' } });
  });

  it('fornecedor_cnpj com letras vira maiúsculo sem pontuação, também no fornecedor novo', async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(dto({ fornecedor_cnpj: '12.abc.345/01de-35' }), 'u1');
    expect(chamadas.create[0].data.fornecedor_cnpj).toBe('12ABC34501DE35');
    expect(chamadas.fornCreateMany[0].data[0].cnpj).toBe('12ABC34501DE35');
  });

  it('CPF só com números continua só números', async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(dto({ fornecedor_cnpj: '123.456.789-09' }), 'u1');
    expect(chamadas.create[0].data.fornecedor_cnpj).toBe('12345678909');
  });

  it("fornecedor_cnpj '' vira null e não cria fornecedor", async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(dto({ fornecedor_cnpj: '' }), 'u1');
    expect(chamadas.create[0].data.fornecedor_cnpj).toBeNull();
    expect(chamadas.fornCreateMany).toHaveLength(0);
  });

  it('existe() consulta a chave normalizada', async () => {
    const { svc, chamadas } = montar();
    await svc.existe(` ${VETOR.toLowerCase()} `);
    expect(chamadas.findUnique[0].where.chave).toBe(VETOR);
  });

  it('vinculos() consulta o CNPJ normalizado', async () => {
    const { svc, chamadas } = montar();
    await svc.vinculos('12.345.678/0001-99');
    expect(chamadas.vinculos[0].where.fornecedor_cnpj).toBe('12345678000199');
  });

  it('existe() devolve os dados da nota', async () => {
    const { svc } = montar(true);
    const r = await svc.existe(VETOR);
    expect(r.existe).toBe(true);
    expect(r.nota?.numero).toBe('4411');
    expect((await montar().svc.existe(VETOR)).nota).toBeNull();
  });
});

describe('NotasService (nota repetida)', () => {
  const FRASE =
    'Já existe a NF 000.004.411 série 001 de Atacadão Smoke, lançada em 03/11/2026 por XML, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.';
  const semChave = (extra: Partial<LancarNotaDto> = {}) => dto({ chave: null, ...extra });

  it('sem confirmação: 409 NOTA_REPETIDA e a transação não roda', async () => {
    const { svc, chamadas } = montar(false, [linha('a')]);
    await expect(svc.lancar(semChave(), 'u1')).rejects.toMatchObject({ status: 409, response: { code: 'NOTA_REPETIDA', message: FRASE } });
    expect(chamadas.transaction).toHaveLength(0);
  });

  it('com confirmar_repetida: grava repetida_de com o id da mais nova', async () => {
    const { svc, chamadas } = montar(false, [linha('nova'), linha('velha')]);
    await svc.lancar(semChave({ confirmar_repetida: true }), 'u1');
    expect(chamadas.create[0].data.repetida_de).toBe('nova');
  });

  it('sem parecida: repetida_de null', async () => {
    const { svc, chamadas } = montar();
    await svc.lancar(semChave(), 'u1');
    expect(chamadas.create[0].data.repetida_de).toBeNull();
  });

  it('série diferente não é parecida', async () => {
    const { svc, chamadas } = montar(false, [linha('a')]);
    await svc.lancar(semChave({ serie: '2' }), 'u1');
    expect(chamadas.create[0].data.repetida_de).toBeNull();
  });

  it('sem CNPJ: nem consulta', async () => {
    const { svc, chamadas } = montar(false, [linha('a')]);
    await svc.lancar(semChave({ fornecedor_cnpj: '' }), 'u1');
    expect(chamadas.findMany).toHaveLength(0);
  });

  it('DUPLICADO e CHAVE_INVALIDA vencem NOTA_REPETIDA', async () => {
    await expect(montar(true, [linha('a')]).svc.lancar(dto(), 'u1')).rejects.toMatchObject({ response: { code: 'DUPLICADO' } });
    await expect(montar(false, [linha('a')]).svc.lancar(dto({ chave: DV_ERRADO }), 'u1')).rejects.toMatchObject({
      response: { code: 'CHAVE_INVALIDA' },
    });
  });

  it('parecidas(): consulta pelo CNPJ normalizado e mantém a ordem', async () => {
    const { svc, chamadas } = montar(false, [linha('nova'), linha('velha'), linha('outra', { numero: '99' })]);
    const r = await svc.parecidas({ cnpj: '12.abc.345/01de-35', numero: '4411', serie: '1' });
    expect(chamadas.findMany[0].where.fornecedor_cnpj).toBe('12ABC34501DE35');
    expect(chamadas.findMany[0].orderBy).toEqual({ created_at: 'desc' });
    expect(r.map((n) => n.id)).toEqual(['nova', 'velha']);
    expect(r[0]).toMatchObject({ data_entrada: '2026-11-03', created_at: '2026-11-03T15:00:00.000Z', valor_total: 1234.56 });
  });
});
