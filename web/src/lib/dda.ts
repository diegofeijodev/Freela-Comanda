import { parseNum } from "./format";
import type { Row } from "./parse";

export type BoletoDDA = { beneficiario: string; cnpj: string | null; vencimento: string; valor: number; linha_digitavel: string | null };
export type ContaRef = { id: string; descricao: string; fornecedor_nome: string | null; valor: number; vencimento: string; status: string };
export type Conciliacao = {
  encontrados: { dda: BoletoDDA; conta: ContaRef }[];
  soNoDDA: BoletoDDA[];
  soNoSistema: ContaRef[];
};

/** dd/mm/aaaa, aaaa-mm-dd ou serial do Excel -> aaaa-mm-dd */
export function dataISO(s: string): string {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

const acha = (r: Row, ...chaves: string[]) => {
  const k = Object.keys(r).find((h) => chaves.some((c) => h.includes(c)));
  return k ? r[k] : "";
};

/** Converte linhas de planilha do DDA (cabeçalhos variam por banco) em boletos */
export function boletosDePlanilha(linhas: Row[]): BoletoDDA[] {
  return linhas.map((r) => ({
    beneficiario: acha(r, "benefici", "cedente", "favorecido", "sacador", "empresa", "nome"),
    cnpj: acha(r, "cnpj", "cpf").replace(/\D/g, "") || null,
    vencimento: dataISO(acha(r, "venc")),
    valor: parseNum(acha(r, "valor")) ?? 0,
    linha_digitavel: acha(r, "linha", "código de barras", "codigo de barras", "barras").replace(/\D/g, "") || null,
  })).filter((b) => b.vencimento && b.valor > 0);
}

const dias = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;

/** Casa boleto do DDA com conta em aberto: mesmo valor (±R$0,01) e vencimento até 3 dias de diferença; prefere a data mais próxima */
export function conciliar(dda: BoletoDDA[], contas: ContaRef[]): Conciliacao {
  const livres = contas.filter((c) => c.status === "aberta");
  const usadas = new Set<string>();
  const encontrados: Conciliacao["encontrados"] = [];
  const soNoDDA: BoletoDDA[] = [];
  for (const b of dda) {
    const cand = livres
      .filter((c) => !usadas.has(c.id) && Math.abs(Number(c.valor) - b.valor) <= 0.01 && dias(c.vencimento, b.vencimento) <= 3)
      .sort((x, y) => dias(x.vencimento, b.vencimento) - dias(y.vencimento, b.vencimento))[0];
    if (cand) { usadas.add(cand.id); encontrados.push({ dda: b, conta: cand }); } else soNoDDA.push(b);
  }
  const fimDDA = dda.reduce((m, b) => (b.vencimento > m ? b.vencimento : m), "");
  const iniDDA = dda.reduce((m, b) => (!m || b.vencimento < m ? b.vencimento : m), "");
  const soNoSistema = livres.filter((c) => !usadas.has(c.id) && c.vencimento >= iniDDA && c.vencimento <= fimDDA);
  return { encontrados, soNoDDA, soNoSistema };
}
