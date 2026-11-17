import { normalizaNome } from '../../common/parse/normaliza';

/** Item como a nota traz (o mesmo formato do esquema do protótipo). */
export type ItemNota = {
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
};

/** Item como a IA devolve: o da nota + a indicação do insumo. */
export type ItemIa = ItemNota & {
  insumo: string | null;
  novo_nome: string | null;
  novo_unidade: string | null;
  novo_subgrupo: string | null;
  fator: number;
};

/** Item já limpo: ou aponta um insumo existente, ou traz a sugestão de cadastro de um novo. */
export type ItemLido = ItemNota & {
  item_estoque_id: string | null;
  novo: { nome: string; unidade: string; subgrupo: string | null } | null;
  fator: number;
};

/** A lista que vai no pedido (não nas instruções): insumos ativos e subgrupos existentes. */
export function textoCatalogo(insumos: { nome: string; unidade: string }[], subgrupos: string[]): string {
  const lista = insumos.length ? insumos.map((i) => `- ${i.nome} (${i.unidade})`).join('\n') : '(nenhum insumo cadastrado)';
  return `Insumos do estoque (nome e unidade do estoque):\n${lista}\n\nSubgrupos existentes: ${subgrupos.length ? subgrupos.join('; ') : '(nenhum)'}`;
}

/** Casa pelo nome inteiro; se não achar, tenta sem um sufixo final entre parênteses ("Tomate (KG)" → "Tomate"). */
function achaInsumo(porNome: Map<string, string>, texto: string): string | null {
  const direto = porNome.get(normalizaNome(texto));
  if (direto) return direto;
  const semSufixo = texto.replace(/\s*\([^()]*\)\s*$/, '');
  return semSufixo !== texto && semSufixo.trim() ? (porNome.get(normalizaNome(semSufixo)) ?? null) : null;
}

/** Confere o que a IA indicou contra o estoque: nome desconhecido vira sugestão de novo insumo; fator inválido vira 1. */
export function limparItens(itens: ItemIa[], insumos: { id: string; nome: string }[], subgrupos: string[]): ItemLido[] {
  const porNome = new Map(insumos.map((i) => [normalizaNome(i.nome), i.id]));
  const subPorNome = new Map(subgrupos.map((s) => [normalizaNome(s), s]));
  return itens.filter((it) => it && typeof it === 'object').map((it) => {
    const { insumo, novo_nome, novo_unidade, novo_subgrupo, fator, ...nota } = it;
    const f = typeof fator === 'number' && Number.isFinite(fator) && fator > 0 ? fator : 1;
    const id = typeof insumo === 'string' && insumo.trim() ? achaInsumo(porNome, insumo) : null;
    if (id) return { ...nota, item_estoque_id: id, novo: null, fator: f };
    return {
      ...nota,
      item_estoque_id: null,
      novo: {
        nome: novo_nome?.trim() || nota.descricao,
        unidade: novo_unidade?.trim().toUpperCase() || nota.unidade?.trim().toUpperCase() || 'UN',
        subgrupo: (novo_subgrupo ? subPorNome.get(normalizaNome(novo_subgrupo)) : undefined) ?? null,
      },
      fator: f,
    };
  });
}

/** O que a IA devolve por linha na sugestão de insumo dos itens do XML. */
export type SugestaoIa = {
  indice: number;
  insumo: string | null;
  novo_nome: string | null;
  novo_unidade: string | null;
  novo_subgrupo: string | null;
  fator: number;
};

/** As linhas da nota que vão no pedido: "1. DESCRIÇÃO (UN)", uma por linha, o número começa em 1. Só descrição e unidade saem. */
export function linhasNumeradas(itens: { descricao: string; unidade?: string | null }[]): string {
  return itens.map((it, i) => `${i + 1}. ${it.descricao}${it.unidade?.trim() ? ` (${it.unidade.trim()})` : ''}`).join('\n');
}

/** Junta a resposta da IA às `n` linhas pelo `indice` (inteiro de 1 a n). Repetido: o primeiro vence; fora disso: ignorado; faltando: null. */
export function casarPorIndice(resposta: unknown[], n: number): (Omit<SugestaoIa, 'indice'> | null)[] {
  const out: (Omit<SugestaoIa, 'indice'> | null)[] = Array.from({ length: n }, () => null);
  for (const r of resposta) {
    if (!r || typeof r !== 'object') continue;
    const { indice, ...resto } = r as SugestaoIa;
    if (!Number.isInteger(indice) || indice < 1 || indice > n || out[indice - 1]) continue;
    out[indice - 1] = resto;
  }
  return out;
}
