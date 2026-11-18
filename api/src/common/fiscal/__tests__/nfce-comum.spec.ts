import { chaveValida, montarChaveNfce, partesDaChave } from '../chave-acesso';
import { cpfValido, gtinValido, mascararCpf } from '../documentos';
import { cabeNoEsquema, textoDoCupom, textoFiscal } from '../texto-fiscal';

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

  it('recusa série acima de 999, tpEmis fora de 1/9 e AAMM torto (cada um com a sua frase)', () => {
    const base = { aamm: '2611', cnpj: '12345678000195', serie: 1, numero: 1, tpEmis: 1 as const, cNF: '00000001' };
    expect(chaveValida(montarChaveNfce({ ...base, serie: 999 }))).toBe(true);
    expect(() => montarChaveNfce({ ...base, serie: 1000 })).toThrow('Série da chave fora de 0–999.');
    expect(() => montarChaveNfce({ ...base, serie: -1 })).toThrow('Série da chave fora de 0–999.');
    expect(() => montarChaveNfce({ ...base, serie: 1.5 })).toThrow('Série da chave fora de 0–999.');
    expect(() => montarChaveNfce({ ...base, tpEmis: 2 as unknown as 1 })).toThrow('Tipo de emissão da chave deve ser 1 ou 9.');
    expect(() => montarChaveNfce({ ...base, tpEmis: 0 as unknown as 1 })).toThrow('Tipo de emissão da chave deve ser 1 ou 9.');
    for (const aamm of ['261', '26110', '26a1', ' 2611', '']) {
      expect(() => montarChaveNfce({ ...base, aamm })).toThrow('AAMM da chave deve ter 4 dígitos.');
    }
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

  it('texto fiscal: TAB, LF e CR viram espaço (não colam as palavras); controles C1 somem', () => {
    expect(textoFiscal('Obrigado!\nVolte\tsempre\r\nfim', 120)).toBe('Obrigado! Volte sempre fim');
    expect(textoFiscal('a\u0080b\u009Fc\u007Fd', 120)).toBe('abcd');
    expect(textoFiscal('a\u0085b', 120)).toBe('a b');
  });

  it('texto do cupom: aspas, travessões e reticências do teclado em ASCII, acento composto; cabeNoEsquema = só U+0020–U+00FF', () => {
    expect(textoDoCupom('\u201CEspecial\u201D \u2013 Cafe\u0301\u2026 d\u2019\u00E1gua\n', 120)).toBe('"Especial" - Café... d\'água');
    expect(textoDoCupom('x'.repeat(130), 120)).toHaveLength(120);
    expect(cabeNoEsquema(textoDoCupom('Pão & "Café" <grande> ç ÿ', 120))).toBe(true);
    for (const t of ['Chopp 🍺', 'Feito ✓', 'Ω', '\u20AC 10']) expect(cabeNoEsquema(textoDoCupom(t, 120))).toBe(false);
  });
});
