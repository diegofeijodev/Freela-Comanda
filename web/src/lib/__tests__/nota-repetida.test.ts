import { describe, expect, it } from "vitest";
import type { NotaParecida } from "../erp-api";
import { chaveDaConsulta, enviaConfirmacao, fraseChaveIgual, fraseNotaRepetida, linhaEntrada, linhaNota, origemPorExtenso } from "../nota-repetida";

const nota = (p: Partial<NotaParecida> = {}): NotaParecida => ({
  id: "n1", numero: "4411", serie: "1", fornecedor_nome: "ATACADÃO S.A.", data_emissao: "2026-11-02", data_entrada: "2026-11-03",
  valor_total: 1234.56, origem: "foto", created_at: "2026-11-03T15:00:00.000Z", ...p,
});

describe("fraseNotaRepetida (igual à da API)", () => {
  it("com série", () => {
    expect(fraseNotaRepetida([nota()])).toBe(
      "Já existe a NF 4411 série 1 de ATACADÃO S.A., lançada em 03/11/2026 por foto, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.",
    );
  });
  it("sem série", () => {
    expect(fraseNotaRepetida([nota({ serie: null })])).toBe(
      "Já existe a NF 4411 de ATACADÃO S.A., lançada em 03/11/2026 por foto, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.",
    );
  });
  it("mais de uma", () => {
    expect(fraseNotaRepetida([nota(), nota()])).toContain("de R$ 1.234,56 (e mais 1 parecida). Se for");
    expect(fraseNotaRepetida([nota(), nota(), nota()])).toContain("(e mais 2 parecidas).");
  });
  it("origens e valor", () => {
    expect(origemPorExtenso("xml")).toBe("por XML");
    expect(origemPorExtenso("pdf")).toBe("por PDF");
    expect(origemPorExtenso("foto")).toBe("por foto");
    expect(origemPorExtenso("sefaz")).toBe("pela SEFAZ");
    expect(fraseNotaRepetida([nota({ valor_total: 890 })])).toContain("de R$ 890,00.");
  });
});

describe("textos da faixa", () => {
  it("chave igual", () => {
    expect(fraseChaveIgual(nota())).toBe("Esta nota já foi lançada. A chave de acesso é a mesma de NF 4411 (ATACADÃO S.A.), de 03/11/2026. Não dá para lançar duas vezes.");
  });
  it("linha da nota, com e sem série", () => {
    expect(linhaNota(nota())).toBe("NF 4411 · série 1 · R$ 1.234,56");
    expect(linhaNota(nota({ serie: null }))).toBe("NF 4411 · R$ 1.234,56");
  });
  it("linha da entrada", () => {
    expect(linhaEntrada(nota())).toBe("Entrou em 03/11/2026 por foto");
  });
});

describe("chaveDaConsulta", () => {
  it("normaliza os três campos", () => {
    expect(chaveDaConsulta("12.abc.345/01de-35", "000.004.411", "001")).toBe(chaveDaConsulta("12ABC34501DE35", "4411", "1"));
  });
  it("série diferente dá chave diferente", () => {
    expect(chaveDaConsulta("12ABC34501DE35", "4411", "2")).not.toBe(chaveDaConsulta("12ABC34501DE35", "4411", "1"));
  });
  it("sem CNPJ ou sem número não há consulta", () => {
    expect(chaveDaConsulta(null, "1", "1")).toBeNull();
    expect(chaveDaConsulta("12ABC34501DE35", "", "1")).toBeNull();
    expect(chaveDaConsulta("12ABC34501DE35", "s/n", "1")).toBeNull();
  });
  it("série vazia ou nula vale igual", () => {
    expect(chaveDaConsulta("12ABC34501DE35", "4411", null)).toBe(chaveDaConsulta("12ABC34501DE35", "4411", ""));
  });
});

describe("enviaConfirmacao", () => {
  const conf = chaveDaConsulta("12ABC34501DE35", "4411", "1");
  it("confirmou e não mudou: envia", () => {
    expect(enviaConfirmacao(conf, "12.abc.345/01de-35", "0004411", "001")).toBe(true);
  });
  it("confirmou e mudou série, número ou CNPJ: não envia", () => {
    expect(enviaConfirmacao(conf, "12ABC34501DE35", "4411", "2")).toBe(false);
    expect(enviaConfirmacao(conf, "12ABC34501DE35", "4412", "1")).toBe(false);
    expect(enviaConfirmacao(conf, "99ABC34501DE35", "4411", "1")).toBe(false);
  });
  it("nunca confirmou: não envia", () => {
    expect(enviaConfirmacao(null, "12ABC34501DE35", "4411", "1")).toBe(false);
  });
});
