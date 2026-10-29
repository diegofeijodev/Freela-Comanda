import { describe, expect, it } from "vitest";
import { calcFicha } from "../ficha";

const cfg = { custo_preparo_pct: 10, margem_seguranca_pct: 10, mkup_padrao: 3.1 };

describe("calcFicha", () => {
  it("custo de preparo é 10% sobre ingredientes", () => {
    expect(calcFicha(10, cfg, null, null).preparo).toBeCloseTo(1);
  });
  it("custo total = ingredientes + preparo", () => {
    expect(calcFicha(10, cfg, null, null).total).toBeCloseTo(11);
  });
  it("margem de segurança multiplica o total por 1,10", () => {
    expect(calcFicha(10, cfg, null, null).comMargem).toBeCloseTo(12.1);
  });
  it("preço sugerido usa Mkup padrão 3,10", () => {
    expect(calcFicha(10, cfg, null, null).sugerido).toBeCloseTo(37.51);
  });
  it("Mkup da ficha substitui o padrão", () => {
    expect(calcFicha(10, cfg, 2, null).sugerido).toBeCloseTo(24.2);
  });
  it("lucro = praticado − custo com margem", () => {
    expect(calcFicha(10, cfg, null, 40).lucro).toBeCloseTo(27.9);
  });
  it("CMV % = custo total ÷ praticado", () => {
    expect(calcFicha(10, cfg, null, 44).cmvPct).toBeCloseTo(25);
  });
  it("selo abaixo do sugerido quando praticado < sugerido", () => {
    expect(calcFicha(10, cfg, null, 30).ok).toBe(false);
    expect(calcFicha(10, cfg, null, 40).ok).toBe(true);
  });
});
