import { describe, expect, it } from "vitest";
import { boletosDePlanilha, conciliar, type ContaRef } from "../dda";

const conta = (id: string, valor: number, vencimento: string, status = "aberta"): ContaRef => ({ id, descricao: id, fornecedor_nome: null, valor, vencimento, status });

describe("DDA", () => {
  it("CNPJ com letras mantém as letras; a linha digitável fica só com números", () => {
    const b = boletosDePlanilha([{ "beneficiário": "ACME LTDA", cnpj: "12.abc.345/01de-35", "data vencimento": "10/11/2026", "valor (r$)": "10,00", "linha digitável": "1234 5678" }]);
    expect(b[0].cnpj).toBe("12ABC34501DE35");
    expect(b[0].linha_digitavel).toBe("12345678");
  });

  it("lê planilha com cabeçalhos do banco", () => {
    const b = boletosDePlanilha([{ "beneficiário": "ACME LTDA", "data vencimento": "10/11/2026", "valor (r$)": "1.234,50", "linha digitável": "1234 5678" }]);
    expect(b[0]).toMatchObject({ beneficiario: "ACME LTDA", vencimento: "2026-11-10", valor: 1234.5, linha_digitavel: "12345678" });
  });
  it("casa por valor e vencimento até 3 dias", () => {
    const r = conciliar([{ beneficiario: "A", cnpj: null, vencimento: "2026-11-10", valor: 100, linha_digitavel: null }], [conta("c1", 100, "2026-11-13")]);
    expect(r.encontrados.map((e) => e.conta.id)).toEqual(["c1"]);
  });
  it("não casa com 4 dias de diferença nem valor diferente", () => {
    const r = conciliar([{ beneficiario: "A", cnpj: null, vencimento: "2026-11-10", valor: 100, linha_digitavel: null }], [conta("c1", 100, "2026-11-14"), conta("c2", 100.5, "2026-11-10")]);
    expect(r.encontrados).toHaveLength(0);
    expect(r.soNoDDA).toHaveLength(1);
  });
  it("conta paga não entra na conciliação", () => {
    const r = conciliar([{ beneficiario: "A", cnpj: null, vencimento: "2026-11-10", valor: 100, linha_digitavel: null }], [conta("c1", 100, "2026-11-10", "paga")]);
    expect(r.encontrados).toHaveLength(0);
  });
});
