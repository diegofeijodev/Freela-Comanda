import * as XLSX from "xlsx";

export type Row = Record<string, string>;

/** Lê CSV (; e vírgula decimal, UTF-8) ou XLSX e devolve linhas com cabeçalho em minúsculas (tela Importar Dados) */
export async function lerArquivo(file: File): Promise<Row[]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    return raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "").trim()])));
  }
  const txt = (await file.text()).replace(/^﻿/, "");
  return parseCSV(txt);
}

export function parseCSV(txt: string, sep = ";"): Row[] {
  const linhas = parseLinhasCSV(txt, sep);
  if (!linhas.length) return [];
  const cab = linhas[0].map((h) => h.trim().toLowerCase());
  return linhas.slice(1).map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? "").trim()])));
}

/** CSV em linhas cruas (aspas com "" escapado; linha toda vazia sai). */
export function parseLinhasCSV(txt: string, sep = ";"): string[][] {
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
  return linhas;
}

// ---------- Importar vendas de outros sistemas (desenho 24/11, A.5)

/** Célula da planilha: texto (CSV) ou o valor tipado do Excel (número, data). */
export type Celula = string | number | Date;

/** UTF-8; se vier o caractere de troca (�), lê de novo como windows-1252 (comum em PDV brasileiro). Tira o BOM. */
export function decodificarTexto(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  const txt = utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
  return txt.replace(/^﻿/, "");
}

/** O separador mais frequente na 1ª linha com conteúdo (fora de aspas): ponto e vírgula, vírgula ou tabulação; empate = ";". */
export function separadorDoTexto(txt: string): ";" | "," | "\t" {
  const linha = txt.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const conta = { ";": 0, ",": 0, "\t": 0 };
  let aspas = false;
  for (const ch of linha) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas && ch in conta) conta[ch as keyof typeof conta]++;
  }
  if (conta["\t"] > conta[";"] && conta["\t"] > conta[","]) return "\t";
  return conta[","] > conta[";"] ? "," : ";";
}

/** A planilha inteira em linhas de células, sem mexer no cabeçalho (a tela acha a linha do cabeçalho e as colunas). */
export async function lerTabelaDeBuffer(nome: string, buf: ArrayBuffer): Promise<Celula[][]> {
  if (/\.xlsx?$/i.test(nome)) {
    // valor TIPADO (raw: true + cellDates): o texto formatado da célula depende do formato do Excel (m/d/yy, 1,234.56)
    const wb = XLSX.read(buf, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json<Celula[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
    return linhas.map((l) => l.map((c) => (c instanceof Date || typeof c === "number" ? c : String(c ?? ""))));
  }
  const txt = decodificarTexto(buf);
  return parseLinhasCSV(txt, separadorDoTexto(txt));
}

export const lerTabela = async (file: File) => lerTabelaDeBuffer(file.name, await file.arrayBuffer());
