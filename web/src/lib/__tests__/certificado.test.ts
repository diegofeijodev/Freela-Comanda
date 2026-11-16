import { describe, expect, it } from "vitest";
import type { CertificadoStatus, ItemHistoricoCertificado } from "../erp-api";
import {
  arquivoParaBase64, dataHoraSp, dataSp, faixaDoCertificado, faltamDias, formatarCnpj, linhasDoHistorico, nomeDoTipo, resumoDoCertificado, rotuloVencimento,
  validarArquivoCertificado,
} from "../certificado";

const EMPRESA = "12345678000195";
const base: CertificadoStatus = {
  situacao: "valido", titular: "Empresa de Teste Ltda", cnpj: EMPRESA, cnpj_confere: "igual", tipo: "A1", politica_oid: "2.16.76.1.2.1.1",
  emissor: "AC Teste", valido_de: "2026-01-01T00:00:00.000Z", valido_ate: "2027-03-10T02:59:59.000Z", dias_restantes: 114, cadeia_conferida: true,
  enviado_em: "2026-11-16T17:32:00.000Z", enviado_por_nome: "Ana", historico: [],
};
const com = (p: Partial<CertificadoStatus>): CertificadoStatus => ({ ...base, ...p });

describe("datas e rótulos", () => {
  it("dia de vencimento conta em Brasília", () => {
    expect(dataSp("2027-03-10T02:59:59.000Z")).toBe("09/03/2027");
    expect(dataHoraSp("2026-11-16T17:32:00.000Z")).toBe("16/11/2026 às 14h32");
  });
  it("rótulo de vencimento", () => {
    expect(rotuloVencimento(0)).toBe("Vence hoje");
    expect(rotuloVencimento(1)).toBe("Vence amanhã");
    expect(rotuloVencimento(12)).toBe("Vence em 12 dias");
  });
});

describe("faltamDias", () => {
  it("singular e plural", () => {
    expect(faltamDias(0)).toBe("vence hoje");
    expect(faltamDias(1)).toBe("falta 1 dia");
    expect(faltamDias(2)).toBe("faltam 2 dias");
    expect(faltamDias(114)).toBe("faltam 114 dias");
  });
});

