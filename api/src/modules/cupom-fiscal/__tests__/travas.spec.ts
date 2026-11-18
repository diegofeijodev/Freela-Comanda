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
  ESPERA_CANCELAMENTO_MS,
  MAX_CANCELAMENTOS,
  SEM_CUPOM,
} from '../travas';
import { horasDe } from '../emissao.service';
import { FRASE_ERRO } from '../frases';
import { acoesDoCupom, inicioDaEspera, type CupomParaAcoes } from '../situacao-cupom';

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
  cancelamentosDoCupom: 0,
  ultimoCancelamentoDoCupom: null,
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

  // parada_656 e (rodada de correção 1, T9-2b) parada_certificado: com o certificado parado, toda chamada falharia (28x).
  it.each(['parada_656', 'parada_certificado'] as const)('%s → NFCE_PARADA em todos os serviços, antes do bloqueio', (situacao) => {
    for (const servico of SERVICOS) {
      expect(podeChamar(livre({ situacao, bloqueado_ate: min(30) }), servico, AGORA)).toEqual({
        ok: false,
        code: 'NFCE_PARADA',
        ate: null,
      });
    }
  });

  // Decisão do controlador (T9-2): consulta pela chave e cancelamento só param no 656 (janela e parada_656) e nos próprios limites.
  it.each(['parada_configuracao', 'parada_serie_em_uso'] as const)(
    'ambiente %s → NFCE_PARADA na emissão e no status; consulta e cancelamento passam',
    (situacao) => {
      for (const servico of ['autorizacao', 'status'] as const) {
        expect(podeChamar(livre({ situacao, bloqueado_ate: min(30) }), servico, AGORA)).toEqual({
          ok: false,
          code: 'NFCE_PARADA',
          ate: null,
        });
      }
      for (const servico of ['consulta', 'evento'] as const) {
        expect(podeChamar(livre({ situacao }), servico, AGORA)).toEqual({ ok: true });
        // a janela do 656 continua valendo para eles
        expect(podeChamar(livre({ situacao, bloqueado_ate: min(30) }), servico, AGORA)).toEqual({
          ok: false,
          code: 'NFCE_BLOQUEADA',
          ate: min(30),
        });
      }
      // e os limites da própria consulta também
      expect(podeChamar(livre({ situacao, enviadoEm: s(-60) }), 'consulta', AGORA)).toEqual({
        ok: false,
        code: 'NFCE_CONSULTA_CEDO',
        ate: s(60),
      });
    },
  );

  it('beco da série (T9-2): parada_serie_em_uso + cupom sem_resposta da mesma série → a consulta sai; a emissão não', () => {
    const cupom: CupomParaAcoes = {
      situacao: 'sem_resposta',
      ambiente: 'producao',
      envios: 1,
      numero_reaproveitavel: true,
      autorizada_em: null,
      cancelamento_pedido_em: null,
      lanca_venda: true,
      venda_lancada_em: null,
      venda_desfeita_em: null,
      enviadoEm: min(-3),
      ultimaConsultaDaChave: null,
      cancelamentos: 0,
    };
    expect(acoesDoCupom(cupom, AGORA).acoes).toEqual(['consultar']);
    const amb = livre({ situacao: 'parada_serie_em_uso', recusas: vezes(10, () => min(-5)), consultas: vezes(5, () => min(-20)) });
    expect(
      podeChamar({ ...amb, enviadoEm: inicioDaEspera(cupom), ultimaConsultaDaChave: cupom.ultimaConsultaDaChave }, 'consulta', AGORA),
    ).toEqual({
      ok: true,
    });
    expect(podeChamar(amb, 'autorizacao', AGORA)).toEqual({ ok: false, code: 'NFCE_PARADA', ate: null });
  });

  it('10 recusas há 59 min → NFCE_MUITAS_RECUSAS até a mais antiga + 60 min, na emissão e no status; consulta e cancelamento passam', () => {
    const recusas = vezes(10, () => min(-59));
    for (const servico of ['autorizacao', 'status'] as const) {
      expect(podeChamar(livre({ recusas }), servico, AGORA)).toEqual({ ok: false, code: 'NFCE_MUITAS_RECUSAS', ate: min(1) });
    }
    for (const servico of ['consulta', 'evento'] as const) {
      expect(podeChamar(livre({ recusas }), servico, AGORA)).toEqual({ ok: true });
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

  it('ordem na emissão e no status: parada → bloqueio → teto de recusas → espera do serviço', () => {
    const tudo = livre({
      situacao: 'parada_configuracao',
      bloqueado_ate: min(10),
      recusas: vezes(10, () => min(-1)),
      ultimo_status_em: min(-1),
    });
    expect(podeChamar(tudo, 'status', AGORA)).toMatchObject({ code: 'NFCE_PARADA' });
    expect(podeChamar({ ...tudo, situacao: 'ok' }, 'status', AGORA)).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(podeChamar({ ...tudo, situacao: 'ok', bloqueado_ate: null }, 'status', AGORA)).toMatchObject({ code: 'NFCE_MUITAS_RECUSAS' });
    expect(podeChamar({ ...tudo, situacao: 'ok', bloqueado_ate: null, recusas: [] }, 'status', AGORA)).toMatchObject({
      code: 'NFCE_TESTE_CEDO',
    });
  });

  it('ordem na consulta: parada_656 → bloqueio → espera da consulta (outras paradas e o teto não contam)', () => {
    const tudo = livre({ situacao: 'parada_656', bloqueado_ate: min(10), recusas: vezes(10, () => min(-1)), enviadoEm: s(-10) });
    expect(podeChamar(tudo, 'consulta', AGORA)).toMatchObject({ code: 'NFCE_PARADA' });
    expect(podeChamar({ ...tudo, situacao: 'parada_configuracao' }, 'consulta', AGORA)).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(podeChamar({ ...tudo, situacao: 'parada_configuracao', bloqueado_ate: null }, 'consulta', AGORA)).toMatchObject({
      code: 'NFCE_CONSULTA_CEDO',
    });
  });
});

// Rodada de correção 1 (Important): o cancelamento tem limite próprio por cupom — 1 pedido a cada 2 min e no máximo 3. As rejeições dele
// contam no teto da hora (`acaoCancelamento` marca `rejeicao`), mas o teto não o barra (o prazo de 30 min não pode se perder).
describe('horasDe: a contagem dos pedidos de cancelamento (a mesma do limite e do botão)', () => {
  it('a falha antes de enviar não conta; o pedido aberto (sem resultado) conta; a última hora é a dos que contam', () => {
    const h = horasDe([
      { servico: 'cancelamento', iniciada_em: min(-9), resultado: 'falha_antes_de_enviar' },
      { servico: 'cancelamento', iniciada_em: min(-7), resultado: 'rejeitado' },
      { servico: 'cancelamento', iniciada_em: min(-5), resultado: null },
      { servico: 'cancelamento', iniciada_em: min(-1), resultado: 'falha_antes_de_enviar' },
      { servico: 'autorizacao', iniciada_em: min(-20), resultado: 'autorizado' },
      { servico: 'consulta', iniciada_em: min(-15), resultado: 'ok' },
    ]);
    expect(h).toEqual({ enviadoEm: min(-20), ultimaConsulta: min(-15), cancelamentos: 2, ultimoCancelamento: min(-5) });
  });

  it('SEM_CUPOM (emissão e status) não liga limite nenhum do cupom', () => {
    expect(SEM_CUPOM).toEqual({ enviadoEm: null, ultimaConsultaDaChave: null, cancelamentosDoCupom: 0, ultimoCancelamentoDoCupom: null });
    expect(podeChamar({ ...livre(), ...SEM_CUPOM }, 'autorizacao', AGORA)).toEqual({ ok: true });
  });
});

describe('podeChamar: limite do cancelamento por cupom', () => {
  it('constantes', () => {
    expect(MAX_CANCELAMENTOS).toBe(3);
    expect(ESPERA_CANCELAMENTO_MS).toBe(120_000);
  });

  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ])('com %i pedidos já feitos pelo cupom → passa: %s (o 4º é recusado, sem hora de volta)', (feitos, passa) => {
    const r = podeChamar(livre({ cancelamentosDoCupom: feitos, ultimoCancelamentoDoCupom: feitos ? min(-10) : null }), 'evento', AGORA);
    expect(r).toEqual(passa ? { ok: true } : { ok: false, code: 'NFCE_LIMITE_CANCELAMENTOS', ate: null });
  });

  it.each([
    [60, false],
    [119, false],
    [120, true],
  ])('2º pedido %i s depois do 1º → passa: %s', (seg, passa) => {
    const r = podeChamar(livre({ cancelamentosDoCupom: 1, ultimoCancelamentoDoCupom: s(-seg) }), 'evento', AGORA);
    expect(r).toEqual(passa ? { ok: true } : { ok: false, code: 'NFCE_CANCELAMENTO_CEDO', ate: s(120 - seg) });
  });

  it('a recusa do 2º pedido cedo leva a hora certa na frase (Brasília, também com TZ=UTC)', () => {
    const r = podeChamar(livre({ cancelamentosDoCupom: 1, ultimoCancelamentoDoCupom: s(-30) }), 'evento', AGORA);
    expect(r).toEqual({ ok: false, code: 'NFCE_CANCELAMENTO_CEDO', ate: s(90) });
    if (r.ok) throw new Error('devia recusar');
    expect(FRASE_ERRO.NFCE_CANCELAMENTO_CEDO(r.ate as Date)).toBe(
      'Espere até as 14h06 para pedir o cancelamento de novo: a SEFAZ bloqueia pedidos repetidos.',
    );
    expect(FRASE_ERRO.NFCE_LIMITE_CANCELAMENTOS).toBe(
      'O cancelamento deste cupom já foi pedido 3 vezes. Para não bloquear o CNPJ, não sai outro pedido: fale com o contador.',
    );
  });

  it('o teto de recusas não barra o cancelamento, mas o limite do cupom sim', () => {
    const recusas = vezes(12, () => min(-5));
    expect(podeChamar(livre({ recusas, cancelamentosDoCupom: 2, ultimoCancelamentoDoCupom: min(-3) }), 'evento', AGORA)).toEqual({
      ok: true,
    });
    expect(podeChamar(livre({ recusas, cancelamentosDoCupom: 3, ultimoCancelamentoDoCupom: min(-3) }), 'evento', AGORA)).toMatchObject({
      code: 'NFCE_LIMITE_CANCELAMENTOS',
    });
  });

  it('o limite do cancelamento não vale para os outros serviços', () => {
    for (const servico of ['autorizacao', 'consulta', 'status'] as const) {
      expect(podeChamar(livre({ cancelamentosDoCupom: 3, ultimoCancelamentoDoCupom: s(-10) }), servico, AGORA)).toEqual({ ok: true });
    }
  });

  it('ordem no cancelamento: parada (656/certificado) → bloqueio → limite de pedidos → espera de 2 min', () => {
    const tudo = livre({
      situacao: 'parada_certificado',
      bloqueado_ate: min(10),
      cancelamentosDoCupom: 3,
      ultimoCancelamentoDoCupom: s(-10),
    });
    expect(podeChamar(tudo, 'evento', AGORA)).toMatchObject({ code: 'NFCE_PARADA' });
    expect(podeChamar({ ...tudo, situacao: 'parada_configuracao' }, 'evento', AGORA)).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(podeChamar({ ...tudo, situacao: 'ok', bloqueado_ate: null }, 'evento', AGORA)).toMatchObject({
      code: 'NFCE_LIMITE_CANCELAMENTOS',
    });
    expect(podeChamar({ ...tudo, situacao: 'ok', bloqueado_ate: null, cancelamentosDoCupom: 1 }, 'evento', AGORA)).toMatchObject({
      code: 'NFCE_CANCELAMENTO_CEDO',
    });
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
