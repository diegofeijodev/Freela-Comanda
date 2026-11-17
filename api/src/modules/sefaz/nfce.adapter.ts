import { Inject, Injectable } from '@nestjs/common';
import { chaveValida } from '../../common/fiscal/chave-acesso';
import { CADEIA_ICP, type CadeiaIcp } from '../certificado-digital/cadeia';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { confiancaSefaz } from './confianca';
import type { AmbienteSefaz } from './distribuicao.port';
import {
  SEFAZ_NFCE,
  type ProtocoloNfce,
  type RespostaAutorizacao,
  type RespostaConsulta,
  type RespostaEvento,
  type RespostaStatus,
  type SefazNfcePort,
  type ServicoNfce,
} from './nfce.port';
import { sefazErro, type CodigoFault, type PassoLeitura } from './sefaz-erro';
import { CHAMAR_SOAP12, faultDe, type ChamarSoap12 } from './transporte-soap12';
import { elementos, lerXml, XmlInvalido, type NoXml } from './xml-leitura';

// Adaptador da NFC-e de SP sobre o transporte SOAP 1.2 com mTLS (desenho §8.3): conhece as URLs (pesquisa B.2), as actions e o
// `nfeDadosMsg` de cada serviço (NT 2016.002), envia SEMPRE com `envelope: 'sem_prefixo'` (a assinatura do infNFe/infEvento confere no
// envelope inteiro) e lê os retornos. Nenhuma regra de quando chamar. Erros: frase fixa (nunca chave, XML ou corpo da resposta).

export { SEFAZ_NFCE };

export const URL_NFCE: Record<ServicoNfce, Record<AmbienteSefaz, string>> = {
  autorizacao: {
    producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
  },
  consulta: {
    producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
    homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
  },
  evento: {
    producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
    homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
  },
  status: {
    producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
    homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
  },
};

/** Namespace do `nfeDadosMsg` de cada serviço: o do WSDL (NT 2016.002). */
const NS_DADOS: Record<ServicoNfce, string> = {
  autorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
  consulta: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
  evento: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
  status: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
};

export const ACTION_NFCE: Record<ServicoNfce, string> = {
  autorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
  consulta: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
  evento: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
  status: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
};

/** Prazo total de cada chamada (desenho §8.3: as respostas da NFC-e são pequenas). */
export const TEMPO_LIMITE_NFCE_MS = 20_000;
export const TETO_RESPOSTA_NFCE_BYTES = 2 * 1024 * 1024;

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const C_UF_SP = '35';
const ABRE_ENVI_NFE = `<enviNFe xmlns="${NS_NFE}" versao="4.00">`;
const ABRE_ENV_EVENTO = `<envEvento xmlns="${NS_NFE}" versao="1.00">`;
const ABRE_DADOS_EVENTO = `<nfeDadosMsg xmlns="${NS_DADOS.evento}">${ABRE_ENV_EVENTO}`;

/** URL do serviço no ambiente; ambiente fora da lista = Error antes de qualquer chamada. */
export function urlNfce(servico: ServicoNfce, ambiente: AmbienteSefaz): string {
  if (!Object.hasOwn(URL_NFCE[servico], ambiente)) throw new Error('Ambiente inválido para a NFC-e.');
  return URL_NFCE[servico][ambiente];
}

const tpAmbDe = (ambiente: AmbienteSefaz): '1' | '2' => {
  if (ambiente === 'producao') return '1';
  if (ambiente === 'homologacao') return '2';
  throw new Error('Ambiente inválido para a NFC-e.');
};
const dadosMsg = (servico: ServicoNfce, conteudo: string): string => `<nfeDadosMsg xmlns="${NS_DADOS[servico]}">${conteudo}</nfeDadosMsg>`;

// --- corpos (conteúdo do Body), puros: o adaptador e o falso usam os mesmos ---------------------------------------------------------

