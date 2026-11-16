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

/** Confere o que a IA indicou contra o estoque: nome desconhecido vira sugestão de novo insumo; fator inválido vira 1. */
export function limparItens(itens: ItemIa[], insumos: { id: string; nome: string }[], subgrupos: string[]): ItemLido[] {
  const porNome = new Map(insumos.map((i) => [normalizaNome(i.nome), i.id]));
  const subPorNome = new Map(subgrupos.map((s) => [normalizaNome(s), s]));
  return itens.map((it) => {
    const { insumo, novo_nome, novo_unidade, novo_subgrupo, fator, ...nota } = it;
    const f = typeof fator === 'number' && Number.isFinite(fator) && fator > 0 ? fator : 1;
    const id = typeof insumo === 'string' && insumo.trim() ? (porNome.get(normalizaNome(insumo)) ?? null) : null;
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
