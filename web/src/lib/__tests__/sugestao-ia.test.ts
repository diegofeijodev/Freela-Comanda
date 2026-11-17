import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SugestaoInsumo } from "../erp-api";
import { aguardandoIa, aplicarSugestoes, avisoDaIa, chaveDeIaDisponivel, LIMITE_DESCRICAO, LIMITE_UNIDADE, LOTE_IA, respostaVale, PRAZO_IA_MS, sugerirEmLotes, type LinhaSugerivel } from "../sugestao-ia";

const sug = (p: Partial<SugestaoInsumo> = {}): SugestaoInsumo => ({ item_estoque_id: null, novo: null, fator: 1, ...p });
const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ descricao: `ITEM ${i + 1}`, unidade: "UN" }));
const semChave = (e: unknown) => e === "SEM_CHAVE";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sugerirEmLotes", () => {
  it("constantes", () => {
    expect(PRAZO_IA_MS).toBe(20_000);
    expect(LOTE_IA).toBe(200);
  });

  it("450 itens: 3 chamadas em sequência (200, 200, 50), resultado na ordem", async () => {
    const tamanhos: number[] = [];
    let emAndamento = 0;
    let max = 0;
    const chamar = vi.fn(async (lote: { descricao: string }[]) => {
      emAndamento++; max = Math.max(max, emAndamento);
      tamanhos.push(lote.length);
      await Promise.resolve();
      emAndamento--;
      return { itens: lote.map((l) => sug({ item_estoque_id: l.descricao })) };
    });
    const r = await sugerirEmLotes(itens(450), chamar, { semChave });
    expect(tamanhos).toEqual([200, 200, 50]);
    expect(max).toBe(1);
    expect(r.tipo).toBe("ia");
    if (r.tipo === "ia") {
      expect(r.itens).toHaveLength(450);
      expect(r.itens[0].item_estoque_id).toBe("ITEM 1");
      expect(r.itens[449].item_estoque_id).toBe("ITEM 450");
    }
  });

  it("estourou o prazo: falhou e aborta o signal", async () => {
    let signal: AbortSignal | undefined;
    const chamar = (_: unknown, s: AbortSignal) => { signal = s; return new Promise<{ itens: SugestaoInsumo[] }>(() => {}); };
    const p = sugerirEmLotes(itens(3), chamar, { semChave });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toEqual({ tipo: "falhou" });
    expect(signal?.aborted).toBe(true);
  });

  it("o prazo é um só para todos os lotes", async () => {
    const chamar = vi.fn((lote: unknown[], s: AbortSignal) => {
      if (chamar.mock.calls.length === 1) return new Promise<{ itens: SugestaoInsumo[] }>((res) => setTimeout(() => res({ itens: lote.map(() => sug()) }), 15_000));
      return new Promise<{ itens: SugestaoInsumo[] }>((_, rej) => s.addEventListener("abort", () => rej(new Error("abortado"))));
    });
    const p = sugerirEmLotes(itens(250), chamar, { semChave });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toEqual({ tipo: "falhou" });
    expect(chamar).toHaveBeenCalledTimes(2);
  });

  it("erro de falta de chave vira sem_chave; outro erro vira falhou", async () => {
    expect(await sugerirEmLotes(itens(2), async () => { throw "SEM_CHAVE"; }, { semChave })).toEqual({ tipo: "sem_chave" });
    expect(await sugerirEmLotes(itens(2), async () => { throw new Error("502"); }, { semChave })).toEqual({ tipo: "falhou" });
  });

  it("resposta com tamanho diferente do lote é falhou", async () => {
    expect(await sugerirEmLotes(itens(3), async () => ({ itens: [sug(), sug()] }), { semChave })).toEqual({ tipo: "falhou" });
  });

  it("0 itens: ia vazio, sem chamar", async () => {
    const chamar = vi.fn();
    expect(await sugerirEmLotes([], chamar, { semChave })).toEqual({ tipo: "ia", itens: [] });
    expect(chamar).not.toHaveBeenCalled();
  });
});

const linha = (p: Partial<LinhaSugerivel> = {}): LinhaSugerivel => ({
  descricao: "X", item_estoque_id: "", novo: null, sugerido: false, fator: "1", pendenteIa: true, tocada: false, fatorTocado: false, ...p,
});
const insumos = [{ id: "i1", nome: "Picanha" }, { id: "i2", nome: "Arroz" }];

