export const ENTRADAS = [
  ["dinheiro", "Dinheiro"], ["debito", "Débito"], ["credito", "Crédito"], ["pix", "PIX"],
  ["ifood", "iFood"], ["delivery_proprio", "Delivery próprio"], ["cartao_alimentacao", "Cartão alimentação"],
] as const;
export type CampoEntrada = (typeof ENTRADAS)[number][0];
export type Caixa = Record<CampoEntrada | "sangria" | "sangria_cofre", number>;
export type SubDRE = { id: string; nome: string; sigla: string; meta_pct: number | null; ordem: number; is_cmv: boolean; is_imposto: boolean };
export type PlanoDRE = { id: string; subgrupo: string; conta: string };
export type Pago = { plano_conta_id: string | null; valor: number };

export type LinhaSub = { sub: SubDRE; total: number; pct: number | null; contas: { conta: string; total: number }[] };
export type DRE = {
  entradas: { campo: CampoEntrada; rotulo: string; valor: number }[];
  faturamento: number; sangria: number; subtotal: number; cofre: number;
  subgrupos: LinhaSub[]; semClasse: number;
  cmv: number; despesas: number; impostos: number;
  lucroBruto: number; antesImpostos: number; liquido: number; liquidoPct: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Monta o DRE: faturamento = soma das entradas do caixa; despesas = contas pagas no período por classe.
 *  Os resultados partem do faturamento bruto (as despesas pagas com sangria já vêm do contas a pagar). */
export function montarDRE(caixas: Partial<Caixa>[], pagos: Pago[], planos: PlanoDRE[], subs: SubDRE[]): DRE {
  const soma = (k: keyof Caixa) => r2(caixas.reduce((s, c) => s + Number(c[k] ?? 0), 0));
  const entradas = ENTRADAS.map(([campo, rotulo]) => ({ campo, rotulo, valor: soma(campo) }));
  const faturamento = r2(entradas.reduce((s, e) => s + e.valor, 0));
  const sangria = soma("sangria"), cofre = soma("sangria_cofre");
  const planoPorId = new Map(planos.map((p) => [p.id, p]));
  const porConta = new Map<string, number>();
  let semClasse = 0;
  for (const p of pagos) {
    const pl = p.plano_conta_id ? planoPorId.get(p.plano_conta_id) : undefined;
    if (!pl || !subs.some((s) => s.nome === pl.subgrupo)) { semClasse += Number(p.valor); continue; }
    porConta.set(pl.id, (porConta.get(pl.id) ?? 0) + Number(p.valor));
  }
  const pctF = (v: number) => (faturamento ? (v / faturamento) * 100 : null);
  const subgrupos = [...subs].sort((a, b) => a.ordem - b.ordem).map((sub) => {
    const contas = planos.filter((p) => p.subgrupo === sub.nome).map((p) => ({ conta: p.conta, total: r2(porConta.get(p.id) ?? 0) }));
    const total = r2(contas.reduce((s, c) => s + c.total, 0));
    return { sub, total, pct: pctF(total), contas };
  });
  const cmv = r2(subgrupos.filter((l) => l.sub.is_cmv).reduce((s, l) => s + l.total, 0));
  const impostos = r2(subgrupos.filter((l) => l.sub.is_imposto).reduce((s, l) => s + l.total, 0));
  const despesas = r2(subgrupos.filter((l) => !l.sub.is_cmv && !l.sub.is_imposto).reduce((s, l) => s + l.total, 0) + semClasse);
  const lucroBruto = r2(faturamento - cmv);
  const antesImpostos = r2(lucroBruto - despesas);
  const liquido = r2(antesImpostos - impostos);
  return { entradas, faturamento, sangria, subtotal: r2(faturamento - sangria), cofre, subgrupos, semClasse: r2(semClasse), cmv, despesas, impostos, lucroBruto, antesImpostos, liquido, liquidoPct: pctF(liquido) };
}
