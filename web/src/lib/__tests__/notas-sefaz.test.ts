import { describe, expect, it, vi } from "vitest";
import type { EstadoResposta, NotaParecida, NotaSefaz, RespostaNota, SituacaoBuscaSefaz, SituacaoSefazLigada } from "../erp-api";
import {
  acoesDaNota, contagemAba, precisaConfirmarTroca, emissaoSp, estadoBuscar, linhasHistoricoSefaz, faixaCancelamento, horaSp, linhaEspera, linhaProxima, linhaUltimaBusca, quando, resumoPainel, tagDaNota, TEXTO_MOTIVO,
  semToqueDuplo, toastBuscaFeita, toastBuscaLigada, TEXTO_ACAO,
  aberturaBusca, avisoDoMotivo, faixaPrazo, linhaPrazo, linhaResposta, normalizarJustificativa, resumoRespostas, textoPorQue, toastRespostasLigadas,
} from "../notas-sefaz";

const AGORA = new Date("2026-11-17T17:05:00Z"); // 14h05 em Brasília

const base: SituacaoSefazLigada = {
  ambiente: "producao", cnpj: "12345678000195", busca_ligada: true, situacao: "ok", mensagem: null, aviso: null,
  ultima_consulta: { em: "2026-11-17T17:05:00Z", novas: 0 }, primeira_consulta_em: "2026-11-10T12:00:00Z",
  proxima_consulta_em: "2026-11-17T18:10:00Z", bloqueado_ate: null, em_andamento: false, lacunas: 0, dias_sem_buscar: 0,
  ligada_por_nome: "Ana", ligada_em: "2026-11-16T17:32:00Z", outro_cnpj_ou_modo: false,
  certificado: { ok: true, code: null, mensagem: null, avisos: [] },
  contagem: { falta_lancar: 2, parece_lancada: 1, cancelada_depois_de_lancada: 0 }, canceladas_depois: [], historico: [],
  respostas: {
    disponivel: true, ligadas: false, situacao: "ok", mensagem: null, pausa_ate: null, ligadas_por_nome: null, ligadas_em: null,
    na_fila: 0, falharam: 0, prazos_perto: [],
  },
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
      compra_nao_aconteceu: "A compra não aconteceu (devolvi ou cancelei)", outro: "Outro motivo", cancelamento_conferido: "Marcada como vista",
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
    situacao_sefaz: "autorizada", cancelada_em: null, situacao: "falta_lancar", lancada: null, parecidas: [], pode_conferir: true, nao_parece_compra: false, ignorada: null, resposta: null, ...p,
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
    situacao_sefaz: "autorizada", cancelada_em: null, situacao: "falta_lancar", lancada: null, parecidas: [], pode_conferir: true, nao_parece_compra: false, ignorada: null, resposta: null, ...p,
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

// ------------------------------------------------------------------------------------------------ respostas à SEFAZ (entrega 3)

const respostasCom = (p: Partial<SituacaoSefazLigada["respostas"]>): SituacaoSefazLigada =>
  com({ respostas: { ...base.respostas, ...p } });

describe("resumoRespostas", () => {
  const r = (p: Partial<SituacaoSefazLigada["respostas"]>) => resumoRespostas(respostasCom(p), AGORA);
  it("servidor sem a variável: sem tag, sem botão, só a frase", () => {
    expect(r({ disponivel: false })).toEqual({
      tag: null, botaoDesabilitado: false, botao: null, linhas: [],
      caixa: { tom: "neutro", texto: "As respostas à SEFAZ não estão ativadas neste servidor. Fale com o suporte do Freela Comanda se quiser usá-las." },
    });
  });
  it("desligadas: tag, botão e a linha fixa", () => {
    const x = r({});
    expect(x.tag).toEqual({ tom: "muted", texto: "Desligadas" });
    expect(x.botao).toBe("ligar");
    expect(x.botaoDesabilitado).toBe(false);
    expect(x.caixa).toBeNull();
    expect(x.linhas).toEqual(["Com as respostas desligadas, nada é enviado à SEFAZ. O que estava na fila espera até você ligar de novo."]);
  });
  it("desligadas sem certificado ou sem CNPJ: botão desabilitado e a frase do certificado", () => {
    const cert = { ok: false, code: "CERTIFICADO_NAO_CADASTRADO", mensagem: "Envie o certificado digital da empresa no quadro acima para ligar a busca.", avisos: [] };
    const x = resumoRespostas(com({ certificado: cert, respostas: base.respostas }), AGORA);
    expect(x.botaoDesabilitado).toBe(true);
    expect(x.caixa).toEqual({ tom: "neutro", texto: cert.mensagem, irParaCertificado: true });
    expect(resumoRespostas(com({ cnpj: null, respostas: base.respostas }), AGORA).botaoDesabilitado).toBe(true);
  });
  it("ligadas: tag, botão, quem ligou e a fila", () => {
    const x = r({ ligadas: true, ligadas_por_nome: "Diego", ligadas_em: "2026-11-17T13:05:00Z", na_fila: 3 });
    expect(x.tag).toEqual({ tom: "ok", texto: "Ligadas" });
    expect(x.botao).toBe("desligar");
    expect(x.caixa).toBeNull();
    expect(x.linhas).toEqual(["Ligadas por Diego em 17/11/2026 às 10h05", "3 respostas na fila"]);
  });
  it("na fila no singular, some com 0; prazo e falhas; modo de teste", () => {
    expect(r({ ligadas: true, na_fila: 1 }).linhas).toEqual(["1 resposta na fila"]);
    const x = resumoRespostas(com({
      ambiente: "homologacao",
      respostas: {
        ...base.respostas, ligadas: true, falharam: 1,
        prazos_perto: [
          { id: "a", numero: "1", serie: "1", emitente_nome: "A", prazo_final: "2027-02-16T02:30:00Z" },
          { id: "b", numero: "2", serie: "1", emitente_nome: "B", prazo_final: "2027-02-20T02:30:00Z" },
        ],
      },
    }), AGORA);
    expect(x.linhas).toEqual([
      "2 notas precisam de resposta até 15/02/2027", "1 resposta não foi enviada", "Modo de teste da SEFAZ: as respostas valem só para notas de mentira.",
    ]);
    expect(r({ ligadas: true, falharam: 2 }).linhas).toEqual(["2 respostas não foram enviadas"]);
    expect(r({ ligadas: true, prazos_perto: [{ id: "a", numero: "1", serie: "1", emitente_nome: "A", prazo_final: "2027-02-16T02:30:00Z" }] }).linhas)
      .toEqual(["1 nota precisa de resposta até 15/02/2027"]);
  });
  it("pausa no futuro: Esperando a SEFAZ e caixa âmbar com a mensagem como vem", () => {
    const m = "A SEFAZ está fora do ar. As respostas saem de novo às 15h10.";
    const x = r({ ligadas: true, pausa_ate: "2026-11-17T18:10:00Z", mensagem: m });
    expect(x.tag).toEqual({ tom: "warn", texto: "Esperando a SEFAZ" });
    expect(x.caixa).toEqual({ tom: "warn", texto: m });
    expect(x.botao).toBe("desligar");
    // pausa que já passou: nada de espera
    expect(r({ ligadas: true, pausa_ate: "2026-11-17T17:00:00Z", mensagem: m }).tag).toEqual({ tom: "ok", texto: "Ligadas" });
    expect(r({ ligadas: true, pausa_ate: "2026-11-17T17:00:00Z", mensagem: m }).caixa).toBeNull();
  });
  it("parada: Paradas, caixa vermelha com a mensagem do servidor e ligar de novo", () => {
    const m = "A SEFAZ recusou o certificado digital (código 280). Confira o certificado digital em Configurações e ligue as respostas de novo.";
    const x = r({ situacao: "parada_certificado", mensagem: m });
    expect(x.tag).toEqual({ tom: "bad", texto: "Paradas" });
    expect(x.caixa).toEqual({ tom: "bad", texto: m });
    expect(x.botao).toBe("ligar_de_novo");
    expect(r({ situacao: "parada_656", mensagem: "x" }).botao).toBe("ligar_de_novo");
  });
  it("toast de ligar", () => {
    expect(toastRespostasLigadas()).toBe("Respostas ligadas. As primeiras saem em até 5 minutos.");
  });
});

describe("linhaPrazo", () => {
  const ciencia: EstadoResposta = { estado: "registrada", em: "2026-11-17T12:00:00Z", protocolo: "1", c_stat: 135, mensagem: null };
  const resp = (p: Partial<RespostaNota>): RespostaNota => ({
    ciencia: null, final: null, prazo_final: "2027-02-16T02:30:00Z", prazo_perto: false, prazo_passou: false, pode_responder: true, ...p,
  });
  const em = (iso: string) => new Date(iso);
  it("nota respondível sem aviso de prazo: neutra, nunca âmbar (inclusive sem ciência)", () => {
    expect(linhaPrazo(resp({}), AGORA)).toEqual({ tom: "neutro", texto: "Responder à SEFAZ até 15/02/2027" });
  });
  it("prazo perto: âmbar com os dias que faltam (dia de Brasília)", () => {
    const r = resp({ ciencia, prazo_perto: true });
    expect(linhaPrazo(r, em("2027-02-09T15:00:00Z"))).toEqual({ tom: "warn", texto: "Faltam 6 dias para responder à SEFAZ (até 15/02/2027)." });
    expect(linhaPrazo(r, em("2027-02-14T15:00:00Z"))).toEqual({ tom: "warn", texto: "Falta 1 dia para responder à SEFAZ (até 15/02/2027)." });
    expect(linhaPrazo(r, em("2027-02-15T15:00:00Z"))).toEqual({ tom: "warn", texto: "Último dia para responder à SEFAZ." });
    // 02h UTC de 16/02 ainda é 15/02 em Brasília
    expect(linhaPrazo(r, em("2027-02-16T02:00:00Z"))).toEqual({ tom: "warn", texto: "Último dia para responder à SEFAZ." });
  });
  it("prazo passado, com aviso de chegada registrado e sem resposta final: muted", () => {
    const passou = { tom: "muted", texto: "Passou o prazo: a SEFAZ considera esta compra confirmada." };
    expect(linhaPrazo(resp({ ciencia, prazo_passou: true, pode_responder: false }), AGORA)).toEqual(passou);
    expect(linhaPrazo(resp({ ciencia, prazo_passou: true, pode_responder: false, prazo_final: null }), AGORA)).toEqual(passou);
    // sem aviso de chegada registrado, ou com resposta final ativa: nada
    expect(linhaPrazo(resp({ prazo_passou: true, pode_responder: false }), AGORA)).toBeNull();
    const final = { ...ciencia, tipo: "confirmacao" as const, origem: "dar_entrada" as const };
    expect(linhaPrazo(resp({ ciencia, final, prazo_passou: true, pode_responder: false }), AGORA)).toBeNull();
  });
  it("sem pode_responder e sem prazo passado: null", () => {
    expect(linhaPrazo(resp({ pode_responder: false }), AGORA)).toBeNull();
  });
});

describe("linhaResposta", () => {
  const ev = (estado: EstadoResposta["estado"], p: Partial<EstadoResposta> = {}): EstadoResposta => ({
    estado, em: "2026-11-17T15:00:00Z", protocolo: null, c_stat: null, mensagem: null, ...p,
  });
  const fin = (tipo: "confirmacao" | "nao_reconheco" | "nao_aconteceu", e: EstadoResposta) => ({ ...e, tipo, origem: "admin" as const });
  const resp = (p: Partial<RespostaNota>): RespostaNota => ({ ciencia: null, final: null, prazo_final: null, prazo_perto: false, prazo_passou: false, pode_responder: false, ...p });
  const trocar = "Para mudar, fale com o seu contador: a SEFAZ aceita corrigir uma vez, em até 30 dias.";

  it("sem evento: null", () => {
    expect(linhaResposta(resp({}))).toBeNull();
  });
  it("aviso de chegada", () => {
    for (const e of ["na_fila", "enviando"] as const) {
      expect(linhaResposta(resp({ ciencia: ev(e) }))).toEqual({ icone: "Loader2", texto: "Avisando a SEFAZ que a nota chegou…", tentarDeNovo: false });
    }
    expect(linhaResposta(resp({ ciencia: ev("registrada") }))).toEqual({ icone: "CheckCircle2", texto: "A SEFAZ já sabe que a nota chegou (17/11).", tentarDeNovo: false });
  });
  it("resposta final na fila e registrada (as três)", () => {
    expect(linhaResposta(resp({ ciencia: ev("registrada"), final: fin("confirmacao", ev("na_fila")) })))
      .toEqual({ icone: "Loader2", texto: "Resposta à SEFAZ na fila: sai em alguns minutos.", tentarDeNovo: false });
    expect(linhaResposta(resp({ final: fin("confirmacao", ev("enviando")) }))?.icone).toBe("Loader2");
    expect(linhaResposta(resp({ final: fin("confirmacao", ev("registrada")) })))
      .toEqual({ icone: "CheckCircle2", texto: "Compra confirmada na SEFAZ em 17/11.", tentarDeNovo: false });
    expect(linhaResposta(resp({ final: fin("nao_reconheco", ev("registrada")) })))
      .toEqual({ icone: "CheckCircle2", texto: `Você avisou a SEFAZ que não reconhece esta nota (17/11). ${trocar}`, tentarDeNovo: false });
    expect(linhaResposta(resp({ final: fin("nao_aconteceu", ev("registrada")) })))
      .toEqual({ icone: "CheckCircle2", texto: `Você avisou a SEFAZ que a compra não aconteceu (17/11). ${trocar}`, tentarDeNovo: false });
  });
  it("recusada: a frase do servidor como vem; sem frase, a do código", () => {
    const frases = [
      "A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.",
      "A SEFAZ não aceitou a resposta: passou o prazo.",
      "Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.",
      "A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa.",
      "A SEFAZ não aceitou a resposta: a chave de acesso não confere.",
      "A SEFAZ não aceitou a resposta (código 999). Fale com o seu contador.",
    ];
    for (const mensagem of frases) {
      expect(linhaResposta(resp({ final: fin("confirmacao", ev("recusada", { c_stat: 650, mensagem })) }))).toEqual({ icone: "Ban", texto: mensagem, tentarDeNovo: false });
    }
    expect(linhaResposta(resp({ final: fin("confirmacao", ev("recusada", { c_stat: 493 })) }))?.texto)
      .toBe("A SEFAZ não aceitou a resposta (código 493). Fale com o seu contador.");
    // recusa do aviso de chegada (655: já respondida por outro) quando não há resposta final
    expect(linhaResposta(resp({ ciencia: ev("recusada", { c_stat: 655, mensagem: frases[2]! }) }))?.texto).toBe(frases[2]);
  });
  it("falhou: Tentar de novo (só aqui)", () => {
    expect(linhaResposta(resp({ final: fin("confirmacao", ev("falhou")) })))
      .toEqual({ icone: "CircleAlert", texto: "Não consegui enviar a resposta à SEFAZ depois de 3 tentativas.", tentarDeNovo: true });
    expect(linhaResposta(resp({ ciencia: ev("falhou") }))?.tentarDeNovo).toBe(true);
    // evento que não assinou: a frase do servidor
    expect(linhaResposta(resp({ final: fin("confirmacao", ev("falhou", { mensagem: "Não consegui assinar." })) }))).toEqual({ icone: "CircleAlert", texto: "Não consegui assinar.", tentarDeNovo: true });
    for (const e of ["na_fila", "registrada", "recusada"] as const) {
      expect(linhaResposta(resp({ final: fin("confirmacao", ev(e)) }))?.tentarDeNovo).toBe(false);
    }
  });
  it("evento cancelado não aparece", () => {
    expect(linhaResposta(resp({ ciencia: ev("cancelada") }))).toBeNull();
  });
});

describe("faixaPrazo", () => {
  const n = (numero: string, nome: string, prazo_final: string) => ({ id: numero, numero, serie: "1", emitente_nome: nome, prazo_final });
  it("0, 1 e várias", () => {
    expect(faixaPrazo([])).toBeNull();
    expect(faixaPrazo([n("4411", "ATACADÃO S.A.", "2027-02-16T02:30:00Z")])).toBe(
      "A NF 4411 de ATACADÃO S.A. precisa de uma resposta à SEFAZ até 15/02/2027. Lance a nota, toque em Não reconheço ou escolha um motivo em Ignorar.",
    );
    expect(faixaPrazo([n("1", "A", "2027-02-16T02:30:00Z"), n("2", "B", "2027-02-20T12:00:00Z"), n("3", "C", "2027-03-01T12:00:00Z")])).toBe(
      "3 notas precisam de uma resposta à SEFAZ. A primeira vence em 15/02/2027.",
    );
  });
});

describe("avisoDoMotivo", () => {
  const BOTAO = "Ignorar nota";
  const AVISAR = "Avisar a SEFAZ e ignorar";
  it("com resposta possível: os cinco motivos", () => {
    expect(avisoDoMotivo("lancada_de_outro_jeito", true)).toEqual({ linha: "A SEFAZ é avisada de que a compra aconteceu, como quando você lança a nota.", avisa: "sempre", botao: BOTAO });
    expect(avisoDoMotivo("nao_e_compra", true)).toEqual({
      linha: "Marque se a nota é verdadeira e só não vai para o estoque (por exemplo, um equipamento).", avisa: "opcional", botao: BOTAO,
    });
    expect(avisoDoMotivo("nao_reconheco", true)).toEqual({
      linha: "A SEFAZ é avisada de que a empresa não reconhece esta nota. Use quando você não conhece o fornecedor ou não pediu nada a ele. Depois de enviado, não dá para desfazer aqui.",
      avisa: "sempre", botao: AVISAR,
    });
    expect(avisoDoMotivo("compra_nao_aconteceu", true)).toEqual({
      linha: "A SEFAZ é avisada de que a compra não aconteceu, com o seu texto. Depois de enviado, não dá para desfazer aqui.", avisa: "sempre", botao: AVISAR,
    });
    expect(avisoDoMotivo("outro", true)).toEqual({ linha: "Nada é enviado à SEFAZ.", avisa: "nunca", botao: BOTAO });
    expect(avisoDoMotivo("cancelamento_conferido", true)).toEqual({ linha: null, avisa: "nunca", botao: BOTAO });
  });
  it("nota que não aceita resposta (respostas ligadas): nunca avisa e diz por quê", () => {
    const nao = "Esta nota não aceita resposta à SEFAZ.";
    expect(avisoDoMotivo("lancada_de_outro_jeito", false)).toEqual({ linha: nao, avisa: "nunca", botao: BOTAO });
    expect(avisoDoMotivo("nao_e_compra", false)).toEqual({ linha: nao, avisa: "nunca", botao: BOTAO });
    expect(avisoDoMotivo("nao_reconheco", false)).toEqual({
      linha: `Se você não conhece este fornecedor, fale com o seu contador. Aqui a nota só fica escondida. ${nao}`, avisa: "nunca", botao: BOTAO,
    });
    expect(avisoDoMotivo("compra_nao_aconteceu", false)).toEqual({ linha: nao, avisa: "nunca", botao: BOTAO });
    expect(avisoDoMotivo("outro", false)).toEqual({ linha: "Nada é enviado à SEFAZ.", avisa: "nunca", botao: BOTAO });
  });
  it("respostas desligadas: o diálogo da entrega 2", () => {
    expect(avisoDoMotivo("nao_reconheco", true, false)).toEqual({
      linha: "Se você não conhece este fornecedor, fale com o seu contador. Aqui a nota só fica escondida.", avisa: "nunca", botao: BOTAO,
    });
    expect(avisoDoMotivo("lancada_de_outro_jeito", true, false)).toEqual({ linha: null, avisa: "nunca", botao: BOTAO });
    expect(avisoDoMotivo("outro", true, false)).toEqual({ linha: null, avisa: "nunca", botao: BOTAO });
  });
});

describe("textos que dependem de as respostas estarem ligadas", () => {
  it("textoPorQue", () => {
    expect(textoPorQue(false)).toBe(
      "A SEFAZ entrega só o resumo da nota (fornecedor, valor e data) até a empresa avisar que a recebeu, e as respostas à SEFAZ estão desligadas. " +
      "Por isso, para dar entrada, envie o XML, o PDF ou a foto. Se o seu contador ou o portal da SEFAZ já avisou, a nota completa pode aparecer aqui.",
    );
    expect(textoPorQue(true)).toBe(
      "O sistema já avisou a SEFAZ que a nota chegou. A nota completa costuma aparecer aqui algumas horas depois (a SEFAZ não fixa o prazo). " +
      "Se tiver pressa, lance pelo XML, pelo PDF ou pela foto.",
    );
  });
  it("aberturaBusca", () => {
    const comeco = "Traz para a Entrada de Notas as notas emitidas para a sua empresa, para você ver o que falta lançar e saber se um fornecedor cancelou uma nota. ";
    expect(aberturaBusca(false)).toBe(`${comeco}A busca só consulta. O que o sistema envia à SEFAZ fica no quadro Respostas à SEFAZ, logo abaixo, e vem desligado.`);
    expect(aberturaBusca(true)).toBe(`${comeco}A busca só consulta. Com as respostas ligadas, a nota completa costuma chegar algumas horas depois do resumo.`);
  });
});

describe("normalizarJustificativa (cópia da API: os mesmos vetores de api/src/modules/sefaz/__tests__/eventos-xml.spec.ts)", () => {
  it.each<[string, string]>([
    ["Mercadoria devolvida — “recusada” na porta’", "Mercadoria devolvida - \"recusada\" na porta'"],
    ["  pedido\ncancelado pelo fornecedor  ", "pedido cancelado pelo fornecedor"],
    ["Pedido cancelad", "Pedido cancelad"],
    ["‘Devolvido’ – \t\r\n inteiro", "'Devolvido' - inteiro"],
    ["a".repeat(255), "a".repeat(255)],
  ])("ok: %j", (entrada, texto) => {
    expect(normalizarJustificativa(entrada)).toEqual({ ok: true, texto });
  });
  it.each<[string, "curta" | "longa" | "caractere"]>([
    ["Pedido cancela", "curta"],
    ["   Pedido   cancela   ", "curta"],
    ["", "curta"],
    ["a".repeat(256), "longa"],
    ["Devolvido 🍅 inteiro", "caractere"],
    ["Devolvido \u0001 inteiro", "caractere"],
    ["Devolvido Ā inteiro", "caractere"],
  ])("recusa %j: %s", (entrada, erro) => {
    expect(normalizarJustificativa(entrada)).toEqual({ ok: false, erro });
  });
  it("U+0085, U+2028 e U+2029 viram um espaço", () => {
    for (const c of [0x85, 0x2028, 0x2029]) {
      expect(normalizarJustificativa(`Mercadoria${String.fromCharCode(c)}devolvida`)).toEqual({ ok: true, texto: "Mercadoria devolvida" });
    }
    expect(normalizarJustificativa(`Mercadoria \u0085 \u2028devolvida`)).toEqual({ ok: true, texto: "Mercadoria devolvida" });
  });
});

describe("acoesDaNota com resposta à SEFAZ", () => {
  const resposta = (pode_responder: boolean): RespostaNota => ({ ciencia: null, final: null, prazo_final: null, prazo_perto: false, prazo_passou: false, pode_responder });
  const n = (p: Partial<NotaSefaz>): NotaSefaz => ({
    id: "n", chave: "1".repeat(44), emitente_cnpj: "1", emitente_nome: "A", numero: "1", serie: "1", emitida_em: null, autorizada_em: null, valor_total: 1,
    situacao_sefaz: "autorizada", cancelada_em: null, situacao: "falta_lancar", lancada: null, parecidas: [], pode_conferir: true, nao_parece_compra: false, ignorada: null,
    resposta: null, ...p,
  });
  it("Não reconheço só com pode_responder E as respostas ligadas, em falta lançar e parece lançada", () => {
    expect(acoesDaNota(n({ resposta: resposta(true) }), true)).toEqual({ primaria: "conferir", secundarias: ["ignorar", "nao_reconheco", "copiar_chave"] });
    expect(acoesDaNota(n({ situacao: "parece_lancada", resposta: resposta(true) }), true))
      .toEqual({ primaria: "mesma_nota", secundarias: ["lancar_mesmo_assim", "nao_reconheco"] });
    expect(acoesDaNota(n({ resposta: resposta(false) }), true).secundarias).toEqual(["ignorar", "copiar_chave"]);
    expect(acoesDaNota(n({ resposta: null }), true).secundarias).toEqual(["ignorar", "copiar_chave"]);
    expect(acoesDaNota(n({ resposta: resposta(true) }), false).secundarias).toEqual(["ignorar", "copiar_chave"]);
    expect(acoesDaNota(n({ resposta: resposta(true) })).secundarias).toEqual(["ignorar", "copiar_chave"]); // sem dizer que estão ligadas: nunca oferece
    expect(acoesDaNota(n({ situacao: "ja_lancada", resposta: resposta(true) }), true)).toEqual({ primaria: null, secundarias: [] });
    expect(TEXTO_ACAO.nao_reconheco).toBe("Não reconheço…");
  });
});
