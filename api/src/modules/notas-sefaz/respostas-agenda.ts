// Decisão do lote das respostas à SEFAZ (pura: sem banco, sem rede, sem relógio global). Recebe o retorno de um `nfeRecepcaoEvento`
// (ou o erro do transporte) e devolve o estado de cada evento e o das respostas: as tabelas "Lote" e "Evento" do desenho (Etapa 2,
// "Retornos → ação"). Nunca em laço: evento que volta à fila sem gastar tentativa sai sempre com pausa no futuro ou com as respostas
// paradas; o que gasta para em `falhou` na 3ª tentativa; código definitivo (registrada/recusada) nunca repete.
import { horaSp } from '../../common/time/dates';
import type { TipoEvento } from '../sefaz/eventos.port';
import type { CodigoFault, CodigoSefazErro } from '../sefaz/sefaz-erro';
import { RECUO_FALHA_MIN } from './agenda';
import { FRASE_RESPOSTA } from './frases';

export type SituacaoRespostas = 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_656' | 'parada_relogio';
export type EstadoEvento = 'na_fila' | 'enviando' | 'registrada' | 'recusada' | 'falhou' | 'cancelada';

export const LOTE_MAX = 20;
export const TENTATIVAS_MAX = 3;
export const ESPERA_ADMIN_MS = 60_000;
export const DERIVA_MAX_MS = 2 * 60_000;
export const PAUSA_FORA_DO_AR_MS = 60 * 60_000;
export const PAUSA_656_MS = 65 * 60_000;
export const PAUSA_CURTA_MS = 15 * 60_000;
export const PAUSA_RELOGIO_MS = 60 * 60_000;

export type ChamadaLote =
  | {
      tipo: 'retorno';
      cStat: number;
      retornos: { chave: string | null; tpEvento: string | null; nSeq: number | null; cStat: number; nProt: string | null }[];
    }
  | { tipo: 'erro'; code: CodigoSefazErro; enviado: boolean; httpStatus?: number; fault?: CodigoFault };

export interface EntradaLote {
  agora: Date;
  /** Os eventos do lote, na ordem de envio; `tentativas` já com o +1 da T1. */
  eventos: { id: string; chave: string; tpEvento: TipoEvento; tentativas: number }[];
  falhasSeguidas: number;
  semRespostaSeguidas: number;
  vezes656Em24h: number;
  relogioNoLoteAnterior: boolean;
  chamada: ChamadaLote;
}

/** `gastou = false` → o serviço desfaz o +1 da T1. */
export interface DecisaoEvento {
  id: string;
  estado: EstadoEvento;
  gastou: boolean;
  cStat: number | null;
  protocolo: string | null;
  mensagem: string | null;
}

export interface DecisaoLote {
  resultado: 'respondida' | 'falha_antes_de_enviar' | 'sem_resposta';
  eventos: DecisaoEvento[];
  situacao: SituacaoRespostas;
  mensagem: string | null;
  /** null = não muda. */
  pausaAte: Date | null;
  falhasSeguidas: number;
  /** O lote mostrou relógio (577–579): o serviço marca o lote, e o 2º seguido para. */
  relogio: boolean;
}

type Evento = EntradaLote['eventos'][number];
type Retorno = Extract<ChamadaLote, { tipo: 'retorno' }>['retornos'][number];
type Parada = { situacao: Exclude<SituacaoRespostas, 'ok'>; mensagem: string };

const maisMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

// Tabela "Evento": volta à fila sem gastar e as respostas param.
const EVENTO_DEFEITO_NOSSO = new Set([250, 252, 489, 490, 491, 492, 493, 572, 594, 595, 297, 298]);
const eventoCertificado = (c: number) => c === 213 || (c >= 290 && c <= 296);
const eventoRelogio = (c: number) => c >= 577 && c <= 579;
const eventoChaveInvalida = (c: number) => c === 236 || c === 496 || (c >= 614 && c <= 619);

/** O evento volta à fila; gastando na 3ª tentativa, vira `falhou`. */
function deVolta(ev: Evento, gastou: boolean, cStat: number | null = null): DecisaoEvento {
  const estado = gastou && ev.tentativas >= TENTATIVAS_MAX ? 'falhou' : 'na_fila';
  return { id: ev.id, estado, gastou, cStat, protocolo: null, mensagem: null };
}

