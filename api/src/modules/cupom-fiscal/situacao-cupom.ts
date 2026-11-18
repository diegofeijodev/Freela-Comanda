// Situação de cada cupom e o que a tela pode fazer com ele (desenho §5.1; UX 3.1, 3.2, 4.2 e pontos 10.3, 10.7 e 10.8). Puras: o
// serviço passa a linha de `nfce_cupons` mais as horas do diário `nfce_envios`, e a tela recebe `acoes`, `consultar_a_partir_de` e
// `cancelar_ate` prontos (a contagem não depende do relógio do celular). "Enviado sem resposta" NUNCA leva a reenvio: só a consulta.

import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { ESPERA_CONSULTA_MS, MAX_CANCELAMENTOS, MAX_ENVIOS } from './travas';

/** Os 10 valores do CHECK de `nfce_cupons.situacao`. */
export type SituacaoCupom =
  | 'enviando'
  | 'nao_enviado'
  | 'sem_resposta'
  | 'nao_consta'
  | 'rejeitado'
  | 'autorizado'
  | 'cancelando'
  | 'denegado'
  | 'cancelado'
  | 'descartado';
export type AcaoCupom = 'enviar_de_novo' | 'consultar' | 'cancelar' | 'descartar' | 'lancar_venda' | 'imprimir';
export type VendaEstoque = 'lancada' | 'pendente' | 'desfeita' | 'desfazer_pendente' | 'teste' | 'nao_lanca';
/**
 * O tipo do 1º pendente, para a frase da faixa (UX 4.2). `cancelando` e `venda_a_desfazer` (o cupom cancelado com a venda ainda no
 * estoque) vêm separados de `sem_resposta` e de `venda_pendente`, porque a frase da UX deles não serve (Ruling T15).
 */
export type TipoPendente = 'sem_resposta' | 'cancelando' | 'nao_saiu' | 'recusado' | 'venda_pendente' | 'venda_a_desfazer';

/** O botão e o servidor aceitam cancelar até a autorização (`dhRecbto`) + 29 min; a SEFAZ aceita 30 (1 min de folga, §5.4). */
export const PRAZO_CANCELAR_MS = 29 * 60_000;

/** As ações saem sempre nesta ordem (a da tela é da tela). */
const ORDEM: readonly AcaoCupom[] = ['enviar_de_novo', 'consultar', 'cancelar', 'descartar', 'lancar_venda', 'imprimir'];

export interface CupomParaAcoes {
  situacao: SituacaoCupom;
  ambiente: AmbienteSefaz;
  envios: number;
  numero_reaproveitavel: boolean;
  autorizada_em: Date | null;
  cancelamento_pedido_em: Date | null;
  /** A resposta fotografada na T1 (em homologação, sempre falso). */
  lanca_venda: boolean;
  venda_lancada_em: Date | null;
  venda_desfeita_em: Date | null;
  /** `iniciada_em` do último envio de autorização (`nfce_envios`): base do `enviando` vencido e da 1ª consulta. */
  enviadoEm: Date | null;
  /** `iniciada_em` da última consulta desta chave. */
  ultimaConsultaDaChave: Date | null;
  /**
   * Pedidos de cancelamento deste cupom que saíram (o aberto conta; a falha antes de enviar não), a MESMA contagem do limite do servidor
   * (`TravasDoCupom.cancelamentosDoCupom`): do 3º em diante a tela não mostra "Cancelar" (Ruling T9 fix).
   */
  cancelamentos: number;
}

const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * `enviando` há 2 min ou mais vale como `sem_resposta` (a T2 não gravou ou o processo morreu; a única saída é a consulta). A virada é
 * na mesma hora em que a consulta abre (`ESPERA_CONSULTA_MS`). Sem a hora do envio, já é `sem_resposta` (número preso).
 */
export function situacaoEfetiva(c: Pick<CupomParaAcoes, 'situacao' | 'enviadoEm'>, agora: Date): SituacaoCupom {
  if (c.situacao !== 'enviando') return c.situacao;
  return c.enviadoEm === null || agora.getTime() - c.enviadoEm.getTime() >= ESPERA_CONSULTA_MS ? 'sem_resposta' : 'enviando';
}

/**
 * O início da espera da consulta (o mesmo para `consultar_a_partir_de` e para o `enviadoEm` de `podeChamar`): em `cancelando`, o
 * pedido de cancelamento; nas outras, o último envio de autorização.
 */
export function inicioDaEspera(c: Pick<CupomParaAcoes, 'situacao' | 'enviadoEm' | 'cancelamento_pedido_em'>): Date | null {
  return c.situacao === 'cancelando' ? (c.cancelamento_pedido_em ?? c.enviadoEm) : c.enviadoEm;
}

