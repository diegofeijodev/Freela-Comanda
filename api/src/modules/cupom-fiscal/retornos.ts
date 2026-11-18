// Retornos da SEFAZ → o que fazer com o cupom e com o ambiente (desenho §5.3 e §5.4; travas da §4.4; frases da UX §6.1). Puras: sem
// banco, sem rede; a hora vem no contexto. Regra de ouro da numeração (§4.3): um número só fica livre com prova de que a SEFAZ não o
// tem. Resposta que não prova nada (falha depois de enviar, lote aceito sem protNFe, autorizado ou denegado sem `nProt` válido, código
// não catalogado) = `sem_resposta`: o número fica preso e só a consulta pela chave decide (a partir de 2 min). Nada aqui manda reenviar.
//
// `rejeicao` (conta no teto de 10 por hora): a SEFAZ respondeu com código de rejeição, ou seja, 200 em diante, menos 301 e 302 (uso
// denegado). Os 1xx (autorizado, lote aceito, serviço parado, cancelamento homologado) e as falhas de transporte não contam.

import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import type { RespostaAutorizacao, RespostaConsulta, RespostaEvento, RespostaStatus } from '../sefaz/nfce.port';
import { SefazErro } from '../sefaz/sefaz-erro';
import { FRASE_RETORNO as F } from './frases';
import type { SituacaoCupom } from './situacao-cupom';
import { depoisDo656, ESPERA_CONSULTA_MS, type SituacaoAmbiente } from './travas';

export type Familia = 'produto' | 'empresa' | 'consumidor' | 'valores' | 'hora' | 'outra';

/** O que a SEFAZ disse, para a tela: o código, a família (escolhe a ação, UX 6.1), a frase final e o `xMotivo` à parte (`<details>`). */
export interface Recusa {
  codigo: number;
  familia: Familia;
  frase: string;
  /** Sem o prefixo "Rejeição:", cortado em 255 caracteres; só texto. */
  x_motivo: string;
}

export interface AcaoRetorno {
  cupom: SituacaoCupom;
  /** Conta no teto de recusas (`nfce_envios.rejeicao`). */
  rejeicao: boolean;
  /** 539: o número é de outra nota e nunca volta a ser usado. */
  numeroReaproveitavel?: false;
  /** A parada do ambiente (a `mensagem` dela sai de `mensagemDoAmbiente`). */
  ambiente?: SituacaoAmbiente;
  /** 656 (no protNFe ou no lote): o serviço grava `bloqueado_ate` e `ultimo_656_em = contexto.agora`. */
  bloquear656?: true;
  bloqueadoAte?: Date;
  /** 120: o aviso da SEFAZ, para `alerta_c_msg`/`alerta_x_msg`. */
  alerta?: { c_msg: string | null; x_msg: string | null };
  /** Não nula quando a resposta tem um código que não é sucesso e a UX dá frase para ele; nula no autorizado e nas falhas sem código. */
  recusa: Recusa | null;
}

/** O que as frases e o 656 precisam além da resposta. */
export interface ContextoRetorno {
  /** "do modo de teste" ou "valendo" (QR). */
  ambiente: AmbienteSefaz;
  serie: number;
  numero: number;
  /** Quando a T2 aplica a resposta: base do bloqueio de 65 min. */
  agora: Date;
  /** Início desta chamada (`nfce_envios.iniciada_em`): base do "consulte a partir das" (+ 2 min) do 204. */
  enviadoEm: Date;
  /** `nfce_ambientes.ultimo_656_em`, para o 2º em 24 h. */
  ultimo656: Date | null;
}

