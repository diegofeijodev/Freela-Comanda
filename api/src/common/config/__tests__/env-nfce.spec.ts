import { validateEnv } from '../env.validation';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'j'.repeat(32) };

describe('validateEnv: NFCE_AMBIENTE (cupom fiscal)', () => {
  it('ausente ou vazia = desligado', () => {
    expect(validateEnv({ ...base }).NFCE_AMBIENTE).toBe('desligado');
    expect(validateEnv({ ...base, NFCE_AMBIENTE: '' }).NFCE_AMBIENTE).toBe('desligado');
  });

  it('homologacao e producao ficam como vieram', () => {
    expect(validateEnv({ ...base, NFCE_AMBIENTE: 'homologacao' }).NFCE_AMBIENTE).toBe('homologacao');
    expect(validateEnv({ ...base, NFCE_AMBIENTE: 'producao' }).NFCE_AMBIENTE).toBe('producao');
  });

  it("'teste' é recusado (valor desconhecido derruba a subida)", () => {
    expect(() => validateEnv({ ...base, NFCE_AMBIENTE: 'teste' })).toThrow(/Configuração de ambiente inválida/);
  });

  it('é separada da busca: NFC-e em homologação com a busca em produção', () => {
    const env = validateEnv({ ...base, NFCE_AMBIENTE: 'homologacao', SEFAZ_DFE_AMBIENTE: 'producao' });
    expect([env.NFCE_AMBIENTE, env.SEFAZ_DFE_AMBIENTE]).toEqual(['homologacao', 'producao']);
  });
});
