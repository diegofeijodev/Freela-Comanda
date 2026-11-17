import { createHash, sign } from 'node:crypto';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { elementos, lerXml, type NoXml } from './xml-leitura';

// XMLDSig enveloped do MOC 7.0 §4.2.4 (`xmldsig-core-schema_v1.01.xsd`, algoritmos fixos): C14N 2001 inclusiva, RSA-SHA1 com
// digest SHA-1, `Reference URI="#{Id}"`, só o certificado da folha. Interface FIXA: os eventos da SEFAZ e a NFC-e assinam por aqui.
// Só `node:crypto` e o leitor de `xml-leitura.ts`; a chave é usada como KeyObject, nunca exportada. Erro = frase fixa, sem trecho do XML.

export const XMLDSIG = {
  ns: 'http://www.w3.org/2000/09/xmldsig#',
  c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  rsaSha1: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  sha1: 'http://www.w3.org/2000/09/xmldsig#sha1',
} as const;

/**
 * De onde veio a recusa, sem detalhe: `certificado` = a chave do certificado (não é RSA, ou o `crypto.sign` falhou); `xml` = o documento
 * ou o `Id` (fora do subconjunto, `Id` ausente ou repetido, caractere recusado). A frase é a mesma nos dois.
 */
export type MotivoAssinatura = 'certificado' | 'xml';

export class AssinaturaErro extends Error {
  constructor(readonly motivo: MotivoAssinatura = 'xml') {
    super('O XML não pôde ser assinado.');
    this.name = 'AssinaturaErro';
  }
}

const ELEMENTO = 1;
const TEXTO = 3;
const CDATA = 4;

