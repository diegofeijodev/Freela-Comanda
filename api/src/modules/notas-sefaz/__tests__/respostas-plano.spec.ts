import { dataBrSp } from '../../../common/time/dates';
import {
  avisoDePrazo,
  AVISO_DIA,
  CIENCIA_MAX_DIAS,
  finalAtiva,
  ordemDeEnvio,
  planejar,
  prazoDaNota,
  PRAZO_FINAL_DIAS,
  respondivel,
  type EventoExistente,
  type NotaParaPlano,
  type Plano,
} from '../respostas-plano';
import type { EstadoEvento } from '../respostas-agenda';
import type { TipoEvento } from '../../sefaz/eventos.port';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const DIA = 86_400_000;
/** `n` dias antes de AGORA, mais `seg` segundos (A9 = dias(9); A9 − 1 s = dias(9, -1); A80 + 1 s = dias(80, 1)). */
const dias = (n: number, seg = 0) => new Date(AGORA.getTime() - n * DIA + seg * 1000);
const A9 = new Date('2026-11-08T17:05:00Z');
const LIGADA = new Date('2026-11-10T13:00:00Z');

const nota = (extra: Partial<NotaParaPlano> = {}): NotaParaPlano => ({
  id: 'n1',
  situacao: 'falta_lancar',
  situacao_sefaz: 'autorizada',
  tp_nf: 1,
  autorizada_em: dias(2),
  emitida_em: dias(2),
  tem_xml_completo: false,
  lancada_pela_chave_em: null,
  ...extra,
});
const ev = (tp_evento: TipoEvento, situacao: EstadoEvento, extra: Partial<EventoExistente> = {}): EventoExistente => ({
  nota_sefaz_id: 'n1',
  tp_evento,
  situacao,
  origem: tp_evento === '210210' ? 'ciencia_automatica' : 'admin',
  pedida_em: dias(1),
  ...extra,
});

const CIENCIA_N1: Plano['criar'][number] = { nota_sefaz_id: 'n1', tp_evento: '210210', origem: 'ciencia_automatica' };
const CONFIRMA_N1: Plano['criar'][number] = { nota_sefaz_id: 'n1', tp_evento: '210200', origem: 'dar_entrada' };
const VAZIO: Plano = { criar: [], cancelarCiencias: [] };

const plano = (n: NotaParaPlano, eventos: EventoExistente[] = []) => planejar([n], eventos, LIGADA, AGORA);

const ATIVOS: EstadoEvento[] = ['na_fila', 'enviando', 'registrada', 'falhou'];
const FINAIS: TipoEvento[] = ['210200', '210220', '210240'];

describe('constantes', () => {
  it('ciência até o 9º dia, resposta final em 90 dias, aviso a partir do 80º', () => {
    expect([CIENCIA_MAX_DIAS, PRAZO_FINAL_DIAS, AVISO_DIA]).toEqual([9, 90, 80]);
  });
  it('o vetor A9 é exatamente 9 dias antes de AGORA', () => {
    expect(dias(9)).toEqual(A9);
  });
});

describe('prazoDaNota (Review Focus 5)', () => {
  it('prazo_final = autorizada_em + 90 dias', () => {
    expect(prazoDaNota({ autorizada_em: dias(2), emitida_em: dias(5) }, AGORA).prazo_final).toEqual(new Date(dias(2).getTime() + 90 * DIA));
  });
  it('sem autorizada_em, a base é emitida_em', () => {
    expect(prazoDaNota({ autorizada_em: null, emitida_em: dias(5) }, AGORA).prazo_final).toEqual(new Date(dias(5).getTime() + 90 * DIA));
  });
  it.each([
    ['A2', dias(2), false, false],
    ['A80 − 1 s', dias(80, -1), true, false],
    ['A80', dias(80), true, false],
    ['A80 + 1 s', dias(80, 1), false, false],
    ['A90 + 1 s', dias(90, 1), true, false],
    ['A90', dias(90), false, true],
    ['A90 − 1 s', dias(90, -1), false, true],
  ])('%s: perto=%s, passou=%s', (_nome, base, perto, passou) => {
    const p = prazoDaNota({ autorizada_em: base, emitida_em: null }, AGORA);
    expect(p).toEqual({ prazo_final: new Date(base.getTime() + 90 * DIA), prazo_perto: perto, prazo_passou: passou });
  });
  it('base nula: tudo nulo/falso', () => {
    expect(prazoDaNota({ autorizada_em: null, emitida_em: null }, AGORA)).toEqual({ prazo_final: null, prazo_perto: false, prazo_passou: false });
  });
  it('nota autorizada perto da meia-noite de Brasília (17/11 23h30): vence 15/02/2027 às 23h30 de Brasília', () => {
    const p = prazoDaNota({ autorizada_em: new Date('2026-11-18T02:30:00Z'), emitida_em: null }, AGORA);
    expect(p.prazo_final?.toISOString()).toBe('2027-02-16T02:30:00.000Z');
    expect(dataBrSp(p.prazo_final!)).toBe('15/02/2027');
  });
});

