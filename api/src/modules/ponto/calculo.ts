// Cálculo do ponto — função pura (sem banco, sem relógio): o serviço junta escala, folgas, marcações e justificativas e
// chama `calcularPeriodo`. Fuso fixo de Brasília (-03:00; sem horário de verão desde 2019), como o resto do sistema.
//
// Regras (CLT):
//  - Esperado do dia = saída − entrada − intervalo da escala (saída menor que a entrada = turno que vira a noite).
//  - Trabalhado = soma dos pares de marcações válidas (entrada→saída, intervalo_fim→saída…), em ordem de horário.
//  - Tolerância diária (art. 58 §1º, padrão 10 min): diferença de saldo até a tolerância não vira débito nem extra;
//    atraso/saída antecipada só viram ocorrência (pedem justificativa) acima dela.
//  - Folga, feriado, férias ou atestado: esperado 0; o que trabalhar nesse dia é extra 100%. Demais extras: 50%.
//  - Justificativa ACEITA com abono devolve o tempo da ocorrência (falta = o dia inteiro) e tira do débito.
//  - Adicional noturno: minutos trabalhados entre 22h e 5h (só a contagem; sem hora reduzida).

export type TipoMarcacao = 'entrada' | 'intervalo_inicio' | 'intervalo_fim' | 'saida';
export type TipoFolga = 'folga' | 'feriado' | 'ferias' | 'atestado';
export type TipoOcorrencia = 'falta' | 'atraso' | 'saida_antecipada';
export type StatusJustificativa = 'pendente' | 'aceita' | 'recusada';

export const TIPOS_MARCACAO: TipoMarcacao[] = ['entrada', 'intervalo_inicio', 'intervalo_fim', 'saida'];
export const TIPOS_FOLGA: TipoFolga[] = ['folga', 'feriado', 'ferias', 'atestado'];
export const TIPOS_OCORRENCIA: TipoOcorrencia[] = ['falta', 'atraso', 'saida_antecipada'];

export interface DiaEscala {
  folga: boolean;
  entrada: string | null; // "HH:MM"
  saida: string | null;
  intervalo_min: number;
}
export interface EscalaCalc {
  tolerancia_min: number;
  dias: Partial<Record<number, DiaEscala>>; // 0 = domingo … 6 = sábado
}
export interface MarcacaoCalc {
  momento: Date;
  tipo: TipoMarcacao;
}
export interface JustificativaCalc {
  tipo: TipoOcorrencia;
  status: StatusJustificativa;
  abonar: boolean;
}

export type SituacaoDia = 'normal' | 'folga_escala' | TipoFolga | 'sem_escala' | 'antes_admissao' | 'futuro';

export interface DiaCalculado {
  data: string;
  dia_semana: number;
  situacao: SituacaoDia;
  previsto: { entrada: string; saida: string; intervalo_min: number } | null;
  marcacoes: { momento: string; tipo: TipoMarcacao }[];
  esperado_min: number;
  trabalhado_min: number;
  atraso_min: number;
  saida_antecipada_min: number;
  falta: boolean;
  /** Número ímpar de marcações num dia que já passou (falta uma batida): o par aberto não conta. */
  incompleto: boolean;
  /** Hoje, com a jornada ainda aberta. */
  em_andamento: boolean;
  abonado_min: number;
  extra_50_min: number;
  extra_100_min: number;
  noturno_min: number;
  debito_min: number;
  saldo_min: number;
  /** Ocorrências do dia e a situação da justificativa de cada uma (`null` = ninguém justificou ainda). */
  ocorrencias: { tipo: TipoOcorrencia; minutos: number; justificativa: StatusJustificativa | null }[];
}

export interface TotaisPeriodo {
  dias_previstos: number;
  dias_trabalhados: number;
  faltas: number;
  esperado_min: number;
  trabalhado_min: number;
  atraso_min: number;
  saida_antecipada_min: number;
  abonado_min: number;
  extra_50_min: number;
  extra_100_min: number;
  noturno_min: number;
  debito_min: number;
  saldo_min: number;
  incompletos: number;
  pendencias: number;
}

const MIN = 60_000;
const OFFSET_SP = '-03:00';

/** "HH:MM" → minutos do dia. */
export function hhmmParaMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h as number) * 60 + (m as number);
}

/** Minutos → "H:MM" (com sinal quando negativo). Para tela e exportação. */
export function minParaHoras(min: number): string {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/** Dia + "HH:MM" em Brasília → instante. `+1 dia` quando o turno vira a noite. */
export function instanteSp(data: string, hhmm: string, diasDepois = 0): Date {
  const d = new Date(`${data}T${hhmm}:00${OFFSET_SP}`);
  return new Date(d.getTime() + diasDepois * 24 * 60 * MIN);
}

/** Instante → "YYYY-MM-DD" em Brasília. */
export function dataSp(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * MIN).toISOString().slice(0, 10);
}

