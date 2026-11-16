import type { KeyObject, X509Certificate } from 'node:crypto';
import { dataBrSp } from '../../common/time/dates';

/** Porta interna (sem rota HTTP) pela qual a busca de notas na SEFAZ e a emissão de cupom obtêm a chave e o certificado em uso. */
export const CERTIFICADO_DIGITAL = Symbol('CERTIFICADO_DIGITAL');

export interface CertificadoEmUso {
  chavePrivada: KeyObject; // RSA nos A1 de hoje (tipo em asymmetricKeyType), nunca PEM solto. mTLS: chavePrivada.export({ type: 'pkcs8', format: 'pem' }) no ponto de uso
  certificado: X509Certificate; // da empresa; .toString() = PEM
  cadeia: X509Certificate[]; // intermediárias do caminho conferido (pode ser vazia)
  cnpj: string; // 14 caracteres, pode ter letras
  validoAte: Date;
  impressaoDigital: string; // SHA-256 hex: o que pode ir para log/auditoria de quem assinou
}

export class CertificadoErro extends Error {
  // molde do LeituraPdfErro, sem `detalhe`
  constructor(
    message: string,
    readonly status: 422 | 503,
    readonly code: 'CERTIFICADO_NAO_CADASTRADO' | 'CERTIFICADO_ILEGIVEL' | 'CERTIFICADO_VENCIDO' | 'CERTIFICADO_OUTRO_CNPJ',
  ) {
    super(message);
    this.name = 'CertificadoErro';
  }
}

export interface CertificadoDigitalPort {
  /** Decifra a cada chamada (sem cache). NAO_CADASTRADO/ILEGIVEL → 503; VENCIDO/OUTRO_CNPJ → 422. */
  emUso(agora?: Date): Promise<CertificadoEmUso>;
}

/** Frases de uso (o OUTRO_CNPJ usa a mesma do cadastro: `msgOutroCnpj`). */
export const MSG_USO = {
  naoCadastrado: 'Cadastre o certificado digital em Configurações.',
  ilegivel: 'O certificado salvo não pode ser lido (a chave do servidor mudou). Envie o .pfx de novo em Configurações.',
  vencido: (d: Date): string => `O certificado digital venceu em ${dataBrSp(d)}. Envie o renovado em Configurações.`,
};
