import { describe, expect, it } from "vitest";
import {
  acharCabecalho, botaoImportar, celulaTexto, colunasDoCabecalho, contaCuponsNovos, contaTotal, contaVendasNovas, deduzirSeparador,
  exemplosDaColuna, linhasParaEnvio, numeroDigitado, problemaDaLinha, somaPdf, sugerirMapeamento, textoCancelamentosDoComanda,
  textoCancelamentoSemVendaXml, textoJaExistentes, textoOutraEmpresa, textoSobreposicao,
} from "../importar-vendas";
import type { PreviaVendas } from "../erp-api";

describe("sugestão de colunas (sinônimos sem acento e sem caixa)", () => {
  it("cabeçalho típico de PDV", () => {
    expect(sugerirMapeamento(["Nº Venda", "Data/Hora", "Descrição", "Qtde", "Vl. Unit.", "Vl. Total", "Desconto", "Taxa de entrega"])).toEqual({
      pedido: "Nº Venda", data: "Data/Hora", produto: "Descrição", quantidade: "Qtde", preco_unitario: "Vl. Unit.", valor_total: "Vl. Total",
      desconto: "Desconto", frete: "Taxa de entrega",
    });
  });
  it("valor total × preço unitário × taxa de serviço; cada coluna usada uma vez só", () => {
    expect(sugerirMapeamento(["Comanda", "Data", "Item", "Quantidade", "Preço", "Valor", "Serviço"])).toEqual({
      pedido: "Comanda", data: "Data", produto: "Item", quantidade: "Quantidade", preco_unitario: "Preço", valor_total: "Valor", taxa: "Serviço",
    });
  });
  it("a planilha padrão do Comanda", () => {
    expect(sugerirMapeamento(["pedido", "data", "hora", "produto_relatorio", "item_cardapio", "preco_unitario", "quantidade", "desconto", "taxa", "frete", "valor_total"])).toMatchObject({
      pedido: "pedido", data: "data", hora: "hora", produto: "produto_relatorio", quantidade: "quantidade", valor_total: "valor_total",
    });
  });
  it("nada parecido = nada sugerido", () => {
    expect(sugerirMapeamento(["A", "B", "C"])).toEqual({});
  });
});

describe("cabeçalho fora da 1ª linha (ponto 7.9 da UX)", () => {
  it("acha a 1ª linha (entre as 10 primeiras) com 3 nomes conhecidos", () => {
    const t = [["Relatório de vendas — Loja X"], ["01/11 a 23/11"], [], ["Data", "Produto", "Qtd", "Total"], ["20/11/2026", "Caldo", "1", "10"]];
    expect(acharCabecalho(t)).toBe(3);
    expect(acharCabecalho([["x", "y"], ["1", "2"]])).toBe(0);
  });
  it("nomes de coluna: vazio vira 'Coluna N' e repetido ganha (2)", () => {
    expect(colunasDoCabecalho(["Data", "", "Total", "Total"])).toEqual(["Data", "Coluna 2", "Total", "Total (2)"]);
  });
});

describe("células para o servidor", () => {
  it("número tipado do Excel com o separador escolhido; data tipada em aaaa-mm-dd (com a hora se houver)", () => {
    expect(celulaTexto(1234.5, "virgula")).toBe("1234,5");
    expect(celulaTexto(1234.5, "ponto")).toBe("1234.5");
    expect(celulaTexto(new Date(2026, 10, 20), "virgula")).toBe("2026-11-20");
    expect(celulaTexto(new Date(2026, 10, 20, 9, 5, 7), "virgula")).toBe("2026-11-20 09:05:07");
    expect(celulaTexto("  Caldo ", "virgula")).toBe("  Caldo ");
  });
  it("linhas a partir do cabeçalho achado, sem as linhas vazias, com o nº da linha do arquivo", () => {
    const t = [["Relatório"], ["Data", "Produto", "Total"], ["20/11/2026", "Caldo", 10.5], [], ["21/11/2026", "Pastel", 8]];
    const r = linhasParaEnvio(t, 1, "virgula");
    expect(r.colunas).toEqual(["Data", "Produto", "Total"]);
    expect(r.linhas).toEqual([{ Data: "20/11/2026", Produto: "Caldo", Total: "10,5" }, { Data: "21/11/2026", Produto: "Pastel", Total: "8" }]);
    expect(r.primeiraLinha).toBe(3);
  });
  it("planilha padrão: colunas em minúsculas (como a tela Importar Dados)", () => {
    expect(linhasParaEnvio([["Pedido", "DATA"], ["1", "2026-11-20"]], 0, "virgula", true).linhas).toEqual([{ pedido: "1", data: "2026-11-20" }]);
  });
  it("3 exemplos não vazios da coluna", () => {
    expect(exemplosDaColuna([{ a: "" }, { a: "x" }, { a: "y" }, { a: "z" }, { a: "w" }], "a")).toEqual(["x", "y", "z"]);
  });
  it("vírgula ou ponto deduzido dos valores do arquivo", () => {
    expect(deduzirSeparador(["12,90", "1.250,00"])).toBe("virgula");
    expect(deduzirSeparador(["12.90", "1,250.00"])).toBe("ponto");
    expect(deduzirSeparador(["12", "abc"])).toBe("virgula");
  });
});


