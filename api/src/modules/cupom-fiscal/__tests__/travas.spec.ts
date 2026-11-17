import {
  BLOQUEIO_656_MS,
  depoisDo656,
  ESPERA_CONSULTA_MS,
  MAX_ENVIOS,
  podeChamar,
  STATUS_CADA_MS,
  TETO_CONSULTAS_HORA,
  TETO_RECUSAS_HORA,
  type EstadoTravas,
} from '../travas';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const s = (n: number) => new Date(AGORA.getTime() + n * 1000);
const min = (n: number) => s(n * 60);
const SERVICOS = ['autorizacao', 'consulta', 'evento', 'status'] as const;

const livre = (extra: Partial<EstadoTravas> = {}): EstadoTravas => ({
  situacao: 'ok',
  bloqueado_ate: null,
  recusas: [],
  consultas: [],
  ultimo_status_em: null,
  enviadoEm: null,
  ultimaConsultaDaChave: null,
  ...extra,
});
const vezes = (n: number, d: (i: number) => Date) => Array.from({ length: n }, (_, i) => d(i));

describe('constantes (§4.4 do desenho)', () => {
  it('valores exatos', () => {
    expect(TETO_RECUSAS_HORA).toBe(10);
    expect(TETO_CONSULTAS_HORA).toBe(20);
    expect(ESPERA_CONSULTA_MS).toBe(120_000);
    expect(STATUS_CADA_MS).toBe(300_000);
    expect(BLOQUEIO_656_MS).toBe(65 * 60_000);
    expect(MAX_ENVIOS).toBe(3);
  });
});

