// Regras de mapeamento da tela "Importar Dados" do protótipo (src/routes/_authenticated/importar.tsx), puras para teste.
// Cada linha chega como a planilha foi lida no navegador: cabeçalho em minúsculas → texto.
import { parseNum } from '../../common/parse/numero';
import { isDateString } from '../../common/time/dates';

export type Linha = Record<string, string>;

const txt = (v: string | undefined) => (v ?? '').trim();

export function insumosDasLinhas(linhas: Linha[]) {
  return linhas
    .filter((r) => txt(r.nome))
    .map((r) => {
      const consumo = parseNum(r.consumo_semanal_base);
      return {
        codigo: txt(r.codigo) || null,
        nome: txt(r.nome),
        tipo: txt(r.tipo) || 'Insumo',
        subgrupo: txt(r.subgrupo) || 'Mercearia',
        unidade: (txt(r.unidade) || 'UN').toUpperCase(),
        preco_unitario: parseNum(r.preco_unitario),
        embalagem_compra: txt(r.embalagem_compra) || null,
        qtd_por_embalagem: parseNum(r.qtd_por_embalagem) ?? 1,
        consumo_semanal_manual: consumo,
        usar_manual: consumo != null,
        estoque_seguranca_pct: parseNum(r.estoque_seguranca_pct),
        ativo: true,
      };
    });
}

/** Agrupa as linhas por item do cardápio (ordem da 1ª aparição), como o `Map` do protótipo. */
export function fichasDasLinhas(linhas: Linha[]) {
  const grupos = new Map<string, Linha[]>();
  for (const r of linhas) {
    const nome = txt(r.item_cardapio);
    if (nome) grupos.set(nome, [...(grupos.get(nome) ?? []), r]);
  }
  const cabecalhos = [...grupos].map(([nome, ls]) => {
    const categoria = txt(ls[0]!.categoria);
    return {
      nome,
      categoria: categoria || 'Pratos',
      grupo: ['Bebidas', 'Chopp'].includes(categoria) ? 'Bebidas' : 'Alimentos',
      preco_venda: parseNum(ls[0]!.preco_venda),
      ativo: true,
    };
  });
  return { grupos, cabecalhos };
}

/** "rend. 2,5" na observação vira rendimento (regra do protótipo). */
export const rendimentoDaObservacao = (obs: string | undefined) => parseNum(obs?.match(/rend\.?\s*([\d,]+)/i)?.[1]);

/** Data AAAA-MM-DD existente; hora HH:MM ou HH:MM:SS (o resto vira nulo, a linha não derruba a importação). */
export const horaValida = (h: string | undefined): string | null => {
  const t = txt(h);
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [hh, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return hh < 24 && mm < 60 && ss < 60 ? `${String(hh).padStart(2, '0')}:${m[2]}:${String(ss).padStart(2, '0')}` : null;
};

export type VendaAgregada = {
  pedido: string;
  data: string;
  hora: string | null;
  produto_relatorio: string;
  preco_unitario: number;
  quantidade: number;
  valor_total: number;
  desconto: number;
  taxa: number;
  frete: number;
};

/**
 * Soma linhas repetidas de pedido + produto + data (a chave única de `vendas`) — hora e preço da 1ª linha.
 * Linha sem pedido/data/produto ou com data inválida fica de fora (a tela avisa "linhas com erro serão ignoradas").
 */
export function vendasDasLinhas(linhas: Linha[]): VendaAgregada[] {
  const ag = new Map<string, VendaAgregada>();
  for (const r of linhas) {
    const pedido = txt(r.pedido);
    const data = txt(r.data);
    const produto = txt(r.produto_relatorio);
    if (!pedido || !data || !produto || !isDateString(data)) continue;
    const k = `${pedido}|${produto}|${data}`;
    const n = {
      quantidade: parseNum(r.quantidade) ?? 0,
      valor_total: parseNum(r.valor_total) ?? 0,
      desconto: parseNum(r.desconto) ?? 0,
      taxa: parseNum(r.taxa) ?? 0,
      frete: parseNum(r.frete) ?? 0,
    };
    const ex = ag.get(k);
    if (ex) {
      ex.quantidade += n.quantidade;
      ex.valor_total += n.valor_total;
      ex.desconto += n.desconto;
      ex.taxa += n.taxa;
      ex.frete += n.frete;
    } else {
      ag.set(k, { pedido, data, hora: horaValida(r.hora), produto_relatorio: produto, preco_unitario: parseNum(r.preco_unitario) ?? 0, ...n });
    }
  }
  return [...ag.values()];
}