const previa = (extra: Partial<PreviaVendas> = {}): PreviaVendas => ({
  periodo: { ini: "2026-11-01", fim: "2026-11-23", dias: 23 },
  linhas: { lidas: 2540, validas: 2453, com_problema: 87, ja_existentes: 120, somadas_no_arquivo: 32, novas: 2301 },
  valor_centavos: 1234560, ja_existentes_valor_centavos: 64000, pedidos: 1120, itens: 3402, problemas: [], motivos: [], amostra: [],
  produtos_sem_de_para: [], ja_existentes_mesma_fonte: 100,
  ja_existentes_de_outra_fonte: [{ fonte: "PDV Centro", tipo: "sistema", linhas: 20, exemplo: { pedido: "1001", data: "2026-11-20" } }],
  ja_existentes_pedido_dia: 0, sobreposicao: [], substituir: null, arquivo_ja_importado: null, ...extra,
});

describe("frases da prévia (cada número com a conta)", () => {
  it("vendas novas e total, com o número por extenso da UX", () => {
    expect(contaVendasNovas(previa().linhas)).toBe(
      "= 2.540 linhas lidas − 120 que já estão no Comanda − 87 com problema − 32 somadas a outra linha igual do arquivo");
    expect(contaVendasNovas({ lidas: 3, validas: 3, com_problema: 0, ja_existentes: 0, somadas_no_arquivo: 0, novas: 3 })).toBe("= 3 linhas lidas");
    expect(contaTotal(previa()).replace(/ /g, " ")).toBe(
      "= soma do valor das 2.301 linhas novas. As 120 que já existiam (R$ 640,00) não entram. Confira com o total do relatório do seu sistema para o mesmo período.");
  });
  it("sobreposição e já existentes de outro sistema (com o exemplo)", () => {
    const p = previa({ sobreposicao: [{ fonte: "Planilha padrão do Comanda", tipo: "padrao", vendas: 1230, valor_centavos: 3450000 }] });
    expect(textoSobreposicao(p).replace(/ /g, " ")).toBe(
      "De 01/11 a 23/11 já há vendas vindas de outro lugar: Planilha padrão do Comanda: 1.230 vendas, R$ 34.500,00. Se for o mesmo caixa, estas vendas vão entrar duas vezes (no faturamento, no estoque e na cana).");
    expect(textoJaExistentes(p, "PDV Valinhos")).toEqual({
      titulo: "120 linhas já estão no Comanda e não entram.",
      texto: "100 deste mesmo sistema (importadas antes) e 20 vindas de PDV Centro. Exemplo: o pedido 1001 de 20/11 já existe vindo de PDV Centro. Se forem vendas diferentes, defina letras antes do pedido para PDV Valinhos.",
    });
  });
  it("o botão diz o que vai acontecer", () => {
    const o = { modo: "acrescentar" as const, sobreposicaoMarcada: false, atualizando: false };
    expect(botaoImportar(previa(), o)).toMatchObject({ rotulo: "Importar 2.301 vendas", acao: "importar" });
    expect(botaoImportar(previa({ sobreposicao: [{ fonte: "x", tipo: "cupom", vendas: 1, valor_centavos: 1 }] }), o)).toMatchObject({ rotulo: "Marque a caixa do aviso", acao: "nada" });
    expect(botaoImportar(previa({ substituir: { vendas: 1980, valor_centavos: 1, ini: "2026-11-01", fim: "2026-11-23", bloqueado: false } }), { ...o, modo: "substituir" })).toMatchObject({
      rotulo: "Substituir 1.980 vendas e importar 2.301", destrutivo: true, acao: "dialogo" });
    // revisão de 24/11: com linha com problema, o Substituir não roda (a venda da linha ruim sairia e não voltaria)
    expect(botaoImportar(previa({ substituir: { vendas: 1980, valor_centavos: 1, ini: "2026-11-01", fim: "2026-11-23", bloqueado: true } }), { ...o, modo: "substituir" })).toEqual({
      rotulo: "Substituir não roda com linhas com problema", destrutivo: false, acao: "nada",
      falta: "Corrija as 87 linhas com problema (ou as colunas) ou escolha “Só acrescentar as novas”." });
    expect(botaoImportar(previa({ linhas: { ...previa().linhas, novas: 0 } }), o).acao).toBe("nada");
  });
  it("XML só com cancelamentos (P18): o botão tira os cancelados", () => {
    const documentos = { ...docs(), arquivos_lidos: 2, arquivos_cancelamento: 2,
      cancelamentos_de_importados: { documentos: 2, linhas: 3, valor_centavos: 8750, ini: "2026-11-05", fim: "2026-11-12" } };
    const p = previa({ linhas: { ...previa().linhas, novas: 0 }, documentos });
    expect(botaoImportar(p, { modo: "acrescentar", sobreposicaoMarcada: false, atualizando: false })).toMatchObject({ rotulo: "Tirar 2 cupons cancelados", acao: "importar" });
  });
});


