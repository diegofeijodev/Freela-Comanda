// DANFE NFC-e (desenho §5.6; pesquisa B.7): os dados do papel, montados SÓ do `nfeProc` guardado (`nfce_cupons.xml_autorizado`).
// "Nada pode ser impresso que não esteja no XML", exceto o retorno da SEFAZ (`nProt`, `dhRecbto`, `cMsg`, `xMsg`, do `protNFe`).
// Os nomes são os das tags e os valores, o texto do XML ("24.00", "2.0000", "2026-11-17T14:30:00-03:00"): a tela formata e põe os textos
// fixos ("Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica", "CONSUMIDOR NÃO IDENTIFICADO", a mensagem de homologação…).
// Lido por `xml-leitura.ts` (sem DOCTYPE nem ENTITY; `&amp;`, `&lt;` voltam a ser `&` e `<`). Cada leitura fica no bloco dela: CNPJ, xNome,
// vProd, vDesc, tpAmb e dhRecbto aparecem em mais de um lugar do nfeProc. Erro = frase fixa, nunca trecho do XML (que tem o CPF).

import { elementos, lerXml, XmlInvalido, type NoXml } from '../sefaz/xml-leitura';

/** Divisão II: uma linha por `det`. */
export interface DanfeItem {
  nItem: number;
  cProd: string;
  xProd: string;
  qCom: string;
  uCom: string;
  vUnCom: string;
  vProd: string;
  /** O desconto da linha (rateado), se houver. */
  vDesc: string | null;
}

export interface Danfe {
  /** I: cabeçalho (o emitente). */
  emit: {
    CNPJ: string;
    xNome: string;
    xFant: string | null;
    IE: string | null;
    enderEmit: {
      xLgr: string | null;
      nro: string | null;
      xCpl: string | null;
      xBairro: string | null;
      xMun: string | null;
      UF: string | null;
      CEP: string | null;
      fone: string | null;
    };
  };
  /** II: itens. */
  det: DanfeItem[];
  /** III: totais (quantidade de itens, valor dos produtos, descontos e acréscimos, valor a pagar) e pagamento (forma, valor, troco). */
  total: { qItens: number; vProd: string; vDesc: string; vFrete: string; vSeg: string; vOutro: string; vNF: string };
  pag: { detPag: { tPag: string; xPag: string | null; vPag: string }[]; vTroco: string | null };
  /** IV: "Consulte pela Chave de Acesso em" `urlChave` + a chave (44 caracteres; a tela agrupa em 11 blocos de 4). */
  chave: string;
  urlChave: string | null;
  /** V: o conteúdo do QR Code. */
  qrCode: string | null;
  /** VI: consumidor (null = "CONSUMIDOR NÃO IDENTIFICADO"). O CPF vai inteiro: o DANFE o imprime (rota de admin; Ruling T11-1). */
  dest: { CPF: string | null; CNPJ: string | null; idEstrangeiro: string | null; xNome: string | null } | null;
  /** VII: número, série, emissão (hora local do XML) e o protocolo de autorização com a data e hora dele. */
  ide: { nNF: string; serie: string; dhEmi: string; tpEmis: string };
  nProt: string | null;
  dhRecbto: string | null;
  /** VIII: em homologação (`tpAmb` 2), "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL". */
  homologacao: boolean;
  /** IX: informações complementares. */
  infCpl: string | null;
  /** O aviso da SEFAZ que veio com a autorização (120). */
  cMsg: string | null;
  xMsg: string | null;
}

/** Frase fixa: o nfeProc tem o CPF do consumidor, e nada dele vai para a mensagem. */
const FORA_DO_FORMATO = 'O arquivo do cupom está fora do formato do DANFE.';

const falta = (): never => {
  throw new Error(FORA_DO_FORMATO);
};
/** O único `nome` filho direto de `pai` (o `texto` de `xml-leitura` procura em todos os descendentes). */
function filho(pai: NoXml, nome: string): NoXml | null {
  return elementos(pai, nome).find((e) => e.parentNode === pai) ?? null;
}
/** O texto de um filho direto (aparado; vazio = null). */
function de(pai: NoXml | null, nome: string): string | null {
  const e = pai === null ? null : filho(pai, nome);
  const t = e?.textContent?.trim();
  return t ? t : null;
}
const obrigatorio = (pai: NoXml | null, nome: string): string => de(pai, nome) ?? falta();

