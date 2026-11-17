import { chaveValida, normalizarChave, normalizarNumeroSerie, partesDaChave } from '../chave-acesso';

const VETOR = '35261112ABC34501DE35550010000044111000044116';

describe('chave de acesso', () => {
  it('normaliza: maiúsculas e só [0-9A-Z]', () => {
    expect(normalizarChave('35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16')).toBe(VETOR);
  });

  it('aceita chaves com DV certo (alfanumérica e numérica)', () => {
    expect(chaveValida(VETOR)).toBe(true);
    expect(chaveValida('35261012345678000199550010000070011000070019')).toBe(true);
  });

  it('recusa DV errado, letra fora de 7–18, tamanho, vazio e minúsculas', () => {
    expect(chaveValida('35261112ABC34501DE35550010000044111000044117')).toBe(false);
    expect(chaveValida('35261012345678000199550010000070011000070011')).toBe(false);
    expect(chaveValida('35261112ABC34501DE35550010000A44111000044116')).toBe(false);
    expect(chaveValida(VETOR.slice(0, 43))).toBe(false);
    expect(chaveValida('')).toBe(false);
    expect(chaveValida(VETOR.toLowerCase())).toBe(false);
  });

  it('partesDaChave', () => {
    expect(partesDaChave(VETOR)).toEqual({
      uf: '35',
      aamm: '2611',
      emitente: '12ABC34501DE35',
      modelo: '55',
      serie: '1',
      numero: '4411',
    });
    expect(partesDaChave('35261112ABC34501DE35550010000044111000044117')).toBeNull();
  });
});

describe('normalizarNumeroSerie', () => {
  it.each([
    ['000.004.411', '4411'],
    ['001', '1'],
    ['000', '0'],
    ['A1', '1'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%s → %s', (entrada, saida) => {
    expect(normalizarNumeroSerie(entrada)).toBe(saida);
  });
});
