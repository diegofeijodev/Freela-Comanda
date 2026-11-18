// Totais do cupom fiscal (NFC-e) em centavos inteiros (bigint), sem `number` com casas.
// ATENÇÃO: api/src/modules/cupom-fiscal/totais.ts e web/src/lib/cupom.ts são o MESMO código (mudar um = mudar o outro); os testes dos dois lados usam os mesmos casos.

export type TPag = '01' | '03' | '04' | '10' | '11' | '17';

export type ErroTotais = 'SEM_ITENS' | 'DESCONTO_INVALIDO' | 'PAGAMENTO_INSUFICIENTE' | 'TROCO_INVALIDO' | 'VALOR_MAXIMO';

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

/** Quantidade em décimos de milésimo (4 casas). Assume `q` já validada. */
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
  const brutos = itens.map((i) => valorItemCentavos(i.quantidade, i.precoCentavos));
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

/** Centavos -> "24.00". */
export function decimal2(c: bigint): string {
  const neg = c < 0n;
  const s = (neg ? -c : c).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Quantidade validada -> "2.0000". */
export function decimal4(q: string): string {
  const [inteiro, frac = ''] = q.split('.');
  return `${inteiro}.${frac.padEnd(4, '0')}`;
}


// ===================================================================================================== regras da tela (só no web)
// Daqui para baixo NÃO há cópia na API: são as regras puras das telas do cupom (Tarefa 14; UX 2 a 4). Nada lê relógio nem rede (a hora
// vem por parâmetro, a do servidor); textos literais da UX (docs/superpowers/specs/2026-11-17-cupom-fiscal-ux.md). Os imports ficam aqui,
// e não no alto, para o bloco de cima continuar igual a `api/src/modules/cupom-fiscal/totais.ts`.
import type {
  AtalhoCupom, CodigoFalta, CupomDetalhe, MotivoProduto, ProdutoCupom, RecusaCupom, SituacaoCupom, SituacaoCupomFiscal,
} from './erp-api';
import { cnpjValido, cpfValido } from './fiscal';
import { horaSp } from './notas-sefaz';

const FUSO = 'America/Sao_Paulo';
const MINUTO_MS = 60_000;
/** Acima de R$ 10.000,00 o CPF ou o CNPJ é obrigatório (desenho §7.2). */
export const DOC_OBRIGATORIO_A_PARTIR = 1_000_000n;

/** Centavos → "R$ 1.234,56" (espaço comum depois de "R$": o `Intl` pt-BR põe U+00A0). Igual ao `reais` de `frases.ts` da API. */
export function reais(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const inteiro = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiro},${(a % 100n).toString().padStart(2, '0')}`;
}

/** Centavos → "60,00" (para preencher um campo de valor). */
export const textoCentavos = (c: bigint): string => reais(c).replace('R$ ', '');

/**
 * O valor digitado ("60", "60,5", "1.234,56", "R$ 10,00"; "60.25" vale como 60,25) em centavos. Com vírgula, os pontos são de milhar;
 * sem vírgula, um ponto seguido de 1 ou 2 números é a vírgula do teclado do celular.
 */
export function centavosDaTela(s: string): bigint | 'vazio' | 'invalido' {
  const t = s.trim().replace(/^R\$/i, '').replace(/\s/g, '');
  if (t === '') return 'vazio';
  let inteiro: string;
  let frac = '';
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length !== 2) return 'invalido';
    if (!/^(\d{1,3}(\.\d{3})*|\d*)$/.test(partes[0])) return 'invalido';
    inteiro = partes[0].replace(/\./g, '');
    frac = partes[1];
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    [inteiro, frac] = t.split('.');
  } else {
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(t)) return 'invalido';
    inteiro = t.replace(/\./g, '');
  }
  if (inteiro === '' && frac === '') return 'invalido';
  if (!/^\d{0,9}$/.test(inteiro) || !/^\d{0,2}$/.test(frac)) return 'invalido';
  return BigInt(inteiro || '0') * 100n + BigInt(frac.padEnd(2, '0'));
}

/** UX 2.3: os 2 primeiros valores diferentes entre o próximo múltiplo de R$ 10, de R$ 50 e de R$ 100 acima do total. */
export function atalhosDinheiro(total: bigint): bigint[] {
  const acima = (m: bigint) => (total / m + 1n) * m;
  const r: bigint[] = [];
  for (const v of [acima(1000n), acima(5000n), acima(10000n)]) if (!r.includes(v)) r.push(v);
  return r.slice(0, 2);
}

/** "0,350" → "0.350" (a vírgula da tela vira o ponto do fio). */
export const quantidadeDaTela = (s: string): string => s.trim().replace(/,/g, '.');

/** "2.0000" → "2"; "0.3500" → "0,35". */
export function quantidadeParaTela(q: string): string {
  const [inteiro, frac = ''] = q.split('.');
  const f = frac.replace(/0+$/, '');
  return f === '' ? inteiro : `${inteiro},${f}`;
}

/** Soma ou tira 1 unidade ("0,350" + 1 = "1,35"); nunca abaixo de 1 (para tirar, use "Tirar"). Quantidade estranha + 1 = "1". */
export function somarQuantidade(qTela: string, delta: 1 | -1): string {
  const q = quantidadeDaTela(qTela);
  if (!quantidadeValida(q)) return delta > 0 ? '1' : qTela;
  const [i, f = ''] = q.split('.');
  const n = BigInt(i + f.padEnd(4, '0')) + BigInt(delta) * 10000n;
  if (n < 10000n) return qTela;
  const s = n.toString().padStart(5, '0');
  return quantidadeParaTela(`${s.slice(0, -4)}.${s.slice(-4)}`);
}

/** "−" só com mais de 1 unidade. */
export function podeDiminuir(qTela: string): boolean {
  const q = quantidadeDaTela(qTela);
  return quantidadeValida(q) && valorItemCentavos(q, 10000n) > 10000n;
}

/** Erro do número da quantidade (no blur), ou null. */
export function erroQuantidade(qTela: string): string | null {
  const q = quantidadeDaTela(qTela);
  if (quantidadeValida(q)) return null;
  if (/^\d{1,7}\.\d{5,}$/.test(q) && /[1-9]/.test(q)) return 'Use até 4 casas depois da vírgula.';
  return 'A quantidade tem de ser maior que zero.';
}

// ----------------------------------------------------------------------------------------------------------------- documento
/** "529.982.247-25" enquanto digita (só números, até 11). */
export function mascaraCpf(s: string): string {
  const d = s.replace(/[^0-9]/g, '').slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.') + (d.length > 9 ? `-${d.slice(9)}` : '');
}

/** "12.ABC.345/01DE-35" enquanto digita (maiúsculas e números, até 14: o CNPJ novo tem letras). */
export function mascaraCnpj(s: string): string {
  const d = s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  let r = d.slice(0, 2);
  if (d.length > 2) r += `.${d.slice(2, 5)}`;
  if (d.length > 5) r += `.${d.slice(5, 8)}`;
  if (d.length > 8) r += `/${d.slice(8, 12)}`;
  if (d.length > 12) r += `-${d.slice(12)}`;
  return r;
}

/** O documento como vai no POST (só números; o CNPJ em maiúsculas), ou null se vazio. */
export function documentoDoPost(tipo: 'cpf' | 'cnpj', s: string): string | null {
  const d = tipo === 'cpf' ? s.replace(/[^0-9]/g, '') : s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return d === '' ? null : d;
}

/** UX 2.4: erro do CPF/CNPJ no blur (`obrigatorio` = total de R$ 10.000,00 ou mais), ou null. */
export function erroDocumento(tipo: 'cpf' | 'cnpj', s: string, obrigatorio: boolean): string | null {
  const d = documentoDoPost(tipo, s);
  if (d === null) return obrigatorio ? 'Acima de R$ 10.000,00, o CPF ou CNPJ é obrigatório.' : null;
  if (tipo === 'cpf') {
    if (d.length < 11) return 'Faltam números no CPF (são 11).';
    return cpfValido(d) ? null : 'Este CPF não confere. Confira os números.';
  }
  return cnpjValido(d) ? null : 'Este CNPJ não confere. Confira os 14 caracteres.';
}

/** "123.456.789-09" / "12.345.678/0001-95" para mostrar um documento guardado (só números/letras). */
export function documentoFormatado(d: string): string {
  return /^[0-9]{11}$/.test(d) ? mascaraCpf(d) : d.length === 14 ? mascaraCnpj(d) : d;
}

// ----------------------------------------------------------------------------------------------------------------- pagamento
/** Ordem e palavras da tela (as da Conciliação de Caixa; UX 2.3). */
export const FORMAS_DA_TELA: readonly TPag[] = ['01', '17', '04', '03', '11', '10'];
export const NOME_PAGAMENTO: Record<TPag, string> = {
  '01': 'Dinheiro',
  '17': 'PIX',
  '04': 'Débito',
  '03': 'Crédito',
  '11': 'Vale-refeição',
  '10': 'Vale-alimentação',
};
/** "No PIX", "No débito"… (a frase do valor acima do que falta, UX 2.3). */
const NA_FORMA: Record<TPag, string> = {
  '01': 'No dinheiro',
  '17': 'No PIX',
  '04': 'No débito',
  '03': 'No crédito',
  '11': 'No vale-refeição',
  '10': 'No vale-alimentação',
};
/** O nome do DANFE: o da tabela de `tPag` do leiaute da NF-e (o `xPag` do XML, quando vem, ganha). */
export const NOME_OFICIAL_PAGAMENTO: Record<string, string> = {
  '01': 'Dinheiro',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '17': 'Pagamento Instantâneo (PIX)',
};
/** "Dinheiro" ou "Dinheiro + PIX" (sem repetir a forma). */
export function nomesDosPagamentos(p: { t_pag: string }[]): string {
  const nomes: string[] = [];
  for (const x of p) {
    const n = NOME_PAGAMENTO[x.t_pag as TPag] ?? NOME_OFICIAL_PAGAMENTO[x.t_pag] ?? x.t_pag;
    if (!nomes.includes(n)) nomes.push(n);
  }
  return nomes.join(' + ');
}

/** Uma linha de pagamento da tela. `auto` = a linha que fica com o que falta até a pessoa digitar nela (UX 2.3, WCAG 3.3.7). */
export type LinhaPagamento = { tPag: TPag; valor: string; auto?: boolean };
export type PagamentosDaTela = {
  /** Os que vão no POST (valor > 0). */
  pagamentos: { tPag: TPag; valor: bigint }[];
  /** O valor de cada linha (a automática já calculada). */
  valores: bigint[];
  falta: bigint;
  troco: bigint;
  /** Erro de cada linha (junto do campo). */
  erros: (string | null)[];
  /** Erro que não é de uma linha só (troco acima do dinheiro). */
  erroGeral: string | null;
  erro: boolean;
};

/**
 * UX 2.3: uma forma só sem ser dinheiro paga o total; dinheiro sozinho com o campo vazio é o valor certo, acima dá troco e abaixo diz o
 * que falta; com 2 formas ou mais, cada linha tem o seu valor, a automática fica com o que falta e nenhuma forma sem ser dinheiro passa
 * do que falta pagar (troco só em dinheiro).
 */
export function pagamentosDaTela(total: bigint, linhas: LinhaPagamento[]): PagamentosDaTela {
  const erros: (string | null)[] = linhas.map(() => null);
  const valores: bigint[] = linhas.map(() => 0n);
  if (linhas.length === 1) {
    const l = linhas[0];
    if (l.tPag !== '01') valores[0] = total;
    else {
      const v = centavosDaTela(l.valor);
      if (v === 'invalido') erros[0] = 'Use um valor como 60,00.';
      else valores[0] = v === 'vazio' ? total : v;
    }
  } else {
    let fixo = 0n;
    linhas.forEach((l, i) => {
      if (l.auto) return;
      const v = centavosDaTela(l.valor);
      if (v === 'invalido') erros[i] = 'Use um valor como 60,00.';
      else valores[i] = v === 'vazio' ? 0n : v;
      fixo += valores[i];
    });
    linhas.forEach((l, i) => {
      if (!l.auto) return;
      valores[i] = total > fixo ? total - fixo : 0n;
      fixo += valores[i];
    });
  }
  const pago = valores.reduce((a, v) => a + v, 0n);
  const falta = total > pago ? total - pago : 0n;
  const troco = pago > total ? pago - total : 0n;
  if (linhas.length === 1 && linhas[0].tPag === '01' && erros[0] === null && falta > 0n) {
    erros[0] = `Falta ${reais(falta)}. Receba o resto em outra forma ou corrija o valor.`;
  }
  if (linhas.length > 1) {
    const semDinheiro = linhas.map((l, i) => (l.tPag === '01' ? 0n : valores[i]));
    const somaSemDinheiro = semDinheiro.reduce((a, v) => a + v, 0n);
    linhas.forEach((l, i) => {
      if (l.tPag === '01' || erros[i] !== null) return;
      const outras = somaSemDinheiro - semDinheiro[i];
      const limite = total > outras ? total - outras : 0n;
      if (valores[i] > limite) {
        erros[i] = `${NA_FORMA[l.tPag]}, o valor não pode passar do que falta pagar (${reais(limite)}). Troco só em dinheiro.`;
      }
    });
  }
  let erroGeral: string | null = null;
  const dinheiro = linhas.reduce((a, l, i) => (l.tPag === '01' ? a + valores[i] : a), 0n);
  if (erros.every((e) => e === null) && troco > dinheiro) {
    const outra = linhas.find((l) => l.tPag !== '01');
    erroGeral = `O troco (${reais(troco)}) não pode passar do que foi pago em dinheiro (${reais(dinheiro)}). Diminua o valor ${
      outra ? NA_FORMA[outra.tPag].replace(/^No /, 'no ') : 'das outras formas'
    }.`;
  }
  return {
    pagamentos: linhas.map((l, i) => ({ tPag: l.tPag, valor: valores[i] })).filter((p) => p.valor > 0n),
    valores,
    falta,
    troco,
    erros,
    erroGeral,
    erro: erroGeral !== null || erros.some((e) => e !== null),
  };
}

// ----------------------------------------------------------------------------------------------------------------- botão
/** O que a aba Emitir sabe para dizer, no botão, o que falta (UX 2.5). `bloqueio` = o rótulo da caixa do topo, já com a hora. */
export type EstadoEmitir = {
  itens: number;
  /** Produto que não entra mais, quantidade com erro, desconto com erro ou total acima do teto. */
  produtosComAviso: boolean;
  formaEscolhida: boolean;
  falta: bigint;
  /** Forma sem ser dinheiro acima do que falta, troco acima do dinheiro, valor que não se lê. */
  pagamentoComErro: boolean;
  documento: { tipo: 'cpf' | 'cnpj'; erro: boolean };
  bloqueio: string | null;
};
export type AlvoBotao = 'busca' | 'produtos' | 'pagamento' | 'documento' | 'topo' | 'conferir';

/** UX 2.5: o 1º que falta, na ordem da tabela; o toque leva ao `alvo`. */
export function rotuloBotaoEmitir(e: EstadoEmitir): { rotulo: string; alvo: AlvoBotao } {
  if (e.itens === 0) return { rotulo: 'Adicione um produto', alvo: 'busca' };
  if (e.produtosComAviso) return { rotulo: 'Confira os produtos', alvo: 'produtos' };
  if (!e.formaEscolhida) return { rotulo: 'Escolha o pagamento', alvo: 'pagamento' };
  if (e.falta > 0n) return { rotulo: `Falta ${reais(e.falta)}`, alvo: 'pagamento' };
  if (e.pagamentoComErro) return { rotulo: 'Confira o pagamento', alvo: 'pagamento' };
  if (e.documento.erro) return { rotulo: e.documento.tipo === 'cpf' ? 'Confira o CPF' : 'Confira o CNPJ', alvo: 'documento' };
  if (e.bloqueio !== null) return { rotulo: e.bloqueio, alvo: 'topo' };
  return { rotulo: 'Conferir e emitir', alvo: 'conferir' };
}

/**
 * O POST que falhou deixou dúvida (UX 2.7, "não sei se saiu")? Só é "erro antes do envio" quando a resposta traz o código da API (4xx ou
 * o 503 `NFCE_DESLIGADA`); sem resposta, 502/504 de proxy, corpo sem código ou erro interno (5xx) = pode ter saído.
 */
export function falhaIncerta(status: number | null, code: string | null): boolean {
  if (code === null || code === 'SEM_CONEXAO' || status === null) return true;
  return status >= 500 && status !== 503;
}

// ----------------------------------------------------------------------------------------------------------------- busca
/** As palavras da tag de cada motivo (UX 5.7; "Nome com emoji ou símbolo": nota 7 do controlador). */
export const TAG_MOTIVO: Record<MotivoProduto, string> = {
  falta_ncm: 'Falta NCM',
  falta_perfil: 'Falta perfil fiscal',
  sem_preco: 'Sem preço de venda',
  inativo: 'Produto inativo',
  perfil_inativo: 'Perfil desativado',
  perfil_fora_do_regime: 'Perfil não vale no regime',
  nome_fora_do_padrao: 'Nome com emoji ou símbolo',
};
/** O motivo em minúscula, dentro de frase (as mesmas palavras de `NFCE_ITEM_INDISPONIVEL` na API). */
export const MOTIVO_NA_FRASE: Record<MotivoProduto, string> = {
  falta_ncm: 'falta NCM',
  falta_perfil: 'falta perfil fiscal',
  sem_preco: 'sem preço de venda',
  inativo: 'inativo',
  perfil_inativo: 'perfil desativado',
  perfil_fora_do_regime: 'o perfil fiscal não vale no regime da empresa',
  nome_fora_do_padrao: 'o nome no cupom tem emoji ou símbolo',
};

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LIMITE_BUSCA = 8;

type ProdutoBusca = Pick<
  ProdutoCupom,
  'item_cardapio_id' | 'nome' | 'categoria' | 'preco_venda_centavos' | 'ativo' | 'gtin' | 'descricao_cupom' | 'pronto'
> & { motivos: readonly string[] };

/**
 * UX 2.2: a partir de 1 letra, sem acento e sem maiúscula, no nome do cardápio e no nome no cupom; o código de barras completo (8 a 14
 * números) acha pelo GTIN. Até 8 prontos (o resto contado em `mais`) e, à parte, os ativos que não entram (até 8). Quem começa com o
 * termo vem antes.
 */
export function buscarProdutos<P extends ProdutoBusca>(produtos: readonly P[], termo: string): { prontos: P[]; mais: number; fora: P[] } {
  const t = semAcento(termo.trim());
  if (t === '') return { prontos: [], mais: 0, fora: [] };
  const gtin = /^[0-9]{8,14}$/.test(t);
  const achados = produtos.filter((p) => {
    if (!p.ativo) return false;
    if (gtin && p.gtin === t) return true;
    return semAcento(p.nome).includes(t) || (p.descricao_cupom !== null && semAcento(p.descricao_cupom).includes(t));
  });
  const comeca = (p: P) => (semAcento(p.nome).startsWith(t) ? 0 : 1);
  const ordenados = achados.map((p, i) => ({ p, i })).sort((a, b) => comeca(a.p) - comeca(b.p) || a.i - b.i).map((x) => x.p);
  const prontos = ordenados.filter((p) => p.pronto);
  return { prontos: prontos.slice(0, LIMITE_BUSCA), mais: Math.max(0, prontos.length - LIMITE_BUSCA), fora: ordenados.filter((p) => !p.pronto).slice(0, LIMITE_BUSCA) };
}

// ----------------------------------------------------------------------------------------------------------------- conferir
/** UX 2.5: "2 × Espetinho de carne … R$ 24,00"; mais de 5 = os 4 primeiros + "e mais 3 produtos". */
export function linhasConferir(itens: { nome: string; quantidade: string; valor: bigint }[]): {
  linhas: { texto: string; valor: string }[];
  resto: string | null;
} {
  const mostra = itens.length > 5 ? itens.slice(0, 4) : itens;
  const n = itens.length - mostra.length;
  return {
    linhas: mostra.map((i) => ({ texto: `${i.quantidade} × ${i.nome}`, valor: reais(i.valor) })),
    resto: n > 0 ? `e mais ${n} ${n === 1 ? 'produto' : 'produtos'}` : null,
  };
}

// ----------------------------------------------------------------------------------------------------------------- o cupom
export type TomCupom = 'ok' | 'warn' | 'bad' | 'muted';
export type IconeCupom = 'ok' | 'alerta' | 'carregando' | 'ban' | null;

/** A tag da situação (UX 3.1): tom, ícone e texto; cor nunca sozinha. */
export function tagDoCupom(s: SituacaoCupom): { tom: TomCupom; icone: IconeCupom; texto: string } {
  switch (s) {
    case 'enviando':
      return { tom: 'warn', icone: 'carregando', texto: 'Enviando' };
    case 'sem_resposta':
      return { tom: 'warn', icone: 'alerta', texto: 'Sem resposta da SEFAZ' };
    case 'nao_enviado':
      return { tom: 'warn', icone: 'alerta', texto: 'Não saiu' };
    case 'nao_consta':
      return { tom: 'warn', icone: 'alerta', texto: 'A SEFAZ não tem este cupom' };
    case 'rejeitado':
      return { tom: 'bad', icone: 'alerta', texto: 'Recusado pela SEFAZ' };
    case 'autorizado':
      return { tom: 'ok', icone: 'ok', texto: 'Autorizado' };
    case 'cancelando':
      return { tom: 'warn', icone: 'carregando', texto: 'Cancelando' };
    case 'cancelado':
      return { tom: 'muted', icone: 'ban', texto: 'Cancelado' };
    case 'denegado':
      return { tom: 'bad', icone: 'ban', texto: 'Uso negado' };
    case 'descartado':
      return { tom: 'muted', icone: null, texto: 'Descartado' };
  }
}

function partesSp(iso: string): Record<string, string> {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
}
/** "17/11" no fuso de Brasília. */
export const diaMesSp = (iso: string) => {
  const p = partesSp(iso);
  return `${p.day}/${p.month}`;
};
/** "hoje às 14h05" | "ontem às 14h05" | "em 14/11 às 14h05" (Brasília; `agora` = a hora do servidor). */
export function quandoSp(iso: string, agora: Date): string {
  const dia = (d: string) => {
    const p = partesSp(d);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const d = dia(iso);
  if (d === dia(agora.toISOString())) return `hoje às ${horaSp(iso)}`;
  if (d === dia(new Date(agora.getTime() - 24 * 60 * MINUTO_MS).toISOString())) return `ontem às ${horaSp(iso)}`;
  return `em ${diaMesSp(iso)} às ${horaSp(iso)}`;
}
const semPontoFinal = (s: string) => s.trim().replace(/[\s.]+$/u, '');

/** O que a caixa da situação precisa do cupom. */
export type CupomParaCaixa = Pick<
  CupomDetalhe,
  | 'situacao' | 'numero' | 'dh_emi' | 'autorizada_em' | 'n_prot' | 'cancelado_em' | 'cancelamento_motivo' | 'descartado_em'
  | 'descarte_motivo' | 'numero_reaproveitavel' | 'c_stat' | 'x_motivo' | 'mensagem'
> & { recusa: RecusaCupom | null };

/**
 * A caixa da situação (UX 3.1): o tom, as frases e o `<details>` "Mensagem da SEFAZ (código N)". Sem resposta: a frase da 3.1, ou a do
 * código (o 204) quando a SEFAZ respondeu; nas recusas, no `cancelando` e na causa do "não saiu": a frase do servidor (fonte única).
 */
export function caixaDoCupom(c: CupomParaCaixa): { tom: TomCupom; textos: string[]; detalhe: { codigo: number; texto: string } | null } {
  const detalhe = c.recusa && c.recusa.x_motivo ? { codigo: c.recusa.codigo, texto: c.recusa.x_motivo } : null;
  switch (c.situacao) {
    case 'enviando':
      return { tom: 'warn', textos: [`Enviado à SEFAZ às ${horaSp(c.dh_emi)}. Esperando a resposta.`], detalhe: null };
    case 'sem_resposta':
      return {
        tom: 'warn',
        textos: [
          c.recusa?.frase ??
            'A SEFAZ não respondeu. O cupom pode ter sido autorizado. Consulte antes de qualquer outra coisa e não emita outro cupom para esta venda até lá.',
        ],
        detalhe,
      };
    case 'nao_enviado':
      return {
        tom: 'warn',
        textos: ['A SEFAZ não recebeu o cupom, e nada foi registrado.', ...(c.mensagem ? [c.mensagem] : [])],
        detalhe,
      };
    case 'nao_consta':
      return { tom: 'warn', textos: ['A SEFAZ confirmou que não tem este cupom. Envie de novo ou descarte.'], detalhe: null };
    case 'rejeitado':
      return {
        tom: 'bad',
        textos: [c.recusa?.frase ?? c.mensagem ?? `A SEFAZ recusou o cupom${c.c_stat === null ? '' : ` (código ${c.c_stat})`}.`],
        detalhe: detalhe ?? (c.c_stat !== null && c.x_motivo ? { codigo: c.c_stat, texto: c.x_motivo } : null),
      };
    case 'autorizado':
      return {
        tom: 'ok',
        textos: [`Autorizado às ${c.autorizada_em ? horaSp(c.autorizada_em) : '—'} · protocolo ${c.n_prot ?? '—'}`],
        detalhe: null,
      };
    case 'cancelando':
      return { tom: 'warn', textos: c.mensagem ? [c.mensagem] : [], detalhe: null };
    case 'cancelado':
      return {
        tom: 'muted',
        textos: [
          `Cancelado às ${c.cancelado_em ? horaSp(c.cancelado_em) : '—'}.${c.cancelamento_motivo ? ` Motivo: ${semPontoFinal(c.cancelamento_motivo)}.` : ''}`,
        ],
        detalhe: null,
      };
    case 'denegado':
      return {
        tom: 'bad',
        textos: [
          c.recusa?.frase ??
            c.mensagem ??
            `A SEFAZ negou o uso do cupom${c.c_stat === null ? '' : ` (código ${c.c_stat})`}${c.x_motivo ? `: ${semPontoFinal(c.x_motivo)}` : ''}. O número foi gasto. Fale com o contador.`,
        ],
        detalhe: null,
      };
    case 'descartado': {
      const quando = c.descartado_em ? ` em ${diaMesSp(c.descartado_em)} às ${horaSp(c.descartado_em)}` : '';
      const motivo = c.descarte_motivo ? ` Motivo: ${semPontoFinal(c.descarte_motivo)}.` : '';
      const numero = c.numero_reaproveitavel
        ? `O número ${c.numero} vai para o próximo cupom.`
        : `O número ${c.numero} não volta a ser usado.`;
      return { tom: 'muted', textos: [`Descartado${quando}.${motivo} ${numero}`], detalhe: null };
    }
  }
}

/**
 * O prazo do cancelamento (UX 3.1, 4.3 e 4.4), pela hora do servidor: `curto` na página ("(faltam 27 min)"), `longo` no diálogo ("(faltam
 * 23 minutos)." e, nos 5 min finais, "Faltam 4 minutos para o prazo."); passado o prazo, "O prazo para cancelar terminou às 14h34."
 */
export function linhaPrazoCancelar(cancelarAte: string, agora: Date, formato: 'curto' | 'longo'): { texto: string; perto: boolean; acabou: boolean } {
  const resta = new Date(cancelarAte).getTime() - agora.getTime();
  const hora = horaSp(cancelarAte);
  if (resta <= 0) return { texto: `O prazo para cancelar terminou às ${hora}.`, perto: false, acabou: true };
  const min = Math.ceil(resta / MINUTO_MS);
  const perto = min <= 5;
  if (formato === 'curto') return { texto: `Dá para cancelar até ${hora} (faltam ${min} min)`, perto, acabou: false };
  if (perto) return { texto: `Faltam ${min} ${min === 1 ? 'minuto' : 'minutos'} para o prazo.`, perto, acabou: false };
  return { texto: `Dá para cancelar até ${hora} (faltam ${min} minutos).`, perto, acabou: false };
}

/** O toast do "Consultar na SEFAZ" (UX 3.1) pelo antes e o depois; null = a página já diz (sem toast). */
export function toastDaConsulta(
  antes: SituacaoCupom,
  depois: { situacao: SituacaoCupom; recusa: Pick<RecusaCupom, 'codigo'> | null; consultar_a_partir_de: string | null },
): string | null {
  switch (depois.situacao) {
    case 'autorizado':
      return antes === 'cancelando' ? 'O cancelamento não entrou na SEFAZ; o cupom continua valendo.' : 'A SEFAZ autorizou este cupom.';
    case 'cancelado':
      return 'Cancelamento registrado na SEFAZ.';
    case 'nao_consta':
      return 'A SEFAZ não tem este cupom.';
    case 'denegado':
      return 'A SEFAZ negou o uso deste cupom.';
    case 'sem_resposta':
    case 'cancelando': {
      const codigo = depois.recusa ? ` (código ${depois.recusa.codigo})` : '';
      const hora = depois.consultar_a_partir_de ? ` Tente de novo às ${horaSp(depois.consultar_a_partir_de)}.` : '';
      return `O cupom continua sem resposta${codigo}.${hora}`;
    }
    default:
      return null;
  }
}

/** "Tentativa 2 de 3" sob o "Enviar de novo" (o próximo envio). */
export const textoTentativa = (envios: number) => `Tentativa ${envios + 1} de 3`;

/** O nome do arquivo baixado (UX 3.5): `cupom-2-12.xml` / `cancelamento-2-12.xml`. */
export const nomeDoArquivo = (tipo: 'nota' | 'cancelamento', serie: number, numero: number) =>
  `${tipo === 'nota' ? 'cupom' : 'cancelamento'}-${serie}-${numero}.xml`;

// ----------------------------------------------------------------------------------------------------------------- DANFE
/** "24.00" → "24,00"; "1234.56" → "1.234,56" (pelo texto do XML, nunca por `Number`). */
export function valorDanfe(v: string): string {
  const [i, f = ''] = v.split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${f.padEnd(2, '0')}`;
}
/** "2.0000" → "2,0000" (a quantidade sai como no XML). */
export const qtdDanfe = (q: string) => q.replace('.', ',');
/** "2026-11-17T14:05:31-03:00" → "17/11/2026 14:05:31" (a hora do XML, pelo texto). */
export function dataHoraDanfe(dh: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(dh);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : dh;
}
/** A chave em 11 blocos de 4 (Manual do DANFE NFC-e). */
export const chaveEmBlocos = (chave: string) => chave.replace(/(.{4})(?=.)/g, '$1 ');

