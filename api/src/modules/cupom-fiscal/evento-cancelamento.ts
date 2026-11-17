import { corpoEnvEvento, dhSefaz, normalizarJustificativa } from '../sefaz/eventos-xml';

// Evento de cancelamento da NFC-e (tpEvento 110111, `NFeRecepcaoEvento4` da UF), só a montagem, sem rede e sem assinatura: quem assina
// é `assinarXmlEnveloped(montarCancelamento(...), idCancelamento(chave), cert)`. O lote reaproveita o `corpoEnvEvento` da manifestação.
// Erro = frase fixa, nunca o dado (chave, protocolo e justificativa não vão para mensagem).

/** `cOrgao` do evento: o da UF do emitente (SP), diferente do 91 do Ambiente Nacional da manifestação. */
export const C_ORGAO_CANCELAMENTO = '35';
export const TP_EVENTO_CANCELAMENTO = '110111';
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const FORMATO_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;
const FORMATO_CHAVE = /^[0-9]{44}$/;
const FORMATO_NPROT = /^[0-9]{15}([0-9]{2})?$/;

export interface DadosCancelamento {
  tpAmb: 1 | 2;
  cnpj: string;
  chave: string;
  nProt: string; // protocolo de autorização do cupom (só dígitos, intacto)
  xJust: string; // já normalizado (normalizarJustificativa)
  dhEvento: Date;
}

/** `Id` do `infEvento`: "ID" + 110111 + chave + nSeqEvento com 2 dígitos (o cancelamento é sempre o 1). */
export function idCancelamento(chave: string): string {
  return `ID${TP_EVENTO_CANCELAMENTO}${chave}01`;
}

const ESCAPE_TEXTO: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escTexto = (s: string): string => s.replace(/[&<>]/g, (c) => ESCAPE_TEXTO[c]);

/**
 * O evento como documento próprio, sem declaração XML e sem `Signature`: `<evento xmlns="…/nfe" versao="1.00"><infEvento Id="…">` com
 * cOrgao, tpAmb, CNPJ, chNFe, dhEvento, tpEvento, nSeqEvento, verEvento e detEvento (descEvento, nProt, xJust), nesta ordem.
 * Dado fora do padrão, ou justificativa que a normalização mudaria (ou fora de 15 a 255 caracteres) = Error.
 */
export function montarCancelamento(d: DadosCancelamento): string {
  if (d.tpAmb !== 1 && d.tpAmb !== 2) throw new Error('Ambiente inválido para o cancelamento.');
  if (!FORMATO_CNPJ.test(d.cnpj)) throw new Error('CNPJ inválido para o cancelamento.');
  if (!FORMATO_CHAVE.test(d.chave)) throw new Error('Chave de acesso inválida para o cancelamento.');
  if (!FORMATO_NPROT.test(d.nProt)) throw new Error('Protocolo de autorização inválido para o cancelamento.');
  const j = normalizarJustificativa(d.xJust);
  if (!j.ok || j.texto !== d.xJust) throw new Error('Justificativa fora do padrão da SEFAZ.');
  if (Number.isNaN(d.dhEvento.getTime())) throw new Error('Data e hora do cancelamento inválidas.');
  return (
    `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${idCancelamento(d.chave)}"><cOrgao>${C_ORGAO_CANCELAMENTO}</cOrgao>` +
    `<tpAmb>${d.tpAmb}</tpAmb><CNPJ>${d.cnpj}</CNPJ><chNFe>${d.chave}</chNFe><dhEvento>${dhSefaz(d.dhEvento)}</dhEvento>` +
    `<tpEvento>${TP_EVENTO_CANCELAMENTO}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${d.nProt}</nProt><xJust>${escTexto(j.texto)}</xJust>` +
    '</detEvento></infEvento></evento>'
  );
}

/** Conteúdo do `Body`: o `envEvento` com este único evento, já assinado (mesmo formato e limites do lote da manifestação). */
export function corpoEnvEventoCancelamento(idLote: bigint, eventoAssinado: string): string {
  return corpoEnvEvento(idLote, [eventoAssinado]);
}
