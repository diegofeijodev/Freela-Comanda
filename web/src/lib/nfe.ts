export type ItemNota = {
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  item_estoque_id?: string | null;
  novo?: { nome: string; unidade: string; subgrupo: string | null } | null;
  fator?: number;
};
export type Parcela = { numero: string; vencimento: string; valor: number };
export type NotaLida = {
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emitente_nome: string;
  emitente_cnpj: string | null;
  data_emissao: string;
  valor_total: number;
  forma_pagamento: FormaPgto;
  itens: ItemNota[];
  parcelas: Parcela[];
};

export const FORMAS = {
  boleto: "Boleto",
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  transferencia: "Transferência",
  cheque: "Cheque",
  outros: "Outros / a prazo",
} as const;
export type FormaPgto = keyof typeof FORMAS;
/** Formas pagas no ato: viram conta já quitada */
export const A_VISTA: FormaPgto[] = ["pix", "dinheiro", "cartao_debito", "transferencia"];

const TPAG: Record<string, FormaPgto> = {
  "01": "dinheiro", "02": "cheque", "03": "cartao_credito", "04": "cartao_debito", "05": "outros",
  "15": "boleto", "16": "transferencia", "17": "pix", "18": "transferencia", "90": "outros", "99": "outros",
};

export function formaDoTPag(tPag: string | null | undefined, temDuplicatas: boolean): FormaPgto {
  const f = tPag ? TPAG[tPag] : undefined;
  if (temDuplicatas && (!f || f === "outros")) return "boleto";
  return f ?? (temDuplicatas ? "boleto" : "outros");
}

const n = (s: string | null | undefined) => (s ? Number(s) || 0 : 0);

/** As três buscas por nome local (qualquer namespace) do XML fiscal; também usadas pela leitura dos XML de venda (`nfe-vendas.ts`). */
export const all = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS("*", tag));
export const one = (el: Element | Document, tag: string) => all(el, tag)[0] ?? null;
export const txt = (el: Element | Document | null, tag: string) => (el ? one(el, tag)?.textContent?.trim() ?? null : null);

/** Lê o XML da NF-e (modelo 55) ou NFC-e (65) */
export function parseNFeXML(xml: string): NotaLida {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Arquivo XML inválido");

  const inf = one(doc, "infNFe");
  if (!inf) throw new Error("Este XML não é uma nota fiscal eletrônica");
  const ide = one(inf, "ide");
  const emit = one(inf, "emit");
  const total = one(inf, "ICMSTot");
  const itens: ItemNota[] = all(inf, "det").map((d) => {
    const p = one(d, "prod");
    return {
      codigo: txt(p, "cProd"),
      descricao: txt(p, "xProd") ?? "",
      unidade: txt(p, "uCom")?.toUpperCase() ?? null,
      quantidade: n(txt(p, "qCom")),
      valor_unitario: n(txt(p, "vUnCom")),
      valor_total: n(txt(p, "vProd")),
    };
  });
  const parcelas: Parcela[] = all(inf, "dup").map((d) => ({
    numero: txt(d, "nDup") ?? "",
    vencimento: (txt(d, "dVenc") ?? "").slice(0, 10),
    valor: n(txt(d, "vDup")),
  }));
  const chave = (inf.getAttribute("Id") ?? "").replace(/^NFe/, "") || txt(doc, "chNFe");
  return {
    chave: chave || null,
    numero: txt(ide, "nNF"),
    serie: txt(ide, "serie"),
    emitente_nome: txt(emit, "xFant") ?? txt(emit, "xNome") ?? "",
    emitente_cnpj: txt(emit, "CNPJ") ?? txt(emit, "CPF"),
    data_emissao: (txt(ide, "dhEmi") ?? txt(ide, "dEmi") ?? "").slice(0, 10),
    valor_total: n(txt(total, "vNF")),
    forma_pagamento: formaDoTPag(txt(inf, "tPag"), parcelas.length > 0),
    itens,
    parcelas,
  };
}

const normaliza = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

/** Sugere o insumo mais parecido pelo nome (palavras em comum). Retorna null se nada parecido. */
export function sugerirInsumo<T extends { id: string; nome: string }>(descricao: string, insumos: T[]): T | null {
  const a = new Set(normaliza(descricao));
  let best: T | null = null, score = 0;
  for (const i of insumos) {
    const b = normaliza(i.nome);
    if (!b.length) continue;
    const comuns = b.filter((w) => a.has(w) || [...a].some((x) => x.startsWith(w) || w.startsWith(x))).length;
    const s = comuns / b.length;
    if (s > score) { score = s; best = i; }
  }
  return score >= 0.5 ? best : null;
}
