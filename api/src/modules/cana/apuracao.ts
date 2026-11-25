import { Prisma } from '@prisma/client';
import { addDays, dateFromString } from '../../common/time/dates';
import { pareceCana } from './parece-cana';

/**
 * A conta da semana da cana (desenho 2026-11-24, B.3), pura e testada sem banco: a 2ª exceção à "regra em SQL" (a 1ª é o
 * `ponto/calculo.ts`). O SQL só junta os números (lançamentos ativos, vendas por item e por dia); aqui sai cada número COM as
 * parcelas, para a tela escrever a conta por extenso. Não é dinheiro: dúzias com 2 casas, litros com 3; as contas usam os
 * valores do banco em Decimal e só arredondam na saída (3 + 50 − 42,8 − 5 = 5,2, sem resto de ponto flutuante).
 *
 * A semana vai de uma contagem até a seguinte: entram lançamentos e vendas com `data > contagem anterior` e `data <= contagem
 * atual` (a mesma borda de `v_cmv_periodo`). A contagem vale como fim do dia. Sem a contagem final = semana em andamento (até hoje):
 * sem cana moída, perda e rendimento.
 */

type Num = number | string | Prisma.Decimal;
const D = (v: Num) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface ContagemCana {
  id: string;
  data: string;
  duzias: Num;
  litros_caldo: Num;
  litros_frozen: Num | null;
}
export interface LancamentoSemana {
  tipo: 'recebimento' | 'producao';
  data: string;
  duzias: Num | null;
  litros_caldo: Num | null;
}
/** Vendas de um item do cardápio num dia (já somadas). */
export interface VendaDoItem {
  item_cardapio_id: string;
  nome: string;
  data: string;
  quantidade: Num;
}
/** Vendas sem item do cardápio (de-para pendente) de um nome do relatório num dia. */
export interface VendaSemCardapio {
  produto_relatorio: string;
  data: string;
  vendas: number;
  quantidade: Num;
}
export interface ProdutoCana {
  item_cardapio_id: string;
  ml_por_unidade: Num;
  frozen: boolean;
  ativo: boolean;
}
export interface ParametrosCana {
  litros_por_duzia_esperado: Num | null;
  /** Litros de frozen que 1 litro de caldo rende. */
  rendimento_frozen: Num | null;
}
export interface EntradaSemana {
  inicial: ContagemCana;
  final: ContagemCana | null;
  /** "Hoje" em Brasília: fim da semana em andamento. */
  hoje: string;
  lancamentos: LancamentoSemana[];
  vendas: VendaDoItem[];
  vendas_sem_cardapio: VendaSemCardapio[];
  produtos: ProdutoCana[];
  parametros: ParametrosCana;
  /** Data da venda mais recente importada (qualquer origem); null = nenhuma venda. */
  vendas_importadas_ate: string | null;
}

export type Aviso =
  | { codigo: 'vendas_incompletas'; dados: { ate: string | null; fim: string } }
  | { codigo: 'nada_configurado'; dados: Record<string, never> }
  | { codigo: 'produto_sem_ml'; dados: { produtos: { nome: string; quantidade: number }[] } }
  | { codigo: 'venda_sem_cardapio'; dados: { produtos: { produto_relatorio: string; vendas: number }[] } }
  | { codigo: 'frozen_sem_rendimento'; dados: { vendidos: number; litros_frozen_contados: number } }
  | { codigo: 'cana_moida_negativa'; dados: { duzias: number } }
  | { codigo: 'cana_moida_zero'; dados: Record<string, never> }
  | { codigo: 'producao_zero_com_venda'; dados: { litros_vendidos: number } };

