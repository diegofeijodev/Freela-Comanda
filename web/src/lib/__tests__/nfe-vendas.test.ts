// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerXmlVenda, MOTIVO_XML } from "../nfe-vendas";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");
const LOJA = "12345678000195";

/** Chave fictícia com DV certo. */
function chave(cnpj: string, modelo: string, numero: number) {
  const base = `352611${cnpj}${modelo}001${String(numero).padStart(9, "0")}112345678`;
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += (base.charCodeAt(i) - 48) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + String(r < 2 ? 0 : 11 - r);
}
function nfeProc(o: { modelo?: string; cnpj?: string; numero?: number; tpAmb?: string; cStat?: string | null; tpNF?: string; finNFe?: string; itens?: string } = {}) {
  const { modelo = "65", cnpj = LOJA, numero = 50, tpAmb = "1", cStat = "100", tpNF = "1", finNFe = "1" } = o;
  const c = chave(cnpj, modelo, numero);
  const itens = o.itens ?? `<det nItem="1"><prod><xProd>CALDO   300ML</xProd><CFOP>5102</CFOP><qCom>2.0000</qCom><vUnCom>8.00</vUnCom><vProd>16.00</vProd><vDesc>1.00</vDesc></prod></det>`;
  const prot = cStat === null ? "" : `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><chNFe>${c}</chNFe><cStat>${cStat}</cStat></infProt></protNFe>`;
  return `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${c}" versao="4.00"><ide><mod>${modelo}</mod><serie>1</serie><nNF>${numero}</nNF><dhEmi>2026-11-20T20:15:00-03:00</dhEmi><tpNF>${tpNF}</tpNF><tpAmb>${tpAmb}</tpAmb><finNFe>${finNFe}</finNFe></ide><emit><CNPJ>${cnpj}</CNPJ></emit>${itens}<total><ICMSTot><vNF>15.00</vNF></ICMSTot></total></infNFe></NFe>${prot}</nfeProc>`;
}

describe("XML de venda lido no navegador (tabela de A.4, linha a linha)", () => {
  it("NFC-e 65 autorizada da loja → documento com o resumo (valores em texto com ponto)", () => {
    const r = lerXmlVenda("a.xml", nfeProc());
    expect(r).toEqual({
      tipo: "documento",
      documento: {
        arquivo: "a.xml", chave: chave(LOJA, "65", 50), modelo: 65, serie: 1, numero: 50, emitente_cnpj: LOJA, tp_amb: 1,
        dh_emi: "2026-11-20T20:15:00-03:00", valor_total: "15.00",
        itens: [{ produto: "CALDO 300ML", quantidade: "2.0000", valor_unitario: "8.00", valor_bruto: "16.00", desconto: "1.00", outros: "0", frete: "0", seguro: "0", cfop: "5102" }],
      },
    });
  });
  it("vOutro, vFrete e vSeg vão no item (o servidor confere a soma × vNF)", () => {
    const itens = `<det nItem="1"><prod><xProd>CALDO</xProd><CFOP>5102</CFOP><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd><vFrete>2.00</vFrete><vSeg>0.50</vSeg><vOutro>1.00</vOutro></prod></det>`;
    const r = lerXmlVenda("a.xml", nfeProc({ itens }));
    expect(r.tipo === "documento" && r.documento.itens[0]).toMatchObject({ outros: "1.00", frete: "2.00", seguro: "0.50" });
  });
  it("a NFC-e fictícia do cupom do Comanda (homologação) → documento com tp_amb 2 (o servidor ignora com o motivo)", () => {
    const r = lerXmlVenda("nfce.xml", fx("nfce-65-homologacao.xml"));
    expect(r.tipo).toBe("documento");
    if (r.tipo !== "documento") return;
    expect([r.documento.tp_amb, r.documento.chave, r.documento.itens.length, r.documento.valor_total]).toEqual([2, "35261112345678000195650010000000121402133776", 2, "32.00"]);
    expect(r.documento.itens[1]!.produto).toBe('Chopp & "Lager" <300> ml');
  });
  it("NF-e 55 → documento (a prévia a mostra desmarcada, com os CFOPs); de outro CNPJ o servidor ignora", () => {
    const r = lerXmlVenda("nfe.xml", fx("nfe-55-de-fornecedor.xml"));
    expect(r.tipo === "documento" && [r.documento.modelo, r.documento.emitente_cnpj]).toEqual([55, "11222333000181"]);
  });
  it("procEventoNFe 110111 com retEvento 135 → cancelamento da chave, com a data do evento", () => {
    expect(lerXmlVenda("c.xml", fx("proc-evento-110111.xml"))).toEqual({
      tipo: "cancelamento",
      cancelamento: { arquivo: "c.xml", chave: "35261111222333000181550010000001201000000120", dh_evento: "2026-11-16T10:00:00-03:00" },
    });
  });
  it("evento sem registro, carta de correção e outro evento → ignorado com motivo", () => {
    const ev = fx("proc-evento-110111.xml");
    expect(lerXmlVenda("x.xml", ev.replace("<cStat>135</cStat>", "<cStat>573</cStat>"))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.cancelamentoSemRegistro } });
    expect(lerXmlVenda("x.xml", ev.replaceAll("110111", "110110"))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.cartaCorrecao } });
    expect(lerXmlVenda("x.xml", ev.replaceAll("110111", "210200"))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.outroEvento } });
  });
  it("sem protocolo, denegada, cancelada no protocolo, entrada, devolução", () => {
    expect(lerXmlVenda("x", nfeProc({ cStat: null }))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.semAutorizacao } });
    expect(lerXmlVenda("x", nfeProc({ cStat: "302" }))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.denegado } });
    expect(lerXmlVenda("x", nfeProc({ cStat: "101" }))).toEqual({ tipo: "cancelamento", cancelamento: { arquivo: "x", chave: chave(LOJA, "65", 50), dh_evento: null } });
    expect(lerXmlVenda("x", nfeProc({ tpNF: "0" }))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.entrada } });
    expect(lerXmlVenda("x", nfeProc({ finNFe: "4" }))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.devolucao } });
  });
  it("inutilização, XML inválido, outro tipo de XML e chave com DV errado", () => {
    expect(lerXmlVenda("i.xml", '<procInutNFe xmlns="http://www.portalfiscal.inf.br/nfe"><inutNFe/></procInutNFe>')).toMatchObject({ ignorado: { motivo: MOTIVO_XML.inutilizacao } });
    expect(lerXmlVenda("q.xml", "<nfeProc><NFe>")).toMatchObject({ ignorado: { arquivo: "q.xml", motivo: MOTIVO_XML.ilegivel } });
    expect(lerXmlVenda("o.xml", "<resNFe><chNFe>1</chNFe></resNFe>")).toMatchObject({ ignorado: { motivo: MOTIVO_XML.outroTipo } });
    const c = chave(LOJA, "65", 50);
    const torta = c.slice(0, 43) + String((Number(c[43]) + 1) % 10);
    expect(lerXmlVenda("d.xml", nfeProc().replaceAll(c, torta))).toMatchObject({ ignorado: { motivo: MOTIVO_XML.chaveInvalida } });
  });
  it("item sem valor → ignorado (nunca um 0 inventado)", () => {
    expect(lerXmlVenda("x", nfeProc({ itens: "<det><prod><xProd>X</xProd><qCom>1</qCom></prod></det>" }))).toMatchObject({ tipo: "ignorado" });
  });
});
