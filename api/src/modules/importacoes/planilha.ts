// Importar vendas de outros sistemas (desenho 24/11, A.5): converte as linhas cruas da planilha (como o navegador leu: nome da coluna →
// texto) pelo mapeamento escolhido na tela. Puro, testado sem banco. Dinheiro e quantidade viram Decimal (nunca float).
import { Prisma } from '@prisma/client';
import { isDateString } from '../../common/time/dates';
import { horaValida } from './regras';

export const CAMPOS_VENDA = ['pedido', 'data', 'hora', 'produto', 'quantidade', 'valor_total', 'preco_unitario', 'desconto', 'taxa', 'frete'] as const;
export type CampoVenda = (typeof CAMPOS_VENDA)[number];
/** Campo do Comanda → nome da coluna no arquivo. Campo ausente = "o arquivo não tem". */
export type Mapeamento = Partial<Record<CampoVenda, string>>;
export type Separador = 'virgula' | 'ponto';

export const OBRIGATORIOS: readonly CampoVenda[] = ['data', 'produto', 'quantidade', 'valor_total'];
export const NOME_DO_CAMPO: Record<CampoVenda, string> = {
  pedido: 'pedido',
  data: 'data',
  hora: 'hora',
  produto: 'produto',
  quantidade: 'quantidade',
  valor_total: 'valor total',
  preco_unitario: 'preço unitário',
  desconto: 'desconto',
  taxa: 'taxa de serviço',
  frete: 'taxa de entrega',
};

/** A "Planilha padrão do Comanda" (origem nula): as colunas fixas da tela Importar Dados, já em minúsculas. */
export const MAPEAMENTO_PADRAO: Mapeamento = {
  pedido: 'pedido',
  data: 'data',
  hora: 'hora',
  produto: 'produto_relatorio',
  quantidade: 'quantidade',
  valor_total: 'valor_total',
  preco_unitario: 'preco_unitario',
  desconto: 'desconto',
  taxa: 'taxa',
  frete: 'frete',
};

/** Uma venda (linha do arquivo já convertida). Valores em Decimal; `linha` = nº da linha no arquivo (cabeçalho = 1). */
export type LinhaVenda = {
  linha: number;
  pedido: string;
  data: string;
  hora: string | null;
  produto_relatorio: string;
  quantidade: Prisma.Decimal;
  valor_total: Prisma.Decimal;
  preco_unitario: Prisma.Decimal | null;
  desconto: Prisma.Decimal;
  taxa: Prisma.Decimal;
  frete: Prisma.Decimal;
};
export type Problema = { linha: number; motivo: string };

/** Campos obrigatórios sem coluna escolhida (400 MAPEAMENTO_INCOMPLETO: "Escolha a coluna de: data, produto."). */
export function camposFaltando(m: Mapeamento | null | undefined): CampoVenda[] {
  return OBRIGATORIOS.filter((c) => !(m?.[c] ?? '').trim());
}

const SO_ESPACO = /[\s ]+/g;
/** Espaços colapsados (o mesmo nome de produto com dois espaços não vira outro produto). */
export const textoLimpo = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(SO_ESPACO, ' ').trim();

const VIRGULA_SIMPLES = /^\d+(,\d+)?$/;
const VIRGULA_MILHAR = /^\d{1,3}(\.\d{3})+,\d+$/;
const PONTO_SIMPLES = /^\d+(\.\d+)?$/;
const PONTO_MILHAR = /^\d{1,3}(,\d{3})+\.\d+$/;

/**
 * Texto da célula → Decimal, conforme "Como os valores estão escritos?". Aceita "R$" e espaços. O que não dá para ler sem chutar vira
 * null (a linha vai para "com problema"): no modo vírgula, "12.90" e "1.234" (sem vírgula, o ponto pode ser decimal); no modo ponto,
 * "12,90" e "1,234". Com o separador de milhar E o decimal ("1.234,56" / "1,234.56"), não há dúvida.
 */
export function numeroDaCelula(v: unknown, sep: Separador): Prisma.Decimal | null {
  let t = textoLimpo(v).replace(/^R\$\s*/i, '').replace(SO_ESPACO, '');
  if (!t) return null;
  let neg = false;
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1);
  }
  let canon: string | null = null;
  if (sep === 'virgula') {
    if (VIRGULA_SIMPLES.test(t)) canon = t.replace(',', '.');
    else if (VIRGULA_MILHAR.test(t)) canon = t.replace(/\./g, '').replace(',', '.');
  } else if (PONTO_SIMPLES.test(t)) canon = t;
  else if (PONTO_MILHAR.test(t)) canon = t.replace(/,/g, '');
  if (canon === null) return null;
  const d = new Prisma.Decimal(canon);
  return neg ? d.neg() : d;
}

const DATA_BR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2}:\d{2}(?::\d{2})?))?$/;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?)?$/;

