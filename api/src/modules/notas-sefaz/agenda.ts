// Agenda da distribuição de DF-e (pura: sem banco, sem rede, sem relógio global). Recebe o "agora" e devolve a ação.
// Regras de consumo da NT 2014.002 §3.5: 1 h depois de 137 / ultNSU == maxNSU; consultar antes = 656 e bloqueio de 1 h.
import { horaSp } from '../../common/time/dates';
import type { CodigoSefazErro } from '../sefaz/sefaz-erro';
import { FRASE } from './frases';

export const ESPERA_MS = 65 * 60_000;
export const TIQUE_MS = 5 * 60_000;
export const PRIMEIRO_TIQUE_MS = 60_000;
export const PAGINAS_POR_CICLO = 10;
export const EM_ANDAMENTO_MAX_MS = 2 * 60_000;
export const RECUO_FALHA_MIN = [15, 30, 60] as const;

export type SituacaoBusca = 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_conflito' | 'parada_656';
export type ResultadoConsulta = 'respondida' | 'falha_antes_de_enviar' | 'sem_resposta' | 'interrompida';
export type Chamada =
  | { tipo: 'retorno'; cStat: number; ultNsu: bigint | null; maxNsu: bigint | null; documentos: number }
  | { tipo: 'erro'; code: CodigoSefazErro; enviado: boolean; httpStatus?: number };

export interface EstadoLinha {
  busca_ligada: boolean;
  ult_nsu: bigint;
  proxima_consulta_em: Date | null;
  bloqueado_ate: Date | null;
  em_andamento_desde: Date | null;
  falhas_seguidas: number;
}

/** Condições de data/estado para consultar (nessa precedência). As de ambiente, certificado e CNPJ são do serviço. */
export function condicoes(l: EstadoLinha | null, agora: Date): 'ok' | 'nao_ligada' | 'ocupada' | 'aguarde' {
  if (!l || !l.busca_ligada) return 'nao_ligada';
  if (l.em_andamento_desde && agora.getTime() - l.em_andamento_desde.getTime() <= EM_ANDAMENTO_MAX_MS) return 'ocupada';
  if (l.proxima_consulta_em && agora < l.proxima_consulta_em) return 'aguarde';
  if (l.bloqueado_ate && agora < l.bloqueado_ate) return 'aguarde';
  return 'ok';
}

/** Quando a consulta fica liberada: o maior entre a próxima e o bloqueio. */
export function liberadaEm(l: EstadoLinha): Date | null {
  const { proxima_consulta_em: p, bloqueado_ate: b } = l;
  if (p && b) return p > b ? p : b;
  return p ?? b;
}

export interface EntradaAgenda {
  agora: Date;
  ultNsuNosso: bigint;
  primeiraConsulta: boolean;
  anteriorEnviada: ResultadoConsulta | null;
  falhasSeguidas: number;
  semRespostaSeguidas: number;
  vezes656Em24h: number;
  /** A reserva pessimista da transação 1 (agora + 65 min): vale quando não se sabe se a SEFAZ recebeu o pedido. */
  reservaAte: Date;
  chamada: Chamada;
}

export interface AcaoAgenda {
  resultado: Exclude<ResultadoConsulta, 'interrompida'>;
  ultNsu: bigint;
  maxNsu: bigint | null;
  proximaConsultaEm: Date;
  /** null = não muda. */
  bloqueadoAte: Date | null;
  falhasSeguidas: number;
  situacao: SituacaoBusca;
  mensagem: string | null;
  /** null = não muda. */
  aviso: string | null;
  lacuna: { nsuDe: bigint; nsuAte: bigint; causa: 'outro_sistema' | 'resposta_perdida' } | null;
  maisPaginas: boolean;
  /** Só para o log. */
  alerta: string | null;
}

const maisMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