/** Frase da recusa definitiva de um evento (linha da resposta). */
function fraseRecusa(cStat: number, tpEvento: TipoEvento): string {
  if (cStat === 655 && tpEvento === '210210') return FRASE_RESPOSTA.recusadaJaRespondida;
  if (cStat === 650 || cStat === 651) return FRASE_RESPOSTA.recusadaCanceladaOuDenegada;
  if (cStat === 596) return FRASE_RESPOSTA.recusadaForaDoPrazo;
  if (cStat === 575) return FRASE_RESPOSTA.recusadaOutraEmpresa;
  if (eventoChaveInvalida(cStat)) return FRASE_RESPOSTA.recusadaChaveInvalida;
  return FRASE_RESPOSTA.recusadaCodigo(cStat);
}

export function decidirLote(e: EntradaLote): DecisaoLote {
  const c = e.chamada;
  if (c.tipo === 'erro') return decidirErro(e, c);
  if (c.cStat === 128) return decidir128(e, c.retornos);
  return decidirCodigoDoLote(e, c.cStat);
}

function decidirCodigoDoLote(e: EntradaLote, cStat: number): DecisaoLote {
  const todos = (gastou: boolean) => e.eventos.map((ev) => deVolta(ev, gastou));
  const base = { resultado: 'respondida' as const, falhasSeguidas: 0, relogio: false };

  if (cStat === 108 || cStat === 109) {
    const pausaAte = maisMs(e.agora, PAUSA_FORA_DO_AR_MS);
    return { ...base, eventos: todos(false), situacao: 'ok', mensagem: FRASE_RESPOSTA.foraDoAr(horaSp(pausaAte)), pausaAte };
  }
  if (cStat === 656) {
    // O 2º em 24 h para; a pausa vale nos dois casos (a SEFAZ bloqueia por 1 h de qualquer jeito).
    const pausaAte = maisMs(e.agora, PAUSA_656_MS);
    if (e.vezes656Em24h >= 1) {
      return { ...base, eventos: todos(false), situacao: 'parada_656', mensagem: FRASE_RESPOSTA.bloqueouDuasVezes, pausaAte };
    }
    return { ...base, eventos: todos(false), situacao: 'ok', mensagem: FRASE_RESPOSTA.esperar(horaSp(pausaAte)), pausaAte };
  }
  if (cStat === 999) {
    // Erro não catalogado da SEFAZ: sem linha própria na UX; vale a de "fora do ar", com a hora da pausa.
    const pausaAte = maisMs(e.agora, PAUSA_CURTA_MS);
    return { ...base, eventos: todos(true), situacao: 'ok', mensagem: FRASE_RESPOSTA.foraDoAr(horaSp(pausaAte)), pausaAte };
  }
  if (cStat >= 280 && cStat <= 286) {
    return {
      ...base,
      eventos: todos(false),
      situacao: 'parada_certificado',
      mensagem: FRASE_RESPOSTA.certificadoRecusado(cStat),
      pausaAte: null,
    };
  }
  // 214, 225, 252, 402, 404, 516, 517, 587, 588 (defeito nosso) e qualquer outro código: param, com o código na frase.
  return { ...base, eventos: todos(false), situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.outroCodigo(cStat), pausaAte: null };
}

function decidir128(e: EntradaLote, retornos: Retorno[]): DecisaoLote {
  let parada: Parada | null = null; // vale a do 1º evento da entrada que parar
  let relogio = false;
  const eventos: DecisaoEvento[] = [];
  for (const ev of e.eventos) {
    // Casa por (chNFe, tpEvento, nSeqEvento) exatos; esta entrega só manda nSeq 1. Sem retEvento = volta gastando.
    const r = retornos.find((x) => x.chave === ev.chave && x.tpEvento === ev.tpEvento && x.nSeq === 1);
    if (!r) {
      eventos.push(deVolta(ev, true));
      continue;
    }
    const s = r.cStat;
    if (s === 135 || s === 136 || s === 573) {
      eventos.push({ id: ev.id, estado: 'registrada', gastou: true, cStat: s, protocolo: r.nProt, mensagem: null });
    } else if (eventoRelogio(s)) {
      relogio = true;
      if (e.relogioNoLoteAnterior) parada ??= { situacao: 'parada_relogio', mensagem: FRASE_RESPOSTA.relogioParou };
      eventos.push(deVolta(ev, false, s));
    } else if (eventoCertificado(s)) {
      parada ??= { situacao: 'parada_certificado', mensagem: FRASE_RESPOSTA.certificadoRecusado(s) };
      eventos.push(deVolta(ev, false, s));
    } else if (EVENTO_DEFEITO_NOSSO.has(s)) {
      parada ??= { situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.outroCodigo(s) };
      eventos.push(deVolta(ev, false, s));
    } else if (s === 999) {
      eventos.push(deVolta(ev, true, s));
    } else {
      eventos.push({ id: ev.id, estado: 'recusada', gastou: true, cStat: s, protocolo: null, mensagem: fraseRecusa(s, ev.tpEvento) });
    }
  }

  // Relógio: +60 mesmo quando outro evento parou as respostas (ao religar, a SEFAZ ainda recusaria a hora).
  const pausaAte = relogio ? maisMs(e.agora, PAUSA_RELOGIO_MS) : null;
  return {
    resultado: 'respondida',
    eventos,
    situacao: parada?.situacao ?? 'ok',
    mensagem: parada?.mensagem ?? (pausaAte ? FRASE_RESPOSTA.relogio(horaSp(pausaAte)) : null),
    pausaAte,
    falhasSeguidas: 0,
    relogio,
  };
}