/** Instante → "HH:MM" em Brasília. */
export function horaSpHHMM(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * MIN).toISOString().slice(11, 16);
}

export function diaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

/** Duração prevista do turno em minutos (saída ≤ entrada = vira a noite), sem descontar o intervalo. */
export function duracaoTurno(entrada: string, saida: string): number {
  const e = hhmmParaMin(entrada);
  const s = hhmmParaMin(saida);
  return s > e ? s - e : s + 24 * 60 - e;
}

/** Que tipos a próxima batida pode ter, dadas as marcações válidas do dia (em ordem). */
export function proximosTipos(feitas: TipoMarcacao[]): TipoMarcacao[] {
  if (feitas.length % 2 === 1) return ['intervalo_inicio', 'saida'];
  if (feitas.length === 0) return ['entrada'];
  return feitas[feitas.length - 1] === 'intervalo_inicio' ? ['intervalo_fim'] : ['entrada'];
}

function minutosNoturnos(ini: Date, fim: Date): number {
  let total = 0;
  // Janelas 22h–5h que podem tocar o par: começando na véspera do início até o dia do fim.
  let d = dataSp(new Date(ini.getTime() - 24 * 60 * MIN));
  const ultimo = dataSp(fim);
  for (let i = 0; i < 5 && d <= ultimo; i++) {
    const a = instanteSp(d, '22:00').getTime();
    const b = instanteSp(d, '05:00', 1).getTime();
    total += Math.max(0, Math.min(b, fim.getTime()) - Math.max(a, ini.getTime()));
    d = dataSp(instanteSp(d, '12:00', 1));
  }
  return Math.round(total / MIN);
}

export interface EntradaDia {
  data: string;
  hoje: string;
  agora: Date;
  escala: EscalaCalc | null;
  admissao: string | null;
  folga: TipoFolga | null;
  marcacoes: MarcacaoCalc[]; // só as válidas (não anuladas)
  justificativas: JustificativaCalc[];
}