export function decidir(e: EntradaAgenda): AcaoAgenda {
  const mais65 = maisMs(e.agora, ESPERA_MS);
  const base: AcaoAgenda = {
    resultado: 'respondida', ultNsu: e.ultNsuNosso, maxNsu: null, proximaConsultaEm: mais65, bloqueadoAte: null,
    falhasSeguidas: 0, situacao: 'ok', mensagem: null, aviso: null, lacuna: null, maisPaginas: false, alerta: null,
  };
  const parada = (situacao: SituacaoBusca, mensagem: string, extra: Partial<AcaoAgenda> = {}): AcaoAgenda => ({
    ...base, situacao, mensagem, ...extra,
  });

  if (e.chamada.tipo === 'erro') return decidirErro(e, e.chamada, base, parada);

  const { cStat, ultNsu, maxNsu, documentos } = e.chamada;
  const comMax = { ...base, maxNsu };

  if (cStat === 138 || cStat === 137) {
    const devolveuMenor = ultNsu !== null && ultNsu < e.ultNsuNosso;
    const adotado = ultNsu !== null && ultNsu > e.ultNsuNosso ? ultNsu : e.ultNsuNosso;
    const semAvanco = cStat === 138 && ultNsu !== null && ultNsu === e.ultNsuNosso && maxNsu !== null && maxNsu > ultNsu;
    const alerta = devolveuMenor ? 'ultNSU devolvido menor que o nosso' : semAvanco ? '138 sem avanço do NSU, com maxNSU maior' : null;
    // Só continua na hora se o NSU realmente avançou; 138 sem avanço é tratado como sem novidade (espera do 137).
    const avancou = ultNsu !== null && ultNsu > e.ultNsuNosso;
    const maisPaginas = cStat === 138 && avancou && maxNsu !== null && ultNsu < maxNsu;
    const aviso =
      cStat === 138 && e.primeiraConsulta && e.ultNsuNosso === 0n && documentos > 0 ? FRASE.indicioD1 : null;
    return { ...comMax, ultNsu: adotado, proximaConsultaEm: maisPaginas ? e.agora : mais65, maisPaginas, aviso, alerta };
  }

  if (cStat === 108 || cStat === 109) return { ...comMax, mensagem: FRASE.foraDoAr(horaSp(mais65)) };

  if (cStat === 656) return decidir656(e, ultNsu, comMax, mais65);

  if ((cStat >= 280 && cStat <= 286) || cStat === 473) {
    return { ...comMax, situacao: 'parada_certificado', mensagem: FRASE.certificadoRecusado(cStat) };
  }
  if (cStat === 593) return { ...comMax, situacao: 'parada_configuracao', mensagem: FRASE.cnpj593 };
  return { ...comMax, situacao: 'parada_configuracao', mensagem: FRASE.outroCodigo(cStat) };
}

function decidir656(e: EntradaAgenda, ultNsu: bigint | null, comMax: AcaoAgenda, mais65: Date): AcaoAgenda {
  const bloqueio = { bloqueadoAte: mais65, proximaConsultaEm: mais65 };
  if (ultNsu === null || ultNsu <= e.ultNsuNosso) {
    if (e.vezes656Em24h >= 1) return { ...comMax, ...bloqueio, situacao: 'parada_656', mensagem: FRASE.bloqueouDuasVezes };
    return { ...comMax, ...bloqueio, mensagem: FRASE.esperar(horaSp(mais65)) };
  }
  // A sequência andou sem a gente: adota o valor devolvido.
  const semHistorico = e.primeiraConsulta && e.ultNsuNosso === 0n;
  const lacuna = semHistorico ? null : { nsuDe: e.ultNsuNosso + 1n, nsuAte: ultNsu };
  const respostaPerdida = !semHistorico && (e.anteriorEnviada === 'sem_resposta' || e.anteriorEnviada === 'interrompida');
  if (respostaPerdida && lacuna) {
    if (e.vezes656Em24h >= 1) {
      return { ...comMax, ...bloqueio, ultNsu, situacao: 'parada_656', mensagem: FRASE.bloqueouDuasVezes, lacuna: { ...lacuna, causa: 'resposta_perdida' } };
    }
    return { ...comMax, ...bloqueio, ultNsu, lacuna: { ...lacuna, causa: 'resposta_perdida' } };
  }
  return {
    ...comMax, ...bloqueio, ultNsu, situacao: 'parada_conflito', mensagem: FRASE.conflito,
    lacuna: lacuna ? { ...lacuna, causa: 'outro_sistema' } : null,
  };
}

function decidirErro(
  e: EntradaAgenda,
  c: Extract<Chamada, { tipo: 'erro' }>,
  base: AcaoAgenda,
  parada: (s: SituacaoBusca, m: string, x?: Partial<AcaoAgenda>) => AcaoAgenda,
): AcaoAgenda {
  if (c.code === 'SEFAZ_HTTP') {
    const st = c.httpStatus;
    if (st === 403) return parada('parada_certificado', FRASE.certificadoRecusado(403));
    if (st === undefined || (st >= 500 && st <= 599)) return { ...base, mensagem: FRASE.foraDoAr(horaSp(base.proximaConsultaEm)) };
    return parada('parada_configuracao', FRASE.outroCodigo(st));
  }
  if (!c.enviado) {
    const recuo = RECUO_FALHA_MIN[Math.min(e.falhasSeguidas, RECUO_FALHA_MIN.length - 1)];
    const proxima = maisMs(e.agora, recuo * 60_000);
    return {
      ...base, resultado: 'falha_antes_de_enviar', proximaConsultaEm: proxima, falhasSeguidas: e.falhasSeguidas + 1,
      mensagem: FRASE.semContato(horaSp(proxima)),
    };
  }
  // Enviado e sem resposta útil: pode ter sido um 137, então vale a reserva e a consulta conta como feita.
  const sem: Partial<AcaoAgenda> = {
    resultado: 'sem_resposta', proximaConsultaEm: e.reservaAte, falhasSeguidas: e.falhasSeguidas + 1,
  };
  if (e.semRespostaSeguidas >= 2) return parada('parada_configuracao', FRASE.tresIlegiveis, sem);
  return { ...base, ...sem, mensagem: FRASE.semContato(horaSp(e.reservaAte)) };
}
