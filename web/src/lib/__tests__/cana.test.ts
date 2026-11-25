import { describe, expect, it } from "vitest";
import type { CanaSemana } from "../erp-api";
import {
  avisoListaCortada, botaoLancar, contaCanaMoida, contaMoagem, contaPerda, contaProduto, contaRendimento, contaUmaVenda, contaVendido, duzias, fraseAviso,
  lerNumero, litros, lPorDz, pct, quandoLoja, resumoLancamento, rotuloSemana,
} from "../cana";

// O exemplo do desenho (B.3), com números INVENTADOS, como o servidor devolve em GET /v1/cana/semanas/:id.
const semana = (mudar: Partial<CanaSemana> = {}): CanaSemana => ({
  periodo: { ini: "2026-11-18", fim: "2026-11-24", dias: 7 },
  em_andamento: false,
  contagem_inicial: { id: "k1", data: "2026-11-17", lancado_por_nome: "Ana" },
  contagem_final: { id: "k2", data: "2026-11-24", lancado_por_nome: "Ana" },
  cana: { inicio: 4, recebida: { duzias: 12, lancamentos: 3, ini: "2026-11-18", fim: "2026-11-24" }, fim: 6, moida: 10, anotada_nas_producoes: { duzias: 9.5, producoes_com: 4, producoes: 6 } },
  caldo: {
    produzido: { litros: 50, lancamentos: 6, ini: "2026-11-18", fim: "2026-11-24" },
    vendido: { litros: 42.8, em_copos: 30, em_frozen: 12.8 },
    inicio: { litros: 3, caldo: 3, frozen: null, frozen_em_caldo: null },
    fim: { litros: 5, caldo: 5, frozen: null, frozen_em_caldo: null },
    perda: 5.2,
  },
  moagem: { litros_por_duzia: 5, esperado: 5.5, diferenca_litros: -5, diferenca_pct: -9.09 },
  rendimento: { litros_vendidos_por_duzia: 4.28 },
  por_produto: [],
  nao_entram: { sem_ml: [], frozen_sem_rendimento: [], sem_cardapio: [] },
  avisos: [],
  vendas_importadas_ate: "2026-11-24",
  parametros: { litros_por_duzia_esperado: 5.5, rendimento_frozen: 1.25 },
  calculada_com: "configuracao_de_hoje",
  ...mudar,
});

describe("formatos da cana (UX 4.2)", () => {
  it("dúzias e litros com até 1 casa, sem ',0', singular abaixo de 2", () => {
    expect([duzias(12), duzias(12.5), duzias(1), duzias(1.5), duzias(0.5), duzias(-2)]).toEqual([
      "12 dúzias", "12,5 dúzias", "1 dúzia", "1,5 dúzia", "0,5 dúzia", "−2 dúzias",
    ]);
    expect([litros(42.8), litros(42.84), litros(5.2), litros(25, true), litros(0.5, true)]).toEqual(["42,8 L", "42,8 L", "5,2 L", "25 litros", "0,5 litro"]);
  });
  it("L por dúzia com 2 casas e porcentagem com 1", () => {
    expect([lPorDz(4.28), lPorDz(5), pct(-9.09)]).toEqual(["4,28 L por dúzia", "5,00 L por dúzia", "−9,1%"]);
  });
  it("as datas da loja: hoje, ontem ou o dia", () => {
    expect([quandoLoja("2026-11-24", "2026-11-24", "2026-11-23"), quandoLoja("2026-11-23", "2026-11-24", "2026-11-23"), quandoLoja("2026-11-20", "2026-11-24", "2026-11-23")]).toEqual([
      "hoje (24/11)", "ontem (23/11)", "20/11",
    ]);
  });
  it("lê o número como a loja digita (vírgula ou ponto) e recusa o resto", () => {
    expect([lerNumero("12"), lerNumero("12,5"), lerNumero(" 0,5 "), lerNumero("1.5"), lerNumero(""), lerNumero("12a"), lerNumero("1.234,5")]).toEqual([
      12, 12.5, 0.5, 1.5, null, Number.NaN, Number.NaN,
    ]);
  });
});