/** O `enviNFe` de `corpoEnviNfe` (sem declaração XML e sem `nfeDadosMsg`) embrulhado UMA vez; qualquer outra forma = Error. */
export function corpoAutorizacao(enviNFe: string): string {
  if (!enviNFe.startsWith(ABRE_ENVI_NFE) || !enviNFe.endsWith('</enviNFe>')) throw new Error('enviNFe fora do formato da autorização.');
  return dadosMsg('autorizacao', enviNFe);
}

/** `consSitNFe` 4.00 com tpAmb, xServ CONSULTAR e a chave (alfanumérica, DV conferido por `chaveValida`). */
export function corpoConsulta(ambiente: AmbienteSefaz, chave: string): string {
  const tpAmb = tpAmbDe(ambiente);
  if (!chaveValida(chave)) throw new Error('Chave de acesso inválida para a consulta.');
  return dadosMsg(
    'consulta',
    `<consSitNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`,
  );
}

/**
 * O `envEvento` em um `nfeDadosMsg` só: o de `corpoEnvEventoCancelamento` (que já vem embrulhado, como o da manifestação) vai como está;
 * o `envEvento` sozinho é embrulhado aqui. Qualquer outra forma (inclusive embrulhado duas vezes ou com o namespace de outro serviço) = Error.
 */
export function corpoEvento(envEvento: string): string {
  if (envEvento.startsWith(ABRE_DADOS_EVENTO) && envEvento.endsWith('</envEvento></nfeDadosMsg>')) return envEvento;
  if (envEvento.startsWith(ABRE_ENV_EVENTO) && envEvento.endsWith('</envEvento>')) return dadosMsg('evento', envEvento);
  throw new Error('envEvento fora do formato do evento.');
}

/** `consStatServ` 4.00 com tpAmb, cUF 35 e xServ STATUS. */
export function corpoStatus(ambiente: AmbienteSefaz): string {
  return dadosMsg(
    'status',
    `<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>${tpAmbDe(ambiente)}</tpAmb><cUF>${C_UF_SP}</cUF><xServ>STATUS</xServ></consStatServ>`,
  );
}

// --- leitura dos retornos ----------------------------------------------------------------------------------------------------------

/** 100 a 9999: o CHECK de `nfce_cupons.c_stat` (3 ou 4 dígitos, sem zero à esquerda). */
const FORMATO_CSTAT = /^[1-9][0-9]{2,3}$/;
/** `TProt`: 15 ou 17 dígitos (SP usa 17 na NFC-e desde 05/10/2026); o CHECK de `n_prot`. */
const FORMATO_NPROT = /^[0-9]{15}([0-9]{2})?$/;
const FORMATO_TMED = /^[0-9]{1,4}$/;
const TP_EVENTO_CANCELAMENTO = '110111';

// O `text` do Postgres recusa o NUL, e o xmldom o aceita no envelope (cru ou `&#0;`): todo texto lido passa por aqui.
const semNul = (s: string): string => s.replace(/\u0000/g, '');
/** Só os FILHOS diretos (`elementos` desce a árvore: o `cStat` do `retConsSitNFe` existe também no `infProt` e no `retEvento`). */
const filhosDe = (pai: NoXml, nomeLocal: string): NoXml[] => elementos(pai, nomeLocal).filter((e) => e.parentNode === pai);
const filhoDe = (pai: NoXml, nomeLocal: string): NoXml | null => filhosDe(pai, nomeLocal)[0] ?? null;
function textoDe(pai: NoXml, nomeLocal: string): string | null {
  const t = filhoDe(pai, nomeLocal)?.textContent;
  return t === null || t === undefined ? null : semNul(t).trim() || null;
}
function cStatDe(pai: NoXml): number {
  const c = textoDe(pai, 'cStat');
  if (c === null || !FORMATO_CSTAT.test(c)) throw new XmlInvalido();
  return Number(c);
}
function nProtDe(pai: NoXml): string | null {
  const n = textoDe(pai, 'nProt');
  return n !== null && FORMATO_NPROT.test(n) ? n : null; // outro formato = sem protocolo (nunca bate no CHECK do banco)
}

