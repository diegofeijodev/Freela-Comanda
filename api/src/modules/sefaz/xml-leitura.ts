import { gunzipSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
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

export function lerXml(texto: string, tetoBytes: number = TETO_XML_BYTES): Document {
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

export function texto(raiz: Document | NoXml, nomeLocal: string): string | null {
  const t = primeiro(raiz, nomeLocal)?.textContent?.trim();
  return t ? t : null;
}

/** base64 + gzip → XML em texto; se não for gzip válido ou passar de 4 MB descompactado, devolve o próprio base64 em `bruto`. */
export function descompactarDocZip(base64: string): { xml: string } | { bruto: string } {
  try {
    const gz = Buffer.from(base64.trim(), 'base64');
    return { xml: gunzipSync(gz, { maxOutputLength: TETO_DOCZIP_BYTES }).toString('utf8') };
  } catch {
    return { bruto: base64 };
  }
}
