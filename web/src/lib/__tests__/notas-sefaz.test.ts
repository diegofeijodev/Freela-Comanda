import { describe, expect, it, vi } from "vitest";
import type { NotaParecida, NotaSefaz, SituacaoBuscaSefaz, SituacaoSefazLigada } from "../erp-api";
import {
  acoesDaNota, contagemAba, precisaConfirmarTroca, emissaoSp, estadoBuscar, linhasHistoricoSefaz, faixaCancelamento, horaSp, linhaEspera, linhaProxima, linhaUltimaBusca, quando, resumoPainel, tagDaNota, TEXTO_MOTIVO,
  semToqueDuplo, toastBuscaFeita, toastBuscaLigada,
} from "../notas-sefaz";

const AGORA = new Date("2026-11-17T17:05:00Z"); // 14h05 em Brasília

const base: SituacaoSefazLigada = {
  ambiente: "producao", cnpj: "12345678000195", busca_ligada: true, situacao: "ok", mensagem: null, aviso: null,
  ultima_consulta: { em: "2026-11-17T17:05:00Z", novas: 0 }, primeira_consulta_em: "2026-11-10T12:00:00Z",
  proxima_consulta_em: "2026-11-17T18:10:00Z", bloqueado_ate: null, em_andamento: false, lacunas: 0, dias_sem_buscar: 0,
  ligada_por_nome: "Ana", ligada_em: "2026-11-16T17:32:00Z", outro_cnpj_ou_modo: false,
  certificado: { ok: true, code: null, mensagem: null, avisos: [] },
  contagem: { falta_lancar: 2, parece_lancada: 1, cancelada_depois_de_lancada: 0 }, canceladas_depois: [], historico: [],
};
const com = (p: Partial<SituacaoSefazLigada>): SituacaoSefazLigada => ({ ...base, ...p });
const desligada = (p: Partial<SituacaoSefazLigada> = {}) => com({ busca_ligada: false, ...p });

describe("horas", () => {
  it("horaSp e quando", () => {
    expect(horaSp("2026-11-17T18:10:00Z")).toBe("15h10");
    expect(quando("2026-11-17T17:05:00Z", AGORA)).toBe("hoje às 14h05");
    expect(quando("2026-11-16T12:30:00Z", AGORA)).toBe("ontem às 09h30");
    expect(quando("2026-11-17T02:30:00Z", AGORA)).toBe("ontem às 23h30");
    expect(quando("2026-11-14T12:30:00Z", AGORA)).toBe("em 14/11 às 09h30");
  });
});

describe("última busca e toast", () => {
  it("linhaUltimaBusca", () => {
    expect(linhaUltimaBusca(com({ ultima_consulta: { em: "2026-11-17T17:05:00Z", novas: 2 } }), AGORA)).toBe("Última busca hoje às 14h05: 2 notas novas");
    expect(linhaUltimaBusca(com({ ultima_consulta: { em: "2026-11-17T17:05:00Z", novas: 1 } }), AGORA)).toBe("Última busca hoje às 14h05: 1 nota nova");
    expect(linhaUltimaBusca(base, AGORA)).toBe("Última busca hoje às 14h05: nada novo");
    expect(linhaUltimaBusca(com({ ultima_consulta: null }), AGORA)).toBe("Ainda não buscou.");
  });
  it("toastBuscaFeita", () => {
    expect(toastBuscaFeita(2)).toBe("Busca feita: 2 notas novas.");
    expect(toastBuscaFeita(1)).toBe("Busca feita: 1 nota nova.");
    expect(toastBuscaFeita(0)).toBe("Busca feita: nada novo.");
  });
  it("toastBuscaLigada: até 5 minutos só quando a próxima busca permitida está a 5 min ou menos", () => {
    const cinco = "Busca ligada. A primeira busca sai em até 5 minutos.";
    expect(toastBuscaLigada(com({ proxima_consulta_em: null }), AGORA)).toBe(cinco);
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-17T17:00:00Z" }), AGORA)).toBe(cinco); // já passou
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-17T17:10:00Z" }), AGORA)).toBe(cinco); // 5 min exatos
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-17T17:10:01Z" }), AGORA)).toBe("Busca ligada. A próxima busca sai às 14h10.");
  });
  it("toastBuscaLigada: senão, a hora de Brasília da próxima busca permitida (e o dia, se for outro)", () => {
    expect(toastBuscaLigada(base, AGORA)).toBe("Busca ligada. A próxima busca sai às 15h10.");
    // 02h30 UTC do dia 18 ainda é dia 17 em Brasília
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-18T02:30:00Z" }), AGORA)).toBe("Busca ligada. A próxima busca sai às 23h30.");
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-18T12:30:00Z" }), AGORA)).toBe("Busca ligada. A próxima busca sai em 18/11 às 09h30.");
    // bloqueio da SEFAZ (656) mais tarde que a próxima: vale o bloqueio
    expect(toastBuscaLigada(com({ proxima_consulta_em: "2026-11-17T17:00:00Z", bloqueado_ate: "2026-11-17T19:10:00Z" }), AGORA)).toBe(
      "Busca ligada. A próxima busca sai às 16h10.",
    );
  });
});