describe('finalAtiva', () => {
  it.each(FINAIS.flatMap((tp) => ATIVOS.map((s) => [tp, s] as const)))('%s %s é ativa', (tp, s) => {
    const final = ev(tp, s);
    expect(finalAtiva([ev('210210', 'registrada'), final])).toBe(final);
  });
  it.each(FINAIS.flatMap((tp) => (['recusada', 'cancelada'] as const).map((s) => [tp, s] as const)))('%s %s não é ativa', (tp, s) => {
    expect(finalAtiva([ev(tp, s)])).toBeNull();
  });
  it.each(ATIVOS)('ciência %s nunca é resposta final', (s) => {
    expect(finalAtiva([ev('210210', s)])).toBeNull();
  });
  it('sem eventos: null', () => {
    expect(finalAtiva([])).toBeNull();
  });
});

describe('respondivel', () => {
  it('autorizada, de compra, no prazo e sem resposta final ativa', () => {
    expect(respondivel(nota(), [], AGORA)).toBe(true);
  });
  it.each([
    ['nota de saída (tp_nf 0)', nota({ tp_nf: 0 })],
    ['tp_nf desconhecido', nota({ tp_nf: null })],
    ['cancelada', nota({ situacao: 'cancelada', situacao_sefaz: 'cancelada' })],
    ['denegada', nota({ situacao: 'denegada', situacao_sefaz: 'denegada' })],
    ['prazo passou (A90)', nota({ autorizada_em: dias(90) })],
    ['base nula (prazo desconhecido)', nota({ autorizada_em: null, emitida_em: null })],
  ])('%s: não', (_nome, n) => {
    expect(respondivel(n, [], AGORA)).toBe(false);
  });
  it('A90 + 1 s ainda é respondível', () => {
    expect(respondivel(nota({ autorizada_em: dias(90, 1) }), [], AGORA)).toBe(true);
  });
  it.each(ATIVOS)('com resposta final %s: não', (s) => {
    expect(respondivel(nota(), [ev('210220', s)], AGORA)).toBe(false);
  });
  it('resposta final recusada ou cancelada não impede', () => {
    expect(respondivel(nota(), [ev('210220', 'recusada'), ev('210240', 'cancelada')], AGORA)).toBe(true);
  });
  it('a resposta final de OUTRA nota não conta', () => {
    expect(respondivel(nota(), [ev('210220', 'registrada', { nota_sefaz_id: 'n2' })], AGORA)).toBe(true);
  });
});