const AUTORIZADO = new Set([100, 150, 120]);
const DENEGADO = new Set([110, 301, 302]);
const FORA_DO_AR = new Set([108, 109]);
const ESQUEMA_E_LOTE = new Set([214, 215, 225, 402, 404, 516, 517, 587, 588]);
const QR = new Set([394, 395]); // o código do hash do QR inválido ainda não foi confirmado (§5.3); o 1º teste completa
/** `xProd` do 1º item fora do texto de homologação (§5.2, `XPROD_HOMOLOGACAO`): defeito da montagem, não do QR (rodada de correção 1). */
const NOME_HOMOLOGACAO = 373;
const EVENTO_REGISTRADO = new Set([135, 155]);
const NOTA_CANCELADA = new Set([101, 151]);
const NAO_CATALOGADO = 999;
const STATUS_EM_OPERACAO = 107;
const certificado = (c: number) => c === 213 || (c >= 280 && c <= 286) || (c >= 290 && c <= 298);
const ehRejeicao = (c: number) => c >= 200 && !DENEGADO.has(c);
/** Sem protocolo não há prova nem DANFE (T9-4): o adaptador já anula o `nProt` fora do formato; aqui se confere de novo (15 ou 17 dígitos). */
const temProtocolo = (p: { nProt: string | null }) => p.nProt !== null && /^[0-9]{15}([0-9]{2})?$/.test(p.nProt);
/** A SEFAZ diz que tem a nota (autorizada ou denegada): o número é dela, com ou sem protocolo legível. */
const temANota = (c: number) => AUTORIZADO.has(c) || DENEGADO.has(c);

/** Família por código (desenho §11, ponto 10.4): só os códigos da pesquisa; fora da lista = `outra` (o 1º teste completa). */
const FAMILIAS: readonly [Familia, readonly number[]][] = [
  ['produto', [386, 725]],
  ['valores', [391, 436, 610, 629, 780, 857, 869, 899, 963]],
  ['consumidor', [786, 787, 788]],
  ['hora', [704]],
  ['empresa', []],
];

export function familiaDoCodigo(c: number): Familia {
  return FAMILIAS.find(([, cs]) => cs.includes(c))?.[0] ?? 'outra';
}

/** O `xMotivo` para a tela: sem o prefixo "Rejeição:", aparado e cortado em 255 caracteres (sem partir emoji). */
export function motivoSefaz(x: string | null | undefined): string {
  const t = (x ?? '').trim().replace(/^rejei[çc][ãa]o\s*:\s*/iu, '');
  return Array.from(t).slice(0, 255).join('');
}

// Data e hora com fuso explícito (a SEFAZ manda `AAAA-MM-DDThh:mm:ss-03:00`); sem fuso o `Date.parse` usaria o do processo.
const DH_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const DERIVA_MAX_MS = 120_000;

/** O relógio do servidor difere do da SEFAZ em mais de 120 s (§4.4, regra 8 → `parada_configuracao`). Ilegível ou sem fuso = não prova. */
export function relogioDiverge(dhRecbto: string, agora: Date): boolean {
  if (!DH_COM_FUSO.test(dhRecbto)) return false;
  const t = Date.parse(dhRecbto);
  return !Number.isNaN(t) && Math.abs(t - agora.getTime()) > DERIVA_MAX_MS;
}

const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * O atalho da tela que conserta a recusa: os LINKS que a UX 6.1 escreve em cada linha (Ruling "T14 atalhos"; a tela não classifica por
 * código). `certificado` = "[Ir para o certificado]" (o certificado digital em Configurações); `csc` = "[Ir para Configurações]" do QR (o
 * código de segurança e o IdCSC, Configurações › Cupom fiscal); `empresa` = "[Ir para Configurações]" da família empresa (quadro "Empresa
 * no cupom"); `serie` = "[Trocar a série]" do 539 (o campo série, Configurações › Cupom fiscal); `produtos` = "Corrigir os produtos" (a
 * aba Produtos com os produtos do cupom). A UX não tem frase nem link próprio para a tributação do item (CFOP, CST/CSOSN, alíquota): ela
 * é da família produto ("Confira os produtos"), então não há atalho `perfil`.
 */
export type Atalho = 'certificado' | 'csc' | 'empresa' | 'serie' | 'produtos';

/** O link da família (UX 6.1): produto e "sem família" (`recusaOutra`: "se ela falar de um produto, confira os produtos") → `produtos`;
 * empresa → `empresa`; consumidor, valores e hora não têm link (Descartar / Enviar de novo). */
