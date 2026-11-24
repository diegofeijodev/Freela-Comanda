// Importar vendas por XML (desenho 24/11, A.4): lê no navegador cada XML de venda que a loja emitiu em OUTRO sistema e devolve só o
// resumo que o servidor confere (nada do XML é guardado). Não reaproveita o `parseNFeXML` (Entrada de Notas), que lê o emitente como
// fornecedor e não olha protocolo, ambiente, modelo, tpNF, finNFe, CFOP nem vDesc. Nada some calado: todo arquivo vira documento,
// cancelamento ou ignorado com o motivo.
import type { DocumentoVendaXml } from "./erp-api";
import { chaveValida, normalizarChave, normalizarCnpj } from "./fiscal";
import { all, one, txt } from "./nfe";

export type LidoXml =
  | { tipo: "documento"; documento: DocumentoVendaXml }
  | { tipo: "cancelamento"; cancelamento: { arquivo: string; chave: string; dh_evento: string | null } }
  | { tipo: "ignorado"; ignorado: { arquivo: string; motivo: string } };

export const MOTIVO_XML = {
  ilegivel: "XML ilegível",
  semAutorizacao: "sem autorização da SEFAZ",
  denegado: "denegado pela SEFAZ",
  entrada: "nota de entrada (não é venda)",
  devolucao: "devolução (não é venda)",
  ajuste: "nota complementar ou de ajuste (não é venda)",
  inutilizacao: "inutilização de numeração",
  cartaCorrecao: "carta de correção",
  outroEvento: "outro evento da nota (não é cancelamento)",
  cancelamentoSemRegistro: "cancelamento sem registro na SEFAZ",
  outroTipo: "não é cupom de venda (outro tipo de arquivo)",
  chaveInvalida: "chave de acesso inválida",
  modelo: "modelo de documento que não é cupom nem nota fiscal",
  semDataHora: "sem a data e a hora da emissão (versão antiga)",
  naoXml: "não é um arquivo XML",
} as const;

const DECIMAL = /^\d{1,13}(\.\d{1,10})?$/;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
/** Eventos que cancelam: 110111 (cancelamento) e 110112 (cancelamento por substituição da NFC-e, *não confirmado* com XML real). */
const EVENTOS_CANCELAMENTO = new Set(["110111", "110112"]);
const CSTAT_EVENTO_OK = new Set(["135", "136", "155"]);
const CSTAT_AUTORIZADA = new Set(["100", "150"]);
const CSTAT_DENEGADA = new Set(["110", "301", "302", "303", "304", "305", "306"]);
const CSTAT_CANCELADA = new Set(["101", "151"]);

const ignorado = (arquivo: string, motivo: string): LidoXml => ({ tipo: "ignorado", ignorado: { arquivo, motivo } });
const decimal = (s: string | null, padrao?: string) => {
  const v = s ?? padrao ?? null;
  return v !== null && DECIMAL.test(v) ? v : null;
};

function evento(arquivo: string, doc: Document): LidoXml {
  const inf = one(doc, "infEvento");
  const tp = txt(inf, "tpEvento");
  if (tp === "110110") return ignorado(arquivo, MOTIVO_XML.cartaCorrecao);
  if (!tp || !EVENTOS_CANCELAMENTO.has(tp)) return ignorado(arquivo, MOTIVO_XML.outroEvento);
  const ret = one(doc, "retEvento");
  const cStat = ret ? txt(ret, "cStat") : null;
  if (!cStat || !CSTAT_EVENTO_OK.has(cStat)) return ignorado(arquivo, MOTIVO_XML.cancelamentoSemRegistro);
  const chave = normalizarChave(txt(inf, "chNFe") ?? "");
  if (!chaveValida(chave)) return ignorado(arquivo, MOTIVO_XML.chaveInvalida);
  const dh = txt(inf, "dhEvento") ?? (ret ? txt(ret, "dhRegEvento") : null);
  return { tipo: "cancelamento", cancelamento: { arquivo, chave, dh_evento: dh && DATA_HORA.test(dh) ? dh : null } };
}

