import { gzipSync } from 'node:zlib';

export function docZip(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

const pad = (n: bigint): string => n.toString().padStart(15, '0');

/** Envelope SOAP 1.2 de resposta da distribuição, montado à mão para os testes (nunca dado real). */
export function retornoSoap(p: {
  cStat: number;
  xMotivo?: string;
  ultNsu?: bigint;
  maxNsu?: bigint;
  docs?: { nsu: bigint; schema: string; conteudo: string }[];
}): string {
  const zips = (p.docs ?? [])
    .map((d) => `<docZip NSU="${pad(d.nsu)}" schema="${d.schema}">${docZip(d.conteudo)}</docZip>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' +
    '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>' +
    `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1.7.0</verAplic><cStat>${p.cStat}</cStat>` +
    `<xMotivo>${p.xMotivo ?? 'teste'}</xMotivo><dhResp>2026-11-17T09:00:00-03:00</dhResp>` +
    (p.ultNsu !== undefined ? `<ultNSU>${pad(p.ultNsu)}</ultNSU>` : '') +
    (p.maxNsu !== undefined ? `<maxNSU>${pad(p.maxNsu)}</maxNSU>` : '') +
    (zips ? `<loteDistDFeInt>${zips}</loteDistDFeInt>` : '') +
    '</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap12:Body></soap12:Envelope>'
  );
}

/** Texto que nunca pode aparecer em erro, log ou banco: vai no `Reason`/`faultstring` dos Faults abaixo. */
export const SENTINELA_FAULT = 'SENTINELA-DO-CORPO-DO-FAULT';

/** SOAP 1.2 Fault montado à mão (`valor` = o QName do `Code/Value`, ex.: `soap:VersionMismatch`; `subcode` vai dentro do `Code`). */
export function faultSoap12(valor: string, subcode = ''): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault>' +
    `<soap:Code><soap:Value>${valor}</soap:Value>${subcode}</soap:Code>` +
    `<soap:Reason><soap:Text xml:lang="pt-BR">${SENTINELA_FAULT}</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>`
  );
}

/** SOAP 1.1 Fault montado à mão (`faultcode` sem namespace, como manda o 1.1). */
export function faultSoap11(valor: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault>' +
    `<faultcode>${valor}</faultcode><faultstring>${SENTINELA_FAULT}</faultstring></soap:Fault></soap:Body></soap:Envelope>`
  );
}