export function atalhoDaFamilia(f: Familia): Atalho | null {
  if (f === 'produto' || f === 'outra') return 'produtos';
  if (f === 'empresa') return 'empresa';
  return null;
}

/**
 * O atalho da recusa da AUTORIZAÇÃO ou da CONSULTA (as do diário que o cupom mostra; a do cancelamento fica no diálogo), pelo MESMO
 * caminho que escolhe a frase (`efeitoNoAmbiente` e `acaoPeloCodigo`), para frase e atalho não se desencontrarem:
 *   - certificado (213, 280–286, 290–298; chega como `nao_enviado`, ou fica na consulta) → `certificado`;
 *   - 539 (série em uso: "troque a série em Configurações → Cupom fiscal") → `serie`;
 *   - QR (394, 395; a frase manda conferir o CSC e o IdCSC) → `csc`;
 *   - as demais rejeições da nota → o link da família (`atalhoDaFamilia`);
 *   - sem atalho: 656 (bloqueio), 781 (credenciamento: o contador), esquema e lote (erro do sistema), autorizado, denegado (o contador),
 *     108/109 (fora do ar), os 1xx e o 999 (sem resposta), 204 (só a consulta) e 373 (erro do sistema).
 */
export function atalhoDaRecusa(r: Pick<Recusa, 'codigo'> | null): Atalho | null {
  if (r === null) return null;
  const c = r.codigo;
  // efeitoNoAmbiente, na mesma ordem
  if (c === 656 || c === 781) return null;
  if (certificado(c)) return 'certificado';
  if (ESQUEMA_E_LOTE.has(c)) return null;
  // acaoPeloCodigo, na mesma ordem
  if (AUTORIZADO.has(c) || DENEGADO.has(c) || FORA_DO_AR.has(c) || c < 200 || c === NAO_CATALOGADO || c === 204) return null;
  if (c === 539) return 'serie';
  if (c === NOME_HOMOLOGACAO) return null;
  if (QR.has(c)) return 'csc';
  return atalhoDaFamilia(familiaDoCodigo(c));
}

function recusaDe(codigo: number, xMotivo: string | null | undefined, frase: (motivo: string) => string): Recusa {
  const x_motivo = motivoSefaz(xMotivo);
  return { codigo, familia: familiaDoCodigo(codigo), frase: frase(x_motivo), x_motivo };
}

type Efeito = Pick<AcaoRetorno, 'ambiente' | 'bloquear656' | 'bloqueadoAte'> & { frase: string };

/** Código que para ou bloqueia o ambiente, em qualquer serviço (§4.4, regras 5 e 6): 656, 781, certificado e esquema. null = não para. */
function efeitoNoAmbiente(c: number, ctx: Pick<ContextoRetorno, 'agora' | 'ultimo656'>): Efeito | null {
  if (c === 656) {
    const d = depoisDo656(ctx.ultimo656, ctx.agora);
    return {
      bloquear656: true,
      bloqueadoAte: d.bloqueado_ate,
      ...(d.parada ? { ambiente: 'parada_656' as const } : {}),
      frase: d.parada ? F.bloqueouDuasVezes : F.bloqueio656(d.bloqueado_ate),
    };
  }
  if (c === 781) return { ambiente: 'parada_configuracao', frase: F.naoCredenciada };
  if (certificado(c)) return { ambiente: 'parada_certificado', frase: F.certificado(c) };
  if (ESQUEMA_E_LOTE.has(c)) return { ambiente: 'parada_configuracao', frase: F.erroDoSistema(c) };
  return null;
}

/**
 * A `mensagem` do ambiente depois da resposta: 2º 656 = a frase do desligamento; outra parada = a frase da recusa; só o bloqueio do 656
 * = a frase do bloqueio com a hora. null = a resposta não mexe no ambiente. Use esta, não a `recusa.frase`: com 656 no lote e `protNFe`
 * na mesma resposta, a recusa é a do cupom.
 */