function decidirErro(e: EntradaLote, c: Extract<ChamadaLote, { tipo: 'erro' }>): DecisaoLote {
  const todos = (gastou: boolean) => e.eventos.map((ev) => deVolta(ev, gastou));
  const respondida = { resultado: 'respondida' as const, falhasSeguidas: 0, relogio: false, pausaAte: null };

  if (c.code === 'SEFAZ_HTTP') {
    const st = c.httpStatus;
    if (st === 403) {
      return { ...respondida, eventos: todos(false), situacao: 'parada_certificado', mensagem: FRASE_RESPOSTA.certificadoRecusado(403) };
    }
    if (st === undefined || (st >= 500 && st <= 599)) {
      // Fault que não é `Receiver`: a SEFAZ recusou o nosso pedido (action ou corpo); `outro` = desconhecido, que nunca repete.
      if (st !== undefined && c.fault !== undefined && c.fault !== 'Receiver') {
        return { ...respondida, eventos: todos(false), situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.outroCodigo(st) };
      }
      // Sem Fault ou com `Receiver`: como 108/109, mas conta na sequência de lotes sem resposta útil (o 3º seguido para).
      const pausaAte = maisMs(e.agora, PAUSA_FORA_DO_AR_MS);
      const parou = e.semRespostaSeguidas >= 2;
      return {
        resultado: 'sem_resposta',
        eventos: todos(false),
        falhasSeguidas: 0,
        relogio: false,
        pausaAte,
        situacao: parou ? 'parada_configuracao' : 'ok',
        mensagem: parou ? FRASE_RESPOSTA.tresIlegiveis : FRASE_RESPOSTA.foraDoAr(horaSp(pausaAte)),
      };
    }
    return { ...respondida, eventos: todos(false), situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.outroCodigo(st) };
  }

  if (!c.enviado) {
    const recuo = RECUO_FALHA_MIN[Math.min(e.falhasSeguidas, RECUO_FALHA_MIN.length - 1)];
    const pausaAte = maisMs(e.agora, recuo * 60_000);
    return {
      resultado: 'falha_antes_de_enviar',
      eventos: todos(false),
      situacao: 'ok',
      mensagem: FRASE_RESPOSTA.semContato(horaSp(pausaAte)),
      pausaAte,
      falhasSeguidas: e.falhasSeguidas + 1,
      relogio: false,
    };
  }

  // Enviado e sem resposta útil (tempo, queda, ilegível, teto): pode ter sido registrado, então gasta (o reenvio volta 573).
  const pausaAte = maisMs(e.agora, PAUSA_CURTA_MS);
  const parou = e.semRespostaSeguidas >= 2;
  return {
    resultado: 'sem_resposta',
    eventos: todos(true),
    pausaAte,
    falhasSeguidas: e.falhasSeguidas + 1,
    relogio: false,
    situacao: parou ? 'parada_configuracao' : 'ok',
    mensagem: parou ? FRASE_RESPOSTA.tresIlegiveis : FRASE_RESPOSTA.semContato(horaSp(pausaAte)),
  };
}

// Data e hora com fuso explícito (a SEFAZ manda `AAAA-MM-DDThh:mm:ss-03:00`); sem fuso o `Date.parse` usaria o do processo.
const DH_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** |dhResp − terminadaEm| em ms; ausente ou ilegível = null. */
export function derivaRelogio(dhResp: string | null, terminadaEm: Date | null): number | null {
  if (dhResp === null || terminadaEm === null || !DH_COM_FUSO.test(dhResp)) return null;
  const sefaz = Date.parse(dhResp);
  const nosso = terminadaEm.getTime();
  if (Number.isNaN(sefaz) || Number.isNaN(nosso)) return null;
  return Math.abs(sefaz - nosso);
}
