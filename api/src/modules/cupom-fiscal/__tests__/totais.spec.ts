import { calcularTotais, decimal2, decimal4, precoCentavos, quantidadeValida, ratearDesconto, valorItemCentavos } from '../totais';

const itens = [
  { quantidade: '2', precoCentavos: 1200n },
  { quantidade: '3', precoCentavos: 990n },
];
const pag = [{ tPag: '01' as const, valor: 6000n }];

describe('totais do cupom (centavos)', () => {
  it('quantidadeValida: até 4 casas, ponto, maior que zero', () => {
    expect(quantidadeValida('0,350')).toBe(false);
    expect(quantidadeValida('0')).toBe(false);
    expect(quantidadeValida('0.0000')).toBe(false);
    expect(quantidadeValida('-1')).toBe(false);
    expect(quantidadeValida('1.23456')).toBe(false);
    expect(quantidadeValida('0.350')).toBe(true);
    expect(quantidadeValida('1234567.1234')).toBe(true);
    expect(quantidadeValida('12345678')).toBe(false);
  });

  it('precoCentavos arredonda uma vez, metade para cima', () => {
    expect(precoCentavos('12.345')).toBe(1235n);
    expect(precoCentavos('12.344')).toBe(1234n);
    expect(precoCentavos('9.9')).toBe(990n);
    expect(precoCentavos('12')).toBe(1200n);
    expect(precoCentavos('0.005')).toBe(1n);
  });

  it('valorItemCentavos: quantidade com 4 casas, arredondado uma vez', () => {
    expect(valorItemCentavos('0.3335', 1000n)).toBe(334n);
    expect(valorItemCentavos('0.3334', 1000n)).toBe(333n);
    expect(valorItemCentavos('2', 1200n)).toBe(2400n);
  });

  it('ratearDesconto: piso proporcional e sobra para os maiores', () => {
    expect(ratearDesconto([2400n, 2970n], 370n)).toEqual([165n, 205n]);
    expect(ratearDesconto([100n, 100n, 100n], 2n)).toEqual([1n, 1n, 0n]);
    expect(ratearDesconto([100n, 100n], 0n)).toEqual([0n, 0n]);
  });

  it('calcularTotais: produtos, desconto, total e troco', () => {
    const t = calcularTotais(itens, 370n, pag);
    expect(t).toMatchObject({ produtos: 5370n, desconto: 370n, total: 5000n, troco: 1000n });
    expect(t).toMatchObject({ itens: [{ bruto: 2400n, desconto: 165n }, { bruto: 2970n, desconto: 205n }] });
  });

  it('calcularTotais: erros na ordem do contrato', () => {
    expect(calcularTotais([], 0n, pag)).toEqual({ erro: 'SEM_ITENS' });
    expect(calcularTotais(itens, 5370n, pag)).toEqual({ erro: 'DESCONTO_INVALIDO' });
    expect(calcularTotais([{ quantidade: '1', precoCentavos: 20_000_000n }], 0n, pag)).toEqual({ erro: 'VALOR_MAXIMO' });
    expect(calcularTotais(itens, 0n, [{ tPag: '01', valor: 5000n }])).toEqual({ erro: 'PAGAMENTO_INSUFICIENTE' });
    expect(calcularTotais(itens, 0n, [{ tPag: '17', valor: 6000n }])).toEqual({ erro: 'TROCO_INVALIDO' });
    expect(calcularTotais(itens, 0n, [{ tPag: '01', valor: 1000n }, { tPag: '17', valor: 5500n }])).toEqual({ erro: 'TROCO_INVALIDO' });
  });

  it('decimal2 e decimal4', () => {
    expect(decimal2(2400n)).toBe('24.00');
    expect(decimal2(5n)).toBe('0.05');
    expect(decimal4('2')).toBe('2.0000');
    expect(decimal4('0.35')).toBe('0.3500');
  });
});
