// Cana: só formatação. Os números chegam prontos do servidor (api/src/modules/cana/apuracao.ts); aqui eles viram as contas por
// extenso da tela (UX 2026-11-24, seção 3.4) e os textos dos botões da loja. Formatos da UX 4.2: dúzias e litros com até 1 casa,
// sem ",0", singular abaixo de 2; "L por dúzia" com 2 casas; porcentagem com 1.
import type { CanaAviso, CanaPorProduto, CanaQuantidades, CanaSemana, TipoCana } from "./erp-api";

const MENOS = "−";
const num = (n: number, casas = 1) => {
  const t = Math.abs(n).toLocaleString("pt-BR", { maximumFractionDigits: casas });
  return n < 0 && t !== "0" ? `${MENOS}${t}` : t;
};
const fixo = (n: number, casas: number) => {
  const t = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return n < 0 ? `${MENOS}${t}` : t;
};
const umOuMais = (n: number, um: string, mais: string) => (Math.abs(n) < 2 ? um : mais);

export const dataCurta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
export const duzias = (n: number) => `${num(n)} ${umOuMais(n, "dúzia", "dúzias")}`;
/** "42,8 L" na Semana; por extenso ("25 litros", "0,5 litro") na loja. */
export const litros = (n: number, extenso = false) => (extenso ? `${num(n)} ${umOuMais(n, "litro", "litros")}` : `${num(n)} L`);
export const lPorDz = (n: number) => `${fixo(n, 2)} L por dúzia`;
export const pct = (n: number) => `${fixo(n, 1)}%`;

/** "hoje (24/11)", "ontem (23/11)" ou "20/11" (as datas da lista da loja). */
export function quandoLoja(data: string, hoje: string, ontem: string) {
  if (data === hoje) return `hoje (${dataCurta(data)})`;
  if (data === ontem) return `ontem (${dataCurta(data)})`;
  return dataCurta(data);
}

/** Hora de Brasília "14h05". */
export function horaSp(iso: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return `${p.find((x) => x.type === "hour")?.value ?? "00"}h${p.find((x) => x.type === "minute")?.value ?? "00"}`;
}

/** Dia de Brasília "24/11" de um instante (ISO). */
export const dataSp = (iso: string) => dataCurta(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)));

/** O número como a loja digita: "12", "12,5", "0,5" (ou "1.5"). null = vazio; NaN = não é número (inclusive "1.234,5"). */
export function lerNumero(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d+([.,]\d+)?$/.test(t)) return Number.NaN;
  return Number(t.replace(",", "."));
}

// ---------- contas da Semana (admin)
const contagem = (d: string) => `contagem de ${dataCurta(d)}`;
const periodoTexto = (ini: string | null, fim: string | null) => (ini && fim ? (ini === fim ? `em ${dataCurta(ini)}` : `de ${dataCurta(ini)} a ${dataCurta(fim)}`) : "");

export function contaCanaMoida(s: CanaSemana): string[] {
  const r = s.cana.recebida;
  const entregas = `${r.lancamentos} ${r.lancamentos === 1 ? "entrega" : "entregas"}`;
  const linhas = [
    `= ${duzias(s.cana.inicio)} que ${umOuMais(s.cana.inicio, "sobrou", "sobraram")} (${contagem(s.contagem_inicial.data)})`,
    `+ ${duzias(r.duzias)} ${umOuMais(r.duzias, "recebida", "recebidas")} (${r.lancamentos ? `${entregas}, ${periodoTexto(r.ini, r.fim)}` : "nenhum recebimento"})`,
  ];
  if (s.cana.fim !== null && s.contagem_final)
    linhas.push(`${MENOS} ${duzias(s.cana.fim)} que ${umOuMais(s.cana.fim, "sobrou", "sobraram")} (${contagem(s.contagem_final.data)})`);
  return linhas;
}

export function contaPerda(s: CanaSemana): string[] {
  const linhas = [`= ${litros(s.caldo.inicio.litros)} no início (${contagem(s.contagem_inicial.data)})`, `+ ${litros(s.caldo.produzido.litros)} produzidos`, `${MENOS} ${litros(s.caldo.vendido.litros)} vendidos`];
  if (s.caldo.fim && s.contagem_final) linhas.push(`${MENOS} ${litros(s.caldo.fim.litros)} no fim (${contagem(s.contagem_final.data)})`);
  return linhas;
}

