import { cnpjDoCn, cnpjValido, compararCnpj, documentoLidoPelaIa, escolherCnpj, formatarCnpj, normalizarCnpj, titularDoCn } from '../cnpj';

describe('cnpj', () => {
  it('normaliza e formata (letras ficam, maiúsculas)', () => {
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(formatarCnpj('123')).toBe('123');
  });

  it.each(['12345678000195', '12345678000276', '99888777000100', '12ABC34501DE35'])('%s tem DV válido', (c) => {
    expect(cnpjValido(c)).toBe(true);
  });

  it.each(['12345678000194', '00000000000000', '1234567800019', '12345678000195X', ''])('%s é inválido', (c) => {
    expect(cnpjValido(c)).toBe(false);
  });

  it('lê o CNPJ no fim do CN e o titular', () => {
    expect(cnpjDoCn('EMPRESA DE TESTE LTDA:12345678000195')).toBe('12345678000195');
    expect(cnpjDoCn('FULANO DE TAL:12345678909')).toBeNull();
    expect(titularDoCn('EMPRESA DE TESTE LTDA:12345678000195')).toBe('EMPRESA DE TESTE LTDA');
    expect(titularDoCn('EMPRESA DE TESTE LTDA')).toBe('EMPRESA DE TESTE LTDA');
    expect(titularDoCn('FULANO DE TAL:12345678909')).toBe('FULANO DE TAL:12345678909');
  });

  describe('escolherCnpj', () => {
    it('SAN só com zeros cai para o CN', () => {
      expect(escolherCnpj({ san: '00000000000000', serialNumber: null, cn: 'X LTDA:12345678000195' })).toBe('12345678000195');
    });
    it('SAN válido vence o CN', () => {
      expect(escolherCnpj({ san: '99888777000100', serialNumber: null, cn: 'X LTDA:12345678000195' })).toBe('99888777000100');
    });
    it('serialNumber vence o CN; o de 11 dígitos (CPF) é ignorado', () => {
      expect(escolherCnpj({ san: null, serialNumber: '12.345.678/0001-95', cn: null })).toBe('12345678000195');
      expect(escolherCnpj({ san: null, serialNumber: '12345678909', cn: null })).toBeNull();
    });
    it('tudo nulo dá null', () => {
      expect(escolherCnpj({ san: null, serialNumber: null, cn: null })).toBeNull();
    });
  });

  describe('compararCnpj', () => {
    const c = '12345678000195';
    it.each([
      ['12.345.678/0001-95', 'igual'],
      ['12.345.678/0002-76', 'mesma_raiz'],
      ['99.888.777/0001-00', 'diferente'],
      ['', 'empresa_sem_cnpj'],
      ['00.000.000/0001-00', 'empresa_sem_cnpj'],
    ])('empresa %s → %s', (empresa, esperado) => {
      expect(compararCnpj(c, empresa)).toBe(esperado);
    });
  });
});

describe('documentoLidoPelaIa', () => {
  it('rótulo, CNPJ e CPF válidos; o resto é null', () => {
    expect(documentoLidoPelaIa('CNPJ: 12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(documentoLidoPelaIa('cpf 123.456.789-09')).toBe('12345678909');
    expect(documentoLidoPelaIa('lixo')).toBeNull();
    expect(documentoLidoPelaIa('12.ABC.345/01DE-36')).toBeNull();
  });
});
