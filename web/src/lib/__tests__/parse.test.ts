import { describe, expect, it } from "vitest";
import { parseCSV } from "../parse";
import { parseNum } from "../format";

describe("importação CSV", () => {
  it("separa por ponto e vírgula", () => {
    const r = parseCSV("codigo;nome\nI001;Picanha\n");
    expect(r[0].nome).toBe("Picanha");
  });
  it("lê decimal com vírgula", () => {
    expect(parseNum("41,9")).toBe(41.9);
    expect(parseNum("1.234,56")).toBe(1234.56);
  });
  it("preço vazio vira nulo (a cotar)", () => {
    expect(parseNum("")).toBeNull();
  });
});
