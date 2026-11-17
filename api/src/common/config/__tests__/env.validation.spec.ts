import { validateEnv } from '../env.validation';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'j'.repeat(32) };

describe('validateEnv: CERTIFICADO_SECRET', () => {
  it('ausente ou vazia = undefined', () => {
    expect(validateEnv({ ...base }).CERTIFICADO_SECRET).toBeUndefined();
    expect(validateEnv({ ...base, CERTIFICADO_SECRET: '' }).CERTIFICADO_SECRET).toBeUndefined();
  });

  it('com 31 caracteres é recusada', () => {
    expect(() => validateEnv({ ...base, CERTIFICADO_SECRET: 'a'.repeat(31) })).toThrow(/Configuração de ambiente inválida/);
  });

  it('com 64 caracteres é mantida', () => {
    expect(validateEnv({ ...base, CERTIFICADO_SECRET: 'a'.repeat(64) }).CERTIFICADO_SECRET).toBe('a'.repeat(64));
  });
});

describe('validateEnv: SEFAZ_DFE_AMBIENTE', () => {
  it('ausente ou vazia = desligado', () => {
    expect(validateEnv({ ...base }).SEFAZ_DFE_AMBIENTE).toBe('desligado');
    expect(validateEnv({ ...base, SEFAZ_DFE_AMBIENTE: '' }).SEFAZ_DFE_AMBIENTE).toBe('desligado');
  });

  it('producao e homologacao ficam como vieram', () => {
    expect(validateEnv({ ...base, SEFAZ_DFE_AMBIENTE: 'producao' }).SEFAZ_DFE_AMBIENTE).toBe('producao');
    expect(validateEnv({ ...base, SEFAZ_DFE_AMBIENTE: 'homologacao' }).SEFAZ_DFE_AMBIENTE).toBe('homologacao');
  });

  it("'prod' é recusado", () => {
    expect(() => validateEnv({ ...base, SEFAZ_DFE_AMBIENTE: 'prod' })).toThrow(/Configuração de ambiente inválida/);
  });
});
