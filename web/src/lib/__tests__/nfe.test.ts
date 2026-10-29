// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formaDoTPag, parseNFeXML, sugerirInsumo } from "../nfe";

const XML = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261012345678000199550010000012341000012345">
<ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000199</CNPJ><xNome>FRIGORIFICO SA</xNome></emit>
<det nItem="1"><prod><cProd>P01</cProd><xProd>PICANHA BOVINA KG</xProd><uCom>kg</uCom><qCom>10.5000</qCom><vUnCom>65.90</vUnCom><vProd>691.95</vProd></prod></det>
<total><ICMSTot><vNF>691.95</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-20</dVenc><vDup>345.98</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-20</dVenc><vDup>345.97</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>691.95</vPag></detPag></pag></infNFe></NFe></nfeProc>`;

describe("leitura do XML da nota", () => {
  const n = parseNFeXML(XML);
  it("lê quantidade e preço de compra", () => {
    expect(n.itens[0].quantidade).toBe(10.5);
    expect(n.itens[0].valor_unitario).toBe(65.9);
  });
  it("boleto gera parcelas com vencimento", () => {
    expect(n.forma_pagamento).toBe("boleto");
    expect(n.parcelas.map((p) => p.vencimento)).toEqual(["2026-11-20", "2026-12-20"]);
  });
  it("lê chave e fornecedor", () => {
    expect(n.chave).toBe("35261012345678000199550010000012341000012345");
    expect(n.emitente_cnpj).toBe("12345678000199");
  });
  it("PIX é reconhecido", () => expect(formaDoTPag("17", false)).toBe("pix"));
  it("sugere insumo pelo nome", () => {
    expect(sugerirInsumo("PICANHA BOVINA KG", [{ id: "1", nome: "Picanha" }, { id: "2", nome: "Alcatra" }])?.id).toBe("1");
  });
});
