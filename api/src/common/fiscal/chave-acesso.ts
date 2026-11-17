// Chave de acesso da NF-e/NFC-e (44 caracteres; posições 7–18 = CNPJ do emitente, que pode ter letras).

const FORMATO = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;

export type PartesChave = { uf: string; aamm: string; emitente: string; modelo: string; serie: string; numero: string };

/** Maiúsculas, só `[0-9A-Z]` (nunca `\D`: apagaria as letras do CNPJ alfanumérico). */
export function normalizarChave(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** DV módulo 11, pesos 2..9 da direita para a esquerda; cada caractere vale o código ASCII − 48. */
function dvChave(base: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function chaveValida(c: string): boolean {
  return FORMATO.test(c) && c.charCodeAt(43) - 48 === dvChave(c.slice(0, 43));
}

/** Só dígitos, sem zeros à esquerda; só zeros → '0'; sem dígito → ''. */
export function normalizarNumeroSerie(s: string | null | undefined): string {
  const d = (s ?? '').replace(/[^0-9]/g, '');
  if (d === '') return '';
  const t = d.replace(/^0+/, '');
  return t === '' ? '0' : t;
}

export function partesDaChave(c: string): PartesChave | null {
  if (!chaveValida(c)) return null;
  return {
    uf: c.slice(0, 2),
    aamm: c.slice(2, 6),
    emitente: c.slice(6, 20),
    modelo: c.slice(20, 22),
    serie: normalizarNumeroSerie(c.slice(22, 25)),
    numero: normalizarNumeroSerie(c.slice(25, 34)),
  };
}