describe('planejar: ciência automática (210210)', () => {
  it.each([
    ['falta lançar, 2º dia', nota()],
    ['A9 (exatos 9 dias)', nota({ autorizada_em: A9 })],
    ['parece lançada', nota({ situacao: 'parece_lancada' })],
  ])('%s: cria', (_nome, n) => {
    expect(plano(n)).toEqual({ criar: [CIENCIA_N1], cancelarCiencias: [] });
  });
  it.each([
    ['A9 − 1 s', nota({ autorizada_em: dias(9, -1) })],
    ['nota de saída (tp_nf 0)', nota({ tp_nf: 0 })],
    ['tp_nf desconhecido', nota({ tp_nf: null })],
    ['cancelada', nota({ situacao: 'cancelada', situacao_sefaz: 'cancelada' })],
    ['denegada', nota({ situacao: 'denegada', situacao_sefaz: 'denegada' })],
    ['ignorada', nota({ situacao: 'ignorada' })],
    ['já lançada (antes de ligar)', nota({ situacao: 'ja_lancada', lancada_pela_chave_em: dias(30) })],
    ['XML completo já chegou', nota({ tem_xml_completo: true })],
    ['sem autorizada_em (a ciência conta da autorização, não da emissão)', nota({ autorizada_em: null, emitida_em: dias(1) })],
  ])('%s: não cria', (_nome, n) => {
    expect(plano(n)).toEqual(VAZIO);
  });
  it.each(['na_fila', 'enviando', 'registrada', 'recusada', 'falhou'] as const)('ciência nossa já %s: não cria outra', (s) => {
    expect(plano(nota(), [ev('210210', s)])).toEqual(VAZIO);
  });
  it('só uma ciência cancelada antes: cria', () => {
    expect(plano(nota(), [ev('210210', 'cancelada')])).toEqual({ criar: [CIENCIA_N1], cancelarCiencias: [] });
  });
  it.each(ATIVOS)('resposta final %s: não cria ciência', (s) => {
    expect(plano(nota(), [ev('210220', s)]).criar).toEqual([]);
  });
});

describe('planejar: confirmação ao dar entrada (210200)', () => {
  const lancada = (extra: Partial<NotaParaPlano> = {}) => nota({ situacao: 'ja_lancada', lancada_pela_chave_em: LIGADA, ...extra });

  it('lançada pela chave no instante em que as respostas foram ligadas: dar_entrada', () => {
    expect(plano(lancada())).toEqual({ criar: [CONFIRMA_N1], cancelarCiencias: [] });
  });
  it('lançada depois de ligar, com XML completo e ciência registrada: dar_entrada', () => {
    const n = lancada({ lancada_pela_chave_em: new Date(LIGADA.getTime() + DIA), tem_xml_completo: true });
    expect(plano(n, [ev('210210', 'registrada')])).toEqual({ criar: [CONFIRMA_N1], cancelarCiencias: [] });
  });
  it.each([
    ['lançada 1 s antes de ligar', lancada({ lancada_pela_chave_em: new Date(LIGADA.getTime() - 1000) })],
    ['já lançada sem data de lançamento', lancada({ lancada_pela_chave_em: null })],
    ['ignorada e lançada depois (a situação é "ignorada")', nota({ situacao: 'ignorada', lancada_pela_chave_em: AGORA })],
    ['nota de saída (tp_nf 0)', lancada({ tp_nf: 0 })],
    ['cancelada depois de lançada', lancada({ situacao: 'cancelada_depois_de_lancada', situacao_sefaz: 'cancelada' })],
    ['prazo passou (A90)', lancada({ autorizada_em: dias(90) })],
  ])('%s: nada', (_nome, n) => {
    expect(plano(n)).toEqual(VAZIO);
  });
  it('parece lançada (não pela chave): nenhuma 210200, só a ciência de nota nova', () => {
    expect(plano(nota({ situacao: 'parece_lancada', lancada_pela_chave_em: AGORA }))).toEqual({ criar: [CIENCIA_N1], cancelarCiencias: [] });
  });
  it('A90 + 1 s ainda confirma', () => {
    expect(plano(lancada({ autorizada_em: dias(90, 1) }))).toEqual({ criar: [CONFIRMA_N1], cancelarCiencias: [] });
  });

  // Review Focus 3: nunca uma 2ª resposta final para a mesma nota.
  it('com 210220 registrada (admin): nada', () => {
    expect(plano(lancada(), [ev('210220', 'registrada')])).toEqual(VAZIO);
  });
  it('com 210200 falhou: nada (não duplica)', () => {
    expect(plano(lancada(), [ev('210200', 'falhou', { origem: 'dar_entrada' })])).toEqual(VAZIO);
  });
  it.each(FINAIS.flatMap((tp) => ATIVOS.map((s) => [tp, s] as const)))('com %s %s: nada', (tp, s) => {
    expect(plano(lancada(), [ev(tp, s)]).criar).toEqual([]);
  });
  it('com 210200 recusada: nada (o índice único ainda guarda a vaga; repetir seria um laço)', () => {
    expect(plano(lancada(), [ev('210200', 'recusada', { origem: 'dar_entrada' })])).toEqual(VAZIO);
  });
  it('com 210200 cancelada (Desfazer do admin): confirma', () => {
    expect(plano(lancada(), [ev('210200', 'cancelada')])).toEqual({ criar: [CONFIRMA_N1], cancelarCiencias: [] });
  });
});

