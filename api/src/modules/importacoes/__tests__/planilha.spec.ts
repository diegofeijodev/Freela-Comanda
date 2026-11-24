import { Prisma } from '@prisma/client';
import { agregarVendas, aplicarMapeamento, camposFaltando, centavos, dataDaCelula, MAPEAMENTO_PADRAO, numeroDaCelula, type Mapeamento } from '../planilha';

const D = (s: string) => new Prisma.Decimal(s);
const txt = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

describe('números da planilha (vírgula ou ponto, sem chute)', () => {
  it('modo vírgula: "1.234,56", "1234,56", "12" e "R$ 12,90"', () => {
    expect(txt(numeroDaCelula('1.234,56', 'virgula'))).toBe('1234.56');
    expect(txt(numeroDaCelula('1234,56', 'virgula'))).toBe('1234.56');
    expect(txt(numeroDaCelula('12', 'virgula'))).toBe('12');
    expect(txt(numeroDaCelula('R$ 12,90', 'virgula'))).toBe('12.9');
    expect(txt(numeroDaCelula('1.234.567,8', 'virgula'))).toBe('1234567.8');
  });
  it('modo vírgula: "12.90" e "1.234" (sem vírgula) são ambíguos = null (linha com problema)', () => {
    expect(numeroDaCelula('12.90', 'virgula')).toBeNull();
    expect(numeroDaCelula('1.234', 'virgula')).toBeNull();
    expect(numeroDaCelula('1,2,3', 'virgula')).toBeNull();
  });
  it('modo ponto: "1,234.56", "1234.56"; "12,90" e "1,234" são ambíguos', () => {
    expect(txt(numeroDaCelula('1,234.56', 'ponto'))).toBe('1234.56');
    expect(txt(numeroDaCelula('1234.56', 'ponto'))).toBe('1234.56');
    expect(numeroDaCelula('12,90', 'ponto')).toBeNull();
    expect(numeroDaCelula('1,234', 'ponto')).toBeNull();
  });
  it('vazio, texto e negativo', () => {
    expect(numeroDaCelula('', 'virgula')).toBeNull();
    expect(numeroDaCelula('abc', 'virgula')).toBeNull();
    expect(numeroDaCelula(undefined, 'virgula')).toBeNull();
    expect(txt(numeroDaCelula('-3,5', 'virgula'))).toBe('-3.5');
    expect(txt(numeroDaCelula(12.5 as unknown as string, 'ponto'))).toBe('12.5');
  });
  it('centavos sem ponto flutuante (0,1 + 0,2 = 30 centavos)', () => {
    expect(centavos(D('0.1').add(D('0.2')))).toBe(30);
    expect(centavos(D('12.345'))).toBe(1235);
  });
});

describe('datas da planilha', () => {
  it('dd/mm/aaaa, aaaa-mm-dd e com a hora junto', () => {
    expect(dataDaCelula('24/11/2026')).toEqual({ data: '2026-11-24', hora: null });
    expect(dataDaCelula('2026-11-24')).toEqual({ data: '2026-11-24', hora: null });
    expect(dataDaCelula('5/1/2026 14:30')).toEqual({ data: '2026-01-05', hora: '14:30:00' });
    expect(dataDaCelula('24/11/2026 09:05:07')).toEqual({ data: '2026-11-24', hora: '09:05:07' });
    expect(dataDaCelula('2026-11-24T21:10:00')).toEqual({ data: '2026-11-24', hora: '21:10:00' });
  });
  it('data impossível, americana ou com ano de 2 dígitos = null', () => {
    expect(dataDaCelula('31/02/2026')).toBeNull();
    expect(dataDaCelula('11/20/2026')).toBeNull();
    expect(dataDaCelula('24/11/26')).toBeNull();
    expect(dataDaCelula('')).toBeNull();
  });
});