describe("CNPJ e arquivo", () => {
  it("formata CNPJ numérico e alfanumérico", () => {
    expect(formatarCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatarCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
  it("valida extensão e tamanho", () => {
    expect(validarArquivoCertificado({ name: "a.PFX", size: 4096 })).toBeNull();
    expect(validarArquivoCertificado({ name: "a.pdf", size: 100 })).toBe(
      "Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou.",
    );
    expect(validarArquivoCertificado({ name: "a.p12", size: 65_537 })).toBe("Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).");
    expect(validarArquivoCertificado({ name: "a.p12", size: 65_536 })).toBeNull();
  });
  it("converte o arquivo para base64", async () => {
    expect(await arquivoParaBase64(new File([new Uint8Array([0x30, 0x82, 0xff])], "a.pfx"))).toBe("MIL/");
  });
  it("nome do tipo pela política", () => {
    expect(nomeDoTipo("2.16.76.1.2.3.999")).toBe("A3");
    expect(nomeDoTipo("2.16.76.1.2.2.1")).toBe("A2");
    expect(nomeDoTipo("2.16.76.1.2.4.7")).toBe("A4");
    expect(nomeDoTipo("2.16.76.1.2.202.1")).toBe("SE-H");
    expect(nomeDoTipo("2.16.76.1.2.1.1")).toBeNull();
    expect(nomeDoTipo(null)).toBeNull();
  });
});

describe("resumoDoCertificado", () => {
  it("ausente", () => {
    const r = resumoDoCertificado(com({ situacao: "ausente", titular: null, cnpj: null }), EMPRESA);
    expect(r).toMatchObject({ tom: "neutro", etiqueta: "Nenhum certificado guardado", acao: "enviar", avisos: [], problema: null });
  });
  it("válido sem aviso", () => {
    expect(resumoDoCertificado(base, EMPRESA)).toMatchObject({ tom: "ok", etiqueta: "Válido", acao: "substituir", avisos: [], problema: null });
  });
  it("vencendo", () => {
    const r = resumoDoCertificado(com({ situacao: "vencendo", dias_restantes: 12 }), EMPRESA);
    expect(r).toMatchObject({ tom: "warn", etiqueta: "Vence em 12 dias", acao: "renovar" });
    expect(r.avisos[0]).toBe("Vence em 09/03/2027. Peça o novo certificado ao seu contador e envie aqui antes dessa data.");
    expect(resumoDoCertificado(com({ situacao: "vencendo", dias_restantes: 1 }), EMPRESA).etiqueta).toBe("Vence amanhã");
    expect(resumoDoCertificado(com({ situacao: "vencendo", dias_restantes: 0 }), EMPRESA).etiqueta).toBe("Vence hoje");
  });
  it("mesma raiz", () => {
    const r = resumoDoCertificado(com({ cnpj_confere: "mesma_raiz", cnpj: "12345678000276" }), EMPRESA);
    expect(r).toMatchObject({ tom: "warn", etiqueta: "Válido, com aviso", acao: "substituir" });
    expect(r.avisos).toEqual([
      "Este certificado é do CNPJ 12.345.678/0002-76, outro estabelecimento da mesma empresa. Foi aceito. Se a SEFAZ recusar, envie o certificado do CNPJ 12.345.678/0001-95.",
    ]);
  });
  it("cadeia não conferida", () => {
    const r = resumoDoCertificado(com({ cadeia_conferida: false }), EMPRESA);
    expect(r).toMatchObject({ tom: "warn", etiqueta: "Válido, com aviso" });
    expect(r.avisos).toEqual(["Guardado, mas não consegui conferir a emissora do certificado. Isso não impede de guardar; a SEFAZ confere na hora de usar."]);
  });
  it("tipo diferente de A1", () => {
    const r = resumoDoCertificado(com({ tipo: "outro", politica_oid: "2.16.76.1.2.3.999" }), EMPRESA);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain("(é o tipo A3)");
    expect(resumoDoCertificado(com({ tipo: "SE-S" }), EMPRESA)).toMatchObject({ tom: "ok", avisos: [] });
  });
  it("empresa sem CNPJ", () => {
    const r = resumoDoCertificado(com({ cnpj_confere: "empresa_sem_cnpj" }), "");
    expect(r.avisos).toEqual(["A empresa está sem CNPJ salvo em Configurações. Preencha o CNPJ no quadro Empresa e toque em Salvar."]);
  });
  it("vencido", () => {
    const r = resumoDoCertificado(com({ situacao: "vencido", dias_restantes: -3 }), EMPRESA);
    expect(r).toMatchObject({ tom: "bad", etiqueta: "Vencido", acao: "renovar" });
    expect(r.problema).toBe("Este certificado venceu em 09/03/2027. Envie o certificado renovado para voltar a usar.");
  });
  it("ilegível", () => {
    expect(resumoDoCertificado(com({ situacao: "ilegivel" }), EMPRESA)).toMatchObject({ tom: "bad", etiqueta: "Não pode ser lido", acao: "enviar_de_novo" });
  });
  it("CNPJ diferente usa o CNPJ salvo da empresa", () => {
    const r = resumoDoCertificado(com({ cnpj_confere: "diferente", cnpj: "99888777000166" }), "11222333000181");
    expect(r).toMatchObject({ tom: "bad", etiqueta: "CNPJ não confere" });
    expect(r.problema).toBe(
      "Este certificado é do CNPJ 99.888.777/0001-66, mas a empresa agora está com o CNPJ 11.222.333/0001-81. Corrija o CNPJ da empresa ou envie o certificado certo.",
    );
  });
  it("sem segredo no servidor", () => {
    const r = resumoDoCertificado(com({ situacao: "sem_segredo", titular: null }), EMPRESA);
    expect(r).toMatchObject({ tom: "bad", etiqueta: "Servidor não pronto", acao: null });
    expect(r.problema).toBe("O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda.");
  });
});

describe("linhasDoHistorico", () => {
  const item = (p: Partial<ItemHistoricoCertificado>): ItemHistoricoCertificado => ({
    evento: "enviado", feito_por_nome: "Ana", feito_em: "2026-11-16T17:32:00.000Z", valido_ate: "2027-03-10T02:59:59.000Z", cnpj: EMPRESA, titular: "Empresa A", ...p,
  });
  it("uma linha por evento, com o verbo certo", () => {
    const [a, b, c] = linhasDoHistorico([item({ evento: "removido" }), item({ evento: "substituido" }), item({})]);
    expect(a).toContain("Removido por Ana em 16/11/2026 às 14h32");
    expect(b).toContain("Substituído por Ana em 16/11/2026 às 14h32 (vale até 09/03/2027)");
    expect(c).toContain("Enviado por Ana em 16/11/2026 às 14h32");
  });
  it("titular e CNPJ só quando mudam, e sempre no mais velho", () => {
    const l = linhasDoHistorico([
      item({ evento: "substituido" }),
      item({ evento: "substituido", feito_em: "2026-11-15T17:32:00.000Z" }),
      item({ evento: "enviado", feito_em: "2026-11-14T17:32:00.000Z", titular: "Empresa B", cnpj: "99888777000166" }),
    ]);
    expect(l[0]).not.toContain("Empresa");
    expect(l[1]).toContain("Empresa A");
    expect(l[1]).toContain("CNPJ 12.345.678/0001-95");
    expect(l[2]).toContain("Empresa B");
    expect(l[2]).toContain("CNPJ 99.888.777/0001-66");
  });
  it("sozinho mostra titular e CNPJ", () => {
    expect(linhasDoHistorico([item({})])[0]).toContain("Empresa A");
  });
});

describe("faixaDoCertificado", () => {
  // Meio-dia em Brasília (15:00Z): somar N dias inteiros dá o dia civil N dias depois.
  const AGORA = new Date("2026-11-16T15:00:00.000Z");
  // n = 0 cai 1 h depois de `agora` (no mesmo dia, ainda vigente); n = -1 cai um dia antes (vencido).
  const em = (n: number) => new Date(AGORA.getTime() + (n === 0 ? 3_600_000 : n * 86_400_000)).toISOString();
  const dia = (n: number) => dataSp(em(n));
  const faixa = (p: Partial<CertificadoStatus>, agora = AGORA) => faixaDoCertificado(com({ situacao: "valido", dias_restantes: 114, ...p }), agora);
  const vence = (n: number, p: Partial<CertificadoStatus> = {}) => faixa({ valido_ate: em(n), ...p });
  const TXT_CNPJ = "O certificado digital não é do CNPJ da empresa. Confira em Configurações.";

  it("sem faixa: carregando, ausente, sem segredo e 31 dias", () => {
    expect(faixaDoCertificado(undefined, AGORA)).toBeNull();
    expect(faixa({ situacao: "ausente", valido_ate: null })).toBeNull();
    expect(faixa({ situacao: "sem_segredo", valido_ate: null })).toBeNull();
    expect(vence(31)).toBeNull();
    expect(vence(114)).toBeNull();
  });
  it("sem faixa para avisos só do painel", () => {
    expect(vence(114, { cnpj_confere: "mesma_raiz" })).toBeNull();
    expect(vence(114, { cadeia_conferida: false })).toBeNull();
    expect(vence(114, { tipo: "outro" })).toBeNull();
    expect(vence(114, { cnpj_confere: "empresa_sem_cnpj" })).toBeNull();
  });
  it("30 e 8 dias: aviso dispensável", () => {
    expect(vence(30)).toEqual({ tom: "warn", dispensavel: true, texto: `O certificado digital vence em 30 dias (${dia(30)}). Envie o renovado em Configurações.` });
    expect(vence(20)).toEqual({ tom: "warn", dispensavel: true, texto: `O certificado digital vence em 20 dias (${dia(20)}). Envie o renovado em Configurações.` });
    expect(vence(8)).toMatchObject({ tom: "warn", dispensavel: true });
  });
  it("7 dias ou menos: forte e sem dispensar", () => {
    expect(vence(7)).toEqual({ tom: "warn_forte", dispensavel: false, texto: `O certificado digital vence em 7 dias (${dia(7)}). Envie o renovado em Configurações.` });
    expect(vence(1)).toMatchObject({ tom: "warn_forte", dispensavel: false, texto: `O certificado digital vence amanhã (${dia(1)}). Envie o renovado em Configurações.` });
    expect(vence(0)).toMatchObject({ tom: "warn_forte", dispensavel: false, texto: `O certificado digital vence hoje (${dia(0)}). Envie o renovado em Configurações.` });
  });
  it("vence mais tarde hoje ainda é 'hoje'; passou o instante é vencido (dia em Brasília)", () => {
    const quase = new Date("2026-11-17T02:30:00.000Z"); // 16/11 23h30 em Brasília
    expect(faixa({ valido_ate: "2026-11-17T02:59:59.000Z" }, quase)?.texto).toContain("vence hoje (16/11/2026)");
    const passou = new Date("2026-11-17T03:30:00.000Z"); // 17/11 00h30
    expect(faixa({ valido_ate: "2026-11-17T02:59:59.000Z" }, passou)).toMatchObject({ tom: "bad", texto: "O certificado digital venceu em 16/11/2026. Envie o renovado em Configurações." });
  });
  it("vencido: vermelha, sem dispensar, mesmo com a resposta guardada ainda dizendo 'vencendo'", () => {
    const esperado = { tom: "bad", dispensavel: false, texto: `O certificado digital venceu em ${dia(-1)}. Envie o renovado em Configurações.` };
    expect(vence(-1, { situacao: "vencido", dias_restantes: -1 })).toEqual(esperado);
    expect(vence(-1, { situacao: "vencendo", dias_restantes: 0 })).toEqual(esperado);
    expect(vence(-1, { situacao: "vencido", cnpj_confere: "diferente" })).toEqual(esperado); // vencido ganha do CNPJ
  });
  it("ilegível: vermelha, sem dispensar, ganha de tudo", () => {
    expect(faixa({ situacao: "ilegivel", valido_ate: null, cnpj_confere: "diferente" })).toEqual({
      tom: "bad", dispensavel: false, texto: "O certificado digital guardado não pode mais ser lido. Envie o arquivo de novo em Configurações.",
    });
    expect(vence(-3, { situacao: "ilegivel" })?.texto).toContain("não pode mais ser lido");
  });
  it("CNPJ diferente: vermelha, sem dispensar, mesmo com 20 ou 114 dias; ganha do vencendo", () => {
    expect(vence(20, { cnpj_confere: "diferente" })).toEqual({ tom: "bad", dispensavel: false, texto: TXT_CNPJ });
    expect(vence(114, { cnpj_confere: "diferente" })).toEqual({ tom: "bad", dispensavel: false, texto: TXT_CNPJ });
    expect(vence(3, { cnpj_confere: "diferente" })?.texto).toBe(TXT_CNPJ);
  });
});
