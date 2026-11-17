import { dataBrSp } from '../../common/time/dates';
import { formatarCnpj, normalizarCnpj } from '../../common/fiscal/cnpj';

/** Os `code` 400 do cadastro de certificado (frases do plano/UX §6; o 503 de segredo ausente fica no serviço). */
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
  arquivo: 'Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou.',
  senha: 'Senha do certificado incorreta. Digite de novo.',
  formato: 'Não consegui abrir este certificado. Peça ao contador para gerar o arquivo de novo.',
  semChave:
    'Este arquivo não serve: falta a parte secreta do certificado. Peça ao contador o certificado A1 (arquivo), não o de cartão ou token.',
  semCnpj: 'Este certificado não é de empresa: não encontrei um CNPJ nele. Peça o certificado da empresa, não o seu pessoal.',
  empresaSemCnpj:
    'Preencha o CNPJ da empresa no quadro Empresa, toque em Salvar (no alto da página) e envie o certificado de novo.',
  naoIcp:
    'Este certificado não foi emitido por uma certificadora brasileira credenciada; a SEFAZ não aceita. Peça outro ao contador.',
  cadeia: 'Este certificado parece alterado ou incompleto. Peça ao contador ou à certificadora um arquivo novo.',
  semSegredo: 'O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda.',
};

export const msgVencido = (d: Date): string => `Este certificado venceu em ${dataBrSp(d)}. Envie o certificado renovado.`;

export const msgAindaNaoVale = (d: Date): string => `Este certificado só vale a partir de ${dataBrSp(d)}.`;

export const msgOutroCnpj = (cnpjCert: string, titular: string, cnpjEmpresa: string): string => {
  const empresa = normalizarCnpj(cnpjEmpresa);
  return `Este certificado é do CNPJ ${formatarCnpj(normalizarCnpj(cnpjCert))} (${titular}). O CNPJ da empresa é ${formatarCnpj(empresa)}.`;
};