export const contaRendimento = (s: CanaSemana) =>
  `= ${litros(s.caldo.vendido.litros)} de caldo vendido ÷ ${duzias(s.cana.moida ?? 0)} de cana moída`;

export function contaMoagem(s: CanaSemana): [string, string] {
  const m = s.moagem;
  const primeira = `= ${litros(s.caldo.produzido.litros)} produzidos ÷ ${duzias(s.cana.moida ?? 0)} ${umOuMais(s.cana.moida ?? 0, "moída", "moídas")}`;
  if (m.esperado === null) return [primeira, "Esperado: não informado."];
  if (m.diferenca_litros === null || m.diferenca_pct === null) return [primeira, `Esperado: ${lPorDz(m.esperado)}.`];
  return [
    primeira,
    `Esperado: ${lPorDz(m.esperado)} → diferença: ${num(s.caldo.produzido.litros)} ${MENOS} ${num(s.cana.moida ?? 0)} × ${num(m.esperado, 3)} = ${litros(m.diferenca_litros)} (${pct(m.diferenca_pct)} do esperado)`,
  ];
}

export const contaProduzido = (s: CanaSemana) => {
  const p = s.caldo.produzido;
  return p.lancamentos ? `= soma de ${p.lancamentos} ${p.lancamentos === 1 ? "produção" : "produções"}, ${periodoTexto(p.ini, p.fim)}` : "= nenhuma produção lançada";
};

export const contaVendido = (s: CanaSemana) => `= ${litros(s.caldo.vendido.em_copos)} em copos + ${litros(s.caldo.vendido.em_frozen)} em frozen (ver Por produto)`;

export function contaProduto(p: Pick<CanaPorProduto, "quantidade" | "ml_por_unidade" | "frozen" | "litros" | "litros_caldo">, rendimento: number | null) {
  const base = `${num(p.quantidade, 3)} × ${num(p.ml_por_unidade, 2)} ml = ${litros(p.litros)}`;
  return p.frozen && rendimento ? `${base} de frozen ÷ ${num(rendimento, 4)} = ${litros(p.litros_caldo)} de caldo` : base;
}

/** "Cada venda conta…" (Configuração, ao vivo). */
export function contaUmaVenda(ml: number, frozen: boolean, rendimento: number | null) {
  const l = ml / 1000;
  if (!frozen) return `Cada venda conta ${num(l, 3)} L de caldo.`;
  if (!rendimento) return "Falta o rendimento do frozen: este produto ainda não entra na conta.";
  return `Cada venda conta ${num(l, 3)} L de frozen ÷ ${num(rendimento, 4)} = ${num(l / rendimento, 3)} L de caldo.`;
}

export function rotuloSemana(s: { periodo: { ini: string; fim: string; dias: number }; contagem_inicial: { data: string }; contagem_final: { data: string } }) {
  const dias = s.periodo.dias === 7 ? "" : `${s.periodo.dias} dias; `;
  return `${dataCurta(s.periodo.ini)} a ${dataCurta(s.periodo.fim)} (${dias}contagens de ${dataCurta(s.contagem_inicial.data)} e ${dataCurta(s.contagem_final.data)})`;
}