/** "dd/mm/aaaa", "aaaa-mm-dd", com ou sem a hora junto ("dd/mm/aaaa hh:mm[:ss]"). Data impossível ("31/02/2026") = null. */
export function dataDaCelula(v: unknown): { data: string; hora: string | null } | null {
  const t = textoLimpo(v);
  let a: string, m: string, d: string, h: string | undefined;
  const br = DATA_BR.exec(t);
  const iso = DATA_ISO.exec(t);
  if (br) [, d, m, a, h] = br as unknown as [string, string, string, string, string | undefined];
  else if (iso) [, a, m, d, h] = iso as unknown as [string, string, string, string, string | undefined];
  else return null;
  const data = `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (!isDateString(data)) return null;
  return { data, hora: h ? horaValida(h) : null };
}

/** "2026-11-24" → "24/11/2026" (frases de problema). */
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Pedido sintético quando o arquivo não tem número de pedido: um por dia (risco 10 do desenho). */
export const pedidoDoDia = (prefixo: string, data: string) => `${prefixo}DIA ${data}`;

/**
 * Aplica o mapeamento às linhas cruas. Linha com problema fica de fora, com o motivo (data inválida ou no futuro, produto vazio,
 * quantidade vazia/ilegível/≤ 0, valor vazio/ilegível/negativo, pedido vazio quando a coluna existe). Sem coluna de pedido, cada dia
 * vira o pedido `<prefixo>DIA <data>`. `linha` conta o cabeçalho como 1 (a 1ª linha de dados é a 2), como a tela Importar Dados.
 */
export function aplicarMapeamento(
  linhas: readonly Record<string, unknown>[],
  m: Mapeamento,
  sep: Separador,
  opcoes: { hoje: string; prefixo: string; primeiraLinha?: number },
): { validas: LinhaVenda[]; problemas: Problema[] } {
  const validas: LinhaVenda[] = [];
  const problemas: Problema[] = [];
  const base = opcoes.primeiraLinha ?? 2;
  const cel = (r: Record<string, unknown>, c: CampoVenda) => (m[c] ? r[m[c]!] : undefined);
  linhas.forEach((r, i) => {
    const linha = base + i;
    const erro = (motivo: string) => problemas.push({ linha, motivo });
    const dt = dataDaCelula(cel(r, 'data'));
    if (!dt) return erro(textoLimpo(cel(r, 'data')) ? `data inválida (${textoLimpo(cel(r, 'data'))})` : 'data vazia');
    if (dt.data > opcoes.hoje) return erro(`data no futuro (${dataBr(dt.data)})`);
    const produto = textoLimpo(cel(r, 'produto'));
    if (!produto) return erro('produto vazio');
    const qTxt = textoLimpo(cel(r, 'quantidade'));
    const q = numeroDaCelula(qTxt, sep);
    if (!qTxt) return erro('quantidade vazia');
    if (!q) return erro(`quantidade ilegível (${qTxt})`);
    if (q.lte(0)) return erro(q.isZero() ? 'quantidade zero' : `quantidade negativa (${qTxt})`);
    const vTxt = textoLimpo(cel(r, 'valor_total'));
    const v = numeroDaCelula(vTxt, sep);
    if (!vTxt) return erro('valor total vazio');
    if (!v) return erro(`valor ilegível (${vTxt})`);
    if (v.isNeg()) return erro(`valor negativo (${vTxt})`);
    const opcional = (c: CampoVenda): Prisma.Decimal | null | 'erro' => {
      const t = textoLimpo(cel(r, c));
      if (!t) return null;
      const n = numeroDaCelula(t, sep);
      if (!n || n.isNeg()) {
        erro(`${NOME_DO_CAMPO[c]} ilegível (${t})`);
        return 'erro';
      }
      return n;
    };
    const pu = opcional('preco_unitario');
    if (pu === 'erro') return;
    const desc = opcional('desconto');
    if (desc === 'erro') return;
    const taxa = opcional('taxa');
    if (taxa === 'erro') return;
    const frete = opcional('frete');
    if (frete === 'erro') return;
    let pedido: string;
    if (m.pedido) {
      const p = textoLimpo(cel(r, 'pedido'));
      if (!p) return erro('pedido vazio');
      pedido = `${opcoes.prefixo}${p}`;
    } else pedido = pedidoDoDia(opcoes.prefixo, dt.data);
    const horaCol = m.hora ? horaValida(textoLimpo(cel(r, 'hora'))) : null;
    validas.push({
      linha,
      pedido,
      data: dt.data,
      hora: horaCol ?? dt.hora,
      produto_relatorio: produto,
      quantidade: q,
      valor_total: v,
      preco_unitario: pu,
      desconto: desc ?? new Prisma.Decimal(0),
      taxa: taxa ?? new Prisma.Decimal(0),
      frete: frete ?? new Prisma.Decimal(0),
    });
  });
  return { validas, problemas };
}

/** Chave única de `vendas`. */
export const chaveVenda = (v: { pedido: string; produto_relatorio: string; data: string }) => `${v.pedido}\u0000${v.produto_relatorio}\u0000${v.data}`;

/**
 * Soma as linhas repetidas de pedido + produto + data (a chave única de `vendas`), como `vendasDasLinhas`: hora e preço da 1ª linha.
 * `somadas` = quantas linhas válidas foram somadas a outra (para a conta "lidas = novas + já existentes + com problema + somadas").
 */
export function agregarVendas(linhas: readonly LinhaVenda[]): { vendas: LinhaVenda[]; somadas: number } {
  const ag = new Map<string, LinhaVenda>();
  for (const l of linhas) {
    const k = chaveVenda(l);
    const ex = ag.get(k);
    if (!ex) {
      ag.set(k, { ...l });
      continue;
    }
    ex.quantidade = ex.quantidade.add(l.quantidade);
    ex.valor_total = ex.valor_total.add(l.valor_total);
    ex.desconto = ex.desconto.add(l.desconto);
    ex.taxa = ex.taxa.add(l.taxa);
    ex.frete = ex.frete.add(l.frete);
  }
  return { vendas: [...ag.values()], somadas: linhas.length - ag.size };
}

/** Reais em Decimal → centavos inteiros (arredondamento comercial). */
export const centavos = (d: Prisma.Decimal): number => d.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
