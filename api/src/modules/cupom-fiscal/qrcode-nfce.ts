// QR Code v2 da NFC-e (on-line) e endereços de consulta de SP. Puro, sem rede. Desenho §5.6; Manual DANFE NFC-e v6.0 §4.3.
//
// v2 on-line (tpEmis 1, 3 ou 4): `<URL>?p=<chave>|2|<tpAmb>|<IdCSC sem zeros à esquerda>|<hash>`, com hash = SHA-1 em hexadecimal
// (maiúsculo, como nos exemplos do manual) de `"<chave>|2|<tpAmb>|<IdCSC>" + CSC`: o CSC vai colado, SEM `|`, e nunca na URL.
// v2 off-line (fase 2, tpEmis 9; conferido no esquema do 010h v1.03): `p=<chave>|2|<tpAmb>|<dia dd>|<vNF>|<digVal>|<IdCSC>|<hash>`, com o
// `digVal` em 56 hex (o hexadecimal dos 28 CARACTERES base64 do DigestValue, não dos 20 bytes) e o hash sobre os 7 campos + CSC.
// Erro = frase fixa: o CSC nunca entra em mensagem.

import { createHash } from 'node:crypto';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';

/** Forma longa da SEFAZ-SP (a curta, `/qrcode`, só se a 395 recusar esta no 1º teste). */
export const URL_QR: Record<AmbienteSefaz, string> = {
  producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
  homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
};

export const URL_CHAVE: Record<AmbienteSefaz, string> = {
  producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica',
  homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica',
};

/** Chave do padrão v2 on-line do esquema: CNPJ pode ter letras; a 35ª posição (tpEmis) é 1, 3 ou 4. O DV é de quem monta a nota. */
const CHAVE_ON_LINE = /^[0-9]{6}[0-9A-Z]{12}[0-9]{16}[134][0-9]{9}$/;

/**
 * O `cHashQRCode` (Manual §4.3.4/§4.3.5): SHA-1 em hexadecimal maiúsculo dos parâmetros (já separados por `|`) com o CSC colado no fim,
 * SEM separador. Igual para o on-line e o off-line; o CSC só entra aqui, nunca na URL.
 */
export function hashQrCode(parametros: string, csc: string): string {
  return createHash('sha1')
    .update(parametros + csc, 'utf8')
    .digest('hex')
    .toUpperCase();
}

export function qrCodeV2(p: { chave: string; tpAmb: 1 | 2; idCsc: number; csc: string }): string {
  if (!CHAVE_ON_LINE.test(p.chave)) throw new Error('Chave fora do padrão do QR Code on-line.');
  if (p.tpAmb !== 1 && p.tpAmb !== 2) throw new Error('Ambiente do QR Code deve ser 1 ou 2.');
  if (!Number.isInteger(p.idCsc) || p.idCsc < 1 || p.idCsc > 999999) throw new Error('IdCSC do QR Code fora de 1–999999.');
  if (typeof p.csc !== 'string' || p.csc === '') throw new Error('CSC ausente para o QR Code.');
  const parametros = `${p.chave}|2|${p.tpAmb}|${p.idCsc}`; // String(número) já sai sem zeros à esquerda
  const hash = hashQrCode(parametros, p.csc);
  return `${URL_QR[p.tpAmb === 1 ? 'producao' : 'homologacao']}?p=${parametros}|${hash}`;
}
