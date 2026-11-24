import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { decodificarTexto, lerTabelaDeBuffer, parseCSV, parseLinhasCSV, separadorDoTexto } from "../parse";
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

// ---------- Importar vendas (desenho 24/11, A.5): separador pelo cabeçalho, windows-1252 e o valor tipado do Excel

describe("planilha de outro sistema", () => {
  it("separador detectado pelo cabeçalho: ponto e vírgula, vírgula ou tabulação (fora de aspas)", () => {
    expect(separadorDoTexto("pedido;data;produto\n1;2;3")).toBe(";");
    expect(separadorDoTexto('"Nº, venda",Data,Descrição\n1,2,3')).toBe(",");
    expect(separadorDoTexto("a\tb\tc\n")).toBe("\t");
    expect(separadorDoTexto("sozinha\n1")).toBe(";");
  });
  it("linhas cruas com aspas, vírgula dentro de aspas e linha vazia", () => {
    expect(parseLinhasCSV('a,b\n"1,5","x ""y"""\n\n3,4', ",")).toEqual([["a", "b"], ["1,5", 'x "y"'], ["3", "4"]]);
  });
  it("texto em windows-1252 (PDV brasileiro) é lido de novo sem o caractere trocado", () => {
    const latin1 = new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]); // "Descrição" em windows-1252
    expect(decodificarTexto(latin1.buffer)).toBe("Descrição");
    expect(decodificarTexto(new TextEncoder().encode("Descrição").buffer as ArrayBuffer)).toBe("Descrição");
  });
  it("o BOM do UTF-8 sai", () => {
    expect(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]).buffer)).toBe("a");
  });
  it("CSV pelo leitor de tabela: cabeçalho como veio (sem minúsculas) e células em texto", async () => {
    const t = await lerTabelaDeBuffer("v.csv", new TextEncoder().encode("Nº;Data;Total\n1001;20/11/2026;1.234,56\n").buffer as ArrayBuffer);
    expect(t).toEqual([["Nº", "Data", "Total"], ["1001", "20/11/2026", "1.234,56"]]);
  });
  it("Excel: data e número vêm TIPADOS (o texto formatado da célula seria m/d/yy e 1,234.56)", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Data", "Total"], [new Date(2026, 10, 20, 19, 30), 1234.56]], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendas");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const formatado = XLSX.utils.sheet_to_json<string[]>(XLSX.read(buf).Sheets.Vendas!, { header: 1, raw: false });
    expect(formatado[1]).not.toEqual(["20/11/2026 19:30", "1234,56"]); // por isso o leitor novo não usa raw:false
    const t = await lerTabelaDeBuffer("v.xlsx", buf);
    expect(t[0]).toEqual(["Data", "Total"]);
    const [d, v] = t[1]!;
    expect(d instanceof Date && [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 20, 19, 30]);
    expect(v).toBe(1234.56);
  });
});
