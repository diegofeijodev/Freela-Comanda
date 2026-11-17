// Frases do aviso de nota repetida. As duas primeiras funções são cópia das da API (api/src/common/fiscal/nota-repetida.ts): o texto do 409 e o da faixa têm de ser o mesmo.
import type { NotaParecida } from "./erp-api";
import { normalizarCnpj, normalizarNumeroSerie } from "./fiscal";

const ORIGENS: Record<string, string> = { xml: "por XML", pdf: "por PDF", foto: "por foto", sefaz: "pela SEFAZ" };

export function origemPorExtenso(origem: string): string {
  return ORIGENS[origem] ?? `por ${origem}`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" pela divisão do texto (nunca por Date, que daria o dia anterior). */
function dataBr(d: string): string {
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
}

/** "R$ 1.234,56" com espaço comum (o Intl com currency põe U+00A0). */
function valorBr(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Frase do 409 NOTA_REPETIDA; `p[0]` é a parecida mais nova. */
export function fraseNotaRepetida(p: NotaParecida[]): string {
  const n = p[0]!;
  const serie = n.serie ? ` série ${n.serie}` : "";
  const mais = p.length > 1 ? ` (e mais ${p.length - 1} ${p.length === 2 ? "parecida" : "parecidas"})` : "";
  return (
    `Já existe a NF ${n.numero}${serie} de ${n.fornecedor_nome}, lançada em ${dataBr(n.data_entrada)} ${origemPorExtenso(n.origem)}, ` +
    `de ${valorBr(n.valor_total)}${mais}. Se for outra nota, confirme para lançar mesmo assim.`
  );
}

/** Caixa vermelha: a chave de acesso já está lançada. */
export function fraseChaveIgual(n: NotaParecida): string {
  return `Esta nota já foi lançada. A chave de acesso é a mesma de NF ${n.numero ?? "—"} (${n.fornecedor_nome}), de ${dataBr(n.data_entrada)}. Não dá para lançar duas vezes.`;
}

/** "NF 4411 · série 1 · R$ 1.234,56" (sem série: "NF 4411 · R$ 1.234,56"). */
export function linhaNota(n: NotaParecida): string {
  return ["NF " + (n.numero ?? "—"), n.serie ? `série ${n.serie}` : null, valorBr(n.valor_total)].filter(Boolean).join(" · ");
}

/** "Entrou em 03/11/2026 por foto". */
export function linhaEntrada(n: NotaParecida): string {
  return `Entrou em ${dataBr(n.data_entrada)} ${origemPorExtenso(n.origem)}`;
}

/** Chave da consulta prévia: `null` sem CNPJ ou sem número; os três campos vão normalizados (mesma regra da API). */
export function chaveDaConsulta(cnpj: string | null, numero: string | null, serie: string | null): string | null {
  const c = normalizarCnpj(cnpj ?? "");
  const n = normalizarNumeroSerie(numero);
  if (!c || !n) return null;
  return `${c}|${n}|${normalizarNumeroSerie(serie)}`;
}

/** `confirmar_repetida` só vai se a confirmação foi dada para o trio (CNPJ, número, série) que está nos campos agora. */
export function enviaConfirmacao(confirmadaPara: string | null, cnpj: string | null, numero: string | null, serie: string | null): boolean {
  return confirmadaPara !== null && confirmadaPara === chaveDaConsulta(cnpj, numero, serie);
}
