import type { SugestaoInsumo } from "./erp-api";
import { sugerirInsumo } from "./nfe";

/** Espera máxima pela IA (todos os lotes juntos). Passou, a tela segue com a sugestão por palavras. */
export const PRAZO_IA_MS = 20_000;
/** Limite de linhas por pedido da API; nota maior vai em vários pedidos, em sequência. */
export const LOTE_IA = 200;

export type ResultadoIa = { tipo: "ia"; itens: SugestaoInsumo[] } | { tipo: "sem_chave" } | { tipo: "falhou" };

type ItemPedido = { descricao: string; unidade: string | null };

/**
 * Pede a sugestão em lotes de até LOTE_IA, um de cada vez, com um único prazo para o conjunto.
 * Estourou o prazo: aborta o pedido em curso e devolve `falhou`. Lote com resposta de outro tamanho: `falhou`.
 * `semChave(e)` separa "a empresa não tem chave de IA" (silêncio total) das demais falhas.
 */
export async function sugerirEmLotes(
  itens: ItemPedido[],
  chamar: (lote: ItemPedido[], signal: AbortSignal) => Promise<{ itens: SugestaoInsumo[] }>,
  op: { semChave: (e: unknown) => boolean; prazoMs?: number },
): Promise<ResultadoIa> {
  if (!itens.length) return { tipo: "ia", itens: [] };
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<ResultadoIa>((resolve) => {
    timer = setTimeout(() => { ctrl.abort(); resolve({ tipo: "falhou" }); }, op.prazoMs ?? PRAZO_IA_MS);
  });
  const trabalho = (async (): Promise<ResultadoIa> => {
    const out: SugestaoInsumo[] = [];
    for (let i = 0; i < itens.length; i += LOTE_IA) {
      if (ctrl.signal.aborted) return { tipo: "falhou" };
      const lote = itens.slice(i, i + LOTE_IA);
      const r = await chamar(lote, ctrl.signal);
      if (!Array.isArray(r?.itens) || r.itens.length !== lote.length) return { tipo: "falhou" };
      out.push(...r.itens);
    }
    return { tipo: "ia", itens: out };
  })().catch((e): ResultadoIa => (op.semChave(e) ? { tipo: "sem_chave" } : { tipo: "falhou" }));
  try { return await Promise.race([trabalho, prazo]); } finally { clearTimeout(timer); }
}

export type LinhaSugerivel = {
  descricao: string;
  item_estoque_id: string;
  novo: { nome: string; unidade: string; subgrupo: string } | null;
  sugerido: boolean;
  fator: string;
  /** Sem vínculo salvo e esperando a IA. */
  pendenteIa: boolean;
  /** O admin já escolheu o insumo ou mexeu no cadastro novo: a sugestão não passa por cima. */
  tocada: boolean;
  /** O admin já digitou o fator. */
  fatorTocado: boolean;
};

/**
 * Aplica o resultado às linhas pendentes. O k-ésimo item da resposta vai para a k-ésima linha pendente (a ordem do pedido).
 * Toda pendente deixa de ser pendente. Linha tocada não muda (e fator tocado fica). Sem sugestão da IA para a linha
 * (ou sem_chave / falhou), vale a sugestão por palavras; sem nada, fica "— não lançar —".
 */
export function aplicarSugestoes<L extends LinhaSugerivel>(linhas: L[], r: ResultadoIa, insumos: { id: string; nome: string }[]): L[] {
  let k = 0;
  return linhas.map((l) => {
    if (!l.pendenteIa) return l;
    const s = r.tipo === "ia" ? r.itens[k] : undefined;
    k++;
    if (l.tocada) return { ...l, pendenteIa: false };
    const fator = s && !l.fatorTocado ? String(s.fator).replace(".", ",") : l.fator;
    if (s?.item_estoque_id) return { ...l, pendenteIa: false, item_estoque_id: s.item_estoque_id, sugerido: true, novo: null, fator };
    if (s?.novo) return { ...l, pendenteIa: false, item_estoque_id: "", sugerido: false, novo: { nome: s.novo.nome, unidade: s.novo.unidade, subgrupo: s.novo.subgrupo ?? "" }, fator };
    const palavras = sugerirInsumo(l.descricao, insumos);
    return { ...l, pendenteIa: false, item_estoque_id: palavras?.id ?? "", sugerido: !!palavras, novo: null };
  });
}

/** A tela espera a IA enquanto houver linha pendente. */
export const aguardandoIa = (linhas: { pendenteIa: boolean }[]) => linhas.some((l) => l.pendenteIa);

/** Que linha mostrar acima da tabela depois da consulta: da IA, de falha discreta, ou nenhuma. */
export const avisoDaIa = (r: ResultadoIa | null): "ia" | "falhou" | null => (r?.tipo === "ia" ? "ia" : r?.tipo === "falhou" ? "falhou" : null);
