// Datas "só dia" no fuso de Brasília — convenção do workspace Freela.
// NUNCA use new Date().toISOString() para "hoje": entre 21h e 00h BRT a data UTC já virou o dia seguinte.
const SP_TZ = 'America/Sao_Paulo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje em Brasília como "YYYY-MM-DD". */
export function todaySp(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Data em Brasília como "DD/MM/AAAA" (para frases de tela). */
export function dataBrSp(d: Date): string {
  const [a, m, dia] = todaySp(d).split('-');
  return `${dia}/${m}/${a}`;
}

/** Data "só dia" válida: formato "YYYY-MM-DD" E dia que existe no calendário ("2026-02-31" não passa). */
export const isDateString = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = dateFromString(value);
  return !Number.isNaN(d.getTime()) && dateToString(d) === value;
};

/** "YYYY-MM-DD" → Date ao MEIO-DIA UTC (imune a fuso). Para gravar em coluna `date` use `dayToDb`. */
export function dateFromString(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

/** Date tratado como dia civil (UTC) → "YYYY-MM-DD". */
export function dateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → valor para coluna `@db.Date` do Prisma (meia-noite UTC = o próprio dia). */
export function dayToDb(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function addDays(dateStr: string, days: number): string {
  const d = dateFromString(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToString(d);
}

/** Primeiro e último dia de um mês "YYYY-MM" (ou de uma data "YYYY-MM-DD"). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y as number, m as number, 0)).getUTCDate();
  return { from: `${month.slice(0, 7)}-01`, to: `${month.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` };
}