export function mensagemDoAmbiente(a: AcaoRetorno): string | null {
  if (a.ambiente === 'parada_656') return F.bloqueouDuasVezes;
  if (a.ambiente) return a.recusa?.frase ?? null;
  if (a.bloquear656 && a.bloqueadoAte) return F.bloqueio656(a.bloqueadoAte);
  return null;
}

function comEfeito(cupom: SituacaoCupom, c: number, xMotivo: string | null | undefined, ef: Efeito): AcaoRetorno {
  const { frase, ...efeito } = ef;
  return { cupom, rejeicao: ehRejeicao(c), ...efeito, recusa: recusaDe(c, xMotivo, () => frase) };
}

const alertaDe = (p: { cStat: number; cMsg: string | null; xMsg: string | null }) =>
  p.cStat === 120 ? { alerta: { c_msg: p.cMsg, x_msg: p.xMsg } } : {};

function fraseDaFamilia(f: Familia, c: number): string {
  switch (f) {
    case 'produto':
      return F.recusaProduto;
    case 'empresa':
      return F.recusaEmpresa;
    case 'consumidor':
      return F.recusaConsumidor;
    case 'valores':
      return F.recusaValores(c);
    case 'hora':
      return F.horaAtrasada;
    default:
      return F.recusaOutra(c);
  }
}

/**
 * Autorização (§5.3, tabela "Autorização"). Com `protNFe`, vale o código dele (seja qual for o do lote); sem, o do lote. Autorizado ou
 * denegado sem `protNFe` ou sem `nProt` válido, lote aceito (103/104/105) sem `protNFe`, outro 1xx e o 999 = `sem_resposta`: a SEFAZ
 * pode ter a nota.
 */
export function acaoAutorizacao(r: RespostaAutorizacao | SefazErro, ctx: ContextoRetorno): AcaoRetorno {
  const a = acaoPeloCodigo(r, ctx);
  // 656 no lote conta mesmo com protNFe (§4.4, regra 6: "em qualquer serviço"; rodada de correção 1): o cupom segue o protNFe (o número
  // é dele) e o ambiente bloqueia 65 min, ou para no 2º em 24 h (a parada_656 vale sobre a do protNFe). A mensagem: `mensagemDoAmbiente`.
  if (r instanceof SefazErro || r.protocolo === null || r.cStatLote !== 656 || a.bloquear656) return a;
  const d = depoisDo656(ctx.ultimo656, ctx.agora);
  return {
    ...a,
    rejeicao: true,
    bloquear656: true,
    bloqueadoAte: d.bloqueado_ate,
    ...(d.parada ? { ambiente: 'parada_656' as const } : {}),
  };
}

