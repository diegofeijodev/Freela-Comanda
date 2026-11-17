import 'reflect-metadata';
import { X509Certificate } from 'node:crypto';
import * as tls from 'node:tls';
import { CADEIA_ICP, carregarCadeiaIcp } from '../../certificado-digital/cadeia';
import { CertificadoDigitalModule } from '../../certificado-digital/certificado-digital.module';
import { ANCORAS_ICP_BRASIL, PACOTE_ICP_BRASIL } from '../../certificado-digital/icp-brasil.gerado';
import { confiancaSefaz } from '../confianca';

describe('confiancaSefaz', () => {
  const confianca = confiancaSefaz(carregarCadeiaIcp());

  it('é a lista de raízes do Node mais as âncoras ICP-Brasil, nada além', () => {
    expect(confianca).toHaveLength(tls.rootCertificates.length + ANCORAS_ICP_BRASIL.length);
  });

  it('traz a Raiz Brasileira v10', () => {
    expect(confianca.some((pem) => new X509Certificate(pem).subject.includes('Raiz Brasileira v10'))).toBe(true);
  });

  it('nunca inclui o pacote de apoio (intermediárias não são âncora de confiança)', () => {
    const pacote = new Set(PACOTE_ICP_BRASIL.map((p) => p.trim()));
    expect(confianca.filter((pem) => pacote.has(pem.trim()))).toEqual([]);
  });

  it('o módulo do certificado exporta CADEIA_ICP para o módulo da SEFAZ', () => {
    expect(Reflect.getMetadata('exports', CertificadoDigitalModule)).toContain(CADEIA_ICP);
  });
});