/** O grupo `documentos` da prévia de XML, zerado. */
const docs = (): NonNullable<PreviaVendas["documentos"]> => ({
  arquivos_lidos: 0, vendas_novas: 0, ja_importados: 0, ja_cancelados: 0, do_proprio_comanda: 0,
  cancelamentos_do_comanda: { arquivos: 0, ainda_autorizados: 0 }, cancelados_no_envio: 0, repetidos_no_envio: 0, arquivos_cancelamento: 0,
  nfe_fora: [], outros_cnpjs: [], ignorados: [], com_problema: [],
  cancelamentos_de_importados: { documentos: 0, linhas: 0, valor_centavos: 0, ini: null, fim: null },
  cancelamentos_sem_venda_xml: { documentos: 0, ini: null, fim: null, fontes: [] },
});
const semNbsp = (s: string) => s.replace(/\u00a0/g, " ");

describe("XML: a conta dos arquivos e os avisos de cancelamento (revisão de 24/11)", () => {
  it("a conta dos cupons novos tira cada grupo, inclusive os com problema e os cancelamentos do Comanda", () => {
    const d = {
      ...docs(), arquivos_lidos: 20, vendas_novas: 10, ja_importados: 2, cancelamentos_do_comanda: { arquivos: 1, ainda_autorizados: 0 },
      arquivos_cancelamento: 2, com_problema: [{ arquivo: "a.xml", motivo: "x" }, { arquivo: "b.xml", motivo: "y" }],
      ignorados: [{ motivo: "inutilização de numeração", arquivos: ["i.xml"] }],
      outros_cnpjs: [{ cnpj: "98765432000110", nome_em_empresas: "Cana Express", documentos: 1, cancelamentos: 1, incluido: false }],
    };
    expect(contaCuponsNovos(d)).toBe(
      "= 20 arquivos lidos − 2 já importados antes − 1 cancelamento de cupom do próprio Comanda (não aplicado) − 2 arquivos de cancelamento − 1 ignorado − 2 com problema (a soma dos itens não bate com o total) − 2 de outra empresa, fora da importação");
  });
  it("outra empresa sua: cupons, só cancelamentos, ou os dois (CNPJ formatado)", () => {
    const o = { cnpj: "98765432000110", nome_em_empresas: "Cana Express Ltda", documentos: 8, cancelamentos: 0, incluido: false };
    expect(textoOutraEmpresa(o)).toEqual({
      texto: "8 cupons foram emitidos por Cana Express Ltda (98.765.432/0001-10), cadastrada em Empresas. Eles só entram se forem vendas desta loja.",
      rotulo: "Incluir os 8 cupons de Cana Express Ltda",
    });
    expect(textoOutraEmpresa({ ...o, documentos: 0, cancelamentos: 2 })).toEqual({
      texto: "Chegou o cancelamento de 2 cupons de Cana Express Ltda (98.765.432/0001-10), cadastrada em Empresas, que nunca entraram aqui. Se eram vendas desta loja, inclua para o cancelamento ficar registrado (o cupom que chegar depois não entra).",
      rotulo: "Incluir os 2 cancelamentos de Cana Express Ltda",
    });
    expect(textoOutraEmpresa({ ...o, documentos: 1, cancelamentos: 1 }).rotulo).toBe("Incluir 1 cupom e 1 cancelamento de Cana Express Ltda");
  });
  it("cancelamento de cupom do próprio Comanda: não aplicado, e quantos o Comanda ainda tem como autorizados", () => {
    expect(textoCancelamentosDoComanda({ arquivos: 2, ainda_autorizados: 1 })).toBe(
      "2 arquivos de cancelamento são de cupons emitidos aqui no Comanda: o Comanda não cancela cupom dele por arquivo. 1 desses cupons continua autorizado aqui: se ele foi cancelado de verdade, confira em Cupom fiscal.");
    expect(textoCancelamentosDoComanda({ arquivos: 1, ainda_autorizados: 0 })).toBe(
      "1 arquivo de cancelamento é de cupom emitido aqui no Comanda: o Comanda não cancela cupom dele por arquivo. O cupom já está cancelado aqui.");
  });
  it("cancelamento de cupom que não veio por XML com vendas de planilha nos dias dele: a planilha não é corrigida", () => {
    const c = { documentos: 3, ini: "2026-11-20", fim: "2026-11-21", fontes: [{ fonte: "Planilha padrão do Comanda", tipo: "padrao" as const, vendas: 40, valor_centavos: 120000 }] };
    expect(semNbsp(textoCancelamentoSemVendaXml(c)!)).toBe(
      "3 cupons cancelados não vieram por XML. De 20/11 a 21/11 há vendas de Planilha padrão do Comanda (40 vendas, R$ 1.200,00): se esses cupons são do mesmo caixa, as vendas deles continuam lá, porque o Comanda não liga o cupom ao pedido da planilha. Para corrigir, importe de novo o relatório desses dias com Substituir.");
    expect(textoCancelamentoSemVendaXml({ ...c, fontes: [] })).toBeNull();
  });
});

