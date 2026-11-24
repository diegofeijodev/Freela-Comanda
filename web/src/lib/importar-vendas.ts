// Importar vendas de outros sistemas (desenho 24/11, A.5; UX 2.3): o que a tela calcula sozinha, puro e testado no vitest.
// Os números da prévia vêm do servidor; aqui só a leitura da planilha, a sugestão de colunas e os textos.
import type { PreviaVendas } from "./erp-api";
import type { Celula } from "./parse";

export const CAMPOS_VENDA = ["data", "produto", "quantidade", "valor_total", "pedido", "hora", "preco_unitario", "desconto", "taxa", "frete"] as const;
export type CampoVenda = (typeof CAMPOS_VENDA)[number];
export type Mapeamento = Partial<Record<CampoVenda, string>>;
export type Separador = "virgula" | "ponto";

export const OBRIGATORIOS: readonly CampoVenda[] = ["data", "produto", "quantidade", "valor_total"];
export const OPCIONAIS_RECOLHIDOS: readonly CampoVenda[] = ["preco_unitario", "desconto", "taxa", "frete"];
export const CAMPO_INFO: Record<CampoVenda, { rotulo: string; ajuda?: string }> = {
  data: { rotulo: "Data", ajuda: "Se a data vier com a hora (24/11/2026 14:30), a hora é aproveitada." },
  produto: { rotulo: "Produto", ajuda: "O nome do produto como está no relatório." },
  quantidade: { rotulo: "Quantidade" },
  valor_total: { rotulo: "Valor total", ajuda: "O valor da linha (quantidade × preço, já com desconto), não o total do pedido." },
  pedido: { rotulo: "Pedido", ajuda: "Número do pedido, comanda ou cupom. Sem ele, cada dia vira um pedido só." },
  hora: { rotulo: "Hora" },
  preco_unitario: { rotulo: "Preço unitário" },
  desconto: { rotulo: "Desconto" },
  taxa: { rotulo: "Taxa de serviço" },
  frete: { rotulo: "Taxa de entrega" },
};

/** Sinônimos (sem acento, sem caixa, pontuação vira espaço). A ordem dos campos decide quem fica com a coluna disputada. */
const SINONIMOS: [CampoVenda, string[]][] = [
  ["frete", ["frete", "entrega", "taxa de entrega", "taxa entrega"]],
  ["taxa", ["taxa", "servico", "taxa de servico", "taxa servico", "gorjeta"]],
  ["preco_unitario", ["unitario", "preco", "vl unit", "preco unitario", "valor unitario", "vl unitario", "preco unit", "valor unit"]],
  ["valor_total", ["total", "valor total", "vl total", "valor", "total item", "valor liquido", "vl liquido"]],
  ["desconto", ["desconto", "desc", "vl desconto", "valor desconto"]],
  ["quantidade", ["qtd", "qtde", "quantidade", "quant", "qt"]],
  ["produto", ["produto", "descricao", "item", "nome", "produto relatorio", "descricao produto", "nome produto"]],
  ["pedido", ["pedido", "n pedido", "no pedido", "numero", "numero pedido", "comanda", "venda", "n venda", "no venda", "cupom", "documento", "num pedido", "cod venda", "codigo venda"]],
  ["hora", ["hora", "horario", "hr"]],
  ["data", ["data", "dt", "data venda", "emissao", "data hora", "data emissao", "dia", "dt venda"]],
];

export const normalizarNome = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Sugere a coluna de cada campo pelo nome: 1º os nomes iguais a um sinônimo, depois os que começam ou contêm um sinônimo de 4+ letras
 * (ex.: "Vl. Total Item"). Cada coluna serve a um campo só.
 */
