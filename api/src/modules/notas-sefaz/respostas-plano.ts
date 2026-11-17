// Planejador das respostas à SEFAZ (puro: sem banco, sem rede, sem relógio global). Roda no tique, com as respostas ligadas, sobre as
// notas da caixa de um (ambiente, CNPJ): decide as respostas automáticas a criar (ciência em até 9 dias; confirmação da nota lançada pela
// chave depois de ligar), as ciências na fila a cancelar, o prazo de 90 dias de cada nota e a ordem de envio. Regras: desenho, Etapa 2,
// "Planejador" e decisão 9 do construtor.
//
// Dias = 24 h em milissegundos: Brasília não tem horário de verão (UTC−3 fixo), então a conta é a mesma no fuso de Brasília e não depende
// do TZ do processo (o contêiner roda em UTC).
import type { TipoEvento } from '../sefaz/eventos.port';
import type { SituacaoSefaz } from './classificacao';
import type { EstadoEvento } from './respostas-agenda';
import type { SituacaoNota } from './situacao-nota';

export const CIENCIA_MAX_DIAS = 9;
export const PRAZO_FINAL_DIAS = 90;
export const AVISO_DIA = 80;

const DIA_MS = 86_400_000;

export type OrigemEvento = 'ciencia_automatica' | 'dar_entrada' | 'admin';

export interface NotaParaPlano {
  id: string;
  situacao: SituacaoNota;
  situacao_sefaz: SituacaoSefaz;
  tp_nf: number | null;
  autorizada_em: Date | null;
  emitida_em: Date | null;
  tem_xml_completo: boolean;
  /** `created_at` da nota lançada com a mesma chave. */
  lancada_pela_chave_em: Date | null;
}

export interface EventoExistente {
  nota_sefaz_id: string;
  tp_evento: TipoEvento;
  situacao: EstadoEvento;
  origem: OrigemEvento;
  pedida_em: Date;
}

/** `prazo_perto` = agora ≥ base + 80 dias e < `prazo_final`; `prazo_passou` = agora ≥ `prazo_final`. */
export interface Prazo {
  prazo_final: Date | null;
  prazo_perto: boolean;
  prazo_passou: boolean;
}

export interface Plano {
  criar: { nota_sefaz_id: string; tp_evento: '210200' | '210210'; origem: 'dar_entrada' | 'ciencia_automatica' }[];
  /** Ids das notas cujas ciências ainda `na_fila` o serviço cancela. */
  cancelarCiencias: string[];
}

const CIENCIA: TipoEvento = '210210';
const ATIVOS: ReadonlySet<EstadoEvento> = new Set<EstadoEvento>(['na_fila', 'enviando', 'registrada', 'falhou']);

const ehFinal = (tp: TipoEvento) => tp !== CIENCIA;
const daNota = (id: string, ev: EventoExistente[]) => ev.filter((e) => e.nota_sefaz_id === id);

/** Prazo da resposta final: base (`autorizada_em`, ou `emitida_em` se faltar) + 90 dias. Base nula = tudo nulo/falso. */
export function prazoDaNota(n: Pick<NotaParaPlano, 'autorizada_em' | 'emitida_em'>, agora: Date): Prazo {
  const base = n.autorizada_em ?? n.emitida_em;
  if (!base) return { prazo_final: null, prazo_perto: false, prazo_passou: false };
  const t = agora.getTime();
  const final = base.getTime() + PRAZO_FINAL_DIAS * DIA_MS;
  const aviso = base.getTime() + AVISO_DIA * DIA_MS;
  return { prazo_final: new Date(final), prazo_perto: t >= aviso && t < final, prazo_passou: t >= final };
}

/** A resposta final ativa (210200, 210220 ou 210240 na fila, enviando, registrada ou falhou) entre os eventos de UMA nota. */
export function finalAtiva(ev: EventoExistente[]): EventoExistente | null {
  return ev.find((e) => ehFinal(e.tp_evento) && ATIVOS.has(e.situacao)) ?? null;
}

/**
 * Autorizada · de compra (`tp_nf = 1`) · dentro do prazo final · sem resposta final ativa. Prazo desconhecido (base nula) = não respondível:
 * nada automático sem saber o prazo. Nota de saída, cancelada ou denegada nunca recebe evento.
 */
