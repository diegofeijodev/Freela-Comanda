import { describe, expect, it } from "vitest";
import { objetivoPendente } from "../objetivo";

const novo = { objetivo_manual: null, usar_manual: false, consumo_semanal_manual: null };

describe("objetivos de Valinhos", () => {
  it("gelo e embalagens sem consumo informado ficam pendentes", () => {
    expect(objetivoPendente(novo, 0)).toBe(true);
  });
  it("consumo manual zero explícito do CSV não é um valor ausente", () => {
    expect(objetivoPendente({ ...novo, usar_manual: true, consumo_semanal_manual: 0 }, 0)).toBe(false);
  });
  it("objetivo manual informado resolve a pendência", () => {
    expect(objetivoPendente({ ...novo, objetivo_manual: 12 }, 0)).toBe(false);
  });
  it("histórico de consumo permite calcular o objetivo", () => {
    expect(objetivoPendente(novo, 3)).toBe(false);
  });
});