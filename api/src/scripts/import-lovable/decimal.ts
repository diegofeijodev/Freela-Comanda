/** Decimais como TEXTO exato (saída do numeric do Postgres): nunca passam por double. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function normalizarDecimal(s: string): string {
  if (!DECIMAL.test(s)) throw new Error(`não é um decimal: ${JSON.stringify(s)}`);
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = s.replace(/^-/, '').split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac.replace(/0+$/, '');
  const zero = i === '0' && f === '';
  return `${neg && !zero ? '-' : ''}${i}${f ? `.${f}` : ''}`;
}

/** Igualdade numérica exata entre dois textos decimais (null só é igual a null). */
export const mesmoDecimal = (a: string | null | undefined, b: string | null | undefined): boolean =>
  a == null || b == null ? a == null && b == null : normalizarDecimal(a) === normalizarDecimal(b);

/** "12345.6789" → "12.345,6789" (sem arredondar); null → "—". */
export function fmtDecimal(s: string | null | undefined): string {
  if (s == null) return '—';
  const n = normalizarDecimal(s);
  const neg = n.startsWith('-');
  const [int = '0', frac] = n.replace(/^-/, '').split('.');
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}${milhar}${frac ? `,${frac}` : ''}`;
}

export const fmtInt = (n: number): string => fmtDecimal(String(n));