export function calcularDia(e: EntradaDia): DiaCalculado {
  const dow = diaSemana(e.data);
  const marcas = [...e.marcacoes].sort((a, b) => a.momento.getTime() - b.momento.getTime());
  const base: DiaCalculado = {
    data: e.data,
    dia_semana: dow,
    situacao: 'normal',
    previsto: null,
    marcacoes: marcas.map((m) => ({ momento: m.momento.toISOString(), tipo: m.tipo })),
    esperado_min: 0,
    trabalhado_min: 0,
    atraso_min: 0,
    saida_antecipada_min: 0,
    falta: false,
    incompleto: false,
    em_andamento: false,
    abonado_min: 0,
    extra_50_min: 0,
    extra_100_min: 0,
    noturno_min: 0,
    debito_min: 0,
    saldo_min: 0,
    ocorrencias: [],
  };

  // Trabalhado e noturno: pares em ordem.
  let trabalhadoMs = 0;
  for (let i = 0; i + 1 < marcas.length; i += 2) {
    const a = marcas[i]!.momento;
    const b = marcas[i + 1]!.momento;
    trabalhadoMs += Math.max(0, b.getTime() - a.getTime());
    base.noturno_min += minutosNoturnos(a, b);
  }
  base.trabalhado_min = Math.round(trabalhadoMs / MIN);
  const aberto = marcas.length % 2 === 1;
  if (aberto) {
    base.em_andamento = e.data >= e.hoje || isAbertoRecente(marcas, e.agora);
    base.incompleto = !base.em_andamento;
  }

  if (e.admissao && e.data < e.admissao) {
    base.situacao = 'antes_admissao';
    return base;
  }
  if (!e.escala) {
    base.situacao = 'sem_escala';
    return base;
  }
  const tol = e.escala.tolerancia_min;
  const dia = e.escala.dias[dow];

  if (e.folga || !dia || dia.folga || !dia.entrada || !dia.saida) {
    base.situacao = e.folga ?? 'folga_escala';
    if (base.trabalhado_min > 0) {
      base.extra_100_min = base.trabalhado_min;
      base.saldo_min = base.trabalhado_min;
    }
    return base;
  }

  base.previsto = { entrada: dia.entrada, saida: dia.saida, intervalo_min: dia.intervalo_min };
  base.esperado_min = Math.max(0, duracaoTurno(dia.entrada, dia.saida) - dia.intervalo_min);
  const vira = hhmmParaMin(dia.saida) <= hhmmParaMin(dia.entrada) ? 1 : 0;
  const prevEntrada = instanteSp(e.data, dia.entrada);
  const prevSaida = instanteSp(e.data, dia.saida, vira);

  if (marcas.length === 0) {
    if (e.data > e.hoje || (e.data === e.hoje && e.agora.getTime() <= prevSaida.getTime())) {
      base.situacao = e.data > e.hoje ? 'futuro' : 'normal';
      return base;
    }
    base.falta = true;
    base.saldo_min = -base.esperado_min;
  } else {
    base.atraso_min = Math.max(0, Math.round((marcas[0]!.momento.getTime() - prevEntrada.getTime()) / MIN));
    if (!aberto) {
      const ultima = marcas[marcas.length - 1]!.momento;
      base.saida_antecipada_min = Math.max(0, Math.round((prevSaida.getTime() - ultima.getTime()) / MIN));
    }
    if (base.em_andamento) return base; // jornada aberta: saldo só no fim
    const bruto = base.trabalhado_min - base.esperado_min;
    base.saldo_min = Math.abs(bruto) <= tol ? 0 : bruto;
  }

  // Ocorrências e abono.
  const ocorr: { tipo: TipoOcorrencia; minutos: number }[] = [];
  if (base.falta) ocorr.push({ tipo: 'falta', minutos: base.esperado_min });
  if (base.atraso_min > tol) ocorr.push({ tipo: 'atraso', minutos: base.atraso_min });
  if (base.saida_antecipada_min > tol) ocorr.push({ tipo: 'saida_antecipada', minutos: base.saida_antecipada_min });
  let abono = 0;
  base.ocorrencias = ocorr.map((o) => {
    const j = e.justificativas.find((x) => x.tipo === o.tipo) ?? null;
    if (j && j.status === 'aceita' && j.abonar) abono += o.minutos;
    return { ...o, justificativa: j ? j.status : null };
  });
  if (base.saldo_min < 0 && abono > 0) {
    const devolvido = Math.min(abono, -base.saldo_min);
    base.abonado_min = devolvido;
    base.saldo_min += devolvido;
  }
  if (base.saldo_min > 0) base.extra_50_min = base.saldo_min;
  if (base.saldo_min < 0) base.debito_min = -base.saldo_min;
  return base;
}

/** Ontem com a jornada aberta há menos de 16 h (turno da noite ainda rolando) não é "incompleto". */
function isAbertoRecente(marcas: MarcacaoCalc[], agora: Date): boolean {
  const ultima = marcas[marcas.length - 1];
  return !!ultima && agora.getTime() - ultima.momento.getTime() < 16 * 60 * MIN;
}

export function totalizar(dias: DiaCalculado[]): TotaisPeriodo {
  const t: TotaisPeriodo = {
    dias_previstos: 0,
    dias_trabalhados: 0,
    faltas: 0,
    esperado_min: 0,
    trabalhado_min: 0,
    atraso_min: 0,
    saida_antecipada_min: 0,
    abonado_min: 0,
    extra_50_min: 0,
    extra_100_min: 0,
    noturno_min: 0,
    debito_min: 0,
    saldo_min: 0,
    incompletos: 0,
    pendencias: 0,
  };
  for (const d of dias) {
    if (d.esperado_min > 0) t.dias_previstos++;
    if (d.marcacoes.length > 0) t.dias_trabalhados++;
    if (d.falta) t.faltas++;
    if (d.incompleto) t.incompletos++;
    t.esperado_min += d.esperado_min;
    t.trabalhado_min += d.trabalhado_min;
    t.atraso_min += d.ocorrencias.find((o) => o.tipo === 'atraso')?.minutos ?? 0;
    t.saida_antecipada_min += d.ocorrencias.find((o) => o.tipo === 'saida_antecipada')?.minutos ?? 0;
    t.abonado_min += d.abonado_min;
    t.extra_50_min += d.extra_50_min;
    t.extra_100_min += d.extra_100_min;
    t.noturno_min += d.noturno_min;
    t.debito_min += d.debito_min;
    t.saldo_min += d.saldo_min;
    t.pendencias += d.ocorrencias.filter((o) => o.justificativa === null).length;
  }
  return t;
}

/** Todos os dias de `ini` a `fim` (inclusive), "YYYY-MM-DD". */
export function diasEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  let d = new Date(`${ini}T12:00:00Z`);
  const f = new Date(`${fim}T12:00:00Z`).getTime();
  while (d.getTime() <= f && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * MIN);
  }
  return out;
}