// ----------------------------------------------------------------------------------------------------------------- aba Emitir
/** Chaves do cache (TanStack Query) das telas do cupom: a página, a aba Emitir e o cupom dividem o mesmo dado. */
export const CHAVES_CUPOM = {
  situacao: ['cupom-fiscal', 'situacao'],
  produtos: ['cupom-fiscal', 'produtos'],
  ultimo: ['cupom-fiscal', 'ultimo'],
  cupom: (id: string) => ['cupom-fiscal', 'cupom', id],
  danfe: (id: string) => ['cupom-fiscal', 'danfe', id],
  /** "Refazer com estes itens": a venda passa pela memória da página, nunca pelo storage (UX 3.1). */
  refazer: ['cupom-fiscal', 'refazer'],
} as const;

/** A chave de idempotência de uma venda nova (uuid v4). `crypto.randomUUID` só existe em HTTPS; `getRandomValues`, sempre. */
export function novaChaveIdempotencia(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Para onde leva cada item de "Para emitir, falta:" (UX 5.1). */
export function linkDaFalta(codigo: CodigoFalta): { rotulo: string; href: string } | null {
  switch (codigo) {
    case 'certificado':
      return { rotulo: 'Ir para o certificado', href: '/configuracoes#certificado-digital' };
    case 'cnpj':
      return { rotulo: 'Preencher', href: '/configuracoes' };
    case 'produto_pronto':
      return { rotulo: 'Ver produtos', href: '/cupom?aba=produtos' };
    case 'teste_homologacao':
      return null;
    default:
      return { rotulo: 'Preencher', href: '/configuracoes?aba=cupom' };
  }
}

/** A caixa do alto da aba Emitir (UX 2.1): só a 1ª linha que se aplica. `formulario` = dá para montar a venda (linhas 4 a 6). */
export type CaixaTopo =
  | { linha: 1; formulario: false }
  | { linha: 2; formulario: false; falta: { codigo: CodigoFalta; texto: string }[] }
  | { linha: 3; formulario: false; aviso: string | null }
  | { linha: 4 | 5 | 6; formulario: true; tom: 'bad' | 'warn'; texto: string; link: { rotulo: string; href: string } | null; botao: string };

const LINK_DA_PARADA: Record<Exclude<SituacaoCupomFiscal['situacao'], 'ok' | 'parada_656'>, { rotulo: string; href: string }> = {
  parada_certificado: { rotulo: 'Ir para o certificado', href: '/configuracoes#certificado-digital' },
  parada_configuracao: { rotulo: 'Ir para Configurações', href: '/configuracoes?aba=cupom' },
  parada_serie_em_uso: { rotulo: 'Trocar a série', href: '/configuracoes?aba=cupom' },
};

/**
 * UX 2.1 pela situação do servidor (`agora` = a hora do servidor). A parada vem antes do "Tudo pronto" (a do 656 desliga a emissão) e o
 * certificado com problema numa emissão ligada é a linha 5 (senão ele é só mais um item de "falta").
 */
export function caixaDoTopo(s: SituacaoCupomFiscal, agora: Date): CaixaTopo | null {
  if (s.ambiente === 'desligado') return { linha: 1, formulario: false };
  const soCertificado = s.falta.length > 0 && s.falta.every((f) => f.codigo === 'certificado');
  if (s.falta.length > 0 && !(soCertificado && s.emissao_ligada)) return { linha: 2, formulario: false, falta: s.falta };
  if (s.situacao !== 'ok') {
    return {
      linha: 4,
      formulario: true,
      tom: 'bad',
      texto: s.mensagem ?? 'A emissão parou.',
      link: s.situacao === 'parada_656' ? null : LINK_DA_PARADA[s.situacao],
      botao: 'A emissão parou',
    };
  }
  if (!s.emissao_ligada) return { linha: 3, formulario: false, aviso: s.mensagem };
  if (!s.certificado.ok) {
    return {
      linha: 5,
      formulario: true,
      tom: 'bad',
      texto: s.certificado.mensagem ?? 'Confira o certificado digital.',
      link: { rotulo: 'Ir para o certificado', href: '/configuracoes#certificado-digital' },
      botao: 'Confira o certificado',
    };
  }
  if (s.bloqueado_ate !== null && new Date(s.bloqueado_ate).getTime() > agora.getTime()) {
    const h = horaSp(s.bloqueado_ate);
    return {
      linha: 6,
      formulario: true,
      tom: 'warn',
      texto: `A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as ${h}.`,
      link: null,
      botao: `Envio volta às ${h}`,
    };
  }
  return null;
}

/** A venda de um cupom, para "Refazer com estes itens" (UX 3.1): os preços são relidos na aba Emitir. */
export type VendaRefeita = {
  itens: { item_cardapio_id: string | null; nome: string; quantidade: string }[];
  desconto_centavos: number;
  pagamentos: { t_pag: string; valor_centavos: number }[];
  consumidor_doc: string | null;
};
export function vendaDoCupom(c: Pick<CupomDetalhe, 'itens' | 'valor_desconto_centavos' | 'pagamentos' | 'consumidor_doc'>): VendaRefeita {
  return {
    itens: c.itens.map((i) => ({ item_cardapio_id: i.item_cardapio_id, nome: i.nome_cardapio, quantidade: quantidadeParaTela(i.quantidade) })),
    desconto_centavos: c.valor_desconto_centavos,
    pagamentos: c.pagamentos,
    consumidor_doc: c.consumidor_doc,
  };
}

/** As linhas de pagamento da tela para uma venda refeita: uma forma sem ser dinheiro fica sem valor (paga o total). */
export function linhasDosPagamentos(p: { t_pag: string; valor_centavos: number }[]): LinhaPagamento[] {
  const formas = p.filter((x): x is { t_pag: TPag; valor_centavos: number } => (FORMAS_DA_TELA as readonly string[]).includes(x.t_pag));
  if (formas.length === 1) {
    const f = formas[0];
    return [{ tPag: f.t_pag, valor: f.t_pag === '01' ? textoCentavos(BigInt(f.valor_centavos)) : '' }];
  }
  return formas.map((x) => ({ tPag: x.t_pag, valor: textoCentavos(BigInt(x.valor_centavos)) }));
}


// ----------------------------------------------------------------------------------------------------------------- trava e chave da venda
/** A chave de idempotência da venda e se ela está travada pelo "não sei se saiu" (UX 2.5 e 2.7). */
export type VendaEnvio = { chave: string; travada: boolean };
/**
 * O desfecho de um envio (ou da leitura pela chave): `cupom` = uma resposta com cupom (201/200, o cupom achado pela chave, ou o 409
 * `NFCE_CHAVE_REUSADA`, em que o servidor já tem um cupom com esta chave); `erro` = erro da API antes do envio (4xx com código ou 503);
 * `incerta` = pode ter saído (sem resposta, 502/504, 5xx, ou a leitura pela chave falhou); `nada` = a leitura pela chave voltou `[]`.
 */
export type DesfechoEnvio = 'cupom' | 'erro' | 'incerta' | 'nada';

/**
 * O ÚNICO lugar que troca a chave ou a trava (Ruling T14 I1): só uma resposta com cupom troca a chave (a próxima venda é outra); `incerta`
 * trava; `erro` e `nada` destravam com a MESMA chave (o servidor confere a chave antes de itens e total, então um 4xx prova que não há
 * cupom com ela; e um corpo diferente que chegue depois de um 1º pedido atrasado vira 409 `NFCE_CHAVE_REUSADA`, nunca um 2º cupom).
 */
export function depoisDoEnvio(v: VendaEnvio, d: DesfechoEnvio, novaChave: () => string = novaChaveIdempotencia): VendaEnvio {
  switch (d) {
    case 'cupom':
      return { chave: novaChave(), travada: false };
    case 'incerta':
      return { chave: v.chave, travada: true };
    case 'erro':
    case 'nada':
      return { chave: v.chave, travada: false };
  }
}

/** O desfecho de um POST que falhou: só com o código da API (4xx ou 503) é erro antes do envio (`falhaIncerta`). */
export const desfechoDoErro = (status: number | null, code: string | null): 'erro' | 'incerta' =>
  falhaIncerta(status, code) ? 'incerta' : 'erro';

/** O toque no botão da venda: com a venda travada, reabre o "não sei se saiu"; fora disso, segue o que falta (`rotuloBotaoEmitir`). */
export const toqueNoBotao = (travada: boolean, alvo: AlvoBotao): AlvoBotao | 'reabrir' => (travada ? 'reabrir' : alvo);

// ----------------------------------------------------------------------------------------------------------------- atalho da recusa
/**
 * O link do atalho que o SERVIDOR manda no cupom (`atalho`, calculado em `retornos.ts` junto da frase; Ruling T14 I2 e "T14 atalhos"): a
 * tela não classifica por código. Os rótulos são os links da UX 6.1; os destinos são as rotas da UX 1 (a aba "Cupom fiscal" de
 * Configurações e a aba Produtos chegam na Tarefa 15). `primario` = é a ação principal ("Corrigir os produtos", e então "Enviar de novo").
 */
export function linkDoAtalho(a: AtalhoCupom | null, cupomId: string): { rotulo: string; href: string; primario: boolean } | null {
  switch (a) {
    case 'produtos':
      return { rotulo: 'Corrigir os produtos', href: `/cupom?aba=produtos&cupom=${cupomId}`, primario: true };
    case 'certificado':
      return { rotulo: 'Ir para o certificado', href: '/configuracoes#certificado-digital', primario: false };
    case 'csc':
    case 'empresa':
      return { rotulo: 'Ir para Configurações', href: '/configuracoes?aba=cupom', primario: false };
    case 'serie':
      return { rotulo: 'Trocar a série', href: '/configuracoes?aba=cupom', primario: false };
    default:
      return null;
  }
}
