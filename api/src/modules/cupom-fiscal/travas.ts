// Travas contra o 656 ("consumo indevido": a SEFAZ bloqueia o CNPJ por até 1 hora, e com ele o caixa de hoje da loja). Desenho §4.4.
// Puras: o serviço lê o estado do ambiente (sob o FOR UPDATE da T1) e o diário `nfce_envios`, e pergunta aqui antes de QUALQUER chamada
// à SEFAZ (autorização, consulta, evento ou status). Nenhum laço: toda chamada nasce de um clique e passa por `podeChamar`.
// Quem resolve um cupom em andamento escapa das paradas de configuração (decisão T9-2): a consulta pela chave e o cancelamento (evento)
// só param no 656 (janela de 65 min e `parada_656`), na `parada_certificado` (com o certificado parado toda chamada falharia; T9-2b)
// e nos próprios limites (consulta: 2 min, 1 a cada 2 min por chave, 20 por hora;
// cancelamento: 1 pedido a cada 2 min e no máximo 3 por cupom, mais o prazo de 30 min, conferido pelo serviço). Sem isso, um cupom sem
// resposta de uma série parada não teria saída (a série só troca sem pendentes). As rejeições do cancelamento contam no teto da hora,
// mas o teto não o barra (o prazo não pode se perder). Emissão e status seguem todas as travas: qualquer parada e o teto de 10 recusas.

import type { ServicoNfce } from '../sefaz/nfce.port';

export type SituacaoAmbiente = 'ok' | 'parada_656' | 'parada_certificado' | 'parada_configuracao' | 'parada_serie_em_uso';

/** Respostas de rejeição (somadas de todos os serviços) em 60 min que param a emissão e o status até a mais antiga sair da janela (a SEFAZ pune acima de 30 iguais). */
export const TETO_RECUSAS_HORA = 10;
/** Consultas pela chave em 60 min, no ambiente. */
export const TETO_CONSULTAS_HORA = 20;
/** A consulta só a partir de 2 min depois do envio (ou do pedido de cancelamento), e uma a cada 2 min por chave. */
export const ESPERA_CONSULTA_MS = 120_000;
/** "Testar conexão" (status do serviço) no máximo uma vez a cada 5 min. */
export const STATUS_CADA_MS = 300_000;
/** Depois de um 656: nenhuma chamada NFC-e por 65 min (a SEFAZ bloqueia por 1 hora). */
export const BLOQUEIO_656_MS = 65 * 60_000;
/** Envios de autorização por cupom; depois, só Descartar. */
export const MAX_ENVIOS = 3;
/** Pedidos de cancelamento (evento 110111) por cupom: o mesmo erro repetido é o caminho do 656 (§4.4, regra 5). */
export const MAX_CANCELAMENTOS = 3;
/** Entre dois pedidos de cancelamento do mesmo cupom. */
export const ESPERA_CANCELAMENTO_MS = 120_000;

const JANELA_MS = 60 * 60_000;
const JANELA_656_MS = 24 * 60 * 60_000;

export interface EstadoTravas {
  situacao: SituacaoAmbiente;
  bloqueado_ate: Date | null;
  /** `iniciada_em` dos envios com `rejeicao = true` (todos os serviços) no ambiente; basta a última hora, em qualquer ordem. */
  recusas: Date[];
  /** `iniciada_em` das consultas no ambiente; basta a última hora, em qualquer ordem. */
  consultas: Date[];
  ultimo_status_em: Date | null;
  /** Só na consulta: o início da espera (envio de autorização, ou pedido de cancelamento em `cancelando`; ver `inicioDaEspera`). */
  enviadoEm?: Date | null;
  /** Só na consulta: a última consulta desta chave. */
  ultimaConsultaDaChave?: Date | null;
  /** Só no evento: quantos pedidos de cancelamento este cupom já fez (`nfce_envios`, serviço `cancelamento`, qualquer resultado). */
  cancelamentosDoCupom?: number;
  /** Só no evento: `iniciada_em` do último pedido de cancelamento deste cupom. */
  ultimoCancelamentoDoCupom?: Date | null;
}

export type CodigoTrava =
  | 'NFCE_BLOQUEADA'
  | 'NFCE_MUITAS_RECUSAS'
  | 'NFCE_PARADA'
  | 'NFCE_CONSULTA_CEDO'
  | 'NFCE_TESTE_CEDO'
  | 'NFCE_CANCELAMENTO_CEDO'
  | 'NFCE_LIMITE_CANCELAMENTOS';
export type ResultadoTrava = { ok: true } | { ok: false; code: CodigoTrava; ate: Date | null };

