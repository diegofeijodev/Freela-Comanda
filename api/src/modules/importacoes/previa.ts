// Prévia da importação de vendas (desenho 24/11, A.1 passo 4, A.3 R1–R7): a conta que a tela mostra antes de gravar, calculada no
// servidor contra os "fatos do banco" (vendas que já existem, por fonte; o que o Substituir apagaria; arquivo já importado; de-para).
// Pura, testada sem banco. O confirmar refaz a mesma conta dentro da transação (os números podem mudar se entrou venda no meio).
import { Prisma } from '@prisma/client';
import { agregarVendas, centavos, chaveVenda, type LinhaVenda, type Problema } from './planilha';

export type TipoFonte = 'cupom' | 'padrao' | 'sistema' | 'xml';
/** De onde veio uma venda: `chave` identifica (cupom | padrao | sistema:<id> | xml:<id>), `nome` é o que a tela mostra. */
export type Fonte = { chave: string; nome: string; tipo: TipoFonte };

export const NOME_PADRAO = 'Planilha padrão do Comanda';
export const NOME_CUPOM = 'Cupons do próprio Comanda';
export const fonteDaImportacao = (formato: 'planilha' | 'xml' | 'pdf', origem: { id: string; nome: string } | null): Fonte => {
  if (!origem) return { chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao' };
  return formato === 'xml'
    ? { chave: `xml:${origem.id}`, nome: `XML de ${origem.nome}`, tipo: 'xml' }
    : { chave: `sistema:${origem.id}`, nome: origem.nome, tipo: 'sistema' };
};

export type FatosPrevia = {
  /** A fonte desta importação (as vendas dela não são "outra fonte"). */
  propria: Fonte;
  modo: 'acrescentar' | 'substituir';
  /** Vendas já no banco com a mesma chave (pedido + produto + data) de alguma linha do arquivo, com a fonte de cada uma. */
  existentes: ReadonlyMap<string, Fonte & { pedido: string; data: string }>;
  /** Vendas já no banco no período do arquivo, por fonte (todas as fontes, inclusive a própria). */
  porFonte: readonly (Fonte & { vendas: number; valor_centavos: number })[];
  /** O que o Substituir apagaria (só a fonte própria, no período). Null fora do Substituir. */
  substituir: { vendas: number; valor_centavos: number } | null;
  arquivoJaImportado: { em: string; por: string | null; vendas: number | null } | null;
  /** Produtos que já estão no de-para (ligados ou não). */
  dePara: ReadonlySet<string>;
  cardapio: readonly { id: string; nome: string }[];
};

export type Previa = {
  periodo: { ini: string; fim: string; dias: number } | null;
  linhas: { lidas: number; validas: number; com_problema: number; ja_existentes: number; somadas_no_arquivo: number; novas: number };
  valor_centavos: number;
  ja_existentes_valor_centavos: number;
  pedidos: number;
  itens: number;
  problemas: Problema[];
  motivos: { motivo: string; linhas: number }[];
  amostra: { pedido: string; data: string; hora: string | null; produto_relatorio: string; quantidade: number; valor_centavos: number }[];
  produtos_sem_de_para: {
    produto_relatorio: string;
    linhas: number;
    valor_centavos: number;
    sugestao_item_cardapio_id: string | null;
    parece_cana: boolean;
  }[];
  ja_existentes_mesma_fonte: number;
  ja_existentes_de_outra_fonte: { fonte: string; tipo: TipoFonte; linhas: number; exemplo: { pedido: string; data: string } }[];
  ja_existentes_pedido_dia: number;
  sobreposicao: { fonte: string; tipo: TipoFonte; vendas: number; valor_centavos: number }[];
  substituir: { vendas: number; valor_centavos: number; ini: string; fim: string } | null;
  arquivo_ja_importado: { em: string; por: string | null; vendas: number | null } | null;
};

export const MAX_PROBLEMAS = 200;
const MAX_AMOSTRA = 20;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Nome que parece de produto de caldo de cana (mesma lista da Configuração da Cana: cana, caldo, garapa, frozen). */
export const pareceCana = (nome: string) => /\b(cana|caldo|garapa|frozen)\b/.test(semAcento(nome));

const palavras = (s: string) =>
  semAcento(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** Item do cardápio sugerido para o nome do relatório: o de mesmo nome (sem caixa e sem acento) ou o de mais palavras em comum (≥ 50%). */
export function sugerirItemCardapio(produto: string, cardapio: readonly { id: string; nome: string }[]): string | null {
  const alvo = semAcento(produto).trim();
  const igual = cardapio.find((c) => semAcento(c.nome).trim() === alvo);
  if (igual) return igual.id;
  const a = new Set(palavras(produto));
  let melhor: string | null = null;
  let nota = 0;
  for (const c of cardapio) {
    const b = palavras(c.nome);
    if (!b.length) continue;
    const s = b.filter((w) => a.has(w)).length / b.length;
    if (s > nota) {
      nota = s;
      melhor = c.id;
    }
  }
  return nota >= 0.5 ? melhor : null;
}

/** "data inválida (31/02/2026)" → "data inválida": o tipo do problema, para os "motivos mais comuns". */
export const tipoDoMotivo = (m: string) => m.replace(/\s*\(.*\)\s*$/, '');

const diasEntre = (ini: string, fim: string) => Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${ini}T12:00:00Z`)) / 864e5) + 1;

/**
 * Monta a prévia. `lidas` = linhas do arquivo (planilha/PDF) ou itens dos documentos novos (XML). Conta que sempre fecha:
 * lidas = novas + ja_existentes + com_problema + somadas_no_arquivo. No Substituir, a venda que existe e é da própria fonte não conta
 * como "já existente": ela sai e volta com os números do arquivo.
 */
export function montarPrevia(e: { lidas: number; validas: readonly LinhaVenda[]; problemas: readonly Problema[] }, f: FatosPrevia): Previa {
  const { vendas, somadas } = agregarVendas(e.validas);
  const novas: LinhaVenda[] = [];
  const existentes: (LinhaVenda & { fonte: Fonte })[] = [];
  for (const v of vendas) {
    const ex = f.existentes.get(chaveVenda(v));
    if (ex && !(f.modo === 'substituir' && ex.chave === f.propria.chave)) existentes.push({ ...v, fonte: ex });
    else novas.push(v);
  }
  const datas = vendas.map((v) => v.data).sort();
  const periodo = datas.length
    ? { ini: datas[0]!, fim: datas[datas.length - 1]!, dias: diasEntre(datas[0]!, datas[datas.length - 1]!) }
    : null;
  const soma = (vs: readonly LinhaVenda[]) => vs.reduce((s, v) => s.add(v.valor_total), new Prisma.Decimal(0));

  const motivos = new Map<string, number>();
  for (const p of e.problemas) motivos.set(tipoDoMotivo(p.motivo), (motivos.get(tipoDoMotivo(p.motivo)) ?? 0) + 1);

  const semDePara = new Map<string, { linhas: number; valor: Prisma.Decimal }>();
  for (const v of novas) {
    if (f.dePara.has(v.produto_relatorio)) continue;
    const x = semDePara.get(v.produto_relatorio) ?? { linhas: 0, valor: new Prisma.Decimal(0) };
    x.linhas++;
    x.valor = x.valor.add(v.valor_total);
    semDePara.set(v.produto_relatorio, x);
  }

  const outra = new Map<string, { fonte: Fonte; linhas: number; exemplo: { pedido: string; data: string } }>();
  for (const x of existentes) {
    if (x.fonte.chave === f.propria.chave) continue;
    const o = outra.get(x.fonte.chave) ?? { fonte: x.fonte, linhas: 0, exemplo: { pedido: x.pedido, data: x.data } };
    o.linhas++;
    outra.set(x.fonte.chave, o);
  }
  const pedidoDia = /DIA \d{4}-\d{2}-\d{2}$/;

  return {
    periodo,
    linhas: {
      lidas: e.lidas,
      validas: e.validas.length,
      com_problema: e.problemas.length,
      ja_existentes: existentes.length,
      somadas_no_arquivo: somadas,
      novas: novas.length,
    },
    valor_centavos: centavos(soma(novas)),
    ja_existentes_valor_centavos: centavos(soma(existentes)),
    pedidos: new Set(novas.map((v) => v.pedido)).size,
    itens: novas.reduce((s, v) => s.add(v.quantidade), new Prisma.Decimal(0)).toNumber(),
    problemas: e.problemas.slice(0, MAX_PROBLEMAS),
    motivos: [...motivos]
      .map(([motivo, linhas]) => ({ motivo, linhas }))
      .sort((a, b) => b.linhas - a.linhas || a.motivo.localeCompare(b.motivo)),
    amostra: novas.slice(0, MAX_AMOSTRA).map((v) => ({
      pedido: v.pedido,
      data: v.data,
      hora: v.hora,
      produto_relatorio: v.produto_relatorio,
      quantidade: v.quantidade.toNumber(),
      valor_centavos: centavos(v.valor_total),
    })),
    produtos_sem_de_para: [...semDePara]
      .map(([produto_relatorio, x]) => ({
        produto_relatorio,
        linhas: x.linhas,
        valor_centavos: centavos(x.valor),
        sugestao_item_cardapio_id: sugerirItemCardapio(produto_relatorio, f.cardapio),
        parece_cana: pareceCana(produto_relatorio),
      }))
      .sort((a, b) => b.valor_centavos - a.valor_centavos || a.produto_relatorio.localeCompare(b.produto_relatorio)),
    ja_existentes_mesma_fonte: existentes.filter((x) => x.fonte.chave === f.propria.chave).length,
    ja_existentes_de_outra_fonte: [...outra.values()].map((o) => ({
      fonte: o.fonte.nome,
      tipo: o.fonte.tipo,
      linhas: o.linhas,
      exemplo: o.exemplo,
    })),
    ja_existentes_pedido_dia: existentes.filter((x) => pedidoDia.test(x.pedido)).length,
    sobreposicao: f.porFonte
      .filter((p) => p.chave !== f.propria.chave && p.vendas > 0)
      .map((p) => ({ fonte: p.nome, tipo: p.tipo, vendas: p.vendas, valor_centavos: p.valor_centavos })),
    substituir: f.substituir && periodo ? { ...f.substituir, ini: periodo.ini, fim: periodo.fim } : null,
    arquivo_ja_importado: f.arquivoJaImportado,
  };
}
