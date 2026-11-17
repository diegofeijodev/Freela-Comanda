import * as tls from 'node:tls';
import type { CadeiaIcp } from '../certificado-digital/cadeia';

/**
 * Autoridades em que o transporte confia para o certificado do SERVIDOR da SEFAZ (opção `ca`, que substitui a lista padrão):
 * as raízes do próprio Node + as âncoras ICP-Brasil fixadas. Nunca o pacote de apoio (intermediárias não são âncora) e
 * nenhuma variável de ambiente acrescenta âncora.
 */
export function confiancaSefaz(icp: CadeiaIcp): string[] {
  return [...tls.rootCertificates, ...icp.ancoras.map(String)];
}