export function respondivel(n: NotaParaPlano, ev: EventoExistente[], agora: Date): boolean {
  const p = prazoDaNota(n, agora);
  return (
    n.situacao_sefaz === 'autorizada' &&
    n.tp_nf === 1 &&
    p.prazo_final !== null &&
    !p.prazo_passou &&
    finalAtiva(daNota(n.id, ev)) === null
  );
}

/** Aviso do prazo: ciência nossa registrada · nenhuma resposta final registrada · do 80º dia até o fim do prazo. */
export function avisoDePrazo(n: NotaParaPlano, ev: EventoExistente[], agora: Date): boolean {
  const meus = daNota(n.id, ev);
  return (
    meus.some((e) => e.tp_evento === CIENCIA && e.situacao === 'registrada') &&
    !meus.some((e) => ehFinal(e.tp_evento) && e.situacao === 'registrada') &&
    prazoDaNota(n, agora).prazo_perto
  );
}

/** 210210: até 9 dias da autorização (não da emissão) · falta lançar ou parece lançada · sem XML completo · nenhuma ciência nossa fora de `cancelada`. */
function pedeCiencia(n: NotaParaPlano, ev: EventoExistente[], agora: Date): boolean {
  return (
    n.autorizada_em !== null &&
    agora.getTime() - n.autorizada_em.getTime() <= CIENCIA_MAX_DIAS * DIA_MS &&
    (n.situacao === 'falta_lancar' || n.situacao === 'parece_lancada') &&
    !n.tem_xml_completo &&
    !ev.some((e) => e.tp_evento === CIENCIA && e.situacao !== 'cancelada')
  );
}

/**
 * 210200 automático: lançada pela chave depois de ligar as respostas. Além do desenho: nenhuma 210200 nossa fora de `cancelada` (uma
 * `recusada` não é "ativa", mas ocupa o índice único (ambiente, chave, tp_evento, n_seq); criar outra seria um laço a cada tique).
 */
function pedeConfirmacao(n: NotaParaPlano, ev: EventoExistente[], ligadaEm: Date): boolean {
  return (
    n.situacao === 'ja_lancada' &&
    n.lancada_pela_chave_em !== null &&
    n.lancada_pela_chave_em.getTime() >= ligadaEm.getTime() &&
    !ev.some((e) => e.tp_evento === '210200' && e.situacao !== 'cancelada')
  );
}

/** Os eventos automáticos a criar e as ciências na fila a cancelar (resposta final pedida = a ciência daria 655 depois). */
export function planejar(notas: NotaParaPlano[], eventos: EventoExistente[], ligadaEm: Date, agora: Date): Plano {
  const porNota = new Map<string, EventoExistente[]>();
  for (const e of eventos) {
    const lista = porNota.get(e.nota_sefaz_id);
    if (lista) lista.push(e);
    else porNota.set(e.nota_sefaz_id, [e]);
  }
  const plano: Plano = { criar: [], cancelarCiencias: [] };
  for (const n of notas) {
    const ev = porNota.get(n.id) ?? [];
    let finalPedida = finalAtiva(ev) !== null;
    if (respondivel(n, ev, agora)) {
      if (pedeConfirmacao(n, ev, ligadaEm)) {
        plano.criar.push({ nota_sefaz_id: n.id, tp_evento: '210200', origem: 'dar_entrada' });
        finalPedida = true;
      } else if (pedeCiencia(n, ev, agora)) {
        plano.criar.push({ nota_sefaz_id: n.id, tp_evento: '210210', origem: 'ciencia_automatica' });
      }
    }
    if (finalPedida && ev.some((e) => e.tp_evento === CIENCIA && e.situacao === 'na_fila')) plano.cancelarCiencias.push(n.id);
  }
  return plano;
}

const pedido = (a: { pedida_em: Date }, b: { pedida_em: Date }) => a.pedida_em.getTime() - b.pedida_em.getTime();
const pelaBase = (a: Date | null, b: Date | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.getTime() - b.getTime());

/** Respostas finais primeiro (pela ordem do pedido); depois as ciências pela base mais antiga (vence antes), base nula por último. */
export function ordemDeEnvio<T extends { tp_evento: TipoEvento; base: Date | null; pedida_em: Date }>(fila: T[]): T[] {
  const finais = fila.filter((e) => ehFinal(e.tp_evento)).sort(pedido);
  const ciencias = fila.filter((e) => !ehFinal(e.tp_evento)).sort((a, b) => pelaBase(a.base, b.base) || pedido(a, b));
  return [...finais, ...ciencias];
}
