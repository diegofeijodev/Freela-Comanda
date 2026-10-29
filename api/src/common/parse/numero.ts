/** Converte "1.234,56" ou "1234.56" para número (mesma regra do `parseNum` do protótipo). Vazio = null. */
export const parseNum = (s: unknown): number | null => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s).trim();
  if (!t) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isNaN(n) ? null : n;
};