const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * Quando o teto volta a ter folga. Conta só as marcas da janela (as dos últimos 60 min, e as "no futuro", que um relógio torto não
 * deve esconder); com `teto` ou mais, a resposta é a hora em que sobram `teto − 1`: a (n − teto + 1)ª mais antiga + 60 min. null = folga.
 */
function tetoAte(marcas: readonly Date[], teto: number, agora: Date): Date | null {
  const inicio = agora.getTime() - JANELA_MS;
  const na = marcas
    .map((d) => d.getTime())
    .filter((t) => t > inicio)
    .sort((a, b) => a - b);
  return na.length < teto ? null : new Date(na[na.length - teto] + JANELA_MS);
}

/** A mais tarde das esperas que ainda não venceram; null = nenhuma. */
function esperaMaisLonga(esperas: readonly (Date | null)[], agora: Date): Date | null {
  let ate: Date | null = null;
  for (const d of esperas) if (d !== null && d > agora && (ate === null || d > ate)) ate = d;
  return ate;
}

/** Consulta pela chave e cancelamento: resolvem um cupom em andamento, então só o 656, o certificado e os próprios limites os param. */
const resolveCupom = (s: ServicoNfce) => s === 'consulta' || s === 'evento';
/** Paradas que valem para todos os serviços: o 2º 656 e o certificado recusado (T9-2b). */
const PARA_TUDO: readonly SituacaoAmbiente[] = ['parada_656', 'parada_certificado'];

/**
 * Pode chamar a SEFAZ agora? Ordem: parada (até o admin religar; na consulta e no evento, só `parada_656` e `parada_certificado`) →
 * bloqueio do 656 →
 * teto de recusas (só emissão e status) → limite do serviço (consulta: 2 min do envio, 2 min da última consulta da chave e 20 por
 * hora; evento: 3 pedidos por cupom e 2 min entre eles; status: 5 min). `ate` = quando abre (null na parada e no limite de pedidos).
 */
export function podeChamar(e: EstadoTravas, servico: ServicoNfce, agora: Date): ResultadoTrava {
  const resolve = resolveCupom(servico);
  if (PARA_TUDO.includes(e.situacao) || (e.situacao !== 'ok' && !resolve)) return { ok: false, code: 'NFCE_PARADA', ate: null };
  if (e.bloqueado_ate !== null && e.bloqueado_ate > agora) return { ok: false, code: 'NFCE_BLOQUEADA', ate: e.bloqueado_ate };
  if (!resolve) {
    const recusas = tetoAte(e.recusas, TETO_RECUSAS_HORA, agora);
    if (recusas !== null) return { ok: false, code: 'NFCE_MUITAS_RECUSAS', ate: recusas };
  }

  if (servico === 'consulta') {
    const ate = esperaMaisLonga(
      [
        tetoAte(e.consultas, TETO_CONSULTAS_HORA, agora),
        e.enviadoEm ? mais(e.enviadoEm, ESPERA_CONSULTA_MS) : null,
        e.ultimaConsultaDaChave ? mais(e.ultimaConsultaDaChave, ESPERA_CONSULTA_MS) : null,
      ],
      agora,
    );
    if (ate !== null) return { ok: false, code: 'NFCE_CONSULTA_CEDO', ate };
  }
  if (servico === 'evento') {
    if ((e.cancelamentosDoCupom ?? 0) >= MAX_CANCELAMENTOS) return { ok: false, code: 'NFCE_LIMITE_CANCELAMENTOS', ate: null };
    const ate = e.ultimoCancelamentoDoCupom ? mais(e.ultimoCancelamentoDoCupom, ESPERA_CANCELAMENTO_MS) : null;
    if (ate !== null && ate > agora) return { ok: false, code: 'NFCE_CANCELAMENTO_CEDO', ate };
  }
  if (servico === 'status' && e.ultimo_status_em !== null) {
    const ate = mais(e.ultimo_status_em, STATUS_CADA_MS);
    if (ate > agora) return { ok: false, code: 'NFCE_TESTE_CEDO', ate };
  }
  return { ok: true };
}

/**
 * Veio um 656 (em qualquer serviço): bloqueia por 65 min; o 2º em 24 h (24 h exatas contam; um anterior "no futuro" também, pelo lado
 * seguro) vira `parada_656`, que desliga a emissão. O serviço grava `ultimo_656_em = agora`.
 */
export function depoisDo656(ultimo656: Date | null, agora: Date): { bloqueado_ate: Date; parada: boolean } {
  const parada = ultimo656 !== null && agora.getTime() - ultimo656.getTime() <= JANELA_656_MS;
  return { bloqueado_ate: mais(agora, BLOQUEIO_656_MS), parada };
}
