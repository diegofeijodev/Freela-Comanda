import { chaveValida, montarChaveNfce, partesDaChave } from '../chave-acesso';
import { cpfValido, gtinValido, mascararCpf } from '../documentos';
import { textoFiscal } from '../texto-fiscal';

describe('peças fiscais da NFC-e', () => {
  it('monta a chave (UF 35, modelo 65, DV pelo módulo 11)', () => {
    const c = montarChaveNfce({ aamm: '2611', cnpj: '12ABC34501DE35', serie: 2, numero: 12, tpEmis: 1, cNF: '40213377' });
    expect(c).toHaveLength(44);
    expect(chaveValida(c)).toBe(true);
    expect(partesDaChave(c)).toMatchObject({ uf: '35', aamm: '2611', modelo: '65', serie: '2', numero: '12' });
    expect(c.slice(34, 35)).toBe('1');
    expect(c.slice(35, 43)).toBe('40213377');
  });

  it('aceita contingência (tpEmis 9) e recusa entrada torta', () => {
    const base = { aamm: '2611', cnpj: '12345678000195', serie: 1, numero: 1, tpEmis: 9 as const, cNF: '00000001' };
    expect(chaveValida(montarChaveNfce(base))).toBe(true);
    expect(() => montarChaveNfce({ ...base, cNF: '123' })).toThrow();
    expect(() => montarChaveNfce({ ...base, numero: 0 })).toThrow();
    expect(() => montarChaveNfce({ ...base, cnpj: '123' })).toThrow();
  });

  it('CPF', () => {
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
  });

  it('máscara do CPF', () => {
    expect(mascararCpf('52998224725')).toBe('***.982.247-**');
    expect(mascararCpf('529.982.247-25')).toBe('***.982.247-**');
    expect(mascararCpf('123')).toBe('***.***.***-**');
  });

  it('GTIN', () => {
    expect(gtinValido('7891000315507')).toBe(true);
    expect(gtinValido('7891000315508')).toBe(false);
    expect(gtinValido('96385074')).toBe(true);
    expect(gtinValido('123')).toBe(false);
    expect(gtinValido('78910003155A7')).toBe(false);
  });

  it('texto fiscal', () => {
    expect(textoFiscal('Chopp 300\u0085ml\u0007  ', 120)).toBe('Chopp 300 ml');
    expect(textoFiscal('a\u2028b\u2029c', 120)).toBe('a b c');
    expect(textoFiscal('a'.repeat(130), 120)).toHaveLength(120);
    expect(textoFiscal('😀'.repeat(5), 3)).toBe('😀😀😀');
  });
});