describe("semToqueDuplo", () => {
  it("o 2º toque antes de a 1ª chamada terminar é ignorado; ao terminar (mesmo com erro), a trava solta", async () => {
    const trava = { current: false };
    let soltar = () => {};
    const acao = vi.fn(() => new Promise<void>((ok) => { soltar = ok; }));
    const primeiro = semToqueDuplo(trava, acao);
    await semToqueDuplo(trava, acao); // toque duplo, antes de o botão desabilitar
    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
    await primeiro;
    expect(trava.current).toBe(false);
    await expect(semToqueDuplo(trava, async () => { throw new Error("falhou"); })).rejects.toThrow("falhou");
    expect(trava.current).toBe(false);
    const depois = semToqueDuplo(trava, acao);
    expect(acao).toHaveBeenCalledTimes(2);
    soltar();
    await depois;
  });
});

describe("Buscar agora", () => {
  it("estadoBuscar", () => {
    expect(estadoBuscar(desligada(), AGORA)).toBe("sem_botao");
    expect(estadoBuscar(com({ em_andamento: true }), AGORA)).toBe("buscando");
    expect(estadoBuscar(base, AGORA)).toBe("espera");
    expect(estadoBuscar(com({ proxima_consulta_em: "2026-11-17T17:00:00Z" }), AGORA)).toBe("normal");
    expect(estadoBuscar(com({ proxima_consulta_em: null }), AGORA)).toBe("normal");
    expect(estadoBuscar(com({ proxima_consulta_em: "2026-11-17T17:00:00Z", bloqueado_ate: "2026-11-17T18:10:00Z" }), AGORA)).toBe("espera");
  });
  it("linhaEspera usa o maior entre a próxima e o bloqueio", () => {
    expect(linhaEspera(base)).toBe("Próxima busca a partir das 15h10. A SEFAZ não deixa buscar antes.");
    expect(linhaEspera(com({ proxima_consulta_em: "2026-11-17T17:00:00Z", bloqueado_ate: "2026-11-17T19:10:00Z" }))).toBe(
      "Próxima busca a partir das 16h10. A SEFAZ não deixa buscar antes.",
    );
    expect(linhaProxima(base)).toBe("Próxima busca a partir das 15h10");
    expect(linhaProxima(com({ proxima_consulta_em: null }))).toBeNull();
  });
  it("contagemAba soma falta_lancar e parece_lancada", () => {
    expect(contagemAba(base)).toBe(3);
  });
});

describe("faixaCancelamento", () => {
  const fim = "Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso.";
  it("uma, várias, nenhuma", () => {
    expect(faixaCancelamento([{ id: "1", numero: "77", serie: "1", emitente_nome: "LATICÍNIOS K" }])).toBe(
      `A NF 77 de LATICÍNIOS K, que você já lançou, foi cancelada pelo fornecedor. ${fim}`,
    );
    const t = { id: "x", numero: "1", serie: "1", emitente_nome: "A" };
    expect(faixaCancelamento([t, t, t])).toBe(`3 notas que você já lançou foram canceladas pelo fornecedor. ${fim}`);
    expect(faixaCancelamento([])).toBeNull();
  });
});

describe("TEXTO_MOTIVO", () => {
  it("frases da tela", () => {
    expect(TEXTO_MOTIVO).toEqual({
      lancada_de_outro_jeito: "Já lancei de outro jeito", nao_e_compra: "Não é compra", nao_reconheco: "Não reconheço esta nota",
      outro: "Outro motivo", cancelamento_conferido: "Marcada como vista",
    });
  });
});

