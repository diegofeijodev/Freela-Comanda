import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { assinarXmlEnveloped } from './assinatura-xml';
import type { AmbienteSefaz } from './distribuicao.port';
import type { RespostaLoteEventos, RetornoEvento, TipoEvento } from './eventos.port';
import { sefazErro, type CodigoFault, type PassoLeitura } from './sefaz-erro';
import { faultDe } from './transporte-soap12';
import { elementos, lerXml, primeiro, XmlInvalido, type NoXml } from './xml-leitura';

// Montagem e leitura dos eventos da manifestação do destinatário (`NFeRecepcaoEvento4` do AN), sem rede. Padrões conferidos nos testes
// contra os esquemas (`leiauteEvento_v1.00.xsd` do 010d v1.03 e `e2102x0_v1.00.xsd` de 2014). Erros: frase fixa, nunca o dado.

export const URL_EVENTOS: Record<AmbienteSefaz, string> = {
  producao: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};
export const ACTION_EVENTOS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento';
/** Órgão do Ambiente Nacional: a manifestação do destinatário vai sempre para o AN. */
export const C_ORGAO_AN = '91';
export const DESC_EVENTO: Record<TipoEvento, string> = {
  '210200': 'Confirmacao da Operacao',
  '210210': 'Ciencia da Operacao',
  '210220': 'Desconhecimento da Operacao',
  '210240': 'Operacao nao Realizada',
};

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_RECEPCAO_EVENTO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const INICIO_EVENTO = `<evento xmlns="${NS_NFE}" versao="1.00">`;
const MAX_EVENTOS = 20;
const FORMATO_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;
const FORMATO_CHAVE = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;
const FORMATO_DH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+](0\d|1[0-2]):00$/;
const FORMATO_CSTAT = /^[0-9]{3,4}$/;
const FORMATO_NPROT = /^[0-9]{15}([0-9]{2})?$/;
const FORMATO_NSEQ = /^[0-9]{1,2}$/;

export interface DadosEvento {
  ambiente: AmbienteSefaz;
  cnpjAutor: string; // o destinatário (a empresa)
  chave: string;
  tpEvento: TipoEvento;
  dhEvento: string; // dhSefaz(...)
  xJust: string | null; // só e sempre no 210240, já normalizado (normalizarJustificativa)
}

/** `Id` do `infEvento`: "ID" + tpEvento + chave + nSeqEvento com 2 dígitos (esta entrega só usa o 1). */
export function idDoEvento(tpEvento: TipoEvento, chave: string): string {
  return `ID${tpEvento}${chave}01`;
}

const BRASILIA_MS = 3 * 60 * 60_000;

/** `dhEvento` no fuso de Brasília com "-03:00" fixo (sem horário de verão desde 2019), sem milissegundos: `AAAA-MM-DDThh:mm:ss-03:00`. */
export function dhSefaz(d: Date): string {
  return `${new Date(d.getTime() - BRASILIA_MS).toISOString().slice(0, 19)}-03:00`;
}

export type Justificativa = { ok: true; texto: string } | { ok: false; erro: 'curta' | 'longa' | 'caractere' };

/**
 * `xJust` do 210240 (TString de 15 a 255, só U+0020–U+00FF, sem espaço nas pontas): aspas e travessões do teclado do celular viram
 * `'`, `"` e `-`; espaços repetidos e quebras de linha (também U+0085, U+2028 e U+2029, que a assinatura recusa crus) viram um
 * espaço; pontas aparadas. Pura e sem import: a do web é CÓPIA desta (`web/src/lib/notas-sefaz.ts`): mudar uma = mudar a outra.
 */
export function normalizarJustificativa(t: string): Justificativa {
  const texto = t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[\s\u0085]+/g, ' ') // \s já pega U+2028 e U+2029; U+0085 (NEL) não
    .trim();
  const tamanho = Array.from(texto).length; // caracteres, não unidades UTF-16
  if (tamanho < 15) return { ok: false, erro: 'curta' };
  if (tamanho > 255) return { ok: false, erro: 'longa' };
  if (!/^[ -ÿ]*$/.test(texto)) return { ok: false, erro: 'caractere' };
  return { ok: true, texto };
}

const ESCAPE_TEXTO: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escTexto = (s: string): string => s.replace(/[&<>]/g, (c) => ESCAPE_TEXTO[c]);