/**
 * Cada elemento `nomeLocal` como veio no corpo (texto entre a marca que abre e a que fecha, sem NUL), na ordem do documento, pulando
 * comentário, CDATA e instrução de processamento (o que há dentro deles não é marca; fora deles, num XML bem formado, `<` sempre abre
 * uma marca). Aninhado em si mesmo ou sem fechar (`<x/>`) = XmlInvalido. `nomeLocal` é sempre um nome fixo daqui.
 */
function trechos(corpo: string, nomeLocal: string): string[] {
  const marcas = new RegExp(
    String.raw`<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)(?:[A-Za-z_][\w.-]*:)?${nomeLocal}(?=[\s/>])`,
    'g',
  );
  const achados: string[] = [];
  let inicio = -1;
  for (const m of corpo.matchAll(marcas)) {
    if (m[1] === undefined) continue; // comentário, CDATA ou instrução
    const i = m.index as number;
    if (m[1] === '') {
      if (inicio >= 0) throw new XmlInvalido();
      inicio = i;
      continue;
    }
    const fim = corpo.indexOf('>', i);
    if (inicio < 0 || fim < 0) throw new XmlInvalido();
    achados.push(semNul(corpo.slice(inicio, fim + 1)));
    inicio = -1;
  }
  if (inicio >= 0) throw new XmlInvalido();
  return achados;
}

type Doc = ReturnType<typeof lerXml>;
type ComTrecho = { no: NoXml; xml: string };

/** Todos os `nomeLocal` do documento, que precisam ser filhos de `pai`, cada um com o seu trecho do corpo. */
function filhosComTrecho(doc: Doc, corpo: string, pai: NoXml, nomeLocal: string): ComTrecho[] {
  const nos = elementos(doc, nomeLocal);
  if (nos.some((n) => n.parentNode !== pai)) throw new XmlInvalido();
  const xmls = trechos(corpo, nomeLocal);
  if (xmls.length !== nos.length) throw new XmlInvalido();
  return nos.map((no, i) => ({ no, xml: xmls[i] }));
}

/** O `protNFe` (TProtNFe): `infProt` com chave válida, `dhRecbto` e `cStat`; o trecho começa em `<protNFe` (é ele que fecha o nfeProc). */
function lerProtocolo({ no, xml }: ComTrecho): ProtocoloNfce {
  const inf = filhoDe(no, 'infProt');
  if (!inf || !/^<protNFe[\s>]/.test(xml) || !xml.endsWith('</protNFe>')) throw new XmlInvalido();
  const chave = textoDe(inf, 'chNFe');
  const dhRecbto = textoDe(inf, 'dhRecbto');
  if (chave === null || !chaveValida(chave) || dhRecbto === null) throw new XmlInvalido();
  return {
    cStat: cStatDe(inf),
    xMotivo: textoDe(inf, 'xMotivo') ?? '',
    chave,
    dhRecbto,
    nProt: nProtDe(inf),
    digVal: textoDe(inf, 'digVal'),
    cMsg: textoDe(inf, 'cMsg'),
    xMsg: textoDe(inf, 'xMsg'),
    xml,
  };
}

/** Zero ou um `protNFe`, filho do retorno. */
function protocoloDe(doc: Doc, corpo: string, ret: NoXml): ProtocoloNfce | null {
  const prots = filhosComTrecho(doc, corpo, ret, 'protNFe');
  if (prots.length > 1) throw new XmlInvalido();
  return prots.length ? lerProtocolo(prots[0]) : null;
}