describe("aplicarSugestoes", () => {
  it("IA com insumo existente marca sugerido e tira a pendência", () => {
    const [l] = aplicarSugestoes([linha()], { tipo: "ia", itens: [sug({ item_estoque_id: "i1", fator: 12 })] }, insumos);
    expect(l).toMatchObject({ item_estoque_id: "i1", sugerido: true, novo: null, pendenteIa: false, fator: "12" });
  });

  it("IA com insumo novo deixa item_estoque_id vazio e subgrupo vazio quando nulo", () => {
    const [l] = aplicarSugestoes([linha()], { tipo: "ia", itens: [sug({ novo: { nome: "Taxa", unidade: "UN", subgrupo: null } })] }, insumos);
    expect(l).toMatchObject({ item_estoque_id: "", sugerido: false, pendenteIa: false, novo: { nome: "Taxa", unidade: "UN", subgrupo: "" } });
  });

  it("fator digitado pelo admin fica; o resto da sugestão entra", () => {
    const [l] = aplicarSugestoes([linha({ fator: "3", fatorTocado: true })], { tipo: "ia", itens: [sug({ item_estoque_id: "i1", fator: 12 })] }, insumos);
    expect(l).toMatchObject({ fator: "3", item_estoque_id: "i1", sugerido: true });
  });

  it("linha tocada não muda (só deixa de estar pendente), mas ocupa o seu lugar na ordem", () => {
    const tocada = linha({ tocada: true, item_estoque_id: "i2" });
    const [a, b] = aplicarSugestoes([tocada, linha()], { tipo: "ia", itens: [sug({ item_estoque_id: "i1" }), sug({ item_estoque_id: "i2" })] }, insumos);
    expect(a).toEqual({ ...tocada, pendenteIa: false });
    expect(b.item_estoque_id).toBe("i2");
  });

  it("linha sem pendenteIa não muda e não consome item da resposta", () => {
    const vinculada = linha({ pendenteIa: false, item_estoque_id: "i2" });
    const [a, b] = aplicarSugestoes([vinculada, linha()], { tipo: "ia", itens: [sug({ item_estoque_id: "i1" })] }, insumos);
    expect(a).toBe(vinculada);
    expect(b.item_estoque_id).toBe("i1");
  });

  it("sem_chave e falhou aplicam a sugestão por palavras", () => {
    for (const tipo of ["sem_chave", "falhou"] as const) {
      const [l, m] = aplicarSugestoes([linha({ descricao: "PICANHA BOVINA KG" }), linha({ descricao: "TAXA DE ENTREGA" })], { tipo }, insumos);
      expect(l).toMatchObject({ item_estoque_id: "i1", sugerido: true, pendenteIa: false });
      expect(m).toMatchObject({ item_estoque_id: "", sugerido: false, pendenteIa: false });
    }
  });

  it("IA sem palpite para a linha cai nas palavras", () => {
    const [l] = aplicarSugestoes([linha({ descricao: "PICANHA BOVINA KG" })], { tipo: "ia", itens: [sug()] }, insumos);
    expect(l).toMatchObject({ item_estoque_id: "i1", sugerido: true });
  });
});

describe("estado da espera", () => {
  it("aguardandoIa: só com linha pendente", () => {
    expect(aguardandoIa([linha(), linha({ pendenteIa: false })])).toBe(true);
    expect(aguardandoIa([linha({ pendenteIa: false })])).toBe(false);
    expect(aguardandoIa([])).toBe(false);
  });
  it("avisoDaIa: ia e falhou mostram; sem_chave e nada, não", () => {
    expect(avisoDaIa({ tipo: "ia", itens: [] })).toBe("ia");
    expect(avisoDaIa({ tipo: "falhou" })).toBe("falhou");
    expect(avisoDaIa({ tipo: "sem_chave" })).toBeNull();
    expect(avisoDaIa(null)).toBeNull();
  });
});

describe("corte dos limites da API", () => {
  it("descrição em 500 e unidade em 20 antes de mandar; a ordem e o tamanho do pedido não mudam", async () => {
    const vistos: { descricao: string; unidade: string | null }[] = [];
    await sugerirEmLotes(
      [{ descricao: "A".repeat(900), unidade: "U".repeat(40) }, { descricao: "curta", unidade: null }],
      async (lote) => { vistos.push(...lote); return { itens: lote.map(() => sug()) }; },
      { semChave },
    );
    expect(vistos).toHaveLength(2);
    expect(vistos[0].descricao).toHaveLength(LIMITE_DESCRICAO);
    expect(vistos[0].unidade).toHaveLength(LIMITE_UNIDADE);
    expect(vistos[1]).toEqual({ descricao: "curta", unidade: null });
  });
});

describe("chaveDeIaDisponivel", () => {
  it("origem nula: não; com origem: sim; consulta que falha: sim", async () => {
    expect(await chaveDeIaDisponivel(async () => ({ origem: null }))).toBe(false);
    expect(await chaveDeIaDisponivel(async () => ({ origem: "servidor" }))).toBe(true);
    expect(await chaveDeIaDisponivel(async () => { throw new Error("x"); })).toBe(true);
  });
  it("sem resposta em 20 s: não (sem sugestão)", async () => {
    const p = chaveDeIaDisponivel(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toBe(false);
  });
});

describe("geração: nota A pendente + arquivo B ilegível", () => {
  it("B ilegível não avança a geração: a resposta de A ainda vale e libera as pendências", () => {
    let geracao = 1; // nota A na tela, pedido da geração 1 vivo
    const pedidoA = geracao;
    const lidoB = false; // B caiu no catch: nenhuma linha nova entrou
    if (lidoB) geracao = 2;
    expect(respostaVale(geracao, pedidoA)).toBe(true);
    const aposResposta = aplicarSugestoes([linha()], { tipo: "falhou" }, insumos);
    expect(aguardandoIa(aposResposta)).toBe(false);
  });
  it("B válido avança a geração: a resposta tardia de A é descartada", () => {
    expect(respostaVale(2, 1)).toBe(false);
  });
});
