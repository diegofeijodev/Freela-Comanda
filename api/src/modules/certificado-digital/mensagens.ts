import { dataBrSp } from '../../common/time/dates';
import { formatarCnpj, normalizarCnpj } from './cnpj';

/** Os `code` 400 do cadastro de certificado (tabela fechada do desenho; o 503 de segredo ausente fica no serviço). */
export type CodigoRecusa =
  | 'CERTIFICADO_ARQUIVO'
  | 'CERTIFICADO_SENHA'
  | 'CERTIFICADO_FORMATO'
  | 'CERTIFICADO_SEM_CHAVE'
  | 'CERTIFICADO_VENCIDO'
  | 'CERTIFICADO_AINDA_NAO_VALE'
  | 'CERTIFICADO_SEM_CNPJ'
  | 'EMPRESA_SEM_CNPJ'
  | 'CERTIFICADO_OUTRO_CNPJ'
  | 'CERTIFICADO_NAO_ICP'
  | 'CERTIFICADO_CADEIA';

/** Nunca leva texto de biblioteca, senha, chave nem trecho do arquivo: só a frase da tabela. */
export class CertificadoRecusado extends Error {
  constructor(
    readonly code: CodigoRecusa,
    message: string,
  ) {
    super(message);
    this.name = 'CertificadoRecusado';
  }
}

export const MSG_CERTIFICADO: Record<
  'arquivo' | 'senha' | 'formato' | 'semChave' | 'semCnpj' | 'empresaSemCnpj' | 'naoIcp' | 'cadeia' | 'semSegredo',
  string
> = {
  arquivo: 'Este arquivo não é um certificado A1 (.pfx ou .p12).',
  senha: 'Senha do certificado incorreta.',
  formato: 'Não consegui abrir este certificado. Exporte o .pfx de novo e tente outra vez.',
  semChave:
    'Este arquivo não tem a chave privada. Use o A1 (.pfx exportado com a chave); certificado em token ou cartão (A3) não serve.',
  semCnpj: 'Este certificado não é de empresa (e-CNPJ): não encontrei CNPJ nele.',
  empresaSemCnpj: 'Preencha o CNPJ da empresa (painel Empresa) antes de enviar o certificado.',
  naoIcp: 'Este certificado não é da ICP-Brasil; a SEFAZ não aceita.',
  cadeia: 'A cadeia deste certificado não confere. Exporte o .pfx de novo ou fale com a certificadora.',
  semSegredo: 'O servidor ainda não está pronto para guardar certificados. Avise o suporte.',
};

export const msgVencido = (d: Date): string => `Este certificado venceu em ${dataBrSp(d)}. Envie o certificado renovado.`;

export const msgAindaNaoVale = (d: Date): string => `Este certificado só vale a partir de ${dataBrSp(d)}.`;

export const msgOutroCnpj = (cnpjCert: string, titular: string, cnpjEmpresa: string): string => {
  const empresa = normalizarCnpj(cnpjEmpresa);
  return `Este certificado é do CNPJ ${formatarCnpj(normalizarCnpj(cnpjCert))} (${titular}). O CNPJ da empresa é ${formatarCnpj(empresa)}.`;
};
