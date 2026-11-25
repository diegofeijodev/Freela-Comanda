import { pareceCana } from '../parece-cana';

describe('pareceCana', () => {
  it('parece de caldo: palavra inteira, sem caixa e sem acento', () => {
    expect([pareceCana('Garapa 300'), pareceCana('FROZEN de cana'), pareceCana('Canapé'), pareceCana('Americana')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
  it('com acento e em qualquer posição', () => {
    expect([pareceCana('Cáldo de cana 500 ml'), pareceCana('Suco de laranja'), pareceCana('CALDO CANA 500')]).toEqual([true, false, true]);
  });
});
