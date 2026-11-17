import { describe, expect, it } from "vitest";
import { chaveValida, cnpjValido, cpfValido, documentoConfere, normalizarChave, normalizarCnpj, normalizarNumeroSerie } from "../fiscal";

const VETOR = "35261112ABC34501DE35550010000044111000044116";

describe("cnpj", () => {
  it("normaliza: maiúsculas e só [0-9A-Z]", () => {
    expect(normalizarCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });
  it.each(["12345678000195", "12345678000276", "99888777000100", "12ABC34501DE35", "44527294000180"])("%s é válido", (c) => {
    expect(cnpjValido(c)).toBe(true);
  });
  it.each(["12345678000194", "00000000000000", "1234567800019", "12345678000195X", ""])("%s é inválido", (c) => {
    expect(cnpjValido(c)).toBe(false);
  });
});

describe("chave de acesso", () => {
  it("normaliza", () => {
    expect(normalizarChave("35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16")).toBe(VETOR);
  });
  it("aceita DV certo e recusa o resto", () => {
    expect(chaveValida(VETOR)).toBe(true);
    expect(chaveValida("35261012345678000199550010000070011000070019")).toBe(true);
    expect(chaveValida("35261112ABC34501DE35550010000044111000044117")).toBe(false);
    expect(chaveValida("35261112ABC34501DE35550010000A44111000044116")).toBe(false);
    expect(chaveValida(VETOR.slice(0, 43))).toBe(false);
    expect(chaveValida("")).toBe(false);
    expect(chaveValida(VETOR.toLowerCase())).toBe(false);
  });
});

describe("normalizarNumeroSerie", () => {
  it.each([["000.004.411", "4411"], ["001", "1"], ["000", "0"], ["A1", "1"], ["", ""], [null, ""], [undefined, ""]])("%s → %s", (e, s) => {
    expect(normalizarNumeroSerie(e)).toBe(s);
  });
});

describe("cpf e documento", () => {
  it("cpfValido", () => {
    expect(cpfValido("12345678909")).toBe(true);
    expect(cpfValido("12345678900")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });
  it("documentoConfere", () => {
    expect(documentoConfere("12345678000199")).toBe(false);
    expect(documentoConfere("12ABC34501DE35")).toBe(true);
    expect(documentoConfere("12.abc.345/01de-35")).toBe(true);
    expect(documentoConfere(null)).toBe(true);
    expect(documentoConfere("")).toBe(true);
    expect(documentoConfere("12345678909")).toBe(true);
    expect(documentoConfere("123")).toBe(false);
  });
});
