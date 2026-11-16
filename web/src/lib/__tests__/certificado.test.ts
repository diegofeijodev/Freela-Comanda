import { describe, expect, it } from "vitest";
import type { CertificadoStatus, ItemHistoricoCertificado } from "../erp-api";
import {
  arquivoParaBase64, dataHoraSp, dataSp, formatarCnpj, linhasDoHistorico, nomeDoTipo, resumoDoCertificado, rotuloVencimento,
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