describe("resumoPainel", () => {
  const r = (s: SituacaoBuscaSefaz) => resumoPainel(s, AGORA);
  it("servidor desligado", () => {
    expect(r({ ambiente: "desligado" })).toEqual({
      tag: null, botao: null, botaoDesabilitado: false, linhas: [],
      caixas: [{ tom: "neutro", texto: "A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la." }],
    });
  });
  it("ligada sem novidade", () => {
    const x = r(base);
    expect(x.tag).toEqual({ tom: "ok", texto: "Ligada" });
    expect(x.botao).toBe("desligar");
    expect(x.botaoDesabilitado).toBe(false);
    expect(x.caixas).toEqual([]);
    expect(x.linhas).toEqual([
      "Última busca hoje às 14h05: nada novo", "Próxima a partir das 15h10", "3 notas para conferir", "Ligada por Ana em 16/11/2026 às 14h32",
    ]);
  });
  it("modo de teste acrescenta a linha", () => {
    expect(r(com({ ambiente: "homologacao" })).linhas.at(-1)).toBe("Modo de teste da SEFAZ: as notas são de mentira.");
  });
  it("parada_conflito", () => {
    const x = r(desligada({ situacao: "parada_conflito", mensagem: "Outro sistema também está buscando." }));
    expect(x.tag).toEqual({ tom: "bad", texto: "Parada" });
    expect(x.botao).toBe("ligar_de_novo");
    expect(x.caixas[0]).toEqual({ tom: "bad", texto: "Outro sistema também está buscando." });
  });
  it("ok com mensagem vira caixa âmbar", () => {
    expect(r(com({ mensagem: "A SEFAZ está fora do ar. Nova tentativa às 15h10." })).caixas).toEqual([
      { tom: "warn", texto: "A SEFAZ está fora do ar. Nova tentativa às 15h10." },
    ]);
  });
  it("ligada com certificado vencido: Pausada", () => {
    const x = r(com({ certificado: { ok: false, code: "CERTIFICADO_VENCIDO", mensagem: "O certificado digital venceu em 10/03/2026. Envie o renovado para a busca voltar.", avisos: [] } }));
    expect(x.tag).toEqual({ tom: "warn", texto: "Pausada" });
    expect(x.botao).toBe("desligar");
    expect(x.caixas[0]).toMatchObject({ tom: "bad", irParaCertificado: true });
  });
  it("sem certificado", () => {
    const x = r(desligada({ certificado: { ok: false, code: "CERTIFICADO_NAO_CADASTRADO", mensagem: "Envie o certificado digital da empresa no quadro acima para ligar a busca.", avisos: [] } }));
    expect(x.tag).toEqual({ tom: "muted", texto: "Desligada" });
    expect(x.botao).toBe("ligar");
    expect(x.botaoDesabilitado).toBe(true);
    expect(x.caixas[0]).toEqual({ tom: "neutro", texto: "Envie o certificado digital da empresa no quadro acima para ligar a busca.", irParaCertificado: true });
  });
  it("sem CNPJ desabilita e não manda para o certificado", () => {
    const x = r(desligada({ cnpj: null, certificado: { ok: false, code: "EMPRESA_SEM_CNPJ", mensagem: "Preencha o CNPJ.", avisos: [] } }));
    expect(x.botaoDesabilitado).toBe(true);
    expect(x.caixas[0]).toEqual({ tom: "bad", texto: "Preencha o CNPJ." });
  });
  it("código do certificado sem o prefixo CERTIFICADO_ não é reconhecido (a API sempre manda o prefixo)", () => {
    const x = r(desligada({ certificado: { ok: false, code: "NAO_CADASTRADO", mensagem: "Envie o certificado.", avisos: [] } }));
    expect(x.caixas[0]).toEqual({ tom: "bad", texto: "Envie o certificado." });
  });
  it("lacuna de 1 nota no singular", () => {
    expect(r(com({ lacunas: 1 })).caixas.map((c) => c.texto)).toEqual([
      "Uma resposta da SEFAZ se perdeu e até 1 nota pode não ter chegado. Essas entram pelo arquivo ou pela foto.",
    ]);
  });
  it("CNPJ mudou, lacuna, aviso e avisos do certificado", () => {
    const x = r(desligada({ outro_cnpj_ou_modo: true, lacunas: 4, aviso: "Aviso D1.", certificado: { ok: true, code: null, mensagem: null, avisos: ["Aviso 280."] } }));
    expect(x.caixas.map((c) => c.texto)).toEqual([
      "O CNPJ da empresa mudou desde a última vez. Ligue a busca de novo.",
      "Uma resposta da SEFAZ se perdeu e até 4 notas podem não ter chegado. Essas entram pelo arquivo ou pela foto.",
      "Aviso D1.", "Aviso 280.",
    ]);
    expect(x.caixas.every((c) => c.tom === "warn")).toBe(true);
  });
  it("desligada há 51 dias avisa; há 50 não", () => {
    const aviso = "A busca está desligada há 51 dias. Passando de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam. Ligue a busca de novo.";
    expect(r(desligada({ dias_sem_buscar: 51 })).caixas).toEqual([{ tom: "warn", texto: aviso }]);
    expect(r(desligada({ dias_sem_buscar: 50 })).caixas).toEqual([]);
    expect(r(com({ dias_sem_buscar: 90 })).caixas).toEqual([]);
  });
  it("linha fixa quando desligada", () => {
    expect(r(desligada()).linhas).toEqual([
      "Com a busca desligada por mais de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam.",
    ]);
  });
  it("primeira busca nas últimas 24 h", () => {
    const x = r(com({ primeira_consulta_em: "2026-11-17T12:00:00Z" }));
    expect(x.caixas).toEqual([{ tom: "neutro", texto: "Primeira busca feita. A SEFAZ passa a separar as notas deste CNPJ a partir de agora; as emitidas antes não aparecem aqui." }]);
  });
});