describe('planejar: ciência na fila com resposta final pedida', () => {
  it('final do admin na fila + ciência na fila: cancela a ciência da nota', () => {
    expect(plano(nota(), [ev('210210', 'na_fila'), ev('210220', 'na_fila')])).toEqual({ criar: [], cancelarCiencias: ['n1'] });
  });
  it.each(ATIVOS)('final %s + ciência na fila: cancela', (s) => {
    expect(plano(nota(), [ev('210210', 'na_fila'), ev('210240', s)]).cancelarCiencias).toEqual(['n1']);
  });
  it('confirmação criada agora + ciência na fila: cria a 210200 e cancela a ciência (seria 655 no mesmo lote)', () => {
    const n = nota({ situacao: 'ja_lancada', lancada_pela_chave_em: AGORA });
    expect(plano(n, [ev('210210', 'na_fila')])).toEqual({ criar: [CONFIRMA_N1], cancelarCiencias: ['n1'] });
  });
  it('ciência já enviando não é cancelada', () => {
    expect(plano(nota(), [ev('210210', 'enviando'), ev('210220', 'na_fila')])).toEqual(VAZIO);
  });
  it.each(['recusada', 'cancelada'] as const)('final %s não cancela a ciência na fila', (s) => {
    expect(plano(nota(), [ev('210210', 'na_fila'), ev('210220', s)])).toEqual(VAZIO);
  });
  it('final ativa mesmo com o prazo passado: cancela a ciência na fila', () => {
    expect(plano(nota({ autorizada_em: dias(90) }), [ev('210210', 'na_fila'), ev('210220', 'falhou')]).cancelarCiencias).toEqual(['n1']);
  });
});

describe('planejar: várias notas', () => {
  it('cada nota só vê os próprios eventos; a saída segue a ordem das notas', () => {
    const notas = [
      nota({ id: 'a' }),
      nota({ id: 'b', situacao: 'ja_lancada', lancada_pela_chave_em: AGORA }),
      nota({ id: 'c' }),
    ];
    const eventos = [
      ev('210220', 'registrada', { nota_sefaz_id: 'x' }),
      ev('210210', 'registrada', { nota_sefaz_id: 'c' }),
      ev('210210', 'na_fila', { nota_sefaz_id: 'b' }),
    ];
    expect(planejar(notas, eventos, LIGADA, AGORA)).toEqual({
      criar: [
        { nota_sefaz_id: 'a', tp_evento: '210210', origem: 'ciencia_automatica' },
        { nota_sefaz_id: 'b', tp_evento: '210200', origem: 'dar_entrada' },
      ],
      cancelarCiencias: ['b'],
    });
  });
  it('aplicado o plano, planejar de novo não cria nem cancela nada (nunca em laço)', () => {
    const notas = [
      nota({ id: 'a' }),
      nota({ id: 'b', situacao: 'ja_lancada', lancada_pela_chave_em: AGORA }),
      nota({ id: 'c', situacao: 'parece_lancada' }),
      nota({ id: 'd' }),
    ];
    let eventos: EventoExistente[] = [
      ev('210210', 'na_fila', { nota_sefaz_id: 'b' }),
      ev('210210', 'na_fila', { nota_sefaz_id: 'd' }),
      ev('210220', 'na_fila', { nota_sefaz_id: 'd' }),
    ];
    const p1 = planejar(notas, eventos, LIGADA, AGORA);
    expect(p1.criar).toHaveLength(3);
    expect(p1.cancelarCiencias).toEqual(['b', 'd']);
    const cancela = (e: EventoExistente) => e.tp_evento === '210210' && e.situacao === 'na_fila' && p1.cancelarCiencias.includes(e.nota_sefaz_id);
    eventos = eventos.map((e) => (cancela(e) ? { ...e, situacao: 'cancelada' as const } : e));
    eventos.push(...p1.criar.map((c) => ({ ...c, situacao: 'na_fila' as const, pedida_em: AGORA })));
    expect(planejar(notas, eventos, LIGADA, AGORA)).toEqual(VAZIO);
  });
  it('sem notas: plano vazio', () => {
    expect(planejar([], [ev('210210', 'na_fila')], LIGADA, AGORA)).toEqual(VAZIO);
  });
});