function acaoPeloCodigo(r: RespostaAutorizacao | SefazErro, ctx: ContextoRetorno): AcaoRetorno {
  if (r instanceof SefazErro) return { cupom: r.enviado ? 'sem_resposta' : 'nao_enviado', rejeicao: false, recusa: null };
  const p = r.protocolo;
  const c = p ? p.cStat : r.cStatLote;
  const xMotivo = p ? p.xMotivo : r.xMotivoLote;
  const rejeicao = ehRejeicao(c);

  if (p && temProtocolo(p) && AUTORIZADO.has(c)) return { cupom: 'autorizado', rejeicao: false, ...alertaDe(p), recusa: null };
  if (p && temProtocolo(p) && DENEGADO.has(c)) {
    return { cupom: 'denegado', rejeicao: false, recusa: recusaDe(c, xMotivo, (m) => F.denegado(c, m)) };
  }
  if (DENEGADO.has(c) || (c < 200 && !FORA_DO_AR.has(c)) || c === NAO_CATALOGADO) return { cupom: 'sem_resposta', rejeicao, recusa: null };

  if (FORA_DO_AR.has(c)) return { cupom: 'nao_enviado', rejeicao: false, recusa: recusaDe(c, xMotivo, () => F.foraDoAr(c)) };
  const efeito = efeitoNoAmbiente(c, ctx);
  if (efeito) return comEfeito('nao_enviado', c, xMotivo, efeito);
  if (c === 204) {
    return { cupom: 'sem_resposta', rejeicao, recusa: recusaDe(c, xMotivo, () => F.jaTem(mais(ctx.enviadoEm, ESPERA_CONSULTA_MS))) };
  }
  if (c === 539) {
    return {
      cupom: 'rejeitado',
      rejeicao,
      numeroReaproveitavel: false,
      ambiente: 'parada_serie_em_uso',
      recusa: recusaDe(c, xMotivo, () => F.serieEmUso(ctx.serie, ctx.numero)),
    };
  }
  if (c === NOME_HOMOLOGACAO) {
    return { cupom: 'rejeitado', rejeicao, ambiente: 'parada_configuracao', recusa: recusaDe(c, xMotivo, () => F.erroDoSistema(c)) };
  }
  if (QR.has(c)) {
    return { cupom: 'rejeitado', rejeicao, ambiente: 'parada_configuracao', recusa: recusaDe(c, xMotivo, () => F.qrCode(c, ctx.ambiente)) };
  }
  // 704 (família hora) e as demais rejeições da nota: a família escolhe a frase; o número fica livre.
  return { cupom: 'rejeitado', rejeicao, recusa: recusaDe(c, xMotivo, () => fraseDaFamilia(familiaDoCodigo(c), c)) };
}

/** Situações em que a SEFAZ já nos deu o protocolo: a consulta só as move para `cancelado` (ou de `cancelando` de volta a `autorizado`). */
const COM_PROTOCOLO: readonly SituacaoCupom[] = ['autorizado', 'cancelando'];
const FINAIS: readonly SituacaoCupom[] = ['cancelado', 'denegado', 'descartado'];

/**
 * Consulta pela chave (§5.3, tabela "Consulta"; §5.1). O cancelamento registrado (evento 135/155, ou a nota 101/151) vale sobre o
 * `protNFe`; "sem evento → autorizado" só quando a resposta mostra a nota autorizada, com `nProt` válido; autorizada ou denegada sem
 * `nProt` válido = `sem_resposta` (o número fica preso, mesmo vindo de um estado de número livre); 217 = `nao_consta` só se não temos
 * protocolo.
 * 656, certificado e esquema param o ambiente e deixam o cupom como está; 108/109, falha de transporte e qualquer outro código também
 * deixam (o `enviando` vencido vira `sem_resposta`). `cancelado`, `denegado` e `descartado` não mudam.
 */
export function acaoConsulta(r: RespostaConsulta | SefazErro, atual: SituacaoCupom, ctx: ContextoRetorno): AcaoRetorno {
  const manter: SituacaoCupom = atual === 'enviando' ? 'sem_resposta' : atual;
  if (r instanceof SefazErro) return { cupom: manter, rejeicao: false, recusa: null };
  const c = r.cStat;
  const p = r.protocolo;
  const rejeicao = ehRejeicao(c);

  const efeito = efeitoNoAmbiente(c, ctx);
  if (efeito) return comEfeito(manter, c, r.xMotivo, efeito);
  if (FINAIS.includes(manter)) return { cupom: manter, rejeicao, recusa: null };

  const cancelada = (r.cancelamento !== null && EVENTO_REGISTRADO.has(r.cancelamento.cStat)) || NOTA_CANCELADA.has(c);
  if (cancelada) return { cupom: 'cancelado', rejeicao: false, recusa: null };
  if (p && temProtocolo(p) && AUTORIZADO.has(p.cStat)) return { cupom: 'autorizado', rejeicao: false, ...alertaDe(p), recusa: null };
  if (COM_PROTOCOLO.includes(manter)) return { cupom: manter, rejeicao, recusa: null };

  if (p && temProtocolo(p) && DENEGADO.has(p.cStat)) {
    return { cupom: 'denegado', rejeicao: false, recusa: recusaDe(p.cStat, p.xMotivo, (m) => F.denegado(p.cStat, m)) };
  }
  if ((p && temANota(p.cStat)) || temANota(c)) return { cupom: 'sem_resposta', rejeicao, recusa: null };
  if (c === 217) return { cupom: 'nao_consta', rejeicao, recusa: null };
  return { cupom: manter, rejeicao, recusa: null };
}