describe("as contas por extenso (UX 3.4)", () => {
  it("cana moída: uma parcela por linha", () => {
    expect(contaCanaMoida(semana())).toEqual([
      "= 4 dúzias que sobraram (contagem de 17/11)",
      "+ 12 dúzias recebidas (3 entregas, de 18/11 a 24/11)",
      "− 6 dúzias que sobraram (contagem de 24/11)",
    ]);
  });
  it("perda de caldo", () => {
    expect(contaPerda(semana())).toEqual(["= 3 L no início (contagem de 17/11)", "+ 50 L produzidos", "− 42,8 L vendidos", "− 5 L no fim (contagem de 24/11)"]);
  });
  it("rendimento, moagem (com e sem o esperado) e caldo vendido", () => {
    expect(contaRendimento(semana())).toBe("= 42,8 L de caldo vendido ÷ 10 dúzias de cana moída");
    expect(contaMoagem(semana())).toEqual([
      "= 50 L produzidos ÷ 10 dúzias moídas",
      "Esperado: 5,50 L por dúzia → diferença: 50 − 10 × 5,5 = −5 L (−9,1% do esperado)",
    ]);
    expect(contaMoagem(semana({ moagem: { litros_por_duzia: 5, esperado: null, diferenca_litros: null, diferenca_pct: null } }))[1]).toBe("Esperado: não informado.");
    expect(contaVendido(semana())).toBe("= 30 L em copos + 12,8 L em frozen (ver Por produto)");
  });
  it("produto a produto e a conta de 1 venda na Configuração", () => {
    expect(contaProduto({ quantidade: 100, ml_por_unidade: 300, frozen: false, litros: 30, litros_caldo: 30 }, 1.25)).toBe("100 × 300 ml = 30 L");
    expect(contaProduto({ quantidade: 40, ml_por_unidade: 400, frozen: true, litros: 16, litros_caldo: 12.8 }, 1.25)).toBe("40 × 400 ml = 16 L de frozen ÷ 1,25 = 12,8 L de caldo");
    expect([contaUmaVenda(300, false, null), contaUmaVenda(400, true, 1.25), contaUmaVenda(400, true, null)]).toEqual([
      "Cada venda conta 0,3 L de caldo.",
      "Cada venda conta 0,4 L de frozen ÷ 1,25 = 0,32 L de caldo.",
      "Falta o rendimento do frozen: este produto ainda não entra na conta.",
    ]);
  });
  it("a semana na lista: as contagens de verdade (semana irregular diz os dias)", () => {
    expect(rotuloSemana({ periodo: { ini: "2026-11-18", fim: "2026-11-24", dias: 7 }, contagem_inicial: { data: "2026-11-17" }, contagem_final: { data: "2026-11-24" } })).toBe(
      "18/11 a 24/11 (contagens de 17/11 e 24/11)",
    );
    expect(rotuloSemana({ periodo: { ini: "2026-11-18", fim: "2026-11-26", dias: 9 }, contagem_inicial: { data: "2026-11-17" }, contagem_final: { data: "2026-11-26" } })).toBe(
      "18/11 a 26/11 (9 dias; contagens de 17/11 e 26/11)",
    );
  });
});

