import * as XLSX from "xlsx";

export type Row = Record<string, string>;

/** Lê CSV (; e vírgula decimal, UTF-8) ou XLSX e devolve linhas com cabeçalho em minúsculas */
export async function lerArquivo(file: File): Promise<Row[]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    return raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "").trim()])));
  }
  const txt = (await file.text()).replace(/^\ufeff/, "");
  return parseCSV(txt);
}

export function parseCSV(txt: string, sep = ";"): Row[] {
  const linhas: string[][] = [];
  let cur: string[] = [], campo = "", aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { cur.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && txt[i + 1] === "\n") i++;
      cur.push(campo); campo = "";
      if (cur.some((c) => c.trim() !== "")) linhas.push(cur);
      cur = [];
    } else campo += ch;
  }
  cur.push(campo);
  if (cur.some((c) => c.trim() !== "")) linhas.push(cur);
  if (!linhas.length) return [];
  const cab = linhas[0].map((h) => h.trim().toLowerCase());
  return linhas.slice(1).map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? "").trim()])));
}