describe('podeChamar', () => {
  it.each(SERVICOS)('sem trava nenhuma: %s passa', (servico) => {
    expect(podeChamar(livre(), servico, AGORA)).toEqual({ ok: true });
  });

  it.each(SERVICOS)('bloqueado_ate no futuro → NFCE_BLOQUEADA (%s)', (servico) => {
    expect(podeChamar(livre({ bloqueado_ate: min(64) }), servico, AGORA)).toEqual({ ok: false, code: 'NFCE_BLOQUEADA', ate: min(64) });
  });

  it('bloqueio vencido (igual a agora) não trava', () => {
    expect(podeChamar(livre({ bloqueado_ate: AGORA }), 'autorizacao', AGORA)).toEqual({ ok: true });
  });

  it.each(['parada_656', 'parada_certificado', 'parada_configuracao', 'parada_serie_em_uso'] as const)(
    'ambiente %s → NFCE_PARADA em todos os serviços, antes do bloqueio',
    (situacao) => {
      for (const servico of SERVICOS) {
        expect(podeChamar(livre({ situacao, bloqueado_ate: min(30) }), servico, AGORA)).toEqual({
          ok: false,
          code: 'NFCE_PARADA',
          ate: null,
        });
      }
    },
  );

  it('10 recusas há 59 min → NFCE_MUITAS_RECUSAS até a mais antiga + 60 min, em todos os serviços', () => {
    const recusas = vezes(10, () => min(-59));
    for (const servico of SERVICOS) {
      expect(podeChamar(livre({ recusas }), servico, AGORA)).toEqual({ ok: false, code: 'NFCE_MUITAS_RECUSAS', ate: min(1) });
    }
  });

  it('recusas espalhadas e fora de ordem: conta só a janela de 60 min; ate = a mais antiga dentro dela + 60 min', () => {
    const recusas = [min(-5), min(-61), min(-50), ...vezes(7, (i) => min(-40 + i)), min(-60)];
    // dentro da janela: -50, -40..-34 (7) e -5 = 9 (o de -60 e o de -61 já saíram) → passa
    expect(podeChamar(livre({ recusas }), 'autorizacao', AGORA)).toEqual({ ok: true });
    const dez = [...recusas, min(-1)];
    expect(podeChamar(livre({ recusas: dez }), 'autorizacao', AGORA)).toEqual({ ok: false, code: 'NFCE_MUITAS_RECUSAS', ate: min(10) });
  });

  it('12 recusas na janela: volta quando sobram 9 (a 3ª mais antiga + 60 min)', () => {
    const recusas = [min(-50), min(-45), min(-30), ...vezes(9, () => min(-10))];
    expect(podeChamar(livre({ recusas }), 'autorizacao', AGORA)).toEqual({ ok: false, code: 'NFCE_MUITAS_RECUSAS', ate: min(30) });
  });

  it('9 recusas passam', () => {
    expect(podeChamar(livre({ recusas: vezes(9, () => min(-1)) }), 'autorizacao', AGORA)).toEqual({ ok: true });
  });

  it.each([
    [119, false],
    [120, true],
    [121, true],
  ])('consulta %i s depois do envio → %s', (seg, passa) => {
    const r = podeChamar(livre({ enviadoEm: s(-seg) }), 'consulta', AGORA);
    expect(r).toEqual(passa ? { ok: true } : { ok: false, code: 'NFCE_CONSULTA_CEDO', ate: s(120 - seg) });
  });

  it('a espera depois do envio vale só para a consulta', () => {
    for (const servico of ['autorizacao', 'evento', 'status'] as const) {
      expect(podeChamar(livre({ enviadoEm: s(-10) }), servico, AGORA)).toEqual({ ok: true });
    }
  });

  it('mesma chave: uma consulta a cada 2 min', () => {
    expect(podeChamar(livre({ ultimaConsultaDaChave: s(-119) }), 'consulta', AGORA)).toEqual({
      ok: false,
      code: 'NFCE_CONSULTA_CEDO',
      ate: s(1),
    });
    expect(podeChamar(livre({ ultimaConsultaDaChave: s(-120) }), 'consulta', AGORA)).toEqual({ ok: true });
  });

  it('20 consultas na última hora → NFCE_CONSULTA_CEDO até a mais antiga + 60 min; 19 passam', () => {
    expect(podeChamar(livre({ consultas: vezes(19, (i) => min(-50 + i)) }), 'consulta', AGORA)).toEqual({ ok: true });
    expect(podeChamar(livre({ consultas: vezes(20, (i) => min(-50 + i)) }), 'consulta', AGORA)).toEqual({
      ok: false,
      code: 'NFCE_CONSULTA_CEDO',
      ate: min(10),
    });
    // as consultas não travam a autorização
    expect(podeChamar(livre({ consultas: vezes(20, () => min(-1)) }), 'autorizacao', AGORA)).toEqual({ ok: true });
  });

  it('várias esperas da consulta: vale a mais longa', () => {
    const e = livre({ enviadoEm: s(-30), ultimaConsultaDaChave: s(-100), consultas: vezes(20, () => min(-55)) });
    expect(podeChamar(e, 'consulta', AGORA)).toEqual({ ok: false, code: 'NFCE_CONSULTA_CEDO', ate: min(5) });
  });

  it('status 4 min depois do último → NFCE_TESTE_CEDO; 5 min depois, passa', () => {
    expect(podeChamar(livre({ ultimo_status_em: min(-4) }), 'status', AGORA)).toEqual({ ok: false, code: 'NFCE_TESTE_CEDO', ate: min(1) });
    expect(podeChamar(livre({ ultimo_status_em: min(-5) }), 'status', AGORA)).toEqual({ ok: true });
    expect(podeChamar(livre({ ultimo_status_em: min(-1) }), 'autorizacao', AGORA)).toEqual({ ok: true });
  });

  it('ordem: parada → bloqueio → teto de recusas → espera do serviço', () => {
    const tudo = livre({ bloqueado_ate: min(10), recusas: vezes(10, () => min(-1)), enviadoEm: s(-10) });
    expect(podeChamar(tudo, 'consulta', AGORA)).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(podeChamar({ ...tudo, bloqueado_ate: null }, 'consulta', AGORA)).toMatchObject({ code: 'NFCE_MUITAS_RECUSAS' });
    expect(podeChamar({ ...tudo, bloqueado_ate: null, recusas: [] }, 'consulta', AGORA)).toMatchObject({ code: 'NFCE_CONSULTA_CEDO' });
  });
});

describe('depoisDo656', () => {
  it('1º 656: bloqueia por 65 min, sem parada', () => {
    expect(depoisDo656(null, AGORA)).toEqual({ bloqueado_ate: min(65), parada: false });
    expect(depoisDo656(min(-24 * 60 - 1), AGORA)).toEqual({ bloqueado_ate: min(65), parada: false });
  });

  it('2º 656 em 24 h → parada (24 h exatas ainda contam)', () => {
    expect(depoisDo656(min(-70), AGORA)).toEqual({ bloqueado_ate: min(65), parada: true });
    expect(depoisDo656(min(-24 * 60), AGORA)).toEqual({ bloqueado_ate: min(65), parada: true });
  });

  it('656 anterior "no futuro" (relógio): conta como recente', () => {
    expect(depoisDo656(min(5), AGORA).parada).toBe(true);
  });
});
