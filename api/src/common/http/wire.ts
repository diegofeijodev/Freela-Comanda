import { Prisma } from '@prisma/client';

/**
 * Colunas `date` (só-dia) do banco. O Prisma devolve `Date` à meia-noite UTC; o Supabase devolvia "YYYY-MM-DD".
 * Estes nomes só existem como `date` no schema (e nas views/funções que os repetem).
 */
export const DATE_ONLY_KEYS = new Set([
  'data',
  'data_emissao',
  'data_entrada',
  'vencimento',
  'pago_em',
  'data_anterior',
  'data_ultimo_inventario',
]);

/** Colunas `time` (sem fuso): o Prisma devolve 1970-01-01THH:MM:SSZ; o protótipo recebia "HH:MM:SS". */
export const TIME_ONLY_KEYS = new Set(['hora']);

/**
 * Converte o resultado do Prisma para o formato de fio do protótipo (PostgREST):
 * `numeric` e `bigint` viram number, `date` vira "YYYY-MM-DD", `time` vira "HH:MM:SS", timestamps viram ISO.
 */
export function toWire(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (key && DATE_ONLY_KEYS.has(key)) return iso.slice(0, 10);
    if (key && TIME_ONLY_KEYS.has(key)) return iso.slice(11, 19);
    return iso;
  }
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (Array.isArray(value)) return value.map((v) => toWire(v, key));
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value) || typeof (value as { pipe?: unknown }).pipe === 'function') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWire(v, k);
    return out;
  }
  return value;
}
