import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from './distribuicao.port';

// Porta das respostas à SEFAZ (eventos da manifestação do destinatário, `NFeRecepcaoEvento4` do AN), separada da distribuição.
// Os eventos chegam JÁ assinados (o serviço os grava como `enviando` antes de a rede sair): a porta só embrulha e envia.

export const SEFAZ_EVENTOS = Symbol('SEFAZ_EVENTOS');

/** 210200 Confirmação · 210210 Ciência · 210220 Desconhecimento · 210240 Operação não Realizada. */
export type TipoEvento = '210200' | '210210' | '210220' | '210240';

export interface RetornoEvento {
  chave: string | null;
  tpEvento: string | null;
  nSeq: number | null;
  cStat: number;
  xMotivo: string;
  nProt: string | null;
  dhRegEvento: string | null;
  xml: string;
}

export interface RespostaLoteEventos {
  cStat: number;
  xMotivo: string;
  retornos: RetornoEvento[]; // 0–20 retornos
}

export interface SefazEventosPort {
  /** Um `nfeRecepcaoEvento` ao AN com 1–20 eventos JÁ assinados (gravados antes). Lança SefazErro. Não decide quando enviar. */
  enviarLote(cert: CertificadoEmUso, ambiente: AmbienteSefaz, idLote: bigint, eventosAssinados: string[]): Promise<RespostaLoteEventos>;
}
