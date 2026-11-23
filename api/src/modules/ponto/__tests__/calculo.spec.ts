import {
  calcularDia,
  diasEntre,
  duracaoTurno,
  instanteSp,
  minParaHoras,
  proximosTipos,
  totalizar,
  type EntradaDia,
  type EscalaCalc,
  type TipoMarcacao,
} from '../calculo';

// Seg–sex 08:00–17:00 com 60 min de intervalo (8 h); sábado 18:00–02:00 (vira a noite, sem intervalo); domingo folga.
const ESCALA: EscalaCalc = {
  tolerancia_min: 10,
  dias: {
    0: { folga: true, entrada: null, saida: null, intervalo_min: 0 },
    1: { folga: false, entrada: '08:00', saida: '17:00', intervalo_min: 60 },
    2: { folga: false, entrada: '08:00', saida: '17:00', intervalo_min: 60 },
    3: { folga: false, entrada: '08:00', saida: '17:00', intervalo_min: 60 },
    4: { folga: false, entrada: '08:00', saida: '17:00', intervalo_min: 60 },
    5: { folga: false, entrada: '08:00', saida: '17:00', intervalo_min: 60 },
    6: { folga: false, entrada: '18:00', saida: '02:00', intervalo_min: 0 },
  },
};

// 2026-11-16 = segunda; 2026-11-21 = sábado; 2026-11-22 = domingo.
const SEG = '2026-11-16';
const SAB = '2026-11-21';
const DOM = '2026-11-22';

function m(data: string, hhmm: string, tipo: TipoMarcacao, diasDepois = 0) {
  return { momento: instanteSp(data, hhmm, diasDepois), tipo };
}
function dia(p: Partial<EntradaDia> & { data: string }): ReturnType<typeof calcularDia> {
  return calcularDia({
    hoje: '2026-11-30',
    agora: instanteSp('2026-11-30', '12:00'),
    escala: ESCALA,
    admissao: null,
    folga: null,
    marcacoes: [],
    justificativas: [],
    ...p,
  });
}
const jornadaNormal = (data: string, e = '08:00', ii = '12:00', vf = '13:00', s = '17:00') => [
  m(data, e, 'entrada'),
  m(data, ii, 'intervalo_inicio'),
  m(data, vf, 'intervalo_fim'),
  m(data, s, 'saida'),
];

