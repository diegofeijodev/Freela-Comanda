import { gunzipSync } from 'node:zlib';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element } from '@xmldom/xmldom';

// Único arquivo que importa '@xmldom/xmldom' (versão exata no package.json). Lê XML de fontes externas (SEFAZ) sem expandir
// entidades: DOCTYPE e ENTITY são recusados ANTES do parser (XXE / "bomba de entidades"); há teto de tamanho do texto e do
// gzip descompactado (bomba de gzip). As mensagens de erro são fixas: nunca levam trecho do XML.

export const TETO_XML_BYTES = 16 * 1024 * 1024;
export const TETO_DOCZIP_BYTES = 4 * 1024 * 1024;

export class XmlInvalido extends Error {
  constructor() {
    super('XML inválido');
    this.name = 'XmlInvalido';
  }
}

export type NoXml = Element;

const PROIBIDO = /<!\s*(doctype|entity)/i;

export function lerXml(entrada: string, tetoBytes: number = TETO_XML_BYTES): Document {
  // BOM UTF-8 e espaços antes de `<?xml`: o `toString('utf8')` do transporte não tira o BOM, e declaração fora da posição 0 é erro fatal.
  const texto = entrada.replace(/^\uFEFF/, '').trimStart();
  if (Buffer.byteLength(texto, 'utf8') > tetoBytes || PROIBIDO.test(texto)) throw new XmlInvalido();
  try {
    // qualquer aviso, erro ou erro fatal do parser invalida o documento
    const doc = new DOMParser({
      onError: () => {
        throw new XmlInvalido();
      },
    }).parseFromString(texto, 'text/xml');
    if (!doc || !doc.documentElement) throw new XmlInvalido();
    return doc;
  } catch {
    throw new XmlInvalido();
  }
}

export function elementos(raiz: Document | NoXml, nomeLocal: string): NoXml[] {
  return Array.from(raiz.getElementsByTagNameNS('*', nomeLocal));
}

export function primeiro(raiz: Document | NoXml, nomeLocal: string): NoXml | null {
  return elementos(raiz, nomeLocal)[0] ?? null;
}

/**
 * Um elemento já lido, de volta a texto, com as declarações de namespace que ele usa postas nele (o prefixo `ns2:` declarado num
 * ancestral vai junto): serve para remontar um documento com um pedaço de outro (o `retEvento` dentro do `procEventoNFe`).
 */
export function xmlDoElemento(no: NoXml): string {
  return new XMLSerializer().serializeToString(no);
}

export function texto(raiz: Document | NoXml, nomeLocal: string): string | null {
  const t = primeiro(raiz, nomeLocal)?.textContent?.trim();
  return t ? t : null;
}

/**
 * base64 + gzip → XML em texto; se não for gzip válido, passar de 4 MB descompactado ou tiver o byte NUL, devolve o próprio base64 em
 * `bruto` (o documento fica guardado como ilegível e não é tentado de novo).
 */
export function descompactarDocZip(base64: string): { xml: string } | { bruto: string } {
  try {
    const gz = Buffer.from(base64.trim(), 'base64');
    const xml = gunzipSync(gz, { maxOutputLength: TETO_DOCZIP_BYTES }).toString('utf8');
    // O `text` do Postgres recusa o NUL (e o XML 1.0 não o admite): gravar falharia sempre, a cada nova tentativa da mesma página.
    return xml.includes('\u0000') ? { bruto: base64 } : { xml };
  } catch {
    return { bruto: base64 };
  }
}