/** O `procEventoNFe` do cancelamento (110111, pelo `evento` ou pelo `retEvento`), com o `retEvento` dele; nenhum = null. */
function cancelamentoDe(doc: Doc, corpo: string, ret: NoXml): RespostaConsulta['cancelamento'] {
  for (const p of filhosComTrecho(doc, corpo, ret, 'procEventoNFe')) {
    const evento = filhoDe(p.no, 'evento');
    const infEvento = evento ? filhoDe(evento, 'infEvento') : null;
    const retEvento = filhoDe(p.no, 'retEvento');
    const infRet = retEvento ? filhoDe(retEvento, 'infEvento') : null;
    const tipo = (infEvento ? textoDe(infEvento, 'tpEvento') : null) ?? (infRet ? textoDe(infRet, 'tpEvento') : null);
    if (tipo !== TP_EVENTO_CANCELAMENTO) continue;
    if (!infRet) throw new XmlInvalido();
    return { cStat: cStatDe(infRet), nProt: nProtDe(infRet), xml: p.xml };
  }
  return null;
}

type Leitura = { doc: Doc; corpo: string; ret: NoXml; xmlRetorno: string; passo: (p: PassoLeitura) => void };

/**
 * Esqueleto comum: XML legível (`xml`) → exatamente um `nomeRaiz` no envelope (`soap`; sem ele, o código do SOAP Fault, se houver) →
 * `ler` (que começa no passo `cStat` e avança). Qualquer defeito = SEFAZ_RESPOSTA_INVALIDA já enviada, com o passo em que parou e o
 * Fault (só os rótulos, nunca o texto do corpo).
 */
function lerRetorno<T>(corpoHttp: string, nomeRaiz: string, ler: (l: Leitura) => T): T {
  let passo: PassoLeitura = 'xml';
  let fault: CodigoFault | null = null;
  try {
    const doc = lerXml(corpoHttp);
    passo = 'soap';
    const rets = elementos(doc, nomeRaiz);
    if (rets.length === 0) fault = faultDe(doc);
    const xmls = trechos(corpoHttp, nomeRaiz);
    if (rets.length !== 1 || xmls.length !== 1) throw new XmlInvalido();
    passo = 'cStat';
    return ler({ doc, corpo: corpoHttp, ret: rets[0], xmlRetorno: xmls[0], passo: (p) => (passo = p) });
  } catch {
    throw sefazErro('SEFAZ_RESPOSTA_INVALIDA', true, undefined, undefined, { passo, ...(fault ? { fault } : {}) });
  }
}

/**
 * `retEnviNFe` (lote síncrono de 1 nota): `cStat` do lote (100 a 9999), `dhRecbto` do lote e o `protNFe`, se houver. Passos: `cStat`
 * (do lote e também do protocolo: `infProt`, chave válida, `dhRecbto`, `cStat`, um só `protNFe`, trecho sem prefixo).
 */
export function lerRetornoAutorizacao(corpoHttp: string): RespostaAutorizacao {
  return lerRetorno(corpoHttp, 'retEnviNFe', ({ doc, corpo, ret, xmlRetorno }) => ({
    cStatLote: cStatDe(ret),
    xMotivoLote: textoDe(ret, 'xMotivo') ?? '',
    dhRecbto: textoDe(ret, 'dhRecbto'),
    protocolo: protocoloDe(doc, corpo, ret),
    xmlRetorno,
  }));
}

/** `retConsSitNFe`: `cStat` da consulta, o `protNFe` (passo `cStat`) e o `procEventoNFe` do cancelamento (passo `retEvento`). */
export function lerRetornoConsulta(corpoHttp: string): RespostaConsulta {
  return lerRetorno(corpoHttp, 'retConsSitNFe', ({ doc, corpo, ret, xmlRetorno, passo }) => {
    const cStat = cStatDe(ret);
    const protocolo = protocoloDe(doc, corpo, ret);
    passo('retEvento');
    return { cStat, xMotivo: textoDe(ret, 'xMotivo') ?? '', protocolo, cancelamento: cancelamentoDe(doc, corpo, ret), xmlRetorno };
  });
}

