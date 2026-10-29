import { describe, expect, it } from "vitest";
import { montarDRE, type SubDRE } from "../dre";

const sub = (nome: string, ordem: number, extra: Partial<SubDRE> = {}): SubDRE => ({ id: nome, nome, sigla: nome, meta_pct: null, ordem, is_cmv: false, is_imposto: false, ...extra });
const subs = [sub("CMV", 1, { is_cmv: true }), sub("DESPESAS ADMINISTRATIVAS", 2), sub("IMPOSTOS", 3, { is_imposto: true })];
const planos = [{ id: "carne", subgrupo: "CMV", conta: "COMPRA DE CARNES" }, { id: "aluguel", subgrupo: "DESPESAS ADMINISTRATIVAS", conta: "ALUGUEL" }, { id: "das", subgrupo: "IMPOSTOS", conta: "SIMPLES NACIONAL" }];

describe("DRE", () => {
  const d = montarDRE(
    [{ dinheiro: 1000, pix: 500, ifood: 500, sangria: 200, sangria_cofre: 150 }],
    [{ plano_conta_id: "carne", valor: 600 }, { plano_conta_id: "aluguel", valor: 300 }, { plano_conta_id: "das", valor: 100 }, { plano_conta_id: null, valor: 50 }],
    planos, subs,
  );
  it("soma entradas, deduz sangria e mostra cofre", () => {
    expect(d.faturamento).toBe(2000);
    expect(d.subtotal).toBe(1800);
    expect(d.cofre).toBe(150);
  });
  it("lucro bruto = faturamento - CMV", () => expect(d.lucroBruto).toBe(1400));
  it("antes dos impostos desconta despesas e as sem classe", () => expect(d.antesImpostos).toBe(1050));
  it("líquido desconta impostos", () => { expect(d.liquido).toBe(950); expect(d.liquidoPct).toBeCloseTo(47.5); });
});