describe('ponto — cálculo puro', () => {
  it('auxiliares de hora', () => {
    expect(duracaoTurno('08:00', '17:00')).toBe(540);
    expect(duracaoTurno('18:00', '02:00')).toBe(480);
    expect(minParaHoras(-75)).toBe('-1:15');
    expect(minParaHoras(480)).toBe('8:00');
    expect(diasEntre('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(instanteSp(SEG, '08:00').toISOString()).toBe('2026-11-16T11:00:00.000Z');
  });

  it('próxima batida permitida', () => {
    expect(proximosTipos([])).toEqual(['entrada']);
    expect(proximosTipos(['entrada'])).toEqual(['intervalo_inicio', 'saida']);
    expect(proximosTipos(['entrada', 'intervalo_inicio'])).toEqual(['intervalo_fim']);
    expect(proximosTipos(['entrada', 'intervalo_inicio', 'intervalo_fim'])).toEqual(['intervalo_inicio', 'saida']);
    expect(proximosTipos(['entrada', 'saida'])).toEqual(['entrada']);
  });

  it('jornada exata: 8 h, saldo zero, sem ocorrência', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG) });
    expect(d).toMatchObject({ situacao: 'normal', esperado_min: 480, trabalhado_min: 480, saldo_min: 0, atraso_min: 0, ocorrencias: [] });
  });

  it('dentro da tolerância de 10 min: nem débito nem extra nem ocorrência', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:07', '12:00', '13:00', '17:00') });
    expect(d.atraso_min).toBe(7);
    expect(d.saldo_min).toBe(0);
    expect(d.ocorrencias).toEqual([]);
  });

  it('atraso acima da tolerância vira ocorrência e débito', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:30') });
    expect(d.atraso_min).toBe(30);
    expect(d.debito_min).toBe(30);
    expect(d.saldo_min).toBe(-30);
    expect(d.ocorrencias).toEqual([{ tipo: 'atraso', minutos: 30, justificativa: null }]);
  });

  it('atraso justificado e aceito com abono não vira débito', () => {
    const d = dia({
      data: SEG,
      marcacoes: jornadaNormal(SEG, '08:30'),
      justificativas: [{ tipo: 'atraso', status: 'aceita', abonar: true }],
    });
    expect(d).toMatchObject({ debito_min: 0, saldo_min: 0, abonado_min: 30 });
    expect(d.ocorrencias[0]!.justificativa).toBe('aceita');
  });

  it('justificativa aceita sem abono: continua débito', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:30'), justificativas: [{ tipo: 'atraso', status: 'aceita', abonar: false }] });
    expect(d.debito_min).toBe(30);
  });

  it('saída antecipada', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:00', '12:00', '13:00', '16:00') });
    expect(d.saida_antecipada_min).toBe(60);
    expect(d.ocorrencias).toEqual([{ tipo: 'saida_antecipada', minutos: 60, justificativa: null }]);
    expect(d.debito_min).toBe(60);
  });

  it('hora extra 50% em dia normal', () => {
    const d = dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:00', '12:00', '13:00', '19:00') });
    expect(d).toMatchObject({ trabalhado_min: 600, extra_50_min: 120, extra_100_min: 0, saldo_min: 120 });
  });

  it('falta: dia previsto sem batida, no passado', () => {
    const d = dia({ data: SEG });
    expect(d).toMatchObject({ falta: true, debito_min: 480, saldo_min: -480 });
    expect(d.ocorrencias).toEqual([{ tipo: 'falta', minutos: 480, justificativa: null }]);
  });

  it('falta abonada (atestado aceito)', () => {
    const d = dia({ data: SEG, justificativas: [{ tipo: 'falta', status: 'aceita', abonar: true }] });
    expect(d).toMatchObject({ falta: true, debito_min: 0, abonado_min: 480, saldo_min: 0 });
  });

  it('hoje antes do fim do turno ainda não é falta; futuro também não', () => {
    expect(dia({ data: SEG, hoje: SEG, agora: instanteSp(SEG, '10:00') })).toMatchObject({ falta: false, situacao: 'normal', saldo_min: 0 });
    expect(dia({ data: '2026-12-01' })).toMatchObject({ falta: false, situacao: 'futuro' });
  });

  it('jornada em andamento hoje: sem saldo nem incompleto', () => {
    const d = dia({ data: SEG, hoje: SEG, agora: instanteSp(SEG, '10:00'), marcacoes: [m(SEG, '08:00', 'entrada')] });
    expect(d).toMatchObject({ em_andamento: true, incompleto: false, saldo_min: 0, trabalhado_min: 0 });
  });

  it('dia passado com batida ímpar = incompleto', () => {
    const d = dia({ data: SEG, marcacoes: [m(SEG, '08:00', 'entrada'), m(SEG, '12:00', 'intervalo_inicio'), m(SEG, '13:00', 'intervalo_fim')] });
    expect(d.incompleto).toBe(true);
    expect(d.trabalhado_min).toBe(240);
  });

  it('domingo de folga trabalhado = extra 100%', () => {
    const d = dia({ data: DOM, marcacoes: [m(DOM, '10:00', 'entrada'), m(DOM, '14:00', 'saida')] });
    expect(d).toMatchObject({ situacao: 'folga_escala', esperado_min: 0, extra_100_min: 240, saldo_min: 240 });
  });

  it('feriado lançado: esperado zero, não é falta', () => {
    expect(dia({ data: SEG, folga: 'feriado' })).toMatchObject({ situacao: 'feriado', falta: false, esperado_min: 0, saldo_min: 0 });
  });

  it('turno que vira a noite + adicional noturno', () => {
    const d = dia({ data: SAB, marcacoes: [m(SAB, '18:00', 'entrada'), m(SAB, '02:00', 'saida', 1)] });
    expect(d).toMatchObject({ esperado_min: 480, trabalhado_min: 480, saldo_min: 0, saida_antecipada_min: 0, noturno_min: 240 });
  });

  it('antes da admissão e sem escala', () => {
    expect(dia({ data: SEG, admissao: '2026-11-20' }).situacao).toBe('antes_admissao');
    expect(dia({ data: SEG, escala: null, marcacoes: jornadaNormal(SEG) })).toMatchObject({ situacao: 'sem_escala', trabalhado_min: 480, saldo_min: 0 });
  });

  it('totaliza o período', () => {
    const dias = [
      dia({ data: SEG, marcacoes: jornadaNormal(SEG, '08:00', '12:00', '13:00', '19:00') }),
      dia({ data: '2026-11-17' }),
      dia({ data: DOM, marcacoes: [m(DOM, '10:00', 'entrada'), m(DOM, '14:00', 'saida')] }),
    ];
    const t = totalizar(dias);
    expect(t).toMatchObject({ dias_previstos: 2, dias_trabalhados: 2, faltas: 1, extra_50_min: 120, extra_100_min: 240, debito_min: 480, saldo_min: -120, pendencias: 1 });
  });
});