export interface CaldoNaContagem {
  /** = caldo + frozen ÷ rendimento (o frozen sem rendimento fica fora). */
  litros: number;
  caldo: number;
  frozen: number | null;
  frozen_em_caldo: number | null;
}
export interface Apuracao {
  periodo: { ini: string; fim: string; dias: number };
  em_andamento: boolean;
  cana: {
    inicio: number;
    recebida: { duzias: number; lancamentos: number; ini: string | null; fim: string | null };
    fim: number | null;
    /** = início + recebida − fim. */
    moida: number | null;
    /** Só exibição: as dúzias que a loja anotou nas produções (não entra em conta nenhuma). */
    anotada_nas_producoes: { duzias: number; producoes_com: number; producoes: number };
  };
  caldo: {
    produzido: { litros: number; lancamentos: number; ini: string | null; fim: string | null };
    vendido: { litros: number; em_copos: number; em_frozen: number };
    inicio: CaldoNaContagem;
    fim: CaldoNaContagem | null;
    /** = início + produzido − vendido − fim (positivo = sumiu). */
    perda: number | null;
  };
  moagem: { litros_por_duzia: number | null; esperado: number | null; diferenca_litros: number | null; diferenca_pct: number | null };
  rendimento: { litros_vendidos_por_duzia: number | null };
  por_produto: {
    item_cardapio_id: string;
    nome: string;
    quantidade: number;
    ml_por_unidade: number;
    frozen: boolean;
    /** quantidade × ml ÷ 1.000 (no frozen, litros de frozen). */
    litros: number;
    /** no frozen, ÷ rendimento. */
    litros_caldo: number;
  }[];
  nao_entram: {
    sem_ml: { item_cardapio_id: string; nome: string; quantidade: number }[];
    frozen_sem_rendimento: { item_cardapio_id: string; nome: string; quantidade: number }[];
    sem_cardapio: { produto_relatorio: string; vendas: number; quantidade: number }[];
  };
  avisos: Aviso[];
  vendas_importadas_ate: string | null;
}

const duz = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber();
const lit = (d: Prisma.Decimal) => d.toDecimalPlaces(3).toNumber();
const taxa = (d: Prisma.Decimal) => d.toDecimalPlaces(4).toNumber();
const qtd = (d: Prisma.Decimal) => d.toDecimalPlaces(4).toNumber();
const porNome = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome, 'pt-BR');

/** Dias entre duas datas "AAAA-MM-DD" (fim − ini). */
const diasEntre = (ini: string, fim: string) => Math.round((dateFromString(fim).getTime() - dateFromString(ini).getTime()) / 864e5);

/** O período da semana: do dia seguinte à contagem anterior até `fim` (a contagem atual ou hoje). */
export function periodoDaSemana(dataContagemAnterior: string, fim: string) {
  return { ini: addDays(dataContagemAnterior, 1), fim, dias: diasEntre(dataContagemAnterior, fim) };
}

/** A borda de `v_cmv_periodo`: depois da contagem anterior e até a contagem atual (inclusive). */
const dentro = (data: string, anterior: string, fim: string) => data > anterior && data <= fim;

/** Litros de caldo numa contagem (exatos, para a conta) = caldo + frozen ÷ rendimento; sem rendimento, o frozen fica fora. */
const litrosNaContagem = (c: ContagemCana, rendimento: Prisma.Decimal | null) =>
  D(c.litros_caldo).plus(c.litros_frozen !== null && rendimento ? D(c.litros_frozen).div(rendimento) : ZERO);

function caldoNaContagem(c: ContagemCana, rendimento: Prisma.Decimal | null): CaldoNaContagem {
  const caldo = D(c.litros_caldo);
  const frozen = c.litros_frozen === null ? null : D(c.litros_frozen);
  const frozenEmCaldo = frozen !== null && rendimento ? frozen.div(rendimento) : null;
  return {
    litros: lit(litrosNaContagem(c, rendimento)),
    caldo: lit(caldo),
    frozen: frozen === null ? null : lit(frozen),
    frozen_em_caldo: frozenEmCaldo === null ? null : lit(frozenEmCaldo),
  };
}