const diaSeguinte = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** A frase de cada aviso (UX 3.4). `contagens` = as datas das contagens da semana (para a cana moída negativa). */
export function fraseAviso(a: CanaAviso, contagens?: { inicial: string; final: string | null }): string {
  switch (a.codigo) {
    case "vendas_incompletas":
      if (!a.dados.ate) return "Nenhuma venda importada ainda: o caldo vendido aparece como 0.";
      return `O caldo vendido está incompleto: as vendas só foram importadas até ${dataCurta(a.dados.ate)}, e a semana vai até ${dataCurta(a.dados.fim)}. Importe as vendas de ${dataCurta(diaSeguinte(a.dados.ate))} a ${dataCurta(a.dados.fim)} antes de olhar a perda.`;
    case "nada_configurado":
      return "Nada configurado: o caldo vendido aparece como 0.";
    case "produto_sem_ml": {
      const ps = a.dados.produtos;
      return `${ps.length} ${ps.length === 1 ? "produto que parece de caldo foi vendido e não está configurado" : "produtos que parecem de caldo foram vendidos e não estão configurados"}: ${ps.map((p) => p.nome).join(", ")}. As vendas ${ps.length === 1 ? "dele" : "deles"} não entram no caldo vendido.`;
    }
    case "venda_sem_cardapio":
      return `Há vendas com nome de caldo que não estão ligadas ao cardápio: ${a.dados.produtos.map((p) => `“${p.produto_relatorio}” (${p.vendas} ${p.vendas === 1 ? "venda" : "vendas"})`).join(", ")}. Elas não entram na conta.`;
    case "frozen_sem_rendimento": {
      const partes = [a.dados.vendidos ? `Os ${num(a.dados.vendidos, 3)} frozen vendidos` : "", a.dados.litros_frozen_contados ? `os ${litros(a.dados.litros_frozen_contados)} de frozen das contagens` : ""].filter(Boolean);
      const sujeito = partes.join(" e ");
      return `Falta o rendimento do frozen. ${sujeito.charAt(0).toUpperCase()}${sujeito.slice(1)} não entram nas contas.`;
    }
    case "cana_moida_negativa": {
      const fim = contagens?.final ? `a contagem de ${dataCurta(contagens.final)}` : "a contagem final";
      const ini = contagens ? `a de ${dataCurta(contagens.inicial)}` : "a anterior";
      return `A cana moída deu negativa (${duzias(a.dados.duzias)}): ${fim} tem mais cana do que ${ini} mais o que foi recebido. Falta lançar um recebimento ou a contagem está errada.`;
    }
    case "cana_moida_zero":
      return "A cana moída deu zero: a contagem final tem a mesma cana do início mais o recebido. Confira os recebimentos e as contagens.";
    case "producao_zero_com_venda":
      return `Nenhuma produção lançada na semana, mas saíram ${litros(a.dados.litros_vendidos)} de caldo em vendas. Falta lançar a produção?`;
  }
}

// ---------- loja (nenhuma conta: só o que a pessoa digitou)
export const TITULO_TIPO: Record<TipoCana, string> = { recebimento: "Recebi cana", producao: "Produzi caldo", contagem: "Contagem do que sobrou" };

/** O botão diz o que vai ser gravado (é a conferência: a loja não desfaz). `quando` = "hoje", "ontem" ou "em 20/11". */
export function botaoLancar(tipo: TipoCana, q: Partial<CanaQuantidades>, quando: string) {
  if (tipo === "recebimento") {
    if (q.duzias == null) return "Digite as dúzias";
    return `Lançar ${duzias(q.duzias)} ${umOuMais(q.duzias, "recebida", "recebidas")} ${quando}`;
  }
  if (tipo === "producao") {
    if (q.litros_caldo == null) return "Digite os litros";
    return `Lançar ${litros(q.litros_caldo, true)} ${umOuMais(q.litros_caldo, "produzido", "produzidos")} ${quando}`;
  }
  if (q.duzias == null) return "Digite as dúzias de cana";
  if (q.litros_caldo == null) return "Digite os litros de caldo";
  return `Lançar a contagem de ${quando.replace(/^em /, "")}`;
}

export function resumoLancamento(l: { tipo: TipoCana } & CanaQuantidades) {
  if (l.tipo === "recebimento") return `${TITULO_TIPO.recebimento} · ${duzias(l.duzias ?? 0)}`;
  if (l.tipo === "producao")
    return `${TITULO_TIPO.producao} · ${litros(l.litros_caldo ?? 0, true)}${l.duzias != null ? ` (${duzias(l.duzias)} ${umOuMais(l.duzias, "moída", "moídas")})` : ""}`;
  const partes = [duzias(l.duzias ?? 0), `${litros(l.litros_caldo ?? 0, true)} de caldo`];
  if (l.litros_frozen != null) partes.push(`${litros(l.litros_frozen, true)} de frozen`);
  return `${TITULO_TIPO.contagem} · ${partes.join(" · ")}`;
}
