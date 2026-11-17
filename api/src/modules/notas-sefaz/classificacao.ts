// Classificação dos documentos da distribuição de DF-e (pura: sem banco, sem rede). Recebe o XML já descompactado e devolve o que ele é;
// `aplicarNaCaixa` diz o que gravar na caixa (criar / atualizar / nada). XML ruim ou chave inválida lançam; quem chama marca o documento.
import { chaveValida, normalizarChave, partesDaChave } from '../../common/fiscal/chave-acesso';
import { normalizarCnpj } from '../../common/fiscal/cnpj';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { lerXml, primeiro, texto, XmlInvalido, type NoXml } from '../sefaz/xml-leitura';

// `Document` do xmldom (o global do TS é outro tipo); só `xml-leitura.ts` importa o pacote.
type Raiz = ReturnType<typeof lerXml> | NoXml;

export type TipoDocumento = 'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'outro' | 'ilegivel';
export type SituacaoSefaz = 'autorizada' | 'denegada' | 'cancelada';

export type DadosNota = {
  chave: string;
  emitente_cnpj: string;
  emitente_nome: string;
  numero: string;
  serie: string;
  emitida_em: Date | null;
  autorizada_em: Date | null;
  valor_total: string | null;
  tp_nf: number | null;
  situacao_sefaz: SituacaoSefaz;
};

export type Classificacao =
  | { tipo: 'resumo'; dados: DadosNota }
  | { tipo: 'completo'; dados: DadosNota; fin_nfe: number | null; nat_op: string | null }
  | { tipo: 'nao_destinatario'; chave: string | null }
  | { tipo: 'cancelamento'; chave: string; cancelada_em: Date; emitente_cnpj: string | null }
  | { tipo: 'outro_evento'; chave: string | null; tp_evento: string | null }
  | { tipo: 'sem_uso' };

const TIPOS: ReadonlySet<string> = new Set(['resNFe', 'procNFe', 'resEvento', 'procEventoNFe']);
const CANCELAMENTO = '110111';

/** O prefixo do nome do schema antes de "_v" ("resNFe_v1.01.xsd" → "resNFe"); o que não é NF-e vira "outro". */
export function tipoDoSchema(schema: string): Exclude<TipoDocumento, 'ilegivel'> {
  const p = schema.split('_v')[0] ?? '';
  return TIPOS.has(p) ? (p as Exclude<TipoDocumento, 'ilegivel'>) : 'outro';
}

