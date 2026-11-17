import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from './distribuicao.port';

// Porta da NFC-e de SP (autorização síncrona, consulta pela chave, evento e status do serviço), desenho §8.3. Infraestrutura: não decide
// QUANDO chamar (as travas são do cupom-fiscal). Lança SefazErro (o `enviado` decide entre número livre e número preso); entrada fora do
// formato (enviNFe, chave, envEvento, ambiente) = Error com frase fixa, antes de qualquer conexão.

export const SEFAZ_NFCE = Symbol('SEFAZ_NFCE');

/** Os 4 serviços da NFC-e usados (URL, action e `nfeDadosMsg` de cada um no adaptador). */
export type ServicoNfce = 'autorizacao' | 'consulta' | 'evento' | 'status';

export interface ProtocoloNfce {
  cStat: number;
  xMotivo: string;
  chave: string;
  dhRecbto: string;
  nProt: string | null;
  digVal: string | null;
  cMsg: string | null;
  xMsg: string | null;
  xml: string; // protNFe serializado, como veio
}
export interface RespostaAutorizacao {
  cStatLote: number;
  xMotivoLote: string;
  dhRecbto: string | null;
  protocolo: ProtocoloNfce | null;
  xmlRetorno: string;
}
export interface RespostaConsulta {
  cStat: number;
  xMotivo: string;
  protocolo: ProtocoloNfce | null;
  cancelamento: { cStat: number; nProt: string | null; xml: string } | null;
  xmlRetorno: string;
}
export interface RespostaEvento {
  cStatLote: number;
  xMotivoLote: string;
  cStat: number | null;
  xMotivo: string | null;
  nProt: string | null;
  dhRegEvento: string | null;
  xmlRetorno: string;
}
export interface RespostaStatus {
  cStat: number;
  xMotivo: string;
  dhRecbto: string | null;
  tMed: number | null;
}
export interface SefazNfcePort {
  autorizar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, enviNFe: string): Promise<RespostaAutorizacao>;
  consultar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, chave: string): Promise<RespostaConsulta>;
  registrarEvento(cert: CertificadoEmUso, ambiente: AmbienteSefaz, envEvento: string): Promise<RespostaEvento>;
  status(cert: CertificadoEmUso, ambiente: AmbienteSefaz): Promise<RespostaStatus>;
}