export function apurarSemana(e: EntradaSemana): Apuracao {
  const anterior = e.inicial.data;
  const emAndamento = e.final === null;
  const periodo = periodoDaSemana(anterior, e.final?.data ?? e.hoje);
  const noPeriodo = (data: string) => dentro(data, anterior, periodo.fim);
  const rendimento = e.parametros.rendimento_frozen === null ? null : D(e.parametros.rendimento_frozen);
  const esperado = e.parametros.litros_por_duzia_esperado === null ? null : D(e.parametros.litros_por_duzia_esperado);
  const avisos: Aviso[] = [];

  // ---------- cana (dúzias)
  const lancs = e.lancamentos.filter((l) => noPeriodo(l.data));
  const recebimentos = lancs.filter((l) => l.tipo === 'recebimento');
  const producoes = lancs.filter((l) => l.tipo === 'producao');
  const datas = (ls: LancamentoSemana[]) => ls.map((l) => l.data).sort();
  const soma = (vs: (Num | null)[]) => vs.reduce<Prisma.Decimal>((s, v) => (v === null ? s : s.plus(D(v))), ZERO);
  const recebida = soma(recebimentos.map((l) => l.duzias));
  const inicioDz = D(e.inicial.duzias);
  const fimDz = e.final ? D(e.final.duzias) : null;
  const moida = fimDz === null ? null : inicioDz.plus(recebida).minus(fimDz);
  const comDuzias = producoes.filter((l) => l.duzias !== null);

  // ---------- caldo vendido, produto a produto (qualquer origem: planilha, XML, PDF ou cupom)
  const config = new Map(e.produtos.filter((p) => p.ativo).map((p) => [p.item_cardapio_id, p]));
  const porItem = new Map<string, { nome: string; quantidade: Prisma.Decimal }>();
  for (const v of e.vendas) {
    if (!noPeriodo(v.data)) continue;
    const it = porItem.get(v.item_cardapio_id) ?? { nome: v.nome, quantidade: ZERO };
    it.quantidade = it.quantidade.plus(D(v.quantidade));
    porItem.set(v.item_cardapio_id, it);
  }
  const porProduto: Apuracao['por_produto'] = [];
  const semMl: Apuracao['nao_entram']['sem_ml'] = [];
  const frozenSemRendimento: Apuracao['nao_entram']['frozen_sem_rendimento'] = [];
  let emCopos = ZERO;
  let emFrozen = ZERO;
  for (const [id, { nome, quantidade }] of porItem) {
    const p = config.get(id);
    if (!p) {
      if (pareceCana(nome)) semMl.push({ item_cardapio_id: id, nome, quantidade: qtd(quantidade) });
      continue;
    }
    const litros = quantidade.times(D(p.ml_por_unidade)).div(1000);
    if (p.frozen && !rendimento) {
      frozenSemRendimento.push({ item_cardapio_id: id, nome, quantidade: qtd(quantidade) });
      continue;
    }
    const litrosCaldo = p.frozen ? litros.div(rendimento!) : litros;
    if (p.frozen) emFrozen = emFrozen.plus(litrosCaldo);
    else emCopos = emCopos.plus(litrosCaldo);
    porProduto.push({
      item_cardapio_id: id,
      nome,
      quantidade: qtd(quantidade),
      ml_por_unidade: D(p.ml_por_unidade).toNumber(),
      frozen: p.frozen,
      litros: lit(litros),
      litros_caldo: lit(litrosCaldo),
    });
  }
  porProduto.sort(porNome);
  semMl.sort(porNome);
  frozenSemRendimento.sort(porNome);
  const vendido = emCopos.plus(emFrozen);

  const semCardapio = new Map<string, { vendas: number; quantidade: Prisma.Decimal }>();
  for (const v of e.vendas_sem_cardapio) {
    if (!noPeriodo(v.data) || !pareceCana(v.produto_relatorio)) continue;
    const it = semCardapio.get(v.produto_relatorio) ?? { vendas: 0, quantidade: ZERO };
    it.vendas += v.vendas;
    it.quantidade = it.quantidade.plus(D(v.quantidade));
    semCardapio.set(v.produto_relatorio, it);
  }
  const semCardapioLista = [...semCardapio]
    .map(([produto_relatorio, x]) => ({ produto_relatorio, vendas: x.vendas, quantidade: qtd(x.quantidade) }))
    .sort((a, b) => a.produto_relatorio.localeCompare(b.produto_relatorio, 'pt-BR'));

  // ---------- caldo produzido, no início e no fim; perda
  const produzido = soma(producoes.map((l) => l.litros_caldo));
  const caldoInicio = caldoNaContagem(e.inicial, rendimento);
  const caldoFim = e.final ? caldoNaContagem(e.final, rendimento) : null;
  const perda =
    e.final === null
      ? null
      : litrosNaContagem(e.inicial, rendimento).plus(produzido).minus(vendido).minus(litrosNaContagem(e.final, rendimento));

  // ---------- moagem e rendimento (sem divisão por zero: cana moída ≤ 0 = null + aviso)
  const podeDividir = moida !== null && moida.gt(0);
  const litrosPorDuzia = podeDividir ? produzido.div(moida!) : null;
  const esperadoTotal = podeDividir && esperado ? moida!.times(esperado) : null;
  const diferenca = esperadoTotal ? produzido.minus(esperadoTotal) : null;

  // ---------- avisos (a ordem é a da tela)
  if (e.vendas_importadas_ate === null || e.vendas_importadas_ate < periodo.fim)
    avisos.push({ codigo: 'vendas_incompletas', dados: { ate: e.vendas_importadas_ate, fim: periodo.fim } });
  if (config.size === 0) avisos.push({ codigo: 'nada_configurado', dados: {} });
  if (semMl.length)
    avisos.push({ codigo: 'produto_sem_ml', dados: { produtos: semMl.map(({ nome, quantidade }) => ({ nome, quantidade })) } });
  if (semCardapioLista.length)
    avisos.push({
      codigo: 'venda_sem_cardapio',
      dados: { produtos: semCardapioLista.map(({ produto_relatorio, vendas }) => ({ produto_relatorio, vendas })) },
    });
  const frozenContado = [e.inicial, e.final].reduce((s, c) => (c?.litros_frozen ? s.plus(D(c.litros_frozen)) : s), ZERO);
  if (!rendimento && (frozenSemRendimento.length || frozenContado.gt(0)))
    avisos.push({
      codigo: 'frozen_sem_rendimento',
      dados: {
        vendidos: qtd(frozenSemRendimento.reduce((s, p) => s.plus(p.quantidade), ZERO)),
        litros_frozen_contados: lit(frozenContado),
      },
    });
  if (moida !== null && moida.lt(0)) avisos.push({ codigo: 'cana_moida_negativa', dados: { duzias: duz(moida) } });
  if (moida !== null && moida.eq(0)) avisos.push({ codigo: 'cana_moida_zero', dados: {} });
  if (produzido.eq(0) && vendido.gt(0)) avisos.push({ codigo: 'producao_zero_com_venda', dados: { litros_vendidos: lit(vendido) } });

  const recDatas = datas(recebimentos);
  const prodDatas = datas(producoes);
  return {
    periodo,
    em_andamento: emAndamento,
    cana: {
      inicio: duz(inicioDz),
      recebida: { duzias: duz(recebida), lancamentos: recebimentos.length, ini: recDatas[0] ?? null, fim: recDatas.at(-1) ?? null },
      fim: fimDz === null ? null : duz(fimDz),
      moida: moida === null ? null : duz(moida),
      anotada_nas_producoes: {
        duzias: duz(soma(comDuzias.map((l) => l.duzias))),
        producoes_com: comDuzias.length,
        producoes: producoes.length,
      },
    },
    caldo: {
      produzido: { litros: lit(produzido), lancamentos: producoes.length, ini: prodDatas[0] ?? null, fim: prodDatas.at(-1) ?? null },
      vendido: { litros: lit(vendido), em_copos: lit(emCopos), em_frozen: lit(emFrozen) },
      inicio: caldoInicio,
      fim: caldoFim,
      perda: perda === null ? null : lit(perda),
    },
    moagem: {
      litros_por_duzia: litrosPorDuzia === null ? null : taxa(litrosPorDuzia),
      esperado: esperado === null ? null : esperado.toNumber(),
      diferenca_litros: diferenca === null ? null : lit(diferenca),
      diferenca_pct: diferenca === null ? null : diferenca.div(esperadoTotal!).times(100).toDecimalPlaces(2).toNumber(),
    },
    rendimento: { litros_vendidos_por_duzia: podeDividir ? taxa(vendido.div(moida!)) : null },
    por_produto: porProduto,
    nao_entram: { sem_ml: semMl, frozen_sem_rendimento: frozenSemRendimento, sem_cardapio: semCardapioLista },
    avisos,
    vendas_importadas_ate: e.vendas_importadas_ate,
  };
}