const ESCAPE_TEXTO: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#xD;' };
const ESCAPE_ATRIBUTO: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '"': '&quot;',
  '\t': '&#x9;',
  '\n': '&#xA;',
  '\r': '&#xD;',
};
const escTexto = (s: string): string => s.replace(/[&<>\r]/g, (c) => ESCAPE_TEXTO[c]);
const escAtributo = (s: string): string => s.replace(/[&<"\t\n\r]/g, (c) => ESCAPE_ATRIBUTO[c]);

/** Ordem de código UCS (a comparação nativa do JS é por unidade UTF-16 e só difere dela fora do plano básico). */
function porCodigo(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) as number);
  const y = Array.from(b, (c) => c.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/**
 * A C14N inclusiva traria para o elemento os `xmlns:prefixo` e os `xml:*` dos ancestrais; o subconjunto (Decisão 3) não os
 * representa, então qualquer atributo com prefixo num ancestral é recusado em vez de gerar uma assinatura que não confere.
 */
function conferirAncestrais(el: NoXml): void {
  for (let p = el.parentNode; p && p.nodeType === ELEMENTO; p = p.parentNode) {
    for (const a of (p as NoXml).attributes) if (a.prefix) throw new AssinaturaErro();
  }
}

function emitir(el: NoXml, ns: string, topo: boolean, partes: string[]): void {
  // um só namespace padrão em todo o elemento; nenhum prefixo; nenhum `xmlns=""`
  if (el.prefix || (el.namespaceURI ?? '') !== ns) throw new AssinaturaErro();
  const atributos: [string, string][] = [];
  for (const a of el.attributes) {
    if (a.prefix) throw new AssinaturaErro();
    if (a.name === 'xmlns') {
      if (a.value === '' || a.value !== ns) throw new AssinaturaErro();
      continue; // declaração redundante (a do topo é emitida abaixo)
    }
    atributos.push([a.name, a.value]);
  }
  atributos.sort(([a], [b]) => porCodigo(a, b));
  partes.push('<', el.nodeName);
  if (topo && ns !== '') partes.push(' xmlns="', escAtributo(ns), '"'); // herdado ou próprio
  for (const [nome, valor] of atributos) partes.push(' ', nome, '="', escAtributo(valor), '"');
  partes.push('>');
  for (const filho of el.childNodes) {
    if (filho.nodeType === ELEMENTO) emitir(filho as NoXml, ns, false, partes);
    else if (filho.nodeType === TEXTO || filho.nodeType === CDATA) partes.push(escTexto(filho.nodeValue ?? ''));
    else throw new AssinaturaErro(); // comentário, instrução de processamento ou qualquer outro nó
  }
  partes.push('</', el.nodeName, '>'); // nunca <x/>
}

/**
 * C14N 2001 inclusiva (sem comentários), restrita ao subconjunto da Decisão 3; fora dele = AssinaturaErro. Saída em UTF-8 ao digerir.
 * Recebe o nó já lido: quem lê o texto recusa antes os literais U+0085/U+2028/U+2029 (ver `QUEBRA_XML_11`).
 */
export function canonicalizar(el: NoXml): string {
  try {
    conferirAncestrais(el);
    const partes: string[] = [];
    emitir(el, el.namespaceURI ?? '', true, partes);
    return partes.join('');
  } catch {
    throw new AssinaturaErro();
  }
}

// `Id` vai em `URI="#…"` e na busca de `Id="…"` no texto: só o que um xs:ID de NF-e/evento usa, sem nada a escapar
const ID_SEGURO = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// O xmldom troca U+0085, U+2028 e U+2029 LITERAIS por `\n` antes de ler (fim de linha do XML 1.1). A SEFAZ lê como XML 1.0 e
// os mantém: o digest cobriria um `\n` que não está no texto enviado. As referências (`&#x2028;`) não são trocadas e passam.
const QUEBRA_XML_11 = /[\u0085\u2028\u2029]/;

const comId = (raiz: ReturnType<typeof lerXml>, id: string): NoXml[] => elementos(raiz, '*').filter((e) => e.getAttribute('Id') === id);

/**
 * Assina o elemento cujo `Id` é `idDoElemento` e devolve o XML com a `Signature` logo depois do `</nome>` que o fecha (Decisão 4),
 * sem reserializar o resto do texto. Recusa (AssinaturaErro): `Id` ausente ou repetido, elemento com descendente de mesmo nome,
 * fora do subconjunto da C14N, chave que não é RSA, U+0085/U+2028/U+2029 literais no texto. O `motivo` separa a chave (`certificado`:
 * não é RSA, ou o `crypto.sign` falhou) do resto (`xml`), sem mudar a frase.
 */
export function assinarXmlEnveloped(xml: string, idDoElemento: string, cert: CertificadoEmUso): string {
  try {
    if (!ID_SEGURO.test(idDoElemento)) throw new AssinaturaErro('xml');
    if (cert.chavePrivada.asymmetricKeyType !== 'rsa') throw new AssinaturaErro('certificado');
    if (QUEBRA_XML_11.test(xml)) throw new AssinaturaErro(); // antes do lerXml, que os apagaria

    const alvos = comId(lerXml(xml), idDoElemento);
    if (alvos.length !== 1) throw new AssinaturaErro();
    const el = alvos[0];
    const c14n = canonicalizar(el);
    if (elementos(el, el.nodeName).length > 0) throw new AssinaturaErro(); // o 1º `</nome>` seria o do descendente

    const marca = `Id="${idDoElemento}"`;
    const i = xml.indexOf(marca);
    if (i < 0 || xml.indexOf(marca, i + marca.length) >= 0) throw new AssinaturaErro();
    const fecho = `</${el.nodeName}>`;
    const j = xml.indexOf(fecho, i);
    if (j < 0) throw new AssinaturaErro();
    const ponto = j + fecho.length;

    // a Signature fica depois do elemento: o `enveloped-signature` não tira nada dele, e o digest é o da C14N do elemento
    const digest = createHash('sha1').update(c14n, 'utf8').digest('base64');
    // SignedInfo já na forma canônica (atributos sem nada a escapar); no documento vai sem o `xmlns`, herdado da Signature
    const corpo =
      `<CanonicalizationMethod Algorithm="${XMLDSIG.c14n}"></CanonicalizationMethod>` +
      `<SignatureMethod Algorithm="${XMLDSIG.rsaSha1}"></SignatureMethod>` +
      `<Reference URI="#${idDoElemento}"><Transforms><Transform Algorithm="${XMLDSIG.enveloped}"></Transform>` +
      `<Transform Algorithm="${XMLDSIG.c14n}"></Transform></Transforms><DigestMethod Algorithm="${XMLDSIG.sha1}"></DigestMethod>` +
      `<DigestValue>${digest}</DigestValue></Reference>`;
    const signedInfo = `<SignedInfo xmlns="${XMLDSIG.ns}">${corpo}</SignedInfo>`;
    let valor: string;
    let folha: string;
    try {
      valor = sign('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), cert.chavePrivada).toString('base64');
      folha = cert.certificado.raw.toString('base64');
    } catch {
      throw new AssinaturaErro('certificado'); // a chave ou o certificado, nunca o documento
    }
    const assinatura =
      `<Signature xmlns="${XMLDSIG.ns}"><SignedInfo>${corpo}</SignedInfo><SignatureValue>${valor}</SignatureValue>` +
      `<KeyInfo><X509Data><X509Certificate>${folha}</X509Certificate></X509Data></KeyInfo></Signature>`;
    const assinado = xml.slice(0, ponto) + assinatura + xml.slice(ponto);

    // a busca no texto tem de concordar com o documento (ex.: `</nome>` dentro de CDATA, `Id` em aspas simples)
    const depois = comId(lerXml(assinado), idDoElemento);
    const irma = depois.length === 1 ? (depois[0].nextSibling as NoXml | null) : null;
    if (
      !irma ||
      irma.nodeType !== ELEMENTO ||
      irma.localName !== 'Signature' ||
      irma.namespaceURI !== XMLDSIG.ns ||
      canonicalizar(depois[0]) !== c14n
    ) {
      throw new AssinaturaErro();
    }
    return assinado;
  } catch (e) {
    // só a classe atravessa: o motivo da recusa fica; qualquer outra falha conta como do documento
    throw new AssinaturaErro(e instanceof AssinaturaErro ? e.motivo : 'xml');
  }
}
