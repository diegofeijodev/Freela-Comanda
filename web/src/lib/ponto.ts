// Rótulos e exportação do ponto. O cálculo é só no servidor (api/src/modules/ponto/calculo.ts); aqui só formatação.
import * as XLSX from "xlsx";
import type { PontoDia, PontoEspelho, PontoTotais, TipoFolga, TipoMarcacao, TipoOcorrencia } from "./erp-api";

export const ROTULO_MARCACAO: Record<TipoMarcacao, string> = {
  entrada: "Entrada",
  intervalo_inicio: "Saída p/ intervalo",
  intervalo_fim: "Volta do intervalo",
  saida: "Saída",
};
export const ROTULO_OCORRENCIA: Record<TipoOcorrencia, string> = { falta: "Falta", atraso: "Atraso", saida_antecipada: "Saída antecipada" };
export const ROTULO_FOLGA: Record<TipoFolga, string> = { folga: "Folga", feriado: "Feriado", ferias: "Férias", atestado: "Atestado" };
export const DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Minutos → "H:MM" (com sinal quando negativo). Igual ao `minParaHoras` da API. */
export function horas(min: number): string {
  const s = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}
/** Zero vira "—" (tabela mais limpa). */
export const horasOuTraco = (min: number) => (min ? horas(min) : "—");

/** Instante ISO → "HH:MM" em Brasília (o ponto é sempre na hora da loja, não na do navegador). */
export function horaSp(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(11, 16);
}
/** A batida caiu no dia seguinte ao da jornada (turno que vira a noite)? */
export function diaSeguinte(iso: string, data: string): boolean {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) > data;
}

export function situacaoDia(d: PontoDia): string {
  switch (d.situacao) {
    case "folga_escala": return "Folga";
    case "folga": case "feriado": case "ferias": case "atestado": return ROTULO_FOLGA[d.situacao];
    case "sem_escala": return "Sem escala";
    case "antes_admissao": return "—";
    case "futuro": return "";
    default:
      if (d.falta) return "Falta";
      if (d.em_andamento) return "Em andamento";
      if (d.incompleto) return "Batida faltando";
      return "";
  }
}

export function previstoTexto(d: PontoDia): string {
  if (!d.previsto) return "";
  return `${d.previsto.entrada}–${d.previsto.saida}${d.previsto.intervalo_min ? ` (${d.previsto.intervalo_min}′)` : ""}`;
}

export function batidasTexto(d: PontoDia): string {
  return d.marcacoes.map((m) => horaSp(m.momento) + (diaSeguinte(m.momento, d.data) ? "⁺¹" : "")).join("  ");
}

export function ocorrenciasTexto(d: PontoDia): string {
  return d.ocorrencias
    .map((o) => {
      const j = o.justificativa === null ? "sem justificativa" : o.justificativa === "pendente" ? "justificativa em análise" : `justificativa ${o.justificativa}`;
      return `${ROTULO_OCORRENCIA[o.tipo]}${o.tipo === "falta" ? "" : ` ${o.minutos} min`} (${j})`;
    })
    .join("; ");
}

const dataBr = (s: string) => s.split("-").reverse().join("/");

export const CABECALHO_DIAS = ["Data", "Dia", "Previsto", "Batidas", "Situação", "Esperado", "Trabalhado", "Extra 50%", "Extra 100%", "Noturno", "Abonado", "Débito", "Saldo", "Ocorrências"];

export function linhasDias(e: PontoEspelho): (string | number)[][] {
  return e.dias
    .filter((d) => d.situacao !== "antes_admissao")
    .map((d) => [
      dataBr(d.data), DIA_CURTO[d.dia_semana] ?? "", previstoTexto(d), batidasTexto(d), situacaoDia(d),
      horas(d.esperado_min), horas(d.trabalhado_min), horas(d.extra_50_min), horas(d.extra_100_min), horas(d.noturno_min),
      horas(d.abonado_min), horas(d.debito_min), horas(d.saldo_min), ocorrenciasTexto(d),
    ]);
}

export const CABECALHO_RESUMO = ["Colaborador", "Empresa", "CPF", "Cargo", "Escala", "Dias previstos", "Dias trabalhados", "Faltas", "Esperado", "Trabalhado", "Extra 50%", "Extra 100%", "Noturno", "Atrasos", "Saídas antecipadas", "Abonado", "Débito", "Saldo"];

export function linhaResumo(e: PontoEspelho): (string | number)[] {
  const t: PontoTotais = e.totais;
  return [
    e.colaborador.nome, e.empresa?.razao_social ?? "", e.colaborador.cpf ?? "", e.colaborador.cargo ?? "", e.colaborador.escala ?? "",
    t.dias_previstos, t.dias_trabalhados, t.faltas, horas(t.esperado_min), horas(t.trabalhado_min), horas(t.extra_50_min), horas(t.extra_100_min),
    horas(t.noturno_min), horas(t.atraso_min), horas(t.saida_antecipada_min), horas(t.abonado_min), horas(t.debito_min), horas(t.saldo_min),
  ];
}

/** Nome de aba do Excel: até 31 caracteres, sem []:*?/\ e sem repetir. */
export function nomeAba(nome: string, usados: Set<string>): string {
  const base = nome.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Colaborador";
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 27 - String(i).length)} (${i})`;
  usados.add(n.toLowerCase());
  return n;
}

/** Planilha do mês: aba "Resumo" + uma aba por colaborador com o espelho dia a dia. */
export function montarPlanilha(espelhos: PontoEspelho[], mes: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const usados = new Set<string>(["resumo"]);
  const resumo = XLSX.utils.aoa_to_sheet([[`Ponto — ${mes.split("-").reverse().join("/")}`], [], CABECALHO_RESUMO, ...espelhos.map(linhaResumo)]);
  XLSX.utils.book_append_sheet(wb, resumo, "Resumo");
  for (const e of espelhos) {
    const ws = XLSX.utils.aoa_to_sheet([
      ...(e.empresa ? [[`Empregador: ${e.empresa.razao_social}`, `CNPJ: ${e.empresa.cnpj}`, e.empresa.endereco]] : []),
      [e.colaborador.nome],
      [`CPF: ${e.colaborador.cpf ?? "—"}`, `Cargo: ${e.colaborador.cargo ?? "—"}`, `Escala: ${e.colaborador.escala ?? "—"}`],
      [`Período: ${dataBr(e.ini)} a ${dataBr(e.fim)}`],
      [],
      CABECALHO_DIAS,
      ...linhasDias(e),
      [],
      CABECALHO_RESUMO.slice(5),
      linhaResumo(e).slice(5),
    ]);
    XLSX.utils.book_append_sheet(wb, ws, nomeAba(e.colaborador.nome, usados));
  }
  return wb;
}

export function baixarPlanilha(espelhos: PontoEspelho[], mes: string, nomeArquivo: string) {
  XLSX.writeFile(montarPlanilha(espelhos, mes), nomeArquivo);
}