describe("tagDaNota", () => {
  const parecida: NotaParecida = { id: "p", numero: "880", serie: "1", fornecedor_nome: "X", data_emissao: "2026-11-14", data_entrada: "2026-11-15", valor_total: 10, origem: "foto", created_at: "2026-11-15T12:00:00Z" };
  const nota = (p: Partial<NotaSefaz>): NotaSefaz => ({
    id: "n", chave: "1".repeat(44), emitente_cnpj: "1", emitente_nome: "ATACADÃO", numero: "4411", serie: "1", emitida_em: null, autorizada_em: null, valor_total: 1,
    situacao_sefaz: "autorizada", cancelada_em: null, situacao: "falta_lancar", lancada: null, parecidas: [], pode_conferir: true, nao_parece_compra: false, ignorada: null, ...p,
  });
  it("as 7 situações", () => {
    expect(tagDaNota(nota({ situacao: "cancelada_depois_de_lancada" }))).toMatchObject({ tom: "bad", icone: "CircleAlert", texto: "Cancelada pelo fornecedor depois de você lançar", detalhe: null });
    expect(tagDaNota(nota({ situacao: "ignorada", ignorada: { em: "2026-11-15T15:00:00Z", por_nome: "Ana", motivo: "nao_e_compra", texto: null } })))
      .toMatchObject({ tom: "muted", icone: "EyeOff", texto: "Ignorada", detalhe: "Motivo: Não é compra · por Ana, 15/11" });
    expect(tagDaNota(nota({ situacao: "cancelada" }))).toMatchObject({ tom: "muted", icone: "Ban", texto: "Cancelada pelo fornecedor. Não precisa lançar." });
    expect(tagDaNota(nota({ situacao: "denegada" }))).toMatchObject({ tom: "bad", icone: "Ban", texto: "Recusada pela SEFAZ (denegada). Esta nota não vale." });
    expect(tagDaNota(nota({ situacao: "ja_lancada", lancada: { ...parecida, origem: "xml", data_entrada: "2026-11-03" } })))
      .toMatchObject({ tom: "ok", icone: "CheckCircle2", texto: "Já lançada por XML em 03/11" });
    expect(tagDaNota(nota({ situacao: "parece_lancada", parecidas: [parecida] }))).toMatchObject({ tom: "warn", icone: "Copy", texto: "Parece a NF 880 que você lançou por foto em 15/11" });
    expect(tagDaNota(nota({ situacao: "falta_lancar" }))).toMatchObject({ tom: "warn", icone: "CircleAlert", texto: "Falta lançar", detalhe: null });
  });
  it("ignorada com outro motivo e sem nome", () => {
    expect(tagDaNota(nota({ situacao: "ignorada", ignorada: { em: "2026-11-15T15:00:00Z", por_nome: null, motivo: "outro", texto: "Duplicada no balcão" } })).detalhe)
      .toBe("Motivo: Duplicada no balcão · 15/11");
  });
  it("marcas soResumo e podeNaoSerCompra", () => {
    expect(tagDaNota(nota({ pode_conferir: false }))).toMatchObject({ soResumo: true, podeNaoSerCompra: false });
    expect(tagDaNota(nota({ pode_conferir: false, situacao: "parece_lancada", parecidas: [parecida] })).soResumo).toBe(true);
    expect(tagDaNota(nota({ pode_conferir: false, situacao: "cancelada" })).soResumo).toBe(false);
    expect(tagDaNota(nota({ nao_parece_compra: true }))).toMatchObject({ soResumo: false, podeNaoSerCompra: true });
  });
});

