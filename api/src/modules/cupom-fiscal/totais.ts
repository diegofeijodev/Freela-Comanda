// Totais do cupom fiscal (NFC-e) em centavos inteiros (bigint), sem `number` com casas.
// ATENÇÃO: api/src/modules/cupom-fiscal/totais.ts e web/src/lib/cupom.ts são o MESMO código (mudar um = mudar o outro); os testes dos dois lados usam os mesmos casos.

export type TPag = '01' | '03' | '04' | '10' | '11' | '17';

export type ErroTotais =
  | 'SEM_ITENS'
  | 'QUANTIDADE_INVALIDA'
  | 'PRECO_INVALIDO'
  | 'PAGAMENTO_INVALIDO'
  | 'ITEM_SEM_VALOR'
  | 'DESCONTO_INVALIDO'
  | 'PAGAMENTO_INSUFICIENTE'
  | 'TROCO_INVALIDO'
  | 'VALOR_MAXIMO';

export type Totais = {
  produtos: bigint;
  desconto: bigint;
  total: bigint;
  troco: bigint;
  itens: { bruto: bigint; desconto: bigint }[];
};

/** Teto do cupom: R$ 200.000,00. */
const TOTAL_MAXIMO = 20_000_000n;

const RE_QUANTIDADE = /^\d{1,7}(\.\d{1,4})?$/;

/** Quantidade com até 4 casas, ponto como separador e maior que zero. */
export function quantidadeValida(q: string): boolean {
  if (typeof q !== 'string' || !RE_QUANTIDADE.test(q)) return false;
  return quantidadeMilesimos(q) > 0n;
}

/** Quantidade em décimos de milésimo (1/10000; 4 casas). Assume `q` já validada (`quantidadeValida`). */
function quantidadeMilesimos(q: string): bigint {
  const [inteiro, frac = ''] = q.split('.');
  return BigInt(inteiro + frac.padEnd(4, '0'));
}

/** Preço decimal ("12.345") em centavos, arredondado UMA vez, metade para cima. */
export function precoCentavos(preco: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(preco);
  if (!m) throw new Error(`Preço inválido: ${preco}`);
  const frac = (m[2] ?? '').padEnd(3, '0');
  const centavos = BigInt(m[1] + frac.slice(0, 2));
  return frac.charCodeAt(2) >= 53 ? centavos + 1n : centavos; // terceira casa >= 5
}

/** Valor do item = quantidade (4 casas) x preço em centavos, arredondado uma vez, metade para cima. */
export function valorItemCentavos(q: string, preco: bigint): bigint {
  return (quantidadeMilesimos(q) * preco + 5000n) / 10000n;
}

/** Rateio proporcional (piso); a sobra vai, de 1 em 1 centavo, para os maiores valores (empate: o primeiro). */
export function ratearDesconto(valores: bigint[], desconto: bigint): bigint[] {
  const soma = valores.reduce((a, v) => a + v, 0n);
  if (soma <= 0n) return valores.map(() => 0n);
  const partes = valores.map((v) => (v * desconto) / soma);
  let sobra = desconto - partes.reduce((a, v) => a + v, 0n);
  const ordem = valores.map((_, i) => i).sort((a, b) => (valores[a] === valores[b] ? a - b : valores[a] > valores[b] ? -1 : 1));
  for (let k = 0; sobra > 0n; k = (k + 1) % ordem.length) {
    partes[ordem[k]] += 1n;
    sobra -= 1n;
  }
  return partes;
}

export function calcularTotais(
  itens: { quantidade: string; precoCentavos: bigint }[],
  desconto: bigint,
  pagamentos: { tPag: TPag; valor: bigint }[],
): Totais | { erro: ErroTotais } {
  if (itens.length === 0) return { erro: 'SEM_ITENS' };
  // as guardas vêm antes de qualquer conta: entrada torta é erro de regra (com frase), nunca o BigInt lançando
  if (itens.some((i) => !quantidadeValida(i.quantidade))) return { erro: 'QUANTIDADE_INVALIDA' };
  if (itens.some((i) => typeof i.precoCentavos !== 'bigint' || i.precoCentavos < 0n)) return { erro: 'PRECO_INVALIDO' };
  if (pagamentos.some((p) => typeof p.valor !== 'bigint' || p.valor <= 0n)) return { erro: 'PAGAMENTO_INVALIDO' };
  const brutos = itens.map((i) => valorItemCentavos(i.quantidade, i.precoCentavos));
  // item que arredonda para 0 centavo não entra no cupom (a montagem recusa vProd zero): sem isto, todos zerados sairiam como desconto
  if (brutos.some((b) => b <= 0n)) return { erro: 'ITEM_SEM_VALOR' };
  const produtos = brutos.reduce((a, v) => a + v, 0n);
  if (desconto < 0n || desconto >= produtos) return { erro: 'DESCONTO_INVALIDO' };
  const total = produtos - desconto;
  if (total >= TOTAL_MAXIMO) return { erro: 'VALOR_MAXIMO' };
  const pago = pagamentos.reduce((a, p) => a + p.valor, 0n);
  if (pago < total) return { erro: 'PAGAMENTO_INSUFICIENTE' };
  const troco = pago - total;
  const dinheiro = pagamentos.filter((p) => p.tPag === '01').reduce((a, p) => a + p.valor, 0n);
  if (troco > dinheiro) return { erro: 'TROCO_INVALIDO' };
  const descontos = ratearDesconto(brutos, desconto);
  return { produtos, desconto, total, troco, itens: brutos.map((bruto, i) => ({ bruto, desconto: descontos[i] })) };
}

/** Centavos (0 ou mais) -> "24.00". Negativo não é valor de cupom: lança. */
export function decimal2(c: bigint): string {
  if (c < 0n) throw new Error('Valor negativo não entra no cupom.');
  const s = c.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Quantidade (`quantidadeValida`) -> "2.0000", sem zero à esquerda ("02" -> "2.0000": o esquema não aceita "02.0000"). Fora do formato: lança. */
export function decimal4(q: string): string {
  if (!quantidadeValida(q)) throw new Error('Quantidade fora do formato.');
  const [inteiro, frac = ''] = q.split('.');
  return `${BigInt(inteiro)}.${frac.padEnd(4, '0')}`;
}