/** `xJust` que vai no evento, ou null; recusa (frase fixa) a que falta no 210240, a que sobra nos outros e a não normalizada. */
function justificativaDoEvento(d: DadosEvento): string | null {
  if (d.tpEvento !== '210240') {
    if (d.xJust !== null) throw new Error('Justificativa fora do padrão da SEFAZ.');
    return null;
  }
  const j = d.xJust === null ? null : normalizarJustificativa(d.xJust);
  if (!j || !j.ok || j.texto !== d.xJust) throw new Error('Justificativa fora do padrão da SEFAZ.');
  return j.texto;
}

/**
 * Um evento como documento próprio, sem declaração XML e sem `Signature`: `<evento xmlns="…/nfe" versao="1.00"><infEvento Id="…">`
 * com cOrgao, tpAmb, CNPJ, chNFe, dhEvento, tpEvento, nSeqEvento, verEvento e detEvento, nesta ordem. Dado fora do padrão = Error.
 */
export function montarEvento(d: DadosEvento): string {
  const tpAmb = d.ambiente === 'producao' ? '1' : d.ambiente === 'homologacao' ? '2' : null;
  if (tpAmb === null) throw new Error('Ambiente inválido para o evento.');
  if (!Object.hasOwn(DESC_EVENTO, d.tpEvento)) throw new Error('Tipo de evento desconhecido.');
  if (!FORMATO_CNPJ.test(d.cnpjAutor)) throw new Error('CNPJ inválido para o evento.');
  if (!FORMATO_CHAVE.test(d.chave)) throw new Error('Chave de acesso inválida para o evento.');
  if (!FORMATO_DH.test(d.dhEvento)) throw new Error('Data e hora do evento fora do padrão.');
  const xJust = justificativaDoEvento(d);
  return (
    `${INICIO_EVENTO}<infEvento Id="${idDoEvento(d.tpEvento, d.chave)}"><cOrgao>${C_ORGAO_AN}</cOrgao><tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${d.cnpjAutor}</CNPJ><chNFe>${d.chave}</chNFe><dhEvento>${d.dhEvento}</dhEvento><tpEvento>${d.tpEvento}</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${DESC_EVENTO[d.tpEvento]}</descEvento>` +
    (xJust === null ? '' : `<xJust>${escTexto(xJust)}</xJust>`) +
    '</detEvento></infEvento></evento>'
  );
}

/** O evento montado e assinado (XMLDSig enveloped do `infEvento`, `Signature` logo depois dele, dentro do `evento`). */
export function eventoAssinado(d: DadosEvento, cert: CertificadoEmUso): string {
  return assinarXmlEnveloped(montarEvento(d), idDoEvento(d.tpEvento, d.chave), cert);
}

/**
 * Conteúdo do `Body`: `nfeDadosMsg` direto, sem o elemento da operação (diferente da distribuição), com o `envEvento` e os eventos
 * como vieram (já assinados, sem declaração XML). idLote de 1 a 15 dígitos; de 1 a 20 eventos.
 */
export function corpoEnvEvento(idLote: bigint, eventosAssinados: string[]): string {
  if (idLote < 1n || idLote >= 10n ** 15n) throw new Error('idLote fora do intervalo de 15 dígitos.');
  if (eventosAssinados.length < 1 || eventosAssinados.length > MAX_EVENTOS) throw new Error('O lote leva de 1 a 20 eventos.');
  if (eventosAssinados.some((e) => !e.startsWith(INICIO_EVENTO) || !e.endsWith('</evento>'))) {
    throw new Error('Evento fora do formato do lote.');
  }
  return (
    `<nfeDadosMsg xmlns="${NS_RECEPCAO_EVENTO}"><envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${idLote}</idLote>` +
    `${eventosAssinados.join('')}</envEvento></nfeDadosMsg>`
  );
}

// O `text` do Postgres recusa o NUL, e o xmldom o aceita no envelope (cru ou `&#0;`): todo texto lido passa por aqui.
const semNul = (s: string): string => s.replace(/\u0000/g, '');
/** Só o FILHO direto (`primeiro`/`texto` descem a árvore: um lote sem `cStat` leria o do 1º `retEvento`). */
const filhoDe = (pai: NoXml, nomeLocal: string): NoXml | null => elementos(pai, nomeLocal).find((e) => e.parentNode === pai) ?? null;
function textoDe(pai: NoXml, nomeLocal: string): string | null {
  const t = filhoDe(pai, nomeLocal)?.textContent;
  return t === null || t === undefined ? null : semNul(t).trim() || null;
}