/**
 * Cancelamento (§5.4). 135/155 = `cancelado`; 573, falha depois de enviar, lote 128 sem `retEvento`, outro 1xx e 999 = `cancelando`
 * (pode ter entrado: a consulta decide); 656, certificado e esquema param ou bloqueiam e o cupom continua `autorizado`; as demais
 * recusas (e 108/109) deixam `autorizado`, com o código na frase (UX 4.3).
 */
export function acaoCancelamento(r: RespostaEvento | SefazErro, ctx: ContextoRetorno): AcaoRetorno {
  if (r instanceof SefazErro) return { cupom: r.enviado ? 'cancelando' : 'autorizado', rejeicao: false, recusa: null };
  const doEvento = r.cStatLote === 128;
  const c = doEvento ? r.cStat : r.cStatLote;
  if (c === null) return { cupom: 'cancelando', rejeicao: false, recusa: null };
  const xMotivo = doEvento ? r.xMotivo : r.xMotivoLote;
  const rejeicao = ehRejeicao(c);

  if (EVENTO_REGISTRADO.has(c)) return { cupom: 'cancelado', rejeicao: false, recusa: null };
  if (c === 573) return { cupom: 'cancelando', rejeicao, recusa: null };
  const efeito = efeitoNoAmbiente(c, ctx);
  if (efeito) return comEfeito('autorizado', c, xMotivo, efeito);
  if (!FORA_DO_AR.has(c) && (c < 200 || c === NAO_CATALOGADO)) return { cupom: 'cancelando', rejeicao, recusa: null };
  return { cupom: 'autorizado', rejeicao, recusa: recusaDe(c, xMotivo, (m) => F.cancelamentoRecusado(c, m)) };
}

/** O que fazer com a resposta do "Testar a conexão" (status do serviço). */
export interface AcaoStatus {
  /** 107: a SEFAZ respondeu que o serviço está em operação. */
  emOperacao: boolean;
  /** Conta no teto de recusas, como nos outros serviços. */
  rejeicao: boolean;
  ambiente?: SituacaoAmbiente;
  bloquear656?: true;
  bloqueadoAte?: Date;
  /** O `cStat` (null na falha de transporte), para o registro do envio. */
  codigo: number | null;
  /** A linha sob o botão (UX 5.1); na parada e no 656, é também a mensagem do ambiente. */
  frase: string;
}

/**
 * "Testar a conexão" (decisão T9-3): a espera de 5 min é do `podeChamar`; aqui, o 656, a parada (781, certificado, esquema) e a
 * rejeição contam como nos outros serviços (`efeitoNoAmbiente`, `ehRejeicao`). 108/109 = fora do ar, sem rejeição. O relógio
 * (`relogioDiverge` com o `dhRecbto` do status) fica com o serviço, como nas outras respostas.
 */
export function acaoStatus(r: RespostaStatus | SefazErro, ctx: Pick<ContextoRetorno, 'agora' | 'ultimo656'>): AcaoStatus {
  if (r instanceof SefazErro) return { emOperacao: false, rejeicao: false, codigo: null, frase: F.statusSemContato };
  const c = r.cStat;
  if (c === STATUS_EM_OPERACAO) return { emOperacao: true, rejeicao: false, codigo: c, frase: F.statusOk(ctx.agora) };
  if (FORA_DO_AR.has(c)) return { emOperacao: false, rejeicao: false, codigo: c, frase: F.statusForaDoAr(c) };
  const efeito = efeitoNoAmbiente(c, ctx);
  if (efeito) return { emOperacao: false, rejeicao: ehRejeicao(c), codigo: c, ...efeito };
  return { emOperacao: false, rejeicao: ehRejeicao(c), codigo: c, frase: F.statusOutroCodigo(c) };
}