/** `retEnvEvento` de um evento só: `cStat` do lote e, se houver, o `retEvento` (passo `retEvento`: no máximo um, com `infEvento`). */
export function lerRetornoEvento(corpoHttp: string): RespostaEvento {
  return lerRetorno(corpoHttp, 'retEnvEvento', ({ doc, corpo, ret, xmlRetorno, passo }) => {
    const cStatLote = cStatDe(ret);
    passo('retEvento');
    const rets = filhosComTrecho(doc, corpo, ret, 'retEvento');
    if (rets.length > 1) throw new XmlInvalido();
    const inf = rets.length ? filhoDe(rets[0].no, 'infEvento') : null;
    if (rets.length && !inf) throw new XmlInvalido();
    return {
      cStatLote,
      xMotivoLote: textoDe(ret, 'xMotivo') ?? '',
      cStat: inf ? cStatDe(inf) : null,
      xMotivo: inf ? (textoDe(inf, 'xMotivo') ?? '') : null,
      nProt: inf ? nProtDe(inf) : null,
      dhRegEvento: inf ? textoDe(inf, 'dhRegEvento') : null,
      xmlRetorno,
    };
  });
}

/** `retConsStatServ`: `cStat`, `xMotivo`, `dhRecbto` e `tMed` (até 4 dígitos; outro formato = null). */
export function lerRetornoStatus(corpoHttp: string): RespostaStatus {
  return lerRetorno(corpoHttp, 'retConsStatServ', ({ ret }) => {
    const tMed = textoDe(ret, 'tMed');
    return {
      cStat: cStatDe(ret),
      xMotivo: textoDe(ret, 'xMotivo') ?? '',
      dhRecbto: textoDe(ret, 'dhRecbto'),
      tMed: tMed !== null && FORMATO_TMED.test(tMed) ? Number(tMed) : null,
    };
  });
}

// --- adaptador ---------------------------------------------------------------------------------------------------------------------

@Injectable()
export class SefazNfceAdapter implements SefazNfcePort {
  constructor(
    @Inject(CADEIA_ICP) private readonly icp: CadeiaIcp,
    @Inject(CHAMAR_SOAP12) private readonly chamar: ChamarSoap12,
  ) {}

  /** O corpo já vem montado (e conferido) por quem chama: entrada fora do formato nunca chega aqui. */
  private enviar(servico: ServicoNfce, cert: CertificadoEmUso, ambiente: AmbienteSefaz, corpo: string): Promise<string> {
    return this.chamar({
      url: urlNfce(servico, ambiente),
      action: ACTION_NFCE[servico],
      corpo,
      certificado: cert,
      confianca: confiancaSefaz(this.icp),
      tempoLimiteMs: TEMPO_LIMITE_NFCE_MS,
      tetoRespostaBytes: TETO_RESPOSTA_NFCE_BYTES,
      // a C14N inclusiva leva ao elemento assinado os prefixos em escopo: com os do envelope da distribuição (soap12, xsi, xsd), a
      // assinatura do infNFe/infEvento não conferiria no documento recebido (nfce.adapter.spec, bytes de req.end())
      envelope: 'sem_prefixo',
    });
  }

  async autorizar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, enviNFe: string): Promise<RespostaAutorizacao> {
    const corpo = corpoAutorizacao(enviNFe);
    return lerRetornoAutorizacao(await this.enviar('autorizacao', cert, ambiente, corpo));
  }

  async consultar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, chave: string): Promise<RespostaConsulta> {
    const corpo = corpoConsulta(ambiente, chave);
    return lerRetornoConsulta(await this.enviar('consulta', cert, ambiente, corpo));
  }

  async registrarEvento(cert: CertificadoEmUso, ambiente: AmbienteSefaz, envEvento: string): Promise<RespostaEvento> {
    const corpo = corpoEvento(envEvento);
    return lerRetornoEvento(await this.enviar('evento', cert, ambiente, corpo));
  }

  async status(cert: CertificadoEmUso, ambiente: AmbienteSefaz): Promise<RespostaStatus> {
    const corpo = corpoStatus(ambiente);
    return lerRetornoStatus(await this.enviar('status', cert, ambiente, corpo));
  }
}