// Marcas de `retEvento` no texto, pulando comentário, CDATA e instrução de processamento (o que há dentro deles não é marca; fora deles,
// num XML bem formado, `<` sempre abre uma marca).
const MARCAS_RET_EVENTO = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)(?:[A-Za-z_][\w.-]*:)?retEvento(?=[\s/>])/g;

/** Cada `retEvento` como veio no corpo (texto entre a marca que abre e a que fecha, sem NUL), na ordem do documento. */
function trechosRetEvento(corpo: string): string[] {
  const trechos: string[] = [];
  let inicio = -1;
  for (const m of corpo.matchAll(MARCAS_RET_EVENTO)) {
    if (m[1] === undefined) continue; // comentário, CDATA ou instrução
    const i = m.index as number;
    if (m[1] === '') {
      if (inicio >= 0) throw new XmlInvalido(); // retEvento dentro de retEvento
      inicio = i;
      continue;
    }
    const fim = corpo.indexOf('>', i);
    if (inicio < 0 || fim < 0) throw new XmlInvalido();
    trechos.push(semNul(corpo.slice(inicio, fim + 1)));
    inicio = -1;
  }
  if (inicio >= 0) throw new XmlInvalido(); // `<retEvento/>`
  return trechos;
}

function lerRetEvento(r: NoXml, xml: string): RetornoEvento {
  const inf = filhoDe(r, 'infEvento');
  const cStat = inf ? textoDe(inf, 'cStat') : null;
  if (!inf || cStat === null || !FORMATO_CSTAT.test(cStat)) throw new XmlInvalido();
  const nSeq = textoDe(inf, 'nSeqEvento');
  const nProt = textoDe(inf, 'nProt');
  return {
    chave: textoDe(inf, 'chNFe'),
    tpEvento: textoDe(inf, 'tpEvento'),
    nSeq: nSeq !== null && FORMATO_NSEQ.test(nSeq) ? Number(nSeq) : null,
    cStat: Number(cStat),
    xMotivo: textoDe(inf, 'xMotivo') ?? '',
    nProt: nProt !== null && FORMATO_NPROT.test(nProt) ? nProt : null, // outro formato = sem protocolo (o serviço alerta)
    dhRegEvento: textoDe(inf, 'dhRegEvento'),
    xml,
  };
}

/**
 * Lê o corpo HTTP (envelope SOAP com o `retEnvEvento`): `cStat` de 3 ou 4 dígitos no lote e em cada evento, até 20 `retEvento`
 * (filhos do `retEnvEvento`), `nProt` de 15 ou 17 dígitos (outro = null). Defeito = SEFAZ_RESPOSTA_INVALIDA já enviada, com o passo
 * em que a leitura parou e, se o envelope trouxer um SOAP Fault no lugar do retorno, o código dele (só o rótulo, nunca o texto).
 */
export function lerRetornoEventos(corpoHttp: string): RespostaLoteEventos {
  let passo: PassoLeitura = 'xml';
  let fault: CodigoFault | null = null;
  try {
    const doc = lerXml(corpoHttp);
    passo = 'soap';
    const ret = primeiro(doc, 'retEnvEvento');
    if (!ret) {
      fault = faultDe(doc);
      throw new XmlInvalido();
    }
    passo = 'cStat';
    const cStat = textoDe(ret, 'cStat');
    if (cStat === null || !FORMATO_CSTAT.test(cStat)) throw new XmlInvalido();
    passo = 'retEvento';
    const rets = elementos(doc, 'retEvento');
    if (rets.length > MAX_EVENTOS || rets.some((r) => r.parentNode !== ret)) throw new XmlInvalido();
    const xmls = trechosRetEvento(corpoHttp);
    if (xmls.length !== rets.length) throw new XmlInvalido();
    return { cStat: Number(cStat), xMotivo: textoDe(ret, 'xMotivo') ?? '', retornos: rets.map((r, i) => lerRetEvento(r, xmls[i])) };
  } catch {
    throw sefazErro('SEFAZ_RESPOSTA_INVALIDA', true, undefined, undefined, { passo, ...(fault ? { fault } : {}) });
  }
}