export function sugerirMapeamento(colunas: readonly string[]): Mapeamento {
  const m: Mapeamento = {};
  const usadas = new Set<string>();
  const norm = colunas.map((c) => ({ c, n: normalizarNome(c) }));
  for (const [campo, sin] of SINONIMOS) {
    const achada = norm.find((x) => !usadas.has(x.c) && sin.includes(x.n));
    if (achada) { m[campo] = achada.c; usadas.add(achada.c); }
  }
  for (const [campo, sin] of SINONIMOS) {
    if (m[campo]) continue;
    const achada = norm.find((x) => !usadas.has(x.c) && sin.some((s) => s.length >= 4 && (` ${x.n} `).includes(` ${s} `)));
    if (achada) { m[campo] = achada.c; usadas.add(achada.c); }
  }
  return m;
}

/** A linha do cabeçalho: a 1ª, entre as 10 primeiras, com 3 ou mais nomes conhecidos (relatório com título em cima); senão a 1ª. */
export function acharCabecalho(tabela: readonly Celula[][]): number {
  for (let i = 0; i < Math.min(10, tabela.length); i++) {
    const nomes = (tabela[i] ?? []).map((c) => (typeof c === "string" ? c : ""));
    if (Object.keys(sugerirMapeamento(nomes)).length >= 3) return i;
  }
  return 0;
}

