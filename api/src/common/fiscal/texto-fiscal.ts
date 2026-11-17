// Texto livre para dentro do XML da NFC-e. A assinatura recusa U+0085, U+2028 e U+2029 crus: aqui viram espaço.

/** Troca NEL/LS/PS por espaço, tira controles, junta espaços, apara e corta em `max` caracteres (por ponto de código). */
export function textoFiscal(s: string, max: number): string {
  const limpo = s
    .replace(/[\u0085\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(limpo).slice(0, max).join('').trim();
}