describe("avisos (frases da UX 3.4)", () => {
  it("vendas incompletas, produto sem ml, venda sem cardápio, frozen sem rendimento, cana moída negativa, produção zero", () => {
    const fim = "2026-11-24";
    expect(fraseAviso({ codigo: "vendas_incompletas", dados: { ate: "2026-11-21", fim } })).toBe(
      "O caldo vendido está incompleto: as vendas só foram importadas até 21/11, e a semana vai até 24/11. Importe as vendas de 22/11 a 24/11 antes de olhar a perda.",
    );
    expect(fraseAviso({ codigo: "vendas_incompletas", dados: { ate: null, fim } })).toBe("Nenhuma venda importada ainda: o caldo vendido aparece como 0.");
    expect(fraseAviso({ codigo: "produto_sem_ml", dados: { produtos: [{ nome: "Caldo 1 L", quantidade: 12 }, { nome: "Garapa jarra", quantidade: 3 }] } })).toBe(
      "2 produtos que parecem de caldo foram vendidos e não estão configurados: Caldo 1 L, Garapa jarra. As vendas deles não entram no caldo vendido.",
    );
    expect(fraseAviso({ codigo: "venda_sem_cardapio", dados: { produtos: [{ produto_relatorio: "CALDO CANA 500", vendas: 8 }] } })).toBe(
      "Há vendas com nome de caldo que não estão ligadas ao cardápio: “CALDO CANA 500” (8 vendas). Elas não entram na conta.",
    );
    expect(fraseAviso({ codigo: "frozen_sem_rendimento", dados: { vendidos: 40, litros_frozen_contados: 2 } })).toBe(
      "Falta o rendimento do frozen. Os 40 frozen vendidos e os 2 L de frozen das contagens não entram nas contas.",
    );
    expect(fraseAviso({ codigo: "cana_moida_negativa", dados: { duzias: -2 } }, { inicial: "2026-11-17", final: fim })).toBe(
      "A cana moída deu negativa (−2 dúzias): a contagem de 24/11 tem mais cana do que a de 17/11 mais o que foi recebido. Falta lançar um recebimento ou a contagem está errada.",
    );
    expect(fraseAviso({ codigo: "producao_zero_com_venda", dados: { litros_vendidos: 42.8 } })).toBe(
      "Nenhuma produção lançada na semana, mas saíram 42,8 L de caldo em vendas. Falta lançar a produção?",
    );
  });
});

describe("a tela da loja (sem conta nenhuma)", () => {
  it("o botão diz o que vai ser gravado", () => {
    expect(botaoLancar("recebimento", { duzias: 12 }, "hoje")).toBe("Lançar 12 dúzias recebidas hoje");
    expect(botaoLancar("recebimento", { duzias: 1 }, "ontem")).toBe("Lançar 1 dúzia recebida ontem");
    expect(botaoLancar("recebimento", { duzias: 12 }, "em 20/11")).toBe("Lançar 12 dúzias recebidas em 20/11");
    expect(botaoLancar("recebimento", { duzias: null }, "hoje")).toBe("Digite as dúzias");
    expect(botaoLancar("producao", { litros_caldo: 25 }, "hoje")).toBe("Lançar 25 litros produzidos hoje");
    expect(botaoLancar("producao", { litros_caldo: null }, "hoje")).toBe("Digite os litros");
    expect(botaoLancar("contagem", { duzias: 6, litros_caldo: 5 }, "hoje")).toBe("Lançar a contagem de hoje");
    expect(botaoLancar("contagem", { duzias: 6, litros_caldo: null }, "hoje")).toBe("Digite os litros de caldo");
  });
  it("o resumo de um lançamento", () => {
    expect(resumoLancamento({ tipo: "recebimento", duzias: 12, litros_caldo: null, litros_frozen: null })).toBe("Recebi cana · 12 dúzias");
    expect(resumoLancamento({ tipo: "producao", duzias: 5, litros_caldo: 25, litros_frozen: null })).toBe("Produzi caldo · 25 litros (5 dúzias moídas)");
    expect(resumoLancamento({ tipo: "contagem", duzias: 6, litros_caldo: 5, litros_frozen: 2 })).toBe("Contagem do que sobrou · 6 dúzias · 5 litros de caldo · 2 litros de frozen");
  });
  it("nenhuma palavra de conta nos textos da loja", () => {
    const textos = [
      botaoLancar("recebimento", { duzias: 12 }, "hoje"), botaoLancar("producao", { litros_caldo: 25 }, "hoje"), botaoLancar("contagem", { duzias: 6, litros_caldo: 5 }, "hoje"),
      resumoLancamento({ tipo: "contagem", duzias: 6, litros_caldo: 5, litros_frozen: 2 }),
    ].join(" ");
    expect(textos).not.toMatch(/perda|vendido|rendimento|esperado|sumiu|L\/DZ/i);
  });
});

describe("a lista de lançamentos do admin", () => {
  it("cortada pelo servidor: diz quantos mostra e que as somas contam só eles", () => {
    expect(avisoListaCortada(2000)).toBe(
      "A lista mostra só os 2.000 lançamentos mais novos deste período, e as somas acima contam só eles. Escolha um período menor (ou um tipo) para ver os outros.",
    );
  });
});