describe("conferência do PDF", () => {
  const l = (valor: string, quantidade = "1", produto = "Caldo") => ({ id: "x", pedido: null, data: null, hora: null, produto, quantidade, valor });
  it("número digitado vira texto com ponto", () => {
    expect([numeroDigitado("12,90"), numeroDigitado("12.90"), numeroDigitado("1.234,56"), numeroDigitado("R$ 3"), numeroDigitado("abc"), numeroDigitado("")])
      .toEqual(["12.90", "12.90", "1234.56", "3", null, null]);
  });
  it("ponto seguido de exatamente 3 dígitos, sem vírgula, é ambíguo (milhar ou decimal?) = null, como na planilha", () => {
    expect(["1.234", "12.345", "0.500", "1.2345", "1.23", "1.234,5"].map(numeroDigitado)).toEqual([null, null, null, "1.2345", "1.23", "1234.5"]);
    expect([problemaDaLinha(l("1.234")), problemaDaLinha(l("10", "2.500"))]).toEqual([
      "Escreva “1.234” sem o ponto (1234) ou com vírgula (1,234): com ponto não dá para saber se é milhar ou centavos.",
      "Escreva “2.500” sem o ponto (2500) ou com vírgula (2,500): com ponto não dá para saber se é milhar ou centavos.",
    ]);
  });
  it("o que falta em cada linha", () => {
    expect([problemaDaLinha(l("10")), problemaDaLinha(l("10", "")), problemaDaLinha(l("10", "0")), problemaDaLinha(l("")), problemaDaLinha(l("1", "1", " "))]).toEqual([
      null, "Falta a quantidade. Digite ou tire a linha.", "Digite a quantidade (maior que zero).", "Falta o valor. Digite ou tire a linha.", "Digite o nome do produto.",
    ]);
  });
  it("soma × total impresso em centavos (0,10 + 0,20 = 30; até R$ 0,05 de diferença bate)", () => {
    expect(somaPdf([l("0,10"), l("0,20")], 0.3)).toEqual({ soma_centavos: 30, total_centavos: 30, bate: true });
    expect(somaPdf([l("1.222,20")], 1234.5)).toEqual({ soma_centavos: 122220, total_centavos: 123450, bate: false });
    expect(somaPdf([l("10,04")], 10)).toMatchObject({ bate: true });
    expect(somaPdf([l("10")], null)).toEqual({ soma_centavos: 1000, total_centavos: null, bate: null });
  });
});