function nota(arquivo: string, doc: Document, inf: Element): LidoXml {
  const chave = normalizarChave((inf.getAttribute("Id") ?? "").replace(/^NFe/, ""));
  if (!chaveValida(chave)) return ignorado(arquivo, MOTIVO_XML.chaveInvalida);
  const prot = one(doc, "protNFe");
  const cStat = prot ? txt(prot, "cStat") : null;
  if (!prot || !cStat) return ignorado(arquivo, MOTIVO_XML.semAutorizacao);
  if (CSTAT_DENEGADA.has(cStat)) return ignorado(arquivo, MOTIVO_XML.denegado);
  // cancelada no próprio protocolo (*não confirmado* que algum PDV exporte assim): vale como cancelamento da chave
  if (CSTAT_CANCELADA.has(cStat)) return { tipo: "cancelamento", cancelamento: { arquivo, chave, dh_evento: null } };
  if (!CSTAT_AUTORIZADA.has(cStat)) return ignorado(arquivo, `${MOTIVO_XML.semAutorizacao} (situação ${cStat})`);
  const ide = one(inf, "ide");
  const modelo = txt(ide, "mod");
  if (modelo !== "55" && modelo !== "65") return ignorado(arquivo, MOTIVO_XML.modelo);
  if (txt(ide, "tpNF") === "0") return ignorado(arquivo, MOTIVO_XML.entrada);
  const fin = txt(ide, "finNFe");
  if (fin === "4") return ignorado(arquivo, MOTIVO_XML.devolucao);
  if (fin && fin !== "1") return ignorado(arquivo, MOTIVO_XML.ajuste);
  const dh = txt(ide, "dhEmi");
  if (!dh || !DATA_HORA.test(dh)) return ignorado(arquivo, MOTIVO_XML.semDataHora);
  const tpAmb = txt(ide, "tpAmb") ?? txt(prot, "tpAmb");
  const emit = one(inf, "emit");
  const itens: DocumentoVendaXml["itens"] = [];
  for (const det of all(inf, "det")) {
    const p = one(det, "prod");
    const q = decimal(txt(p, "qCom"));
    const vu = decimal(txt(p, "vUnCom"));
    const vp = decimal(txt(p, "vProd"));
    const desc = decimal(txt(p, "vDesc"), "0");
    const outros = decimal(txt(p, "vOutro"), "0");
    const frete = decimal(txt(p, "vFrete"), "0");
    const seguro = decimal(txt(p, "vSeg"), "0");
    const produto = (txt(p, "xProd") ?? "").replace(/\s+/g, " ").trim();
    if (!produto || !q || !vu || !vp || !desc || !outros || !frete || !seguro) return ignorado(arquivo, `${MOTIVO_XML.ilegivel} (item sem produto, quantidade ou valor)`);
    const cfop = txt(p, "CFOP");
    itens.push({ produto, quantidade: q, valor_unitario: vu, valor_bruto: vp, desconto: desc, outros, frete, seguro, cfop: cfop && /^\d{4}$/.test(cfop) ? cfop : null });
  }
  const vNF = decimal(txt(one(inf, "ICMSTot"), "vNF"));
  if (!itens.length || !vNF) return ignorado(arquivo, `${MOTIVO_XML.ilegivel} (sem itens ou sem total)`);
  return {
    tipo: "documento",
    documento: {
      arquivo,
      chave,
      modelo: Number(modelo) as 55 | 65,
      serie: Number(txt(ide, "serie") ?? "0"),
      numero: Number(txt(ide, "nNF") ?? "0"),
      emitente_cnpj: normalizarCnpj(txt(emit, "CNPJ") ?? txt(emit, "CPF") ?? ""),
      tp_amb: tpAmb === "2" ? 2 : 1,
      dh_emi: dh,
      valor_total: vNF,
      itens,
    },
  };
}

/** Um arquivo XML → documento de venda, cancelamento ou ignorado (com o motivo). */
export function lerXmlVenda(arquivo: string, xml: string): LidoXml {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return ignorado(arquivo, MOTIVO_XML.ilegivel);
  }
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) return ignorado(arquivo, MOTIVO_XML.ilegivel);
  const raiz = doc.documentElement.localName;
  if (raiz === "procInutNFe" || raiz === "inutNFe" || raiz === "retInutNFe") return ignorado(arquivo, MOTIVO_XML.inutilizacao);
  if (raiz === "procEventoNFe" || raiz === "evento" || raiz === "envEvento") return evento(arquivo, doc);
  const inf = one(doc, "infNFe");
  if (inf && (raiz === "nfeProc" || raiz === "NFe")) return nota(arquivo, doc, inf);
  return ignorado(arquivo, MOTIVO_XML.outroTipo);
}