describe('mapeamento de colunas', () => {
  const m: Mapeamento = { pedido: 'Nº Venda', data: 'Data', produto: 'Descrição', quantidade: 'Qtde', valor_total: 'Total', desconto: 'Desc' };
  const op = { hoje: '2026-11-24', prefixo: '' };

  it('campos obrigatórios faltando', () => {
    expect(camposFaltando({ pedido: 'x', produto: 'p' })).toEqual(['data', 'quantidade', 'valor_total']);
    expect(camposFaltando(m)).toEqual([]);
    expect(camposFaltando({ data: '  ', produto: 'p', quantidade: 'q', valor_total: 't' })).toEqual(['data']);
  });

  it('converte as linhas válidas e guarda o nº da linha do arquivo (cabeçalho = 1)', () => {
    const r = aplicarMapeamento(
      [{ 'Nº Venda': '1001', Data: '20/11/2026 19:30', Descrição: '  Caldo   300 ml ', Qtde: '2', Total: '1.234,50', Desc: '0,50' }],
      m,
      'virgula',
      op,
    );
    expect(r.problemas).toEqual([]);
    expect(r.validas).toHaveLength(1);
    const v = r.validas[0]!;
    expect([v.linha, v.pedido, v.data, v.hora, v.produto_relatorio]).toEqual([2, '1001', '2026-11-20', '19:30:00', 'Caldo 300 ml']);
    expect([txt(v.quantidade), txt(v.valor_total), txt(v.desconto), txt(v.taxa), v.preco_unitario]).toEqual(['2', '1234.5', '0.5', '0', null]);
  });

  it('cada problema com o motivo e a linha', () => {
    const r = aplicarMapeamento(
      [
        { 'Nº Venda': '1', Data: '31/02/2026', Descrição: 'X', Qtde: '1', Total: '10' },
        { 'Nº Venda': '2', Data: '28/11/2026', Descrição: 'X', Qtde: '1', Total: '10' },
        { 'Nº Venda': '3', Data: '20/11/2026', Descrição: '', Qtde: '1', Total: '10' },
        { 'Nº Venda': '4', Data: '20/11/2026', Descrição: 'X', Qtde: '0', Total: '10' },
        { 'Nº Venda': '5', Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '12.90' },
        { 'Nº Venda': '', Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '10' },
        { 'Nº Venda': '7', Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '-10' },
        { 'Nº Venda': '8', Data: '20/11/2026', Descrição: 'X', Qtde: '', Total: '10' },
        { 'Nº Venda': '9', Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '10', Desc: 'abc' },
      ],
      m,
      'virgula',
      op,
    );
    expect(r.validas).toEqual([]);
    expect(r.problemas).toEqual([
      { linha: 2, motivo: 'data inválida (31/02/2026)' },
      { linha: 3, motivo: 'data no futuro (28/11/2026)' },
      { linha: 4, motivo: 'produto vazio' },
      { linha: 5, motivo: 'quantidade zero' },
      { linha: 6, motivo: 'valor ilegível (12.90)' },
      { linha: 7, motivo: 'pedido vazio' },
      { linha: 8, motivo: 'valor negativo (-10)' },
      { linha: 9, motivo: 'quantidade vazia' },
      { linha: 10, motivo: 'desconto ilegível (abc)' },
    ]);
  });

  it('sem coluna de pedido: cada dia vira o pedido "<prefixo>DIA <data>"', () => {
    const r = aplicarMapeamento(
      [
        { Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '10' },
        { Data: '21/11/2026', Descrição: 'X', Qtde: '1', Total: '10' },
      ],
      { data: 'Data', produto: 'Descrição', quantidade: 'Qtde', valor_total: 'Total' },
      'virgula',
      { hoje: '2026-11-24', prefixo: 'IF-' },
    );
    expect(r.validas.map((v) => v.pedido)).toEqual(['IF-DIA 2026-11-20', 'IF-DIA 2026-11-21']);
  });

  it('prefixo do sistema na frente do pedido e hora da coluna própria vence a da data', () => {
    const r = aplicarMapeamento(
      [{ p: '1001', d: '20/11/2026 10:00', h: '19:45', x: 'X', q: '1', t: '10' }],
      { pedido: 'p', data: 'd', hora: 'h', produto: 'x', quantidade: 'q', valor_total: 't' },
      'virgula',
      { hoje: '2026-11-24', prefixo: 'IF-' },
    );
    expect([r.validas[0]!.pedido, r.validas[0]!.hora]).toEqual(['IF-1001', '19:45:00']);
  });

  it('a planilha padrão do Comanda: as colunas de sempre, datas aaaa-mm-dd e vírgula decimal', () => {
    const r = aplicarMapeamento(
      [{ pedido: 'S1', data: '2026-10-20', hora: '19:30', produto_relatorio: 'SMOKE ESPETO', quantidade: '2', valor_total: '24,00' }],
      MAPEAMENTO_PADRAO,
      'virgula',
      op,
    );
    expect([r.validas[0]!.pedido, r.validas[0]!.data, txt(r.validas[0]!.valor_total)]).toEqual(['S1', '2026-10-20', '24']);
  });
});

describe('linhas repetidas no arquivo', () => {
  it('soma pedido + produto + data (Decimal) e conta quantas foram somadas', () => {
    const r = aplicarMapeamento(
      [
        { p: '1', d: '20/11/2026', x: 'X', q: '1', t: '0,10' },
        { p: '1', d: '20/11/2026', x: 'X', q: '2', t: '0,20' },
        { p: '2', d: '20/11/2026', x: 'X', q: '1', t: '5' },
      ],
      { pedido: 'p', data: 'd', produto: 'x', quantidade: 'q', valor_total: 't' },
      'virgula',
      { hoje: '2026-11-24', prefixo: '' },
    );
    const { vendas, somadas } = agregarVendas(r.validas);
    expect(somadas).toBe(1);
    expect(vendas.map((v) => [v.pedido, txt(v.quantidade), txt(v.valor_total), v.linha])).toEqual([
      ['1', '3', '0.3', 2],
      ['2', '1', '5', 4],
    ]);
  });
});
