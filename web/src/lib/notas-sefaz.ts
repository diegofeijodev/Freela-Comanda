// Regras puras da tela "Notas da SEFAZ": horas, frases, estado do painel de ativação e a tag de cada nota. Nada aqui lê relógio nem rede
// (o relógio vem por parâmetro). Textos literais da UX (docs/superpowers/specs/2026-11-16-notas-sefaz-ux.md §3 e §4).
import { dataHoraSp } from "./certificado";
import type { MotivoIgnorar, NotaSefaz, RespostaNota, SituacaoBuscaSefaz, SituacaoSefazLigada } from "./erp-api";
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

const CINCO_MIN_MS = 5 * 60_000;

/**
 * Toast depois de Ligar (com a situação que o PUT devolve). A busca sai no tique de 5 min, mas nunca antes da próxima busca permitida:
 * religar não antecipa a agenda nem o bloqueio da SEFAZ. Hora de Brasília; outro dia leva "em DD/MM".
 */
export function toastBuscaLigada(s: SituacaoBuscaSefaz, agora: Date): string {
  const t = s.ambiente === "desligado" ? null : liberaEm(s);
  if (!t || new Date(t).getTime() - agora.getTime() <= CINCO_MIN_MS) return "Busca ligada. A primeira busca sai em até 5 minutos.";
  const dia = diaSp(new Date(t)) === diaSp(agora) ? "" : `em ${ddmm(t)} `;
  return `Busca ligada. A próxima busca sai ${dia}às ${horaSp(t)}.`;
}

/**
 * Trava de toque duplo por `ref`: o `disabled={ocupado}` só vale depois do re-render, e um 2º toque no mesmo instante mandaria a mesma
 * gravação duas vezes. Ignora a chamada enquanto a anterior não terminou; solta a trava ao terminar, com ou sem erro.
 */
