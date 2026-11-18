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
    expect(t).toMatchObject({
      itens: [
        { bruto: 2400n, desconto: 165n },
        { bruto: 2970n, desconto: 205n },
      ],
    });
  });

  it('calcularTotais: erros na ordem do contrato', () => {
    expect(calcularTotais([], 0n, pag)).toEqual({ erro: 'SEM_ITENS' });
    expect(calcularTotais(itens, 5370n, pag)).toEqual({ erro: 'DESCONTO_INVALIDO' });
    expect(calcularTotais([{ quantidade: '1', precoCentavos: 20_000_000n }], 0n, pag)).toEqual({ erro: 'VALOR_MAXIMO' });
    expect(calcularTotais(itens, 0n, [{ tPag: '01', valor: 5000n }])).toEqual({ erro: 'PAGAMENTO_INSUFICIENTE' });
    expect(calcularTotais(itens, 0n, [{ tPag: '17', valor: 6000n }])).toEqual({ erro: 'TROCO_INVALIDO' });
    expect(
      calcularTotais(itens, 0n, [
        { tPag: '01', valor: 1000n },
        { tPag: '17', valor: 5500n },
      ]),
    ).toEqual({ erro: 'TROCO_INVALIDO' });
  });

  it('decimal2 e decimal4', () => {
    expect(decimal2(2400n)).toBe('24.00');
    expect(decimal2(5n)).toBe('0.05');
    expect(decimal4('2')).toBe('2.0000');
    expect(decimal4('0.35')).toBe('0.3500');
  });
  // Leva pré-final, item 2 (Minor 1–3 e 6 da revisão da Tarefa 4): guardas e limites.
  it('calcularTotais: entrada torta vira erro de regra (nunca BigInt lançando)', () => {
    for (const q of ['0,350', 'abc', '', '1.', '0', '-1']) {
      expect(calcularTotais([{ quantidade: q, precoCentavos: 100n }], 0n, pag)).toEqual({ erro: 'QUANTIDADE_INVALIDA' });
    }
    expect(calcularTotais([{ quantidade: '1', precoCentavos: -1n }], 0n, pag)).toEqual({ erro: 'PRECO_INVALIDO' });
    expect(
      calcularTotais(itens, 0n, [
        { tPag: '01', valor: 100000n },
        { tPag: '03', valor: -95000n },
      ]),
    ).toEqual({
      erro: 'PAGAMENTO_INVALIDO',
    });
    expect(
      calcularTotais(itens, 0n, [
        { tPag: '01', valor: 6000n },
        { tPag: '17', valor: 0n },
      ]),
    ).toEqual({ erro: 'PAGAMENTO_INVALIDO' });
  });

  it('calcularTotais: item que arredonda para 0 centavo = ITEM_SEM_VALOR (não DESCONTO_INVALIDO)', () => {
    expect(calcularTotais([{ quantidade: '0.0001', precoCentavos: 1n }], 0n, pag)).toEqual({ erro: 'ITEM_SEM_VALOR' });
    expect(calcularTotais([...itens, { quantidade: '0.0001', precoCentavos: 1n }], 0n, pag)).toEqual({ erro: 'ITEM_SEM_VALOR' });
    expect(calcularTotais([{ quantidade: '1', precoCentavos: 0n }], 0n, pag)).toEqual({ erro: 'ITEM_SEM_VALOR' });
  });

  it('calcularTotais: limites do teto, do desconto e do pagamento exato', () => {
    const um = (centavos: bigint) => [{ quantidade: '1', precoCentavos: centavos }];
    expect(calcularTotais(um(19_999_999n), 0n, [{ tPag: '01', valor: 19_999_999n }])).toMatchObject({ total: 19_999_999n, troco: 0n });
    expect(calcularTotais(um(20_000_000n), 0n, [{ tPag: '01', valor: 20_000_000n }])).toEqual({ erro: 'VALOR_MAXIMO' });
    expect(calcularTotais(itens, 5369n, [{ tPag: '01', valor: 1n }])).toMatchObject({ produtos: 5370n, desconto: 5369n, total: 1n });
    expect(calcularTotais(itens, 5370n, [{ tPag: '01', valor: 1n }])).toEqual({ erro: 'DESCONTO_INVALIDO' });
    expect(calcularTotais(itens, 370n, [{ tPag: '03', valor: 5000n }])).toMatchObject({ total: 5000n, troco: 0n });
  });

  it('ratearDesconto: a soma das partes é o desconto, nenhuma parte passa do valor, a sobra vai para os maiores', () => {
    const casos: [bigint[], bigint][] = [
      [[2400n, 2970n], 370n],
      [[1n, 1n, 1n], 2n],
      [[333n, 333n, 334n], 999n],
      [[7n, 13n, 101n, 999n], 1119n],
      [[5000n, 1n], 4999n],
    ];
    for (const [valores, desconto] of casos) {
      const partes = ratearDesconto(valores, desconto);
      expect(partes.reduce((a, v) => a + v, 0n)).toBe(desconto);
      partes.forEach((p, i) => expect(p <= valores[i]).toBe(true));
    }
    expect(ratearDesconto([100n, 300n, 300n], 2n)).toEqual([0n, 1n, 1n]);
  });

  it('quantidadeValida: "1." e "" recusadas', () => {
    expect(quantidadeValida('1.')).toBe(false);
    expect(quantidadeValida('')).toBe(false);
  });

  it('decimal2 recusa negativo; decimal4 valida a entrada e não sai com zero à esquerda', () => {
    expect(() => decimal2(-1n)).toThrow();
    expect(decimal2(0n)).toBe('0.00');
    expect(decimal4('02')).toBe('2.0000');
    expect(decimal4('007.5')).toBe('7.5000');
    expect(decimal4('0.35')).toBe('0.3500');
    for (const q of ['0,350', '', '1.', 'abc', '0', '-1']) expect(() => decimal4(q)).toThrow();
  });
});
