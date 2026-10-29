export const brl = (v: number | null | undefined) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const num = (v: number | null | undefined, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(Number(v)) ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
export const dataBR = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
export const dataHoraBR = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
export const isoDate = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
/** Converte "1.234,56" ou "1234.56" para número */
export const parseNum = (s: unknown): number | null => {
  if (s == null) return null;
  if (typeof s === "number") return s;
  const t = String(s).trim();
  if (!t) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isNaN(n) ? null : n;
};
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function downloadCSV(nome: string, linhas: (string | number | null | undefined)[][]) {
  const csv = linhas
    .map((l) => l.map((c) => {
      const v = c == null ? "" : typeof c === "number" ? String(c).replace(".", ",") : String(c);
      return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
}
