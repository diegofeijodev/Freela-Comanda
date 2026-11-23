import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { PontoDia, PontoEspelho } from "../erp-api";
import { batidasTexto, diaSeguinte, horaSp, horas, linhaResumo, montarPlanilha, nomeAba, ocorrenciasTexto, situacaoDia } from "../ponto";

const dia = (p: Partial<PontoDia>): PontoDia => ({
  data: "2026-11-21", dia_semana: 6, situacao: "normal", previsto: { entrada: "18:00", saida: "02:00", intervalo_min: 0 }, marcacoes: [],
  esperado_min: 480, trabalhado_min: 0, atraso_min: 0, saida_antecipada_min: 0, falta: false, incompleto: false, em_andamento: false,
  abonado_min: 0, extra_50_min: 0, extra_100_min: 0, noturno_min: 0, debito_min: 0, saldo_min: 0, ocorrencias: [], ...p,
});
const totais = { dias_previstos: 1, dias_trabalhados: 1, faltas: 0, esperado_min: 480, trabalhado_min: 500, atraso_min: 0, saida_antecipada_min: 0, abonado_min: 0, extra_50_min: 20, extra_100_min: 0, noturno_min: 240, debito_min: 0, saldo_min: 20, incompletos: 0, pendencias: 0 };
const espelho = (nome: string): PontoEspelho => ({
  colaborador: { id: nome, nome, cpf: null, cargo: "Garçom", escala: "Noite", ativo: true }, ini: "2026-11-01", fim: "2026-11-30",
  dias: [dia({ marcacoes: [{ momento: "2026-11-21T21:00:00.000Z", tipo: "entrada" }, { momento: "2026-11-22T05:20:00.000Z", tipo: "saida" }], trabalhado_min: 500 })],
  totais,
});

describe("ponto (web)", () => {
  it("horas e hora de Brasília", () => {
    expect(horas(-75)).toBe("-1:15");
    expect(horas(600)).toBe("10:00");
    expect(horaSp("2026-11-21T21:00:00.000Z")).toBe("18:00");
    expect(diaSeguinte("2026-11-22T05:20:00.000Z", "2026-11-21")).toBe(true);
  });

  it("textos do dia", () => {
    const d = espelho("A").dias[0]!;
    expect(batidasTexto(d)).toBe("18:00  02:20⁺¹");
    expect(situacaoDia(dia({ falta: true }))).toBe("Falta");
    expect(situacaoDia(dia({ situacao: "feriado" }))).toBe("Feriado");
    expect(ocorrenciasTexto(dia({ ocorrencias: [{ tipo: "atraso", minutos: 30, justificativa: null }, { tipo: "falta", minutos: 480, justificativa: "aceita" }] })))
      .toBe("Atraso 30 min (sem justificativa); Falta (justificativa aceita)");
  });

  it("nome de aba do Excel sem repetir nem caractere proibido", () => {
    const usados = new Set<string>();
    expect(nomeAba("Ana/Maria: [cozinha]", usados)).toBe("Ana Maria   cozinha");
    expect(nomeAba("Ana/Maria: [cozinha]", usados)).toBe("Ana Maria   cozinha (2)");
    expect(nomeAba("x".repeat(40), usados).length).toBeLessThanOrEqual(31);
  });

  it("planilha: resumo + uma aba por colaborador", () => {
    const wb = montarPlanilha([espelho("Ana"), espelho("Bruno")], "2026-11");
    expect(wb.SheetNames).toEqual(["Resumo", "Ana", "Bruno"]);
    const resumo = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Resumo!, { header: 1 });
    expect(resumo[0]).toEqual(["Ponto — 11/2026"]);
    expect(resumo[3]).toEqual(linhaResumo(espelho("Ana")));
    expect(linhaResumo(espelho("Ana")).slice(7, 12)).toEqual(["8:00", "8:20", "0:20", "0:00", "4:00"]);
  });
});
