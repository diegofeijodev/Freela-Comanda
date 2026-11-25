import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../../common/auth/auth-user';
import type { PrismaService } from '../../../common/database/prisma.service';
import { addDays, dayToDb, todaySp } from '../../../common/time/dates';
import { CanaService } from '../cana.service';
import type { LancamentoCanaDto } from '../dto/cana.dto';

// O serviço da Cana com um Prisma falso (só o que cada rota usa): a ordem das conferências do lançar e o corte da lista do admin.
// As regras puras (o que cada tipo pede, datas, motivo) estão em cana.dto.spec.ts; o banco de verdade, no smoke (K1–K6).

const LOJA: AuthUser = { id: 'u-loja', email: 'l@x', nome: 'Caixa', perfil: 'loja', master: false, modulos: ['cana'], empresaId: null };
const CHAVE = '00000000-0000-4000-8000-00000000ca01';

function guardado(o: { data: string; duzias: number; lancado_por?: string }) {
  return {
    id: 'l-1',
    tipo: 'recebimento',
    data: dayToDb(o.data),
    duzias: new Prisma.Decimal(o.duzias),
    litros_caldo: null,
    litros_frozen: null,
    fornecedor: null,
    observacao: null,
    substitui_id: null,
    chave_idempotencia: CHAVE,
    lancado_por: o.lancado_por ?? LOJA.id,
    lancado_por_nome: 'Caixa',
    lancado_em: new Date(),
    anulado_em: null,
    anulado_por: null,
    anulado_por_nome: null,
    anulado_motivo: null,
  };
}

function montar(o: { ja?: ReturnType<typeof guardado> | null; lista?: unknown[] } = {}) {
  const cana_lancamentos = {
    findUnique: jest.fn(() => Promise.resolve(o.ja ?? null)),
    create: jest.fn((a: { data: object }) => Promise.resolve({ id: 'novo', ...a.data })),
    // como o banco: devolve no máximo `take` linhas
    findMany: jest.fn((a: { take?: number }) => Promise.resolve((o.lista ?? []).slice(0, a.take ?? Infinity))),
  };
  const svc = new CanaService({ cana_lancamentos } as unknown as PrismaService);
  return { svc, cana_lancamentos };
}

async function falha(p: Promise<unknown>): Promise<[number, string]> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return [e.getStatus(), (e.getResponse() as { code: string }).code];
    throw e;
  }
  throw new Error('não falhou');
}

describe('CanaService.lancar — a repetição vem antes das regras do lançamento novo', () => {
  const tresDiasAtras = addDays(todaySp(), -3);
  const pedido = (duzias: number, chave: string | undefined = CHAVE): LancamentoCanaDto =>
    ({ tipo: 'recebimento', data: tresDiasAtras, duzias, chave_idempotencia: chave }) as LancamentoCanaDto;

  it('reenvio depois da meia-noite (o dia já não vale para a loja): devolve o já gravado, sem lançar outro', async () => {
    const ja = guardado({ data: tresDiasAtras, duzias: 12 });
    const { svc, cana_lancamentos } = montar({ ja });
    await expect(svc.lancar(LOJA, pedido(12))).resolves.toEqual({ lancamento: ja, repetido: true });
    expect(cana_lancamentos.create).not.toHaveBeenCalled();
  });

  it('a mesma chave com outro número continua 409 (não vira 400 de data)', async () => {
    const { svc, cana_lancamentos } = montar({ ja: guardado({ data: tresDiasAtras, duzias: 12 }) });
    expect(await falha(svc.lancar(LOJA, pedido(120)))).toEqual([409, 'CANA_CHAVE_REPETIDA']);
    expect(cana_lancamentos.create).not.toHaveBeenCalled();
  });

  it('a chave de outra pessoa não devolve o lançamento dela: 409', async () => {
    const { svc } = montar({ ja: guardado({ data: tresDiasAtras, duzias: 12, lancado_por: 'u-outra' }) });
    expect(await falha(svc.lancar(LOJA, pedido(12)))).toEqual([409, 'CANA_CHAVE_REPETIDA']);
  });

  it('lançamento novo (chave nunca vista, ou sem chave) com a data fora: 400 CANA_DATA_FORA, nada gravado', async () => {
    for (const chave of [CHAVE, undefined]) {
      const { svc, cana_lancamentos } = montar({ ja: null });
      expect(await falha(svc.lancar(LOJA, pedido(12, chave)))).toEqual([400, 'CANA_DATA_FORA']);
      expect(cana_lancamentos.create).not.toHaveBeenCalled();
    }
  });
});

describe('CanaService.listar — a lista do admin diz quando cortou', () => {
  const linhas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l-${i}`, substituido_por: i === 0 ? { id: 'novo' } : null }));

  it('mais de 2.000 no período: devolve os 2.000 mais novos e truncado = true', async () => {
    const { svc } = montar({ lista: linhas(2500) });
    const r = await svc.listar('2026-01-01', '2026-11-24');
    expect([r.lancamentos.length, r.truncado, r.limite]).toEqual([2000, true, 2000]);
    expect(r.lancamentos[0]).toEqual({ id: 'l-0', corrigido_por_id: 'novo' });
  });

  it('exatamente 2.000: não diz que cortou', async () => {
    const { svc } = montar({ lista: linhas(2000) });
    const r = await svc.listar('2026-01-01', '2026-11-24');
    expect([r.lancamentos.length, r.truncado]).toEqual([2000, false]);
  });

  it('poucos: todos, truncado = false', async () => {
    const { svc } = montar({ lista: linhas(3) });
    const r = await svc.listar('2026-11-01', '2026-11-24', 'contagem');
    expect([r.lancamentos.length, r.truncado]).toEqual([3, false]);
  });
});
