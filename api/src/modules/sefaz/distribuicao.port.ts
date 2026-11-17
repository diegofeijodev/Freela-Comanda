import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';

export { SefazErro } from './sefaz-erro';

export const SEFAZ_DFE = Symbol('SEFAZ_DFE');

export type AmbienteSefaz = 'producao' | 'homologacao'; // tpAmb 1 | 2

/** `bruto` só vem preenchido quando o `docZip` não pôde ser descompactado (guarda o base64 recebido). */
export interface DocumentoDistribuido {
  nsu: bigint;
  schema: string;
  xml: string | null;
  bruto: string | null;
}

export interface RespostaDistribuicao {
  cStat: number;
  xMotivo: string;
  dhResp: string;
  ultNsu: bigint | null;
  maxNsu: bigint | null;
  documentos: DocumentoDistribuido[]; // 0–50
}

export interface SefazDfePort {
  /** Uma chamada `distNSU` ao AN. Não decide QUANDO chamar: as esperas da NT 2014.002 §3.11.4 são do serviço. */
  distribuirPorNsu(cert: CertificadoEmUso, ambiente: AmbienteSefaz, cnpj: string, ultNsu: bigint): Promise<RespostaDistribuicao>;
}