/** Nome de cada coluna: vazio vira "Coluna N"; repetido ganha " (2)". */
export function colunasDoCabecalho(cab: readonly Celula[]): string[] {
  const vistos = new Map<string, number>();
  return cab.map((c, i) => {
    const base = (c instanceof Date ? "" : String(c ?? "")).trim() || `Coluna ${i + 1}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

const dois = (n: number) => String(n).padStart(2, "0");
/** Célula → texto para o servidor: número do Excel com o separador escolhido (sem milhar); data do Excel em aaaa-mm-dd [hh:mm:ss]. */
export function celulaTexto(v: Celula, sep: Separador): string {
  if (typeof v === "number") return sep === "virgula" ? String(v).replace(".", ",") : String(v);
  if (v instanceof Date) {
    const d = `${v.getFullYear()}-${dois(v.getMonth() + 1)}-${dois(v.getDate())}`;
    const temHora = v.getHours() || v.getMinutes() || v.getSeconds();
    return temHora ? `${d} ${dois(v.getHours())}:${dois(v.getMinutes())}:${dois(v.getSeconds())}` : d;
  }
  return v;
}

/** As linhas de dados (depois do cabeçalho, sem as vazias) como coluna → texto, e o nº da 1ª linha de dados no arquivo. */
export function linhasParaEnvio(tabela: readonly Celula[][], iCabecalho: number, sep: Separador, minusculas = false) {
  const nomes = colunasDoCabecalho(tabela[iCabecalho] ?? []);
  const colunas = minusculas ? nomes.map((c) => c.toLowerCase()) : nomes;
  const linhas: Record<string, string>[] = [];
  for (const l of tabela.slice(iCabecalho + 1)) {
    if (!l.some((c) => celulaTexto(c, sep).trim() !== "")) continue;
    linhas.push(Object.fromEntries(colunas.map((c, i) => [c, celulaTexto(l[i] ?? "", sep)])));
  }
  return { colunas, linhas, primeiraLinha: iCabecalho + 2 };
}

/** Os 3 primeiros valores não vazios da coluna, como estão no arquivo. */
export const exemplosDaColuna = (linhas: readonly Record<string, string>[], coluna: string, n = 3) =>
  linhas.map((l) => (l[coluna] ?? "").trim()).filter(Boolean).slice(0, n);

/** "Como os valores estão escritos?": vírgula se algum valor termina em ",dd" (ou tem milhar com ponto); ponto no caso espelhado. */
export function deduzirSeparador(valores: readonly string[]): Separador {
  for (const v of valores) {
    const t = v.replace(/[R$\s]/g, "");
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+,\d{1,2}$/.test(t)) return "virgula";
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+\.\d{1,2}$/.test(t)) return "ponto";
  }
  return "virgula";
}

export const camposFaltando = (m: Mapeamento) => OBRIGATORIOS.filter((c) => !m[c]);

/** SHA-256 do arquivo (aviso "este arquivo já foi importado"). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Centavos → "R$ 1.234,56". */
export const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Inteiro com milhar ("2.301"). */
export const inteiro = (n: number) => n.toLocaleString("pt-BR");
/** "2026-11-20" → "20/11". */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Instante (ISO com hora) → "20/11 às 18h10" no fuso do aparelho. */
export function quandoFoi(iso: string): { dia: string; hora: string } {
  const d = new Date(iso);
  const dois = (n: number) => String(n).padStart(2, "0");
  return { dia: `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`, hora: `${dois(d.getHours())}h${dois(d.getMinutes())}` };
}
/** Plural simples: "1 venda" / "2 vendas". */
export const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

// ---------- frases da prévia (UX 2.6/2.7): cada número com a conta e de onde veio

const menos = (n: number, texto: string) => (n > 0 ? ` − ${inteiro(n)} ${texto}` : "");

/** "= 2.540 linhas lidas − 120 que já estão no Comanda − 87 com problema − 32 somadas a outra linha igual do arquivo" */
export function contaVendasNovas(l: PreviaVendas["linhas"]): string {
  return `= ${plural(l.lidas, "linha lida", "linhas lidas")}${menos(l.ja_existentes, "que já estão no Comanda")}${menos(l.com_problema, "com problema")}${menos(l.somadas_no_arquivo, "somadas a outra linha igual do arquivo")}`;
}

export function contaTotal(p: PreviaVendas): string {
  const base = `= soma do valor das ${plural(p.linhas.novas, "linha nova", "linhas novas")}.`;
  const ja = p.linhas.ja_existentes > 0 ? ` As ${inteiro(p.linhas.ja_existentes)} que já existiam (${reais(p.ja_existentes_valor_centavos)}) não entram.` : "";
  return `${base}${ja} Confira com o total do relatório do seu sistema para o mesmo período.`;
}

export const contaPeriodo = (p: PreviaVendas) =>
  p.periodo ? `= a primeira e a última data das linhas válidas do arquivo (${plural(p.periodo.dias, "dia", "dias")})` : "";

export const periodoCurto = (p: { ini: string; fim: string } | null) => (p ? (p.ini === p.fim ? diaMes(p.ini) : `${diaMes(p.ini)} a ${diaMes(p.fim)}`) : "—");

/** P1 (R5): "De 01/11 a 23/11 já há vendas vindas de outro lugar: Planilha padrão do Comanda: 1.230 vendas, R$ 34.500,00 · …" */
export function textoSobreposicao(p: PreviaVendas): string {
  const fontes = p.sobreposicao.map((s) => `${s.fonte}: ${plural(s.vendas, "venda", "vendas")}, ${reais(s.valor_centavos)}`).join(" · ");
  return `De ${periodoCurto(p.periodo)} já há vendas vindas de outro lugar: ${fontes}. Se for o mesmo caixa, estas vendas vão entrar duas vezes (no faturamento, no estoque e na cana).`;
}

/** P4: "120 linhas já estão no Comanda e não entram." + de onde. */
export function textoJaExistentes(p: PreviaVendas, sistema: string): { titulo: string; texto: string } {
  const outras = p.ja_existentes_de_outra_fonte;
  const partes = [
    p.ja_existentes_mesma_fonte ? `${inteiro(p.ja_existentes_mesma_fonte)} deste mesmo sistema (importadas antes)` : "",
    ...outras.map((o) => `${inteiro(o.linhas)} vindas de ${o.fonte}`),
  ].filter(Boolean);
  const ex = outras[0];
  const exemplo = ex
    ? ` Exemplo: o pedido ${ex.exemplo.pedido} de ${diaMes(ex.exemplo.data)} já existe vindo de ${ex.fonte}. Se forem vendas diferentes, defina letras antes do pedido para ${sistema}.`
    : "";
  return { titulo: `${plural(p.linhas.ja_existentes, "linha já está", "linhas já estão")} no Comanda e não entram.`, texto: `${partes.join(" e ")}.${exemplo}` };
}

export type Botao = { rotulo: string; destrutivo: boolean; acao: "importar" | "dialogo" | "nada"; falta?: string };
/** O botão diz o que vai acontecer (UX 2.7). */
export function botaoImportar(p: PreviaVendas, o: { modo: "acrescentar" | "substituir"; sobreposicaoMarcada: boolean; atualizando: boolean }): Botao {
  if (o.atualizando) return { rotulo: "Atualizando a prévia…", destrutivo: false, acao: "nada", falta: "Aguarde a prévia atualizar." };
  const novas = p.linhas.novas;
  const canc = p.documentos?.cancelamentos_de_importados.documentos ?? 0;
  const aplicar = (p.documentos?.arquivos_cancelamento ?? 0) > 0;
  if (novas === 0 && !aplicar) return { rotulo: "", destrutivo: false, acao: "nada" };
  if (p.sobreposicao.length && !o.sobreposicaoMarcada) return { rotulo: "Marque a caixa do aviso", destrutivo: false, acao: "nada", falta: "Marque a caixa do aviso “Pode contar em dobro”." };
  if (p.documentos) {
    if (novas === 0) return { rotulo: canc ? `Tirar ${plural(canc, "cupom cancelado", "cupons cancelados")}` : "Registrar os cancelamentos", destrutivo: false, acao: "importar" };
    const cupons = p.documentos.vendas_novas;
    return { rotulo: canc ? `Importar ${plural(cupons, "cupom", "cupons")} e tirar ${inteiro(canc)} ${canc === 1 ? "cancelado" : "cancelados"}` : `Importar ${plural(cupons, "cupom", "cupons")}`, destrutivo: false, acao: "importar" };
  }
  if (o.modo === "substituir" && p.substituir && p.substituir.vendas > 0) {
    return { rotulo: `Substituir ${inteiro(p.substituir.vendas)} vendas e importar ${inteiro(novas)}`, destrutivo: true, acao: "dialogo" };
  }
  return { rotulo: `Importar ${plural(novas, "venda", "vendas")}`, destrutivo: false, acao: "importar" };
}

// ---------- conferência do PDF lido pela IA (UX 2.5)

/** Número digitado na conferência ("12,90", "12.90", "1.234,56") → texto com ponto para o servidor; ilegível = null. */
export function numeroDigitado(s: string): string | null {
  const t = s.replace(/[R$\s]/g, "");
  if (!t) return null;
  let c = t;
  if (c.includes(",")) c = c.replace(/\./g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(c) ? c : null;
}
/** Número da IA para o campo da tela (pt-BR, sem milhar). */
export const numeroParaCampo = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

export type LinhaConferencia = { id: string; pedido: string | null; data: string | null; hora: string | null; produto: string; quantidade: string; valor: string };

/** O que falta numa linha da conferência ("Falta a quantidade. Digite ou tire a linha."); null = a linha está boa. */
export function problemaDaLinha(l: LinhaConferencia): string | null {
  if (!l.produto.trim()) return "Digite o nome do produto.";
  const q = numeroDigitado(l.quantidade);
  if (!q || Number(q) <= 0) return l.quantidade.trim() ? "Digite a quantidade (maior que zero)." : "Falta a quantidade. Digite ou tire a linha.";
  if (!numeroDigitado(l.valor)) return l.valor.trim() ? "Digite o valor (R$)." : "Falta o valor. Digite ou tire a linha.";
  return null;
}

/** Soma das linhas × total impresso (diferença até R$ 0,05 = bate). Em centavos, sem ponto flutuante na soma. */
export function somaPdf(linhas: readonly LinhaConferencia[], totalImpresso: number | null) {
  const soma = linhas.reduce((s, l) => {
    const v = numeroDigitado(l.valor);
    if (!v) return s;
    const [i, d = ""] = v.split(".");
    return s + Number(i) * 100 + Number((d + "00").slice(0, 2)) + (Number(d[2] ?? 0) >= 5 ? 1 : 0);
  }, 0);
  const total = totalImpresso == null ? null : Math.round(totalImpresso * 100);
  return { soma_centavos: soma, total_centavos: total, bate: total == null ? null : Math.abs(soma - total) <= 5 };
}
