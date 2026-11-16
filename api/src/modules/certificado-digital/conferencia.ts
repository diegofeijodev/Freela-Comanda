import type { KeyObject, X509Certificate } from 'node:crypto';
import { caminhoDoPfx, type CadeiaIcp, impressaoDigital, montarCadeia } from './cadeia';
import { compararCnpj, escolherCnpj, titularDoCn } from './cnpj';
import {
  CertificadoRecusado,
  MSG_CERTIFICADO,
  msgAindaNaoVale,
  msgOutroCnpj,
  msgVencido,
} from './mensagens';
import { abrirPfx, lerCamposX509 } from './pkcs12.adapter';

export type TipoCertificado = 'A1' | 'SE-S' | 'outro';

export interface CertificadoConferido {
  chave: KeyObject;
  folha: X509Certificate;
  cadeia: X509Certificate[];
  titular: string;
  cnpj: string;
  cnpjConfere: 'igual' | 'mesma_raiz';
  tipo: TipoCertificado;
  politicaOid: string | null;
  emissor: string;
  numeroSerie: string;
  impressaoDigital: string;
  validoDe: Date;
  validoAte: Date;
  cadeiaConferida: boolean;
}

/** A folha é o certificado cuja chave pública casa com a chave privada do .pfx. Nenhum casa = FORMATO. */
export function escolherFolha(chave: KeyObject, certificados: X509Certificate[]): X509Certificate {
  const folha = certificados.find((c) => {
    try {
      return c.checkPrivateKey(chave);
    } catch {
      return false;
    }
  });
  if (!folha) throw new CertificadoRecusado('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato);
  return folha;
}

export function tipoDaPolitica(politicas: string[]): { tipo: TipoCertificado; politicaOid: string | null } {
  const a1 = politicas.find((p) => p.startsWith('2.16.76.1.2.1.'));
  if (a1) return { tipo: 'A1', politicaOid: a1 };
  const se = politicas.find((p) => p.startsWith('2.16.76.1.2.201.'));
  if (se) return { tipo: 'SE-S', politicaOid: se };
  return { tipo: 'outro', politicaOid: politicas.find((p) => p.startsWith('2.16.76.1.2.')) ?? politicas[0] ?? null };
}

/** Ordem: abrir → folha → validade → CNPJ → cadeia. Falha = `CertificadoRecusado` com a frase da tabela; nunca texto de biblioteca. */
export function conferirCertificado(e: {
  arquivo: Buffer;
  senha: string;
  cnpjEmpresa: string;
  agora: Date;
  icp: CadeiaIcp;
}): CertificadoConferido {
  const { chave, certificados } = abrirPfx(e.arquivo, e.senha);
  const folha = escolherFolha(chave, certificados);

  const validoDe = new Date(folha.validFrom);
  const validoAte = new Date(folha.validTo);
  if (e.agora < validoDe) throw new CertificadoRecusado('CERTIFICADO_AINDA_NAO_VALE', msgAindaNaoVale(validoDe));
  if (e.agora > validoAte) throw new CertificadoRecusado('CERTIFICADO_VENCIDO', msgVencido(validoAte));

  const campos = lerCamposX509(folha.raw);
  const cnpj = escolherCnpj({ san: campos.cnpjSan, serialNumber: campos.serialNumberSujeito, cn: campos.cnSujeito });
  if (cnpj === null) throw new CertificadoRecusado('CERTIFICADO_SEM_CNPJ', MSG_CERTIFICADO.semCnpj);
  const confere = compararCnpj(cnpj, e.cnpjEmpresa);
  if (confere === 'empresa_sem_cnpj') throw new CertificadoRecusado('EMPRESA_SEM_CNPJ', MSG_CERTIFICADO.empresaSemCnpj);
  const titular = campos.cnSujeito === null ? '' : titularDoCn(campos.cnSujeito);
  if (confere === 'diferente') {
    throw new CertificadoRecusado('CERTIFICADO_OUTRO_CNPJ', msgOutroCnpj(cnpj, titular, e.cnpjEmpresa));
  }

  const resultado = montarCadeia(folha, certificados, e.icp, e.agora);
  if (resultado.situacao === 'adulterada') throw new CertificadoRecusado('CERTIFICADO_CADEIA', MSG_CERTIFICADO.cadeia);
  let cadeia: X509Certificate[];
  if (resultado.situacao === 'conferida') {
    cadeia = resultado.intermediarias;
  } else {
    const sinalIcp = campos.orgEmissor === 'ICP-Brasil' || campos.politicas.some((p) => p.startsWith('2.16.76.1.2.'));
    if (!sinalIcp) throw new CertificadoRecusado('CERTIFICADO_NAO_ICP', MSG_CERTIFICADO.naoIcp);
    cadeia = caminhoDoPfx(folha, certificados);
  }

  return {
    chave,
    folha,
    cadeia,
    titular,
    cnpj,
    cnpjConfere: confere,
    ...tipoDaPolitica(campos.politicas),
    emissor: campos.cnEmissor ?? campos.orgEmissor ?? '',
    numeroSerie: folha.serialNumber,
    impressaoDigital: impressaoDigital(folha),
    validoDe,
    validoAte,
    cadeiaConferida: resultado.situacao === 'conferida',
  };
}