describe('avisoDePrazo', () => {
  const comCiencia = [ev('210210', 'registrada')];
  it('ciência registrada + A80: avisa', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80) }), comCiencia, AGORA)).toBe(true);
  });
  it('ciência registrada + A80 + 1 s: ainda não', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80, 1) }), comCiencia, AGORA)).toBe(false);
  });
  it('ciência registrada + A90: o prazo passou, não avisa', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(90) }), comCiencia, AGORA)).toBe(false);
  });
  it('com 210200 registrada: não', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80) }), [...comCiencia, ev('210200', 'registrada')], AGORA)).toBe(false);
  });
  it('resposta final só na fila: continua avisando até ela ser registrada', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(85) }), [...comCiencia, ev('210220', 'na_fila')], AGORA)).toBe(true);
  });
  it.each(['na_fila', 'enviando', 'recusada', 'falhou', 'cancelada'] as const)('ciência só %s: não', (s) => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80) }), [ev('210210', s)], AGORA)).toBe(false);
  });
  it('sem ciência: não', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80) }), [], AGORA)).toBe(false);
  });
  it('a ciência de OUTRA nota não conta', () => {
    expect(avisoDePrazo(nota({ autorizada_em: dias(80) }), [ev('210210', 'registrada', { nota_sefaz_id: 'n2' })], AGORA)).toBe(false);
  });
  it('base nula: não', () => {
    expect(avisoDePrazo(nota({ autorizada_em: null, emitida_em: null }), comCiencia, AGORA)).toBe(false);
  });
  it('lido ao pé da letra: nota cancelada depois da ciência registrada ainda avisa (preocupação no relato)', () => {
    expect(avisoDePrazo(nota({ situacao: 'cancelada', situacao_sefaz: 'cancelada', autorizada_em: dias(80) }), comCiencia, AGORA)).toBe(true);
  });
});

describe('ordemDeEnvio', () => {
  type Item = { id: string; tp_evento: TipoEvento; base: Date | null; pedida_em: Date };
  const item = (id: string, tp_evento: TipoEvento, base: Date | null, pedida_em: Date): Item => ({ id, tp_evento, base, pedida_em });

  it('respostas finais primeiro (pela ordem do pedido); depois as ciências pela base mais antiga', () => {
    const fila = [
      item('c5', '210210', dias(5), dias(0, -60)),
      item('f220', '210220', dias(1), dias(0, -30)),
      item('c8', '210210', dias(8), dias(0, -50)),
      item('f200', '210200', dias(40), dias(0, -90)),
      item('c2', '210210', dias(2), dias(0, -200)),
      item('f240', '210240', dias(3), dias(0, -10)),
    ];
    expect(ordemDeEnvio(fila).map((i) => i.id)).toEqual(['f200', 'f220', 'f240', 'c8', 'c5', 'c2']);
  });
  it('210220 antes de qualquer ciência, mesmo pedida depois e com base mais nova', () => {
    const fila = [item('c', '210210', dias(9), dias(1)), item('f', '210220', dias(0), AGORA)];
    expect(ordemDeEnvio(fila).map((i) => i.id)).toEqual(['f', 'c']);
  });
  it('ciências com a mesma base: pela ordem do pedido; base nula por último', () => {
    const fila = [
      item('nula', '210210', null, dias(3)),
      item('b2', '210210', dias(4), dias(0, -10)),
      item('b1', '210210', dias(4), dias(0, -20)),
    ];
    expect(ordemDeEnvio(fila).map((i) => i.id)).toEqual(['b1', 'b2', 'nula']);
  });
  it('não muda a fila recebida', () => {
    const fila = [item('c', '210210', dias(2), dias(1)), item('f', '210200', dias(3), AGORA)];
    const copia = [...fila];
    ordemDeEnvio(fila);
    expect(fila).toEqual(copia);
  });
  it('fila vazia', () => {
    expect(ordemDeEnvio([])).toEqual([]);
  });
});
