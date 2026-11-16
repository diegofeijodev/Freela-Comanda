import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnviarCertificadoDto } from '../certificado-digital.dto';

const mensagens = (o: unknown) =>
  validateSync(plainToInstance(EnviarCertificadoDto, o) as object, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('EnviarCertificadoDto', () => {
  it('arquivo e senha dentro dos limites passam (90.000 e 128)', () => {
    expect(mensagens({ arquivo_base64: 'A'.repeat(90000), senha: 'x'.repeat(128) })).toEqual([]);
  });
  it('90.001 caracteres = a frase dos 64 KB', () => {
    expect(mensagens({ arquivo_base64: 'A'.repeat(90001), senha: 'x' })).toEqual([
      'Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).',
    ]);
  });
  it('senha vazia', () => {
    expect(mensagens({ arquivo_base64: 'AAAA', senha: '' })).toEqual(['Digite a senha do certificado.']);
  });
  it('senha com 129 caracteres', () => {
    expect(mensagens({ arquivo_base64: 'AAAA', senha: 'x'.repeat(129) })).toEqual(['A senha do certificado tem no máximo 128 caracteres.']);
  });
  it('arquivo vazio', () => {
    expect(mensagens({ arquivo_base64: '', senha: 'x' })).toEqual(['Escolha o arquivo do certificado.']);
  });
  it('campo a mais é recusado', () => {
    expect(mensagens({ arquivo_base64: 'AAAA', senha: 'x', extra: 1 }).length).toBeGreaterThan(0);
  });
});