describe("linhasHistoricoSefaz", () => {
  it("três eventos", () => {
    expect(linhasHistoricoSefaz([
      { evento: "parada_automatica", feito_por_nome: null, feito_em: "2026-11-17T17:05:00Z", c_stat: 656 },
      { evento: "desligada", feito_por_nome: "Ana", feito_em: "2026-11-16T17:32:00Z", c_stat: null },
      { evento: "ligada", feito_por_nome: null, feito_em: "2026-11-15T17:32:00Z", c_stat: null },
    ])).toEqual(["Parou sozinha em 17/11/2026 às 14h05 (código 656)", "Desligada por Ana em 16/11/2026 às 14h32", "Ligada em 15/11/2026 às 14h32"]);
  });
});

describe("acoesDaNota", () => {
  const n = (p: Partial<NotaSefaz>): NotaSefaz => ({
    id: "n", chave: "1".repeat(44), emitente_cnpj: "1", emitente_nome: "ATACADÃO", numero: "4411", serie: "1", emitida_em: null, autorizada_em: null, valor_total: 1,
    situacao_sefaz: "autorizada", cancelada_em: null, situacao: "falta_lancar", lancada: null, parecidas: [], pode_conferir: true, nao_parece_compra: false, ignorada: null, ...p,
  });
  it("cancelada depois de lançada: só marcar como visto", () => {
    expect(acoesDaNota(n({ situacao: "cancelada_depois_de_lancada" }))).toEqual({ primaria: "marcar_visto", secundarias: [] });
  });
  it("ignorada: voltar para a lista", () => {
    expect(acoesDaNota(n({ situacao: "ignorada" }))).toEqual({ primaria: "voltar_lista", secundarias: [] });
  });
  it("cancelada, denegada e já lançada: nenhuma ação", () => {
    for (const situacao of ["cancelada", "denegada", "ja_lancada"] as const) expect(acoesDaNota(n({ situacao }))).toEqual({ primaria: null, secundarias: [] });
  });
  it("parece lançada: é a mesma nota, com ou sem nota completa", () => {
    expect(acoesDaNota(n({ situacao: "parece_lancada", pode_conferir: true }))).toEqual({ primaria: "mesma_nota", secundarias: ["lancar_mesmo_assim"] });
    expect(acoesDaNota(n({ situacao: "parece_lancada", pode_conferir: false }))).toEqual({ primaria: "mesma_nota", secundarias: ["lancar_mesmo_assim"] });
  });
  it("falta lançar: Conferir só com nota completa; senão lançar por arquivo ou foto", () => {
    expect(acoesDaNota(n({ pode_conferir: true }))).toEqual({ primaria: "conferir", secundarias: ["ignorar", "copiar_chave"] });
    expect(acoesDaNota(n({ pode_conferir: false }))).toEqual({ primaria: "lancar_por_arquivo", secundarias: ["ignorar", "copiar_chave"] });
  });
});

describe("emissaoSp", () => {
  it("data no fuso de Brasília, traço sem data", () => {
    expect(emissaoSp("2026-11-15T01:30:00Z")).toBe("14/11/2026");
    expect(emissaoSp(null)).toBe("—");
  });
});

describe("precisaConfirmarTroca", () => {
  it("há nota em conferência: pede confirmação; não há: segue direto", () => {
    expect(precisaConfirmarTroca({ numero: "1" })).toBe(true);
    expect(precisaConfirmarTroca(null)).toBe(false);
    expect(precisaConfirmarTroca(undefined)).toBe(false);
  });
});
