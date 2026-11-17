// Regras puras da tela "Notas da SEFAZ": horas, frases, estado do painel de ativação e a tag de cada nota. Nada aqui lê relógio nem rede
// (o relógio vem por parâmetro). Textos literais da UX (docs/superpowers/specs/2026-11-16-notas-sefaz-ux.md §3 e §4).
import { dataHoraSp } from "./certificado";
import type { MotivoIgnorar, NotaSefaz, SituacaoBuscaSefaz, SituacaoSefazLigada } from "./erp-api";
import { origemPorExtenso } from "./nota-repetida";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 24 * 60 * 60_000;

function partes(d: Date): Record<string, string> {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "15h10" no fuso de Brasília. */
export function horaSp(iso: string): string {
  const p = partes(new Date(iso));
  return `${p.hour}h${p.minute}`;
}

const diaSp = (d: Date) => { const p = partes(d); return `${p.year}-${p.month}-${p.day}`; };
const ddmm = (iso: string) => { const p = partes(new Date(iso)); return `${p.day}/${p.month}`; };
/** "AAAA-MM-DD" → "DD/MM" pela divisão do texto (nunca por Date). */
const ddmmDeData = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** "hoje às 14h05" | "ontem às 09h30" | "em 14/11 às 09h30". */
export function quando(iso: string, agora: Date): string {
  const d = new Date(iso);
  const dia = diaSp(d);
  if (dia === diaSp(agora)) return `hoje às ${horaSp(iso)}`;
  if (dia === diaSp(new Date(agora.getTime() - DIA_MS))) return `ontem às ${horaSp(iso)}`;
  return `em ${ddmm(iso)} às ${horaSp(iso)}`;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export function linhaUltimaBusca(s: SituacaoSefazLigada, agora: Date): string {
  if (!s.ultima_consulta) return "Ainda não buscou.";
  const n = s.ultima_consulta.novas;
  const fim = n <= 0 ? "nada novo" : `${n} ${plural(n, "nota nova", "notas novas")}`;
  return `Última busca ${quando(s.ultima_consulta.em, agora)}: ${fim}`;
}

/** O momento em que a próxima busca é permitida: o maior entre a agenda e o bloqueio da SEFAZ. */
function liberaEm(s: SituacaoSefazLigada): string | null {
  const a = s.proxima_consulta_em;
  const b = s.bloqueado_ate;
  if (a && b) return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  return a ?? b;
}

export function linhaProxima(s: SituacaoSefazLigada): string | null {
  const t = liberaEm(s);
  return t ? `Próxima busca a partir das ${horaSp(t)}` : null;
}

export function linhaEspera(s: SituacaoSefazLigada): string {
  const t = liberaEm(s);
  return `${t ? `Próxima busca a partir das ${horaSp(t)}` : "Próxima busca em breve"}. A SEFAZ não deixa buscar antes.`;
}

export function estadoBuscar(s: SituacaoSefazLigada, agora: Date): "sem_botao" | "buscando" | "espera" | "normal" {
  if (!s.busca_ligada) return "sem_botao";
  if (s.em_andamento) return "buscando";
  const t = liberaEm(s);
  return t && new Date(t).getTime() > agora.getTime() ? "espera" : "normal";
}

export function toastBuscaFeita(novas: number): string {
  return novas <= 0 ? "Busca feita: nada novo." : `Busca feita: ${novas} ${plural(novas, "nota nova", "notas novas")}.`;
}

export const contagemAba = (s: SituacaoSefazLigada): number => s.contagem.falta_lancar + s.contagem.parece_lancada;

export function faixaCancelamento(c: SituacaoSefazLigada["canceladas_depois"]): string | null {
  const fim = "Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso.";
  if (c.length === 0) return null;
  if (c.length === 1) return `A NF ${c[0]!.numero} de ${c[0]!.emitente_nome}, que você já lançou, foi cancelada pelo fornecedor. ${fim}`;
  return `${c.length} notas que você já lançou foram canceladas pelo fornecedor. ${fim}`;
}

export const TEXTO_MOTIVO: Record<MotivoIgnorar, string> = {
  lancada_de_outro_jeito: "Já lancei de outro jeito",
  nao_e_compra: "Não é compra",
  nao_reconheco: "Não reconheço esta nota",
  outro: "Outro motivo",
  cancelamento_conferido: "Marcada como vista",
};

// ------------------------------------------------------------------------------------------------ painel de ativação

export type TomSefaz = "neutro" | "ok" | "warn" | "bad" | "muted";
export type ResumoPainelSefaz = {
  tag: { tom: TomSefaz; texto: "Ligada" | "Desligada" | "Parada" | "Pausada" } | null;
  botao: "ligar" | "ligar_de_novo" | "desligar" | null;
  botaoDesabilitado: boolean;
  caixas: { tom: "neutro" | "warn" | "bad"; texto: string; irParaCertificado?: true }[];
  linhas: string[];
};

const FRASE_SERVIDOR_DESLIGADO = "A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la.";
const FRASE_60_DIAS = "Com a busca desligada por mais de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam.";

/** O código do certificado chega como `CERTIFICADO_VENCIDO`; aceita também o nome curto. */
const codigoCurto = (c: string | null) => (c ?? "").replace(/^CERTIFICADO_/, "");

export function resumoPainel(s: SituacaoBuscaSefaz, agora: Date): ResumoPainelSefaz {
  if (s.ambiente === "desligado") {
    return { tag: null, botao: null, botaoDesabilitado: false, caixas: [{ tom: "neutro", texto: FRASE_SERVIDOR_DESLIGADO }], linhas: [] };
  }
  const parada = s.situacao.startsWith("parada_");
  const ligada = s.busca_ligada;

  const tag: NonNullable<ResumoPainelSefaz["tag"]> = parada
    ? { tom: "bad", texto: "Parada" }
    : ligada && !s.certificado.ok
      ? { tom: "warn", texto: "Pausada" }
      : ligada
        ? { tom: "ok", texto: "Ligada" }
        : { tom: "muted", texto: "Desligada" };
  const botao = ligada ? "desligar" : parada ? "ligar_de_novo" : "ligar";
  const botaoDesabilitado = !ligada && (!s.certificado.ok || s.cnpj === null);

  const caixas: ResumoPainelSefaz["caixas"] = [];
  if (parada && s.mensagem) caixas.push({ tom: "bad", texto: s.mensagem });
  else if (s.situacao === "ok" && s.mensagem) caixas.push({ tom: "warn", texto: s.mensagem });
  if (!s.certificado.ok && s.certificado.mensagem) {
    const c = codigoCurto(s.certificado.code);
    const ir = c === "NAO_CADASTRADO" || c === "VENCIDO" || c === "ILEGIVEL";
    caixas.push({ tom: c === "NAO_CADASTRADO" ? "neutro" : "bad", texto: s.certificado.mensagem, ...(ir ? { irParaCertificado: true as const } : {}) });
  }
  if (s.outro_cnpj_ou_modo) caixas.push({ tom: "warn", texto: "O CNPJ da empresa mudou desde a última vez. Ligue a busca de novo." });
  if (s.lacunas > 0) {
    caixas.push({ tom: "warn", texto: `Uma resposta da SEFAZ se perdeu e até ${s.lacunas} notas podem não ter chegado. Essas entram pelo arquivo ou pela foto.` });
  }
  if (s.aviso) caixas.push({ tom: "warn", texto: s.aviso });
  for (const a of s.certificado.avisos) caixas.push({ tom: "warn", texto: a });
  if (!ligada && s.dias_sem_buscar !== null && s.dias_sem_buscar > 50) {
    caixas.push({
      tom: "warn",
      texto: `A busca está desligada há ${s.dias_sem_buscar} dias. Passando de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam. Ligue a busca de novo.`,
    });
  }
  if (s.primeira_consulta_em) {
    const idade = agora.getTime() - new Date(s.primeira_consulta_em).getTime();
    if (idade >= 0 && idade <= DIA_MS) {
      caixas.push({ tom: "neutro", texto: "Primeira busca feita. A SEFAZ passa a separar as notas deste CNPJ a partir de agora; as emitidas antes não aparecem aqui." });
    }
  }

  const linhas: string[] = [];
  if (ligada) {
    linhas.push(linhaUltimaBusca(s, agora));
    const prox = linhaProxima(s);
    if (prox) linhas.push(prox.replace("Próxima busca a partir", "Próxima a partir"));
    const n = contagemAba(s);
    if (n > 0) linhas.push(`${n} ${plural(n, "nota", "notas")} para conferir`);
    if (s.ligada_em) linhas.push(`Ligada${s.ligada_por_nome ? ` por ${s.ligada_por_nome}` : ""} em ${dataHoraSp(s.ligada_em)}`);
    if (s.ambiente === "homologacao") linhas.push("Modo de teste da SEFAZ: as notas são de mentira.");
  } else {
    linhas.push(FRASE_60_DIAS);
  }
  return { tag, botao, botaoDesabilitado, caixas, linhas };
}

// ------------------------------------------------------------------------------------------------ tag de cada nota

export type TagNota = {
  tom: TomSefaz;
  icone: "CircleAlert" | "EyeOff" | "Ban" | "CheckCircle2" | "Copy";
  texto: string;
  detalhe: string | null;
  soResumo: boolean;
  podeNaoSerCompra: boolean;
};

export function tagDaNota(n: NotaSefaz): TagNota {
  const marcas = {
    soResumo: !n.pode_conferir && (n.situacao === "falta_lancar" || n.situacao === "parece_lancada"),
    podeNaoSerCompra: n.nao_parece_compra,
  };
  const t = (tom: TomSefaz, icone: TagNota["icone"], texto: string, detalhe: string | null = null): TagNota => ({ tom, icone, texto, detalhe, ...marcas });
  switch (n.situacao) {
    case "cancelada_depois_de_lancada":
      return t("bad", "CircleAlert", "Cancelada pelo fornecedor depois de você lançar");
    case "ignorada": {
      const ig = n.ignorada;
      if (!ig) return t("muted", "EyeOff", "Ignorada");
      const motivo = ig.motivo === "outro" && ig.texto ? ig.texto : TEXTO_MOTIVO[ig.motivo];
      return t("muted", "EyeOff", "Ignorada", `Motivo: ${motivo} · ${ig.por_nome ? `por ${ig.por_nome}, ` : ""}${ddmm(ig.em)}`);
    }
    case "cancelada":
      return t("muted", "Ban", "Cancelada pelo fornecedor. Não precisa lançar.");
    case "denegada":
      return t("bad", "Ban", "Recusada pela SEFAZ (denegada). Esta nota não vale.");
    case "ja_lancada": {
      const l = n.lancada ?? n.parecidas[0];
      return t("ok", "CheckCircle2", l ? `Já lançada ${origemPorExtenso(l.origem)} em ${ddmmDeData(l.data_entrada)}` : "Já lançada");
    }
    case "parece_lancada": {
      const p = n.parecidas[0] ?? n.lancada;
      return t("warn", "Copy", p ? `Parece a NF ${p.numero ?? "—"} que você lançou ${origemPorExtenso(p.origem)} em ${ddmmDeData(p.data_entrada)}` : "Parece já lançada");
    }
    default:
      return t("warn", "CircleAlert", "Falta lançar");
  }
}

/** Histórico do painel, do mais novo para o mais antigo (a API já manda nessa ordem): "Ligada por Ana em 16/11/2026 às 14h32". */
export function linhasHistoricoSefaz(h: SituacaoSefazLigada["historico"]): string[] {
  return h.map((e) => {
    const quando = dataHoraSp(e.feito_em);
    const por = e.feito_por_nome ? ` por ${e.feito_por_nome}` : "";
    if (e.evento === "ligada") return `Ligada${por} em ${quando}`;
    if (e.evento === "desligada") return `Desligada${por} em ${quando}`;
    return `Parou sozinha em ${quando}${e.c_stat !== null ? ` (código ${e.c_stat})` : ""}`;
  });
}