function data(t: string | null): Date | null {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inteiro(t: string | null): number | null {
  return t !== null && /^[0-9]{1,9}$/.test(t) ? Number(t) : null;
}

/** CNPJ, senão CPF, normalizado; null se nenhum. */
function documentoDe(no: Raiz | null): string | null {
  if (!no) return null;
  const t = texto(no, 'CNPJ') ?? texto(no, 'CPF');
  return t ? normalizarCnpj(t) : null;
}

function chaveLida(t: string | null): string {
  const c = normalizarChave(t ?? '');
  if (!chaveValida(c)) throw new XmlInvalido();
  return c;
}

/** Chave só para registro: se não for válida, null (sem lançar). */
function chaveOuNula(t: string | null): string | null {
  const c = normalizarChave(t ?? '');
  return chaveValida(c) ? c : null;
}

function resumo(raiz: Raiz): Classificacao {
  const chave = chaveLida(texto(raiz, 'chNFe'));
  const partes = partesDaChave(chave)!;
  const sit = texto(raiz, 'cSitNFe');
  return {
    tipo: 'resumo',
    dados: {
      chave,
      emitente_cnpj: documentoDe(raiz) ?? partes.emitente,
      emitente_nome: texto(raiz, 'xNome') ?? '',
      numero: partes.numero,
      serie: partes.serie,
      emitida_em: data(texto(raiz, 'dhEmi')),
      autorizada_em: data(texto(raiz, 'dhRecbto')),
      valor_total: texto(raiz, 'vNF'),
      tp_nf: inteiro(texto(raiz, 'tpNF')),
      situacao_sefaz: sit === '3' ? 'cancelada' : sit === '2' ? 'denegada' : 'autorizada',
    },
  };
}

function completa(raiz: Raiz, cnpjDestinatario: string): Classificacao {
  const inf = primeiro(raiz, 'infNFe');
  const prot = primeiro(raiz, 'protNFe');
  const chave = chaveOuNula(texto(prot ?? raiz, 'chNFe') ?? (inf?.getAttribute('Id') ?? '').replace(/^NFe/i, ''));
  const dest = documentoDe(primeiro(raiz, 'dest'));
  if (dest === null || dest !== normalizarCnpj(cnpjDestinatario)) return { tipo: 'nao_destinatario', chave };
  if (!chave || !inf) throw new XmlInvalido();
  const partes = partesDaChave(chave)!;
  const cStat = inteiro(texto(prot ?? raiz, 'cStat'));
  const negada = cStat === 110 || (cStat !== null && cStat >= 301 && cStat <= 306);
  const ide = primeiro(inf, 'ide') ?? inf;
  return {
    tipo: 'completo',
    dados: {
      chave,
      emitente_cnpj: documentoDe(primeiro(inf, 'emit')) ?? partes.emitente,
      emitente_nome: texto(primeiro(inf, 'emit') ?? inf, 'xNome') ?? '',
      numero: partes.numero,
      serie: partes.serie,
      emitida_em: data(texto(ide, 'dhEmi')),
      autorizada_em: data(texto(prot ?? raiz, 'dhRecbto')),
      valor_total: texto(primeiro(inf, 'ICMSTot') ?? inf, 'vNF'),
      tp_nf: inteiro(texto(ide, 'tpNF')),
      situacao_sefaz: negada ? 'denegada' : 'autorizada',
    },
    fin_nfe: inteiro(texto(ide, 'finNFe')),
    nat_op: texto(ide, 'natOp'),
  };
}

function evento(raiz: Raiz, procesado: boolean): Classificacao {
  const inf = (procesado ? primeiro(raiz, 'infEvento') : null) ?? raiz;
  const tp = texto(inf, 'tpEvento');
  if (tp !== CANCELAMENTO) return { tipo: 'outro_evento', chave: chaveOuNula(texto(inf, 'chNFe')), tp_evento: tp };
  // evento rejeitado (retEvento com outro cStat): fica registrado, mas a nota não vira cancelada (a marca não volta)
  const ret = procesado ? primeiro(raiz, 'retEvento') : null;
  const cStatRet = ret ? inteiro(texto(ret, 'cStat')) : null;
  if (ret && (cStatRet === null || ![135, 136, 155].includes(cStatRet))) {
    return { tipo: 'outro_evento', chave: chaveOuNula(texto(inf, 'chNFe')), tp_evento: tp };
  }
  const cancelada_em = data(texto(inf, 'dhEvento'));
  if (!cancelada_em) throw new XmlInvalido();
  return { tipo: 'cancelamento', chave: chaveLida(texto(inf, 'chNFe')), cancelada_em, emitente_cnpj: documentoDe(inf) };
}

export function classificar(doc: { tipo: TipoDocumento; xml: string | null }, cnpjDestinatario: string): Classificacao {
  if (doc.xml === null || doc.tipo === 'outro' || doc.tipo === 'ilegivel') return { tipo: 'sem_uso' };
  const raiz = lerXml(doc.xml);
  switch (doc.tipo) {
    case 'resNFe':
      return resumo(raiz);
    case 'procNFe':
      return completa(raiz, cnpjDestinatario);
    case 'resEvento':
      return evento(raiz, false);
    case 'procEventoNFe':
      return evento(raiz, true);
  }
}

/** Chave e tipo de evento para gravar no documento cru (`sefaz_documentos`). */
export function chaveDoDocumento(c: Classificacao): { chave: string | null; tp_evento: string | null } {
  switch (c.tipo) {
    case 'resumo':
    case 'completo':
      return { chave: c.dados.chave, tp_evento: null };
    case 'nao_destinatario':
      return { chave: c.chave, tp_evento: null };
    case 'cancelamento':
      return { chave: c.chave, tp_evento: CANCELAMENTO };
    case 'outro_evento':
      return { chave: c.chave, tp_evento: c.tp_evento };
    case 'sem_uso':
      return { chave: null, tp_evento: null };
  }
}

export type LinhaCaixa = {
  ambiente: AmbienteSefaz;
  cnpj_destinatario: string;
  chave: string;
  emitente_cnpj: string;
  emitente_nome: string;
  numero: string;
  serie: string;
  emitida_em: Date | null;
  autorizada_em: Date | null;
  valor_total: string | null;
  tp_nf: number | null;
  fin_nfe: number | null;
  nat_op: string | null;
  situacao_sefaz: SituacaoSefaz;
  cancelada_em: Date | null;
  resumo_id: string | null;
  documento_completo_id: string | null;
};

/** O que gravar na caixa para este documento: criar a linha, atualizar a existente, ou nada. */
export function aplicarNaCaixa(
  atual: LinhaCaixa | null,
  c: Classificacao,
  docId: string,
  base: { ambiente: AmbienteSefaz; cnpj_destinatario: string },
): { criar: LinhaCaixa } | { atualizar: Partial<LinhaCaixa> } | null {
  const vazia = { fin_nfe: null, nat_op: null, cancelada_em: null, resumo_id: null, documento_completo_id: null };
  switch (c.tipo) {
    case 'resumo': {
      if (!atual) return { criar: { ...base, ...vazia, ...c.dados, resumo_id: docId } };
      const { chave: _chave, situacao_sefaz, ...resto } = c.dados;
      // uma nota cancelada nunca volta a "autorizada" por um resumo que chegou depois
      return { atualizar: { ...resto, resumo_id: docId, ...(atual.situacao_sefaz === 'cancelada' ? {} : { situacao_sefaz }) } };
    }
    case 'completo':
      if (!atual) return { criar: { ...base, ...vazia, ...c.dados, fin_nfe: c.fin_nfe, nat_op: c.nat_op, documento_completo_id: docId } };
      return { atualizar: { documento_completo_id: docId, fin_nfe: c.fin_nfe, nat_op: c.nat_op } };
    case 'cancelamento': {
      if (atual) return { atualizar: { situacao_sefaz: 'cancelada', cancelada_em: c.cancelada_em } };
      const p = partesDaChave(c.chave)!;
      return {
        criar: {
          ...base,
          ...vazia,
          chave: c.chave,
          emitente_cnpj: c.emitente_cnpj ?? p.emitente,
          emitente_nome: '',
          numero: p.numero,
          serie: p.serie,
          emitida_em: null,
          autorizada_em: null,
          valor_total: null,
          tp_nf: null,
          situacao_sefaz: 'cancelada',
          cancelada_em: c.cancelada_em,
        },
      };
    }
    default:
      return null;
  }
}