export async function semToqueDuplo(trava: { current: boolean }, acao: () => Promise<void>): Promise<void> {
  if (trava.current) return;
  trava.current = true;
  try {
    await acao();
  } finally {
    trava.current = false;
  }
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
  compra_nao_aconteceu: "A compra não aconteceu (devolvi ou cancelei)",
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

/** Abertura do painel da busca (UX §4 com a §8): a segunda frase muda conforme as respostas à SEFAZ estejam ligadas. Sem a variável, vale a "desligadas". */
export function aberturaBusca(respostasLigadas: boolean): string {
  const comeco = "Traz para a Entrada de Notas as notas emitidas para a sua empresa, para você ver o que falta lançar e saber se um fornecedor cancelou uma nota. ";
  return comeco + (respostasLigadas
    ? "A busca só consulta. Com as respostas ligadas, a nota completa costuma chegar algumas horas depois do resumo."
    : "A busca só consulta. O que o sistema envia à SEFAZ fica no quadro Respostas à SEFAZ, logo abaixo, e vem desligado.");
}

const FRASE_SERVIDOR_DESLIGADO = "A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la.";
const FRASE_60_DIAS = "Com a busca desligada por mais de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam.";

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
    const c = s.certificado.code; // a API manda CERTIFICADO_NAO_CADASTRADO, CERTIFICADO_VENCIDO etc. (ou EMPRESA_SEM_CNPJ)
    const ir = c === "CERTIFICADO_NAO_CADASTRADO" || c === "CERTIFICADO_VENCIDO" || c === "CERTIFICADO_ILEGIVEL";
    caixas.push({ tom: c === "CERTIFICADO_NAO_CADASTRADO" ? "neutro" : "bad", texto: s.certificado.mensagem, ...(ir ? { irParaCertificado: true as const } : {}) });
  }
  if (s.outro_cnpj_ou_modo) caixas.push({ tom: "warn", texto: "O CNPJ da empresa mudou desde a última vez. Ligue a busca de novo." });
  if (s.lacunas > 0) {
    const podem = plural(s.lacunas, "nota pode", "notas podem");
    caixas.push({ tom: "warn", texto: `Uma resposta da SEFAZ se perdeu e até ${s.lacunas} ${podem} não ter chegado. Essas entram pelo arquivo ou pela foto.` });
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

// ------------------------------------------------------------------------------------------------ ações de cada nota

export type AcaoNota =
  | "marcar_visto" | "voltar_lista" | "mesma_nota" | "lancar_mesmo_assim" | "conferir" | "lancar_por_arquivo" | "ignorar" | "nao_reconheco" | "copiar_chave";

/**
 * UX §3 e §8, coluna "Ações": o que cada situação oferece. Os componentes só desenham o que esta tabela devolve. "Não reconheço…" pede a
 * nota respondível (`resposta.pode_responder`, que não olha as respostas ligadas) E as respostas ligadas (`respostasLigadas`, do quadro):
 * quem chama diz; sem dizer, nunca oferece.
 */
export function acoesDaNota(n: NotaSefaz, respostasLigadas = false): { primaria: AcaoNota | null; secundarias: AcaoNota[] } {
  const naoReconheco: AcaoNota[] = respostasLigadas && n.resposta?.pode_responder ? ["nao_reconheco"] : [];
  switch (n.situacao) {
    case "cancelada_depois_de_lancada":
      return { primaria: "marcar_visto", secundarias: [] };
    case "ignorada":
      return { primaria: "voltar_lista", secundarias: [] };
    case "parece_lancada":
      return { primaria: "mesma_nota", secundarias: ["lancar_mesmo_assim", ...naoReconheco] };
    case "falta_lancar":
      return { primaria: n.pode_conferir ? "conferir" : "lancar_por_arquivo", secundarias: ["ignorar", ...naoReconheco, "copiar_chave"] };
    default:
      return { primaria: null, secundarias: [] };
  }
}

export const TEXTO_ACAO: Record<AcaoNota, string> = {
  marcar_visto: "Marcar como visto",
  voltar_lista: "Voltar para a lista",
  mesma_nota: "É a mesma nota",
  lancar_mesmo_assim: "Lançar mesmo assim",
  conferir: "Conferir",
  lancar_por_arquivo: "Lançar por arquivo ou foto",
  ignorar: "Ignorar…",
  nao_reconheco: "Não reconheço…",
  copiar_chave: "Copiar chave",
};

/** "14/11/2026" no fuso de Brasília; "—" sem data. */
export function emissaoSp(iso: string | null): string {
  if (!iso) return "—";
  const p = partes(new Date(iso));
  return `${p.day}/${p.month}/${p.year}`;
}

/** "Conferir"/"Lançar mesmo assim" substituem a nota da aba Lançar nota: se já há uma em conferência, o admin confirma antes de perder o que preencheu. */
export function precisaConfirmarTroca(notaEmConferencia: unknown): boolean {
  return notaEmConferencia !== null && notaEmConferencia !== undefined;
}

// ------------------------------------------------------------------------------------------------ respostas à SEFAZ (UX §8)

export const FRASE_RESPOSTAS_INDISPONIVEIS = "As respostas à SEFAZ não estão ativadas neste servidor. Fale com o suporte do Freela Comanda se quiser usá-las.";
const FRASE_RESPOSTAS_DESLIGADAS = "Com as respostas desligadas, nada é enviado à SEFAZ. O que estava na fila espera até você ligar de novo.";
export const ABERTURA_RESPOSTAS =
  "Com as respostas ligadas, o Freela Comanda avisa a SEFAZ, em nome da empresa e com o certificado digital: que recebeu cada nota nova " +
  "(assim a nota completa chega aqui para conferir); que a compra aconteceu, quando a nota é lançada; e que a empresa não reconhece uma nota, " +
  "quando você tocar em Não reconheço.";

export type ResumoRespostas = {
  tag: { tom: TomSefaz; texto: "Ligadas" | "Desligadas" | "Paradas" | "Esperando a SEFAZ" } | null;
  caixa: { tom: "neutro" | "warn" | "bad"; texto: string; irParaCertificado?: true } | null;
  botao: "ligar" | "desligar" | "ligar_de_novo" | null;
  botaoDesabilitado: boolean;
  /** `ver`: a linha leva o atalho para a lista de notas (UX §8: [Ver as notas] no prazo, [Ver] nas falhas). */
  linhas: { texto: string; ver?: "Ver as notas" | "Ver" }[];
};

/**
 * O quadro "Respostas à SEFAZ". A `mensagem` das respostas (espera ou parada) vem pronta do servidor e é mostrada como vem. Sem certificado
 * ou sem CNPJ, "Ligar" fica desabilitado com as mesmas frases da busca.
 */
export function resumoRespostas(s: SituacaoSefazLigada, agora: Date): ResumoRespostas {
  const r = s.respostas;
  if (!r.disponivel) return { tag: null, caixa: { tom: "neutro", texto: FRASE_RESPOSTAS_INDISPONIVEIS }, botao: null, botaoDesabilitado: false, linhas: [] };

  const parada = r.situacao.startsWith("parada_");
  const esperando = r.ligadas && r.pausa_ate !== null && new Date(r.pausa_ate).getTime() > agora.getTime();
  const tag: NonNullable<ResumoRespostas["tag"]> = parada
    ? { tom: "bad", texto: "Paradas" }
    : esperando
      ? { tom: "warn", texto: "Esperando a SEFAZ" }
      : r.ligadas
        ? { tom: "ok", texto: "Ligadas" }
        : { tom: "muted", texto: "Desligadas" };
  const botao = r.ligadas ? "desligar" : parada ? "ligar_de_novo" : "ligar";
  const botaoDesabilitado = !r.ligadas && (!s.certificado.ok || s.cnpj === null);

  let caixa: ResumoRespostas["caixa"] = null;
  if (parada && r.mensagem) caixa = { tom: "bad", texto: r.mensagem };
  else if (esperando && r.mensagem) caixa = { tom: "warn", texto: r.mensagem };
  else if (!r.ligadas && !s.certificado.ok && s.certificado.mensagem) {
    const c = s.certificado.code;
    const ir = c === "CERTIFICADO_NAO_CADASTRADO" || c === "CERTIFICADO_VENCIDO" || c === "CERTIFICADO_ILEGIVEL";
    caixa = { tom: c === "CERTIFICADO_NAO_CADASTRADO" ? "neutro" : "bad", texto: s.certificado.mensagem, ...(ir ? { irParaCertificado: true as const } : {}) };
  }

  const linhas: ResumoRespostas["linhas"] = [];
  if (r.ligadas) {
    if (r.ligadas_em) linhas.push({ texto: `Ligadas${r.ligadas_por_nome ? ` por ${r.ligadas_por_nome}` : ""} em ${dataHoraSp(r.ligadas_em)}` });
    if (r.na_fila > 0) linhas.push({ texto: `${r.na_fila} ${plural(r.na_fila, "resposta", "respostas")} na fila` });
    const p = r.prazos_perto;
    if (p.length > 0) linhas.push({ texto: `${p.length} ${plural(p.length, "nota precisa", "notas precisam")} de resposta até ${emissaoSp(p[0]!.prazo_final)}`, ver: "Ver as notas" });
    if (r.falharam > 0) linhas.push({ texto: `${r.falharam} ${plural(r.falharam, "resposta não foi enviada", "respostas não foram enviadas")}`, ver: "Ver" });
  } else {
    linhas.push({ texto: FRASE_RESPOSTAS_DESLIGADAS });
  }
  if (s.ambiente === "homologacao") linhas.push({ texto: "Modo de teste da SEFAZ: as respostas valem só para notas de mentira." });
  return { tag, caixa, botao, botaoDesabilitado, linhas };
}

export const toastRespostasLigadas = (): string => "Respostas ligadas. As primeiras saem em até 5 minutos.";

/** Dias de calendário (Brasília) de `de` até `ate`; negativo = já passou. */
function diasAte(ate: Date, de: Date): number {
  const [a, b] = [diaSp(ate), diaSp(de)].map((d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return Math.round((a! - b!) / DIA_MS);
}

/**
 * A linha do prazo no cartão da nota (UX §8). Âmbar na nota em `prazo_perto` (do 80º dia em diante); a respondível comum leva a linha
 * neutra; `prazo_passou` leva a linha muted.
 */
export function linhaPrazo(r: RespostaNota, agora: Date): { tom: "neutro" | "warn" | "muted"; texto: string } | null {
  // `prazo_passou` e `prazo_perto` vêm do servidor, que já conta a ciência possivelmente registrada: sem regra própria aqui.
  if (r.prazo_passou) return { tom: "muted", texto: "Passou o prazo: a SEFAZ considera esta compra confirmada." };
  if (!r.pode_responder || !r.prazo_final) return null;
  const ate = emissaoSp(r.prazo_final);
  if (r.prazo_perto) {
    const dias = diasAte(new Date(r.prazo_final), agora);
    if (dias <= 0) return { tom: "warn", texto: "Último dia para responder à SEFAZ." };
    return { tom: "warn", texto: `${plural(dias, "Falta", "Faltam")} ${dias} ${plural(dias, "dia", "dias")} para responder à SEFAZ (até ${ate}).` };
  }
  return { tom: "neutro", texto: `Responder à SEFAZ até ${ate}` };
}

const FRASE_TROCAR = "Para mudar, fale com o seu contador: a SEFAZ aceita corrigir uma vez, em até 30 dias.";

/**
 * A linha da resposta no cartão (UX §8): a resposta final, se houver; senão o aviso de chegada. A frase da recusa vem do servidor (pelo
 * código); `tentarDeNovo` só no que falhou.
 */
export function linhaResposta(r: RespostaNota): { icone: "Loader2" | "CheckCircle2" | "Ban" | "CircleAlert"; texto: string; tentarDeNovo: boolean } | null {
  const f = r.final && r.final.estado !== "cancelada" ? r.final : null;
  const c = r.ciencia && r.ciencia.estado !== "cancelada" ? r.ciencia : null;
  const e = f ?? c;
  if (!e) return null;
  const dia = ddmm(e.em);
  const linha = (icone: "Loader2" | "CheckCircle2" | "Ban" | "CircleAlert", texto: string, tentarDeNovo = false) => ({ icone, texto, tentarDeNovo });
  switch (e.estado) {
    case "na_fila":
    case "enviando":
      return f ? linha("Loader2", "Resposta à SEFAZ na fila: sai em alguns minutos.") : linha("Loader2", "Avisando a SEFAZ que a nota chegou…");
    case "registrada":
      if (!f) return linha("CheckCircle2", `A SEFAZ já sabe que a nota chegou (${dia}).`);
      if (f.tipo === "confirmacao") return linha("CheckCircle2", `Compra confirmada na SEFAZ em ${dia}.`);
      if (f.tipo === "nao_reconheco") return linha("CheckCircle2", `Você avisou a SEFAZ que não reconhece esta nota (${dia}). ${FRASE_TROCAR}`);
      return linha("CheckCircle2", `Você avisou a SEFAZ que a compra não aconteceu (${dia}). ${FRASE_TROCAR}`);
    case "recusada":
      return linha("Ban", e.mensagem ?? `A SEFAZ não aceitou a resposta${e.c_stat !== null ? ` (código ${e.c_stat})` : ""}. Fale com o seu contador.`);
    case "falhou":
      return linha("CircleAlert", e.mensagem ?? "Não consegui enviar a resposta à SEFAZ depois de 3 tentativas.", true);
    default:
      return null;
  }
}

/** A faixa âmbar do prazo, acima das abas (UX §8). `prazos_perto` já vem com a nota que vence primeiro na frente. */
export function faixaPrazo(p: SituacaoSefazLigada["respostas"]["prazos_perto"]): string | null {
  if (p.length === 0) return null;
  const primeiro = emissaoSp(p[0]!.prazo_final);
  if (p.length === 1) {
    return `A NF ${p[0]!.numero} de ${p[0]!.emitente_nome} precisa de uma resposta à SEFAZ até ${primeiro}. Lance a nota, toque em Não reconheço ou escolha um motivo em Ignorar.`;
  }
  return `${p.length} notas precisam de uma resposta à SEFAZ. A primeira vence em ${primeiro}.`;
}

export const ROTULO_AVISAR_COMPRA = "Avisar a SEFAZ que a compra aconteceu";
const FRASE_NAO_ACEITA = "Esta nota não aceita resposta à SEFAZ.";
const FRASE_NAO_RECONHECO_E2 = "Se você não conhece este fornecedor, fale com o seu contador. Aqui a nota só fica escondida.";

/**
 * A linha sob cada motivo do diálogo Ignorar, se a SEFAZ é avisada (`avisa`) e o rótulo do botão primário (UX §8). `podeResponder` = a nota
 * é respondível; `respostasLigadas` = o quadro está ligado (desligadas, ou sem dizer, o diálogo é o da entrega 2: falha fechado, como `acoesDaNota`).
 */
export function avisoDoMotivo(
  m: MotivoIgnorar, podeResponder: boolean, respostasLigadas = false,
): { linha: string | null; avisa: "sempre" | "opcional" | "nunca"; botao: string } {
  const BOTAO = "Ignorar nota";
  const sem = (linha: string | null) => ({ linha, avisa: "nunca" as const, botao: BOTAO });
  if (m === "cancelamento_conferido") return sem(null);
  if (!respostasLigadas) return sem(m === "nao_reconheco" ? FRASE_NAO_RECONHECO_E2 : null);
  if (m === "outro") return sem("Nada é enviado à SEFAZ.");
  if (!podeResponder) return sem(m === "nao_reconheco" ? `${FRASE_NAO_RECONHECO_E2} ${FRASE_NAO_ACEITA}` : FRASE_NAO_ACEITA);
  const AVISAR = "Avisar a SEFAZ e ignorar";
  switch (m) {
    case "lancada_de_outro_jeito":
      return { linha: "A SEFAZ é avisada de que a compra aconteceu, como quando você lança a nota.", avisa: "sempre", botao: BOTAO };
    case "nao_e_compra":
      return { linha: "Marque se a nota é verdadeira e só não vai para o estoque (por exemplo, um equipamento).", avisa: "opcional", botao: BOTAO };
    case "nao_reconheco":
      return {
        linha: "A SEFAZ é avisada de que a empresa não reconhece esta nota. Use quando você não conhece o fornecedor ou não pediu nada a ele. Depois de enviado, não dá para desfazer aqui.",
        avisa: "sempre", botao: AVISAR,
      };
    default:
      return { linha: "A SEFAZ é avisada de que a compra não aconteceu, com o seu texto. Depois de enviado, não dá para desfazer aqui.", avisa: "sempre", botao: AVISAR };
  }
}

/** O texto do "Por quê?" (UX §3 com a §8). Sem a variável no servidor, vale o das respostas desligadas. */
export function textoPorQue(ligadas: boolean): string {
  return ligadas
    ? "O sistema já avisou a SEFAZ que a nota chegou. A nota completa costuma aparecer aqui algumas horas depois (a SEFAZ não fixa o prazo). " +
      "Se tiver pressa, lance pelo XML, pelo PDF ou pela foto."
    : "A SEFAZ entrega só o resumo da nota (fornecedor, valor e data) até a empresa avisar que a recebeu, e as respostas à SEFAZ estão desligadas. " +
      "Por isso, para dar entrada, envie o XML, o PDF ou a foto. Se o seu contador ou o portal da SEFAZ já avisou, a nota completa pode aparecer aqui.";
}

export type Justificativa = { ok: true; texto: string } | { ok: false; erro: "curta" | "longa" | "caractere" };

/**
 * `xJust` do 210240 (15 a 255, só U+0020–U+00FF, sem espaço nas pontas). CÓPIA de `normalizarJustificativa` em
 * `api/src/modules/sefaz/eventos-xml.ts`: mudar uma = mudar a outra (os testes das duas usam os mesmos vetores).
 */
export function normalizarJustificativa(t: string): Justificativa {
  const texto = t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[\s\u0085]+/g, " ") // \s já pega U+2028 e U+2029; U+0085 (NEL) não
    .trim();
  const tamanho = Array.from(texto).length; // caracteres, não unidades UTF-16
  if (tamanho < 15) return { ok: false, erro: "curta" };
  if (tamanho > 255) return { ok: false, erro: "longa" };
  if (!/^[ -ÿ]*$/.test(texto)) return { ok: false, erro: "caractere" };
  return { ok: true, texto };
}
