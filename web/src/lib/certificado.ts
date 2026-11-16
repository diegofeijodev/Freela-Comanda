// Regras puras da tela do certificado digital (A1): formatação, validação do arquivo e o resumo que o painel desenha.
// Nada aqui lê relógio nem rede; o arquivo só é lido em `arquivoParaBase64`, no momento do envio.
import type { CertificadoStatus, ItemHistoricoCertificado } from "./erp-api";

const FUSO = "America/Sao_Paulo";

function partes(iso: string): Record<string, string> {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** `DD/MM/AAAA` no fuso de Brasília. */
export function dataSp(iso: string): string {
  const p = partes(iso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** "16/11/2026 às 14h32" no fuso de Brasília. */
export function dataHoraSp(iso: string): string {
  const p = partes(iso);
  return `${p.day}/${p.month}/${p.year} às ${p.hour}h${p.minute}`;
}

/** Trecho "(faltam N dias)" do painel, com singular e o dia do vencimento. */
export function faltamDias(dias: number): string {
  if (dias <= 0) return "vence hoje";
  if (dias === 1) return "falta 1 dia";
  return `faltam ${dias} dias`;
}

export function rotuloVencimento(dias: number): string {
  if (dias <= 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`; // 1 já saiu acima, então o plural é sempre certo
}

/** 00.000.000/0000-00 (aceita as letras do CNPJ alfanumérico). Se não tiver 14 caracteres, devolve como veio. */
export function formatarCnpj(c: string): string {
  const s = c.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (s.length !== 14) return c;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

export const MSG_ARQUIVO = "Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou.";
export const MSG_GRANDE = "Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).";
const MAX_BYTES = 64 * 1024;

/** `null` = pode enviar; senão, a frase para mostrar. Só olha extensão e tamanho (quem confere de verdade é o servidor). */
export function validarArquivoCertificado(f: { name: string; size: number }): string | null {
  if (!/\.(pfx|p12)$/i.test(f.name)) return MSG_ARQUIVO;
  if (f.size === 0) return MSG_ARQUIVO;
  if (f.size > MAX_BYTES) return MSG_GRANDE;
  return null;
}

/** base64 puro (sem prefixo de data URL), como a API espera. */
export async function arquivoParaBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A2/A3/A4/SE-H pela política (OID) do certificado; `null` quando não dá para dizer. */
export function nomeDoTipo(politicaOid: string | null): string | null {
  if (!politicaOid) return null;
  const m = /^2\.16\.76\.1\.2\.(2|3|4|202)(\.|$)/.exec(politicaOid);
  if (!m) return null;
  return m[1] === "202" ? "SE-H" : `A${m[1]}`;
}

export type TomCertificado = "neutro" | "ok" | "warn" | "bad";
export type AcaoCertificado = "enviar" | "substituir" | "renovar" | "enviar_de_novo" | null;
export type ResumoCertificado = { tom: TomCertificado; etiqueta: string; problema: string | null; avisos: string[]; acao: AcaoCertificado };

export const MSG_SEM_SEGREDO = "O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda.";

/** Tudo que o painel desenha (tom, etiqueta, caixa de problema, avisos, botão principal) a partir da resposta da API. */
export function resumoDoCertificado(c: CertificadoStatus, cnpjEmpresaSalvo: string): ResumoCertificado {
  const validoAte = c.valido_ate ? dataSp(c.valido_ate) : "";
  const cnpjCert = formatarCnpj(c.cnpj ?? "");
  const cnpjEmpresa = formatarCnpj(cnpjEmpresaSalvo);
  if (c.situacao === "sem_segredo") return { tom: "bad", etiqueta: "Servidor não pronto", problema: MSG_SEM_SEGREDO, avisos: [], acao: null };
  if (c.situacao === "ausente") return { tom: "neutro", etiqueta: "Nenhum certificado guardado", problema: null, avisos: [], acao: "enviar" };
  if (c.situacao === "ilegivel") {
    return {
      tom: "bad", etiqueta: "Não pode ser lido", acao: "enviar_de_novo", avisos: [],
      problema: "O certificado guardado não pode mais ser lido (a chave de segurança do servidor mudou). Envie o arquivo de novo.",
    };
  }
  if (c.situacao === "vencido") {
    return {
      tom: "bad", etiqueta: "Vencido", acao: "renovar", avisos: [],
      problema: `Este certificado venceu em ${validoAte}. Envie o certificado renovado para voltar a usar.`,
    };
  }
  if (c.cnpj_confere === "diferente") {
    return {
      tom: "bad", etiqueta: "CNPJ não confere", acao: "substituir", avisos: [],
      problema: `Este certificado é do CNPJ ${cnpjCert}, mas a empresa agora está com o CNPJ ${cnpjEmpresa}. Corrija o CNPJ da empresa ou envie o certificado certo.`,
    };
  }
  const vencendo = c.situacao === "vencendo";
  const avisos: string[] = [];
  if (vencendo) avisos.push(`Vence em ${validoAte}. Peça o novo certificado ao seu contador e envie aqui antes dessa data.`);
  if (c.cnpj_confere === "mesma_raiz") {
    avisos.push(
      `Este certificado é do CNPJ ${cnpjCert}, outro estabelecimento da mesma empresa. Foi aceito. Se a SEFAZ recusar, envie o certificado do CNPJ ${cnpjEmpresa}.`,
    );
  }
  if (c.cnpj_confere === "empresa_sem_cnpj") {
    avisos.push("A empresa está sem CNPJ salvo em Configurações. Preencha o CNPJ no quadro Empresa e toque em Salvar.");
  }
  if (c.cadeia_conferida === false) {
    avisos.push("Guardado, mas não consegui conferir a emissora do certificado. Isso não impede de guardar; a SEFAZ confere na hora de usar.");
  }
  if (c.tipo === "outro") {
    avisos.push(`Este certificado não é do tipo A1 comum (é ${nomeDoTipo(c.politica_oid) ? `o tipo ${nomeDoTipo(c.politica_oid)}` : "de outro tipo"}). Pode servir para nota fiscal, mas confirme com a certificadora.`);
  }
  if (vencendo) return { tom: "warn", etiqueta: rotuloVencimento(c.dias_restantes ?? 0), problema: null, avisos, acao: "renovar" };
  if (avisos.length) return { tom: "warn", etiqueta: "Válido, com aviso", problema: null, avisos, acao: "substituir" };
  return { tom: "ok", etiqueta: "Válido", problema: null, avisos, acao: "substituir" };
}

/** Linhas do histórico (da mais nova para a mais velha). Titular e CNPJ só quando mudam em relação à linha mais velha seguinte, e sempre na mais velha. */
export function linhasDoHistorico(h: ItemHistoricoCertificado[]): string[] {
  return h.map((x, i) => {
    const quando = dataHoraSp(x.feito_em);
    const verbo = x.evento === "enviado" ? "Enviado" : x.evento === "substituido" ? "Substituído" : "Removido";
    let linha = `${verbo} por ${x.feito_por_nome} em ${quando}`;
    if (x.evento === "substituido") linha += ` (vale até ${dataSp(x.valido_ate)})`;
    const mais = h[i + 1];
    if (!mais || mais.cnpj !== x.cnpj || mais.titular !== x.titular) linha += ` · ${x.titular} · CNPJ ${formatarCnpj(x.cnpj)}`;
    return linha;
  });
}

export type FaixaCertificado = { tom: "warn" | "warn_forte" | "bad"; texto: string; dispensavel: boolean };

/** Dia civil de Brasília como número de dias (para contar diferença de dias sem depender da hora). */
function diaCivilSp(d: Date): number {
  const p = partes(d.toISOString());
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

const RENOVAR = "Envie o renovado em Configurações.";

/**
 * Faixa do topo do app (só admin): qual aviso mostrar, ou `null`. Os dias saem de `valido_ate` e de `agora` (dia civil de Brasília),
 * não do `dias_restantes` guardado, porque a consulta fica 5 minutos em cache e o dia pode virar nesse meio tempo.
 * Precedência: ilegível > vencido > CNPJ diferente > vence em 0–7 > vence em 8–30. Sem faixa para "ausente", "sem segredo"
 * nem para os avisos que são só do painel.
 */
export function faixaDoCertificado(c: CertificadoStatus | undefined, agora: Date): FaixaCertificado | null {
  if (!c || c.situacao === "ausente" || c.situacao === "sem_segredo") return null;
  if (c.situacao === "ilegivel") {
    return { tom: "bad", dispensavel: false, texto: "O certificado digital guardado não pode mais ser lido. Envie o arquivo de novo em Configurações." };
  }
  const ate = c.valido_ate ? new Date(c.valido_ate) : null;
  if (c.situacao === "vencido" || (ate && agora.getTime() >= ate.getTime())) {
    const quando = c.valido_ate ? ` em ${dataSp(c.valido_ate)}` : "";
    return { tom: "bad", dispensavel: false, texto: `O certificado digital venceu${quando}. ${RENOVAR}` };
  }
  if (c.cnpj_confere === "diferente") {
    return { tom: "bad", dispensavel: false, texto: "O certificado digital não é do CNPJ da empresa. Confira em Configurações." };
  }
  if (!ate || !c.valido_ate) return null;
  const dias = diaCivilSp(ate) - diaCivilSp(agora);
  if (dias > 30) return null;
  const data = dataSp(c.valido_ate);
  const quando = dias <= 0 ? `hoje (${data})` : dias === 1 ? `amanhã (${data})` : `em ${dias} dias (${data})`;
  return { tom: dias <= 7 ? "warn_forte" : "warn", dispensavel: dias > 7, texto: `O certificado digital vence ${quando}. ${RENOVAR}` };
}
