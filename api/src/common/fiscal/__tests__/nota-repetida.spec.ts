import { fraseNotaRepetida, origemPorExtenso, pareceRepetida, type NotaParecida } from '../nota-repetida';

const ref = (cnpj: string | null, numero: string | null, serie: string | null = null) => ({ cnpj, numero, serie });

describe('pareceRepetida', () => {
  it.each([
    [ref('12ABC34501DE35', '000.004.411', '001'), ref('12ABC34501DE35', '4411', '1')],
    [ref('1', '1', '000'), ref('1', '1', '0')],
    [ref('1', '1', null), ref('1', '1', '1')],
    [ref('123.456.789-09', '5'), ref('12345678909', '5')],
    [ref('12.abc.345/01de-35', '7'), ref('12ABC34501DE35', '7')],
  ])('verdadeiro: %j × %j', (a, b) => expect(pareceRepetida(a, b)).toBe(true));

  it.each([
    [ref('1', '1', '1'), ref('1', '1', '2')],
    [ref('1', '1'), ref('1', '2')],
    [ref('1', '1'), ref('2', '1')],
    [ref(null, '1'), ref(null, '1')],
    [ref('', '1'), ref('', '1')],
    [ref('1', null), ref('1', null)],
    [ref('1', 's/n'), ref('1', 's/n')],
  ])('falso: %j × %j', (a, b) => expect(pareceRepetida(a, b)).toBe(false));
});

const nota = (extra: Partial<NotaParecida> = {}): NotaParecida => ({
  id: 'n1',
  numero: '4411',
  serie: '1',
  fornecedor_nome: 'ATACADÃO S.A.',
  data_emissao: '2026-11-03',
  data_entrada: '2026-11-03',
  valor_total: 1234.56,
  origem: 'foto',
  created_at: '2026-11-03T15:00:00.000Z',
  ...extra,
});

describe('fraseNotaRepetida', () => {
  it('com série', () => {
    expect(fraseNotaRepetida([nota()])).toBe(
      'Já existe a NF 4411 série 1 de ATACADÃO S.A., lançada em 03/11/2026 por foto, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.',
    );
  });
  it('sem série', () => {
    expect(fraseNotaRepetida([nota({ serie: null })])).toBe(
      'Já existe a NF 4411 de ATACADÃO S.A., lançada em 03/11/2026 por foto, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.',
    );
  });
  it('mais de uma parecida', () => {
    expect(fraseNotaRepetida([nota(), nota()])).toContain('de R$ 1.234,56 (e mais 1 parecida). Se for');
    expect(fraseNotaRepetida([nota(), nota(), nota()])).toContain('(e mais 2 parecidas).');
  });
  it('origens e valor', () => {
    expect(origemPorExtenso('xml')).toBe('por XML');
    expect(origemPorExtenso('pdf')).toBe('por PDF');
    expect(origemPorExtenso('foto')).toBe('por foto');
    expect(origemPorExtenso('sefaz')).toBe('pela SEFAZ');
    expect(origemPorExtenso('outra')).toBe('por outra');
    expect(fraseNotaRepetida([nota({ valor_total: 890 })])).toContain('de R$ 890,00.');
  });
});