/**
 * A venda do cupom no estoque (UX 3.2), só em `autorizado`, `cancelando` e `cancelado`. Em `cancelando` a venda fica até a resposta.
 * `pendente` = ainda não lançou (a T3 falhou ou não rodou); no `cancelado`, a venda que entrou e ainda não saiu = `desfazer_pendente`.
 */
export function vendaEstoque(
  c: Pick<CupomParaAcoes, 'situacao' | 'ambiente' | 'lanca_venda' | 'venda_lancada_em' | 'venda_desfeita_em'>,
): VendaEstoque | null {
  if (c.situacao !== 'autorizado' && c.situacao !== 'cancelando' && c.situacao !== 'cancelado') return null;
  if (c.ambiente === 'homologacao') return 'teste';
  if (!c.lanca_venda) return 'nao_lanca';
  if (c.situacao === 'cancelado') return c.venda_lancada_em !== null && c.venda_desfeita_em === null ? 'desfazer_pendente' : 'desfeita';
  return c.venda_lancada_em !== null ? 'lancada' : 'pendente';
}

/**
 * O que a tela pode fazer agora (§5.1). `consultar` aparece mesmo antes da hora, com `consultar_a_partir_de` (o botão habilita sozinho,
 * nunca dispara); `cancelar` some depois de `cancelar_ate`, que continua vindo para a tela dizer quando terminou (UX 4.4).
 * Sem resposta (inclusive o 204 e o `enviando` vencido) = só `consultar`. Número bloqueado (539) = só `descartar`.
 */
export function acoesDoCupom(
  c: CupomParaAcoes,
  agora: Date,
): { acoes: AcaoCupom[]; consultar_a_partir_de: Date | null; cancelar_ate: Date | null } {
  const s = situacaoEfetiva(c, agora);
  const acoes = new Set<AcaoCupom>();
  const podeReenviar = c.numero_reaproveitavel && c.envios < MAX_ENVIOS;
  const cancelar_ate =
    (s === 'autorizado' || s === 'cancelando') && c.autorizada_em !== null ? mais(c.autorizada_em, PRAZO_CANCELAR_MS) : null;

  switch (s) {
    case 'nao_enviado':
    case 'rejeitado':
      if (!c.numero_reaproveitavel) {
        acoes.add('descartar');
        break;
      }
      if (podeReenviar) acoes.add('enviar_de_novo');
      acoes.add('consultar').add('descartar');
      break;
    case 'nao_consta':
      if (podeReenviar) acoes.add('enviar_de_novo');
      acoes.add('descartar');
      break;
    case 'sem_resposta':
    case 'cancelando':
      acoes.add('consultar');
      break;
    case 'autorizado':
      acoes.add('imprimir').add('consultar');
      if (cancelar_ate !== null && agora <= cancelar_ate && c.cancelamentos < MAX_CANCELAMENTOS) acoes.add('cancelar');
      if (vendaEstoque(c) === 'pendente') acoes.add('lancar_venda');
      break;
    case 'cancelado':
      if (vendaEstoque(c) === 'desfazer_pendente') acoes.add('lancar_venda');
      break;
    // enviando (dentro dos 2 min), denegado e descartado: nenhuma
  }

  let consultar_a_partir_de: Date | null = null;
  if (acoes.has('consultar')) {
    for (const base of [inicioDaEspera({ ...c, situacao: s }), c.ultimaConsultaDaChave]) {
      if (base === null) continue;
      const d = mais(base, ESPERA_CONSULTA_MS);
      if (consultar_a_partir_de === null || d > consultar_a_partir_de) consultar_a_partir_de = d;
    }
  }
  return { acoes: ORDEM.filter((a) => acoes.has(a)), consultar_a_partir_de, cancelar_ate };
}

/** O tipo do cupom na faixa de pendentes (ponto 10.7): o `enviando` vencido conta como sem resposta; `cancelando` tem o seu tipo. */
export function tipoPendente(
  c: Pick<CupomParaAcoes, 'situacao' | 'enviadoEm' | 'ambiente' | 'lanca_venda' | 'venda_lancada_em' | 'venda_desfeita_em'>,
  agora: Date,
): TipoPendente | null {
  const s = situacaoEfetiva(c, agora);
  if (s === 'sem_resposta') return 'sem_resposta';
  if (s === 'cancelando') return 'cancelando';
  if (s === 'nao_enviado' || s === 'nao_consta') return 'nao_saiu';
  if (s === 'rejeitado') return 'recusado';
  const v = vendaEstoque(c);
  return v === 'pendente' ? 'venda_pendente' : v === 'desfazer_pendente' ? 'venda_a_desfazer' : null;
}
