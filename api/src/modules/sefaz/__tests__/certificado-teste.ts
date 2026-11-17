import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';

// Certificado FICTÍCIO dos testes do transporte e da assinatura (fixtures/tls, `api/scripts/gerar-certificados-teste.sh --tls`):
// a folha `cliente`, emitida pela `ac-teste`. Nunca um certificado real.
const fixtureTls = (nome: string): string => readFileSync(join(__dirname, 'fixtures', 'tls', nome), 'utf8');

export const CLIENTE: CertificadoEmUso = {
  chavePrivada: createPrivateKey(fixtureTls('cliente.key')),
  certificado: new X509Certificate(fixtureTls('cliente.pem')),
  cadeia: [],
  cnpj: '12345678000195',
  validoAte: new Date('2046-01-01T00:00:00Z'),
  impressaoDigital: 'FICTICIO',
};