export function danfeDoNfeProc(xml: string): Danfe {
  let doc: ReturnType<typeof lerXml>;
  try {
    doc = lerXml(xml);
  } catch (e) {
    if (e instanceof XmlInvalido) throw new Error(FORA_DO_FORMATO);
    throw e;
  }
  const raiz = doc.documentElement as unknown as NoXml;
  const nfe = raiz.localName === 'nfeProc' ? filho(raiz, 'NFe') : null;
  const inf = nfe === null ? null : filho(nfe, 'infNFe');
  const infProt = filho(filho(raiz, 'protNFe') ?? falta(), 'infProt');
  if (inf === null || infProt === null) return falta();
  const ide = filho(inf, 'ide');
  const emit = filho(inf, 'emit') ?? falta();
  const ender = filho(emit, 'enderEmit');
  const dest = filho(inf, 'dest');
  const icmsTot = filho(filho(inf, 'total') ?? falta(), 'ICMSTot');
  const pag = filho(inf, 'pag') ?? falta();
  const supl = nfe === null ? null : filho(nfe, 'infNFeSupl');
  const id = /^NFe([0-9A-Z]{44})$/.exec(inf.getAttribute('Id') ?? '')?.[1] ?? falta();

  const det = elementos(inf, 'det')
    .filter((d) => d.parentNode === inf)
    .map((d): DanfeItem => {
      const prod = filho(d, 'prod') ?? falta();
      const nItem = Number(d.getAttribute('nItem'));
      if (!Number.isInteger(nItem) || nItem < 1) falta();
      return {
        nItem,
        cProd: obrigatorio(prod, 'cProd'),
        xProd: obrigatorio(prod, 'xProd'),
        qCom: obrigatorio(prod, 'qCom'),
        uCom: obrigatorio(prod, 'uCom'),
        vUnCom: obrigatorio(prod, 'vUnCom'),
        vProd: obrigatorio(prod, 'vProd'),
        vDesc: de(prod, 'vDesc'),
      };
    });
  if (det.length === 0) falta();

  return {
    emit: {
      CNPJ: obrigatorio(emit, 'CNPJ'),
      xNome: obrigatorio(emit, 'xNome'),
      xFant: de(emit, 'xFant'),
      IE: de(emit, 'IE'),
      enderEmit: {
        xLgr: de(ender, 'xLgr'),
        nro: de(ender, 'nro'),
        xCpl: de(ender, 'xCpl'),
        xBairro: de(ender, 'xBairro'),
        xMun: de(ender, 'xMun'),
        UF: de(ender, 'UF'),
        CEP: de(ender, 'CEP'),
        fone: de(ender, 'fone'),
      },
    },
    det,
    total: {
      qItens: det.length,
      vProd: obrigatorio(icmsTot, 'vProd'),
      vDesc: obrigatorio(icmsTot, 'vDesc'),
      vFrete: obrigatorio(icmsTot, 'vFrete'),
      vSeg: obrigatorio(icmsTot, 'vSeg'),
      vOutro: obrigatorio(icmsTot, 'vOutro'),
      vNF: obrigatorio(icmsTot, 'vNF'),
    },
    pag: {
      detPag: elementos(pag, 'detPag')
        .filter((p) => p.parentNode === pag)
        .map((p) => ({ tPag: obrigatorio(p, 'tPag'), xPag: de(p, 'xPag'), vPag: obrigatorio(p, 'vPag') })),
      vTroco: de(pag, 'vTroco'),
    },
    chave: id,
    urlChave: de(supl, 'urlChave'),
    qrCode: de(supl, 'qrCode'),
    dest:
      dest === null
        ? null
        : { CPF: de(dest, 'CPF'), CNPJ: de(dest, 'CNPJ'), idEstrangeiro: de(dest, 'idEstrangeiro'), xNome: de(dest, 'xNome') },
    ide: {
      nNF: obrigatorio(ide, 'nNF'),
      serie: obrigatorio(ide, 'serie'),
      dhEmi: obrigatorio(ide, 'dhEmi'),
      tpEmis: obrigatorio(ide, 'tpEmis'),
    },
    nProt: de(infProt, 'nProt'),
    dhRecbto: de(infProt, 'dhRecbto'),
    homologacao: obrigatorio(ide, 'tpAmb') === '2',
    infCpl: de(filho(inf, 'infAdic'), 'infCpl'),
    cMsg: de(infProt, 'cMsg'),
    xMsg: de(infProt, 'xMsg'),
  };
}
