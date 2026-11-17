// Texto livre para dentro do XML da NFC-e. A assinatura recusa U+0085, U+2028 e U+2029 crus: aqui viram espaço.

/**
 * TAB, LF, CR, NEL, LS e PS viram espaço (uma quebra de linha não cola as palavras); os outros controles (C0, DEL e C1) saem; junta
 * espaços, apara e corta em `max` caracteres (por ponto de código).
 */
export function textoFiscal(s: string, max: number): string {
  const limpo = s
    .replace(/[\t\n\r\u0085\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(limpo).slice(0, max).join('').trim();
}

/**
 * O texto como entra no cupom (montagem do XML e validação do produto usam o mesmo): acento composto (NFC), aspas, travessões e
 * reticências do teclado do celular em ASCII, e o `textoFiscal`.
 */
export function textoDoCupom(s: string, max: number): string {
  const teclado = s
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...');
  return textoFiscal(teclado, max).normalize('NFC');
}

/** Só U+0020–U+00FF: o `TString` do esquema da NF-e. Emoji e símbolos ficam de fora (a SEFAZ recusaria o cupom pelo esquema, 225). */
export function cabeNoEsquema(s: string): boolean {
  return /^[\u0020-\u00FF]*$/.test(s);
}
