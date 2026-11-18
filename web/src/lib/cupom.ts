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
  AmbienteCupom, AmbienteSefaz, AmbienteServidor, AtalhoCupom, CodigoFalta, CupomDetalhe, CupomLinha, MotivoProduto, PerfilFiscal, ProdutoCupom,
  RecusaCupom, SalvarPerfilFiscal, SalvarProdutoCupom, SituacaoCupom, SituacaoCupomFiscal, TipoPendente,
} from './erp-api';
import { dataHoraSp, dataSp } from './certificado';
import { cnpjValido, cpfValido, gtinValido } from './fiscal';
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

/** O endereço de um campo de Configurações (UX 5.1, ponto 10.5): a aba e a âncora; a página põe o foco nele quando ele aparece. */
export const hrefDoCampo = (alvo: { aba: 'geral' | 'cupom'; id: string }) =>
  alvo.aba === 'geral' ? `/configuracoes#${alvo.id}` : `/configuracoes?aba=cupom#${alvo.id}`;
const ambienteDaTela = (a: AmbienteServidor): AmbienteSefaz => (a === 'homologacao' ? 'homologacao' : 'producao');

/**
 * Para onde leva cada item de "Para emitir, falta:" (UX 5.1): o campo em Configurações (o mesmo alvo do painel, `alvoDaFalta`, com a
 * série e o código de segurança do ambiente do servidor), ou a aba Produtos. O teste no modo de teste se faz aqui mesmo: sem link.
 */
export function linkDaFalta(codigo: CodigoFalta, ambiente: AmbienteServidor = 'producao'): { rotulo: string; href: string } | null {
  if (codigo === 'teste_homologacao') return null;
  const alvo = alvoDaFalta(codigo, ambienteDaTela(ambiente));
  if ('href' in alvo) return { rotulo: alvo.rotulo, href: alvo.href };
  return { rotulo: codigo === 'certificado' ? alvo.rotulo : 'Preencher', href: hrefDoCampo(alvo) };
}

/** A caixa do alto da aba Emitir (UX 2.1): só a 1ª linha que se aplica. `formulario` = dá para montar a venda (linhas 4 a 6). */
export type CaixaTopo =
  | { linha: 1; formulario: false }
  | { linha: 2; formulario: false; falta: { codigo: CodigoFalta; texto: string }[] }
  | { linha: 3; formulario: false; aviso: string | null }
  | { linha: 4 | 5 | 6; formulario: true; tom: 'bad' | 'warn'; texto: string; link: { rotulo: string; href: string } | null; botao: string };

/** O link de cada parada (UX 6.1), até o campo que corrige: o certificado, o código de segurança (QR) ou a série do ambiente. */
function linkDaParada(
  p: Exclude<SituacaoCupomFiscal['situacao'], 'ok' | 'parada_656'>,
  ambiente: AmbienteServidor,
): { rotulo: string; href: string } {
  const a = ambienteDaTela(ambiente);
  switch (p) {
    case 'parada_certificado':
      return { rotulo: 'Ir para o certificado', href: hrefDoCampo({ aba: 'geral', id: 'certificado-digital' }) };
    case 'parada_configuracao':
      return { rotulo: 'Ir para Configurações', href: hrefDoCampo({ aba: 'cupom', id: `cupom-csc-${a}` }) };
    case 'parada_serie_em_uso':
      return { rotulo: 'Trocar a série', href: hrefDoCampo({ aba: 'cupom', id: `cupom-serie-${a}` }) };
  }
}

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
      link: s.situacao === 'parada_656' ? null : linkDaParada(s.situacao, s.ambiente),
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
 * tela não classifica por código. Os rótulos são os links da UX 6.1; os destinos são as rotas da UX 1, até o CAMPO que corrige (rodada
 * de correção 1 da T15: o código de segurança e a série do ambiente do cupom; a empresa = a inscrição estadual, 1º campo do quadro).
 * `primario` = é a ação principal ("Corrigir os produtos", e então "Enviar de novo").
 */
export function linkDoAtalho(
  a: AtalhoCupom | null,
  cupomId: string,
  ambiente: AmbienteSefaz,
): { rotulo: string; href: string; primario: boolean } | null {
  switch (a) {
    case 'produtos':
      return { rotulo: 'Corrigir os produtos', href: `/cupom?aba=produtos&cupom=${cupomId}`, primario: true };
    case 'certificado':
      return { rotulo: 'Ir para o certificado', href: hrefDoCampo({ aba: 'geral', id: 'certificado-digital' }), primario: false };
    case 'csc':
      return { rotulo: 'Ir para Configurações', href: hrefDoCampo({ aba: 'cupom', id: `cupom-csc-${ambiente}` }), primario: false };
    case 'empresa':
      return { rotulo: 'Ir para Configurações', href: hrefDoCampo({ aba: 'cupom', id: 'cupom-ie' }), primario: false };
    case 'serie':
      return { rotulo: 'Trocar a série', href: hrefDoCampo({ aba: 'cupom', id: `cupom-serie-${ambiente}` }), primario: false };
    default:
      return null;
  }
}


// ===================================================================================================== Tarefa 15 (só no web)
// Emitidos e a faixa de pendentes (UX 4.1, 4.2 e 4.6), Produtos e perfis fiscais (UX 5.6 e 5.7), a aba "Cupom fiscal" de Configurações
// (UX 5.1 a 5.5) e os avisos da importação e do inventário (UX 5.8). Puras: a hora vem por parâmetro (a do servidor); textos literais da UX.

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const primeiraMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ----------------------------------------------------------------------------------------------------------------- pendentes
type PendentesTela = { total: number; primeiro: { serie: number; numero: number; tipo: TipoPendente } | null };

/**
 * A faixa de pendentes (UX 4.2), pelo `pendentes` da situação. O `tipo` vem do servidor: `sem_resposta` inclui o `cancelando` e o
 * `enviando` vencido; `venda_pendente` inclui a venda do cupom cancelado que não saiu do estoque (a frase é a da UX, do autorizado).
 */
export function textoPendentes(p: PendentesTela): string | null {
  if (p.total <= 0) return null;
  if (p.total > 1 || p.primeiro === null) return `${p.total} ${plural(p.total, 'cupom precisa', 'cupons precisam')} de você.`;
  const n = p.primeiro.numero;
  switch (p.primeiro.tipo) {
    case 'sem_resposta':
      return '1 cupom ficou sem resposta da SEFAZ. Consulte antes de emitir outro para a mesma venda.';
    case 'nao_saiu':
    case 'recusado':
      return `O cupom nº ${n} não saiu. Envie de novo ou descarte.`;
    case 'venda_pendente':
      return `O cupom nº ${n} está autorizado, mas a venda não baixou o estoque.`;
  }
}

/** Emitidos em "Precisam de você" (o destino do [Ver] da faixa com vários, e dos avisos do estoque). */
export const HREF_PRECISAM = '/cupom?aba=emitidos&situacao=atencao';

/** O link da faixa: um = direto ao cupom ("Ver o cupom"); vários = Emitidos em "Precisam de você" ("Ver"). */
export function linkPendentes(p: SituacaoCupomFiscal['pendentes']): { rotulo: string; href: string } | null {
  if (p.total <= 0) return null;
  if (p.total === 1 && p.primeiro) return { rotulo: 'Ver o cupom', href: `/cupom/${p.primeiro.id}` };
  return { rotulo: 'Ver', href: HREF_PRECISAM };
}

/** "2 cupons autorizados ainda não baixaram o estoque." (UX 5.1 e 5.8); nenhum = null. */
export function textoVendasPendentes(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? '1 cupom autorizado ainda não baixou o estoque.' : `${n} cupons autorizados ainda não baixaram o estoque.`;
}

/** O aviso da importação de vendas (UX 5.8): os cupons valendo que já estão no estoque no período do arquivo; nenhum = null. */
export function textoAvisoImportacao(r: { quantidade: number; valor_centavos: number }): string | null {
  if (r.quantidade <= 0) return null;
  return `Neste período, o Freela Comanda já lançou ${r.quantidade} ${plural(r.quantidade, 'cupom', 'cupons')} no estoque (${reais(
    BigInt(r.valor_centavos),
  )}). Se essas vendas também estão neste arquivo, vão contar duas vezes.`;
}

/** O período do arquivo de vendas: a menor e a maior data `AAAA-MM-DD` (as outras não contam); nenhuma = null. */
export function periodoDoArquivo(datas: readonly (string | null | undefined)[]): { ini: string; fim: string } | null {
  const ok = datas.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return ok.length === 0 ? null : { ini: ok[0], fim: ok[ok.length - 1] };
}

// ----------------------------------------------------------------------------------------------------------------- Emitidos
export type PeriodoEmitidos = 'hoje' | 'ontem' | '7dias' | 'mes' | 'mes_passado' | 'datas';
export const ROTULO_PERIODO: Record<PeriodoEmitidos, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7dias': 'Últimos 7 dias',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
  datas: 'Escolher datas',
};
export type SituacaoEmitidos = 'todos' | 'atencao' | 'autorizados' | 'cancelados' | 'descartados';
/** O filtro de situação de cada botão (UX 4.1): "Precisam de você" é o `atencao=true` do servidor (pendentes + venda pendente). */
export const SITUACOES_DO_FILTRO: Record<Exclude<SituacaoEmitidos, 'todos' | 'atencao'>, SituacaoCupom[]> = {
  autorizados: ['autorizado'],
  cancelados: ['cancelado'],
  descartados: ['descartado'],
};

/** "AAAA-MM-DD" do dia em Brasília. */
export function diaSpDe(d: Date): string {
  const p = partesSp(d.toISOString());
  return `${p.year}-${p.month}-${p.day}`;
}

/** Soma dias a um "AAAA-MM-DD" pelo calendário (sem fuso). */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O intervalo de cada período (UX 4.1), em dias de Brasília; `hoje` = o dia do servidor. */
export function intervaloDoPeriodo(p: Exclude<PeriodoEmitidos, 'datas'>, hoje: string): { ini: string; fim: string } {
  const primeiro = `${hoje.slice(0, 7)}-01`;
  switch (p) {
    case 'hoje':
      return { ini: hoje, fim: hoje };
    case 'ontem': {
      const d = somarDias(hoje, -1);
      return { ini: d, fim: d };
    }
    case '7dias':
      return { ini: somarDias(hoje, -6), fim: hoje };
    case 'mes':
      return { ini: primeiro, fim: hoje };
    case 'mes_passado': {
      const fim = somarDias(primeiro, -1);
      return { ini: `${fim.slice(0, 7)}-01`, fim };
    }
  }
}

/**
 * A próxima ação de um cupom na lista (UX 4.1), uma linha só: a venda pendente no estoque primeiro (é o que precisa de você), depois a
 * consulta, o enviar de novo/descartar e o prazo de cancelar (que some depois do prazo, UX 4.4). Nada = null.
 */
export function proximaAcao(
  l: Pick<CupomLinha, 'situacao' | 'acoes' | 'cancelar_ate' | 'consultar_a_partir_de' | 'venda_estoque'>,
  agora: Date,
): string | null {
  if (l.venda_estoque === 'pendente') return 'A venda não baixou o estoque';
  if (l.venda_estoque === 'desfazer_pendente') return 'A venda ainda está no estoque';
  if (l.situacao === 'sem_resposta' || l.situacao === 'cancelando') {
    return l.consultar_a_partir_de ? `Consulte a partir das ${horaSp(l.consultar_a_partir_de)}` : 'Consulte na SEFAZ';
  }
  if (l.acoes.includes('enviar_de_novo')) return 'Envie de novo ou descarte';
  if (l.acoes.includes('descartar')) return 'Descarte este cupom';
  if (l.acoes.includes('cancelar') && l.cancelar_ate && new Date(l.cancelar_ate).getTime() > agora.getTime()) {
    return `Dá para cancelar até ${horaSp(l.cancelar_ate)}`;
  }
  return null;
}

/** "Hoje às 14h05" | "Ontem às 14h05" | "Em 14/11 às 14h05" (o cartão do celular). */
export const quandoNaLista = (iso: string, agora: Date) => primeiraMaiuscula(quandoSp(iso, agora));
/** "17/11 14h05" (a tabela do computador). */
export const dataHoraNaLista = (iso: string) => `${diaMesSp(iso)} ${horaSp(iso)}`;

/** O documento da lista: o CPF já vem mascarado do servidor (`***.982.247-**`) e fica como veio; o CNPJ, formatado; nenhum = "—". */
export function documentoNaLista(d: string | null): string {
  if (d === null || d === '') return '—';
  return d.includes('*') ? d : documentoFormatado(d);
}

/**
 * O ambiente do zip do contador (UX 4.6): o do SERVIDOR, não o da lista ("Ver cupons de teste" não muda o arquivo). Desligado = valendo
 * (como a lista); sem a situação ainda = o servidor escolhe (o dele).
 */
export function ambienteDoContador(servidor: AmbienteServidor | undefined): AmbienteSefaz | undefined {
  return servidor === undefined ? undefined : ambienteDaTela(servidor);
}

/** O mês do contador (UX 4.6): até o dia 10, o mês passado; depois, este mês ("AAAA-MM"). */
export function mesPadraoContador(hoje: string): string {
  const primeiro = `${hoje.slice(0, 7)}-01`;
  return Number(hoje.slice(8, 10)) <= 10 ? somarDias(primeiro, -1).slice(0, 7) : hoje.slice(0, 7);
}

/** Os `n` meses até este (o mais novo primeiro), para o `Select` "Mês". */
export function mesesDoContador(hoje: string, n = 12): string[] {
  const r: string[] = [];
  let primeiro = `${hoje.slice(0, 7)}-01`;
  for (let i = 0; i < n; i++) {
    r.push(primeiro.slice(0, 7));
    primeiro = `${somarDias(primeiro, -1).slice(0, 7)}-01`;
  }
  return r;
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "2026-10" → "outubro/2026". */
export const nomeDoMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

// ----------------------------------------------------------------------------------------------------------------- máscaras
export const soNumeros = (s: string) => s.replace(/[^0-9]/g, '');
/** Os números de `s` (até a soma dos grupos) com os separadores entre os grupos, enquanto digita. */
function mascarar(s: string, grupos: number[], seps: string[]): string {
  const d = soNumeros(s).slice(0, grupos.reduce((a, g) => a + g, 0));
  let r = '';
  let i = 0;
  grupos.forEach((g, k) => {
    const parte = d.slice(i, i + g);
    if (parte === '') return;
    r += (k > 0 ? seps[k - 1] : '') + parte;
    i += g;
  });
  return r;
}
export const mascaraNcm = (s: string) => mascarar(s, [4, 2, 2], ['.', '.']);
export const mascaraCest = (s: string) => mascarar(s, [2, 3, 2], ['.', '.']);
export const mascaraIe = (s: string) => mascarar(s, [3, 3, 3, 3], ['.', '.', '.']);
export const mascaraCep = (s: string) => mascarar(s, [5, 3], ['-']);
/** Sem os separadores das máscaras (espaço, ponto, hífen e barra); o que sobrar de estranho fica, para a validação recusar. */
const semSeparador = (s: string) => s.replace(/[\s.\-/]/g, '');
const vazioNulo = (s: string) => {
  const t = s.trim();
  return t === '' ? null : t;
};

// ----------------------------------------------------------------------------------------------------------------- Produtos
export type FiltroProdutos = 'faltam' | 'prontos' | 'todos';

/** Contagem dos botões (UX 5.7), só dos ativos (a grade é dos itens ativos do cardápio; o número bate com o da aba). */
export function contarProdutos(ps: readonly ProdutoCupom[]): Record<FiltroProdutos, number> {
  const ativos = ps.filter((p) => p.ativo);
  const prontos = ativos.filter((p) => p.pronto).length;
  return { faltam: ativos.length - prontos, prontos, todos: ativos.length };
}

/**
 * A grade (UX 5.7): os ativos (ou, vindo de um cupom, os produtos dele, `so`), pelo filtro, a categoria e a busca (sem acento, no nome do
 * cardápio e no nome no cupom).
 */
export function filtrarProdutos(
  ps: readonly ProdutoCupom[],
  f: { busca: string; filtro: FiltroProdutos; categoria: string | null; so: readonly string[] | null },
): ProdutoCupom[] {
  const t = semAcento(f.busca.trim());
  return ps.filter((p) => {
    if (f.so ? !f.so.includes(p.item_cardapio_id) : !p.ativo) return false;
    if (f.filtro === 'faltam' && p.pronto) return false;
    if (f.filtro === 'prontos' && !p.pronto) return false;
    if (f.categoria && p.categoria !== f.categoria) return false;
    if (t === '') return true;
    return semAcento(p.nome).includes(t) || (p.descricao_cupom !== null && semAcento(p.descricao_cupom).includes(t));
  });
}

/** As tags do produto (UX 5.7): "Pronto para o cupom" ou uma por motivo. */
export function tagsDoProduto(p: Pick<ProdutoCupom, 'pronto' | 'motivos'>): { tom: 'ok' | 'warn'; texto: string }[] {
  if (p.pronto) return [{ tom: 'ok', texto: 'Pronto para o cupom' }];
  return p.motivos.map((m) => ({ tom: 'warn' as const, texto: TAG_MOTIVO[m] }));
}

/** "NCM 1602.50.00 · Prato da casa" (o que houver). */
export function linhaFiscalDoProduto(p: Pick<ProdutoCupom, 'ncm' | 'perfil_nome'>): string | null {
  const partes = [p.ncm ? `NCM ${mascaraNcm(p.ncm)}` : null, p.perfil_nome].filter((x): x is string => !!x);
  return partes.length === 0 ? null : partes.join(' · ');
}

export type FormProduto = {
  ncm: string;
  perfil_fiscal_id: string;
  cest: string;
  gtin: string;
  origem: string;
  descricao_cupom: string;
  unidade: string;
};
export const formDoProduto = (p: ProdutoCupom): FormProduto => ({
  ncm: p.ncm ? mascaraNcm(p.ncm) : '',
  perfil_fiscal_id: p.perfil_fiscal_id ?? '',
  cest: p.cest ? mascaraCest(p.cest) : '',
  gtin: p.gtin ?? '',
  origem: String(p.origem),
  descricao_cupom: p.descricao_cupom ?? '',
  unidade: p.unidade ?? '',
});

/** Erro de cada campo da folha do produto (no blur; as frases da UX 5.7); vazio = sem erro (o NCM e o perfil vazios só deixam "Falta"). */
export function errosDoProduto(f: FormProduto): Partial<Record<keyof FormProduto, string>> {
  const e: Partial<Record<keyof FormProduto, string>> = {};
  const ncm = semSeparador(f.ncm);
  const cest = semSeparador(f.cest);
  const gtin = semSeparador(f.gtin);
  if (ncm !== '' && !/^\d{8}$/.test(ncm)) e.ncm = 'O NCM tem 8 números.';
  if (cest !== '' && !/^\d{7}$/.test(cest)) e.cest = 'O CEST tem 7 números.';
  if (gtin !== '' && !gtinValido(gtin)) e.gtin = 'Este código de barras não confere. Confira os números (8, 12, 13 ou 14).';
  if (Array.from(f.descricao_cupom.trim()).length > 120) e.descricao_cupom = 'Use até 120 letras.';
  if (Array.from(f.unidade.trim()).length > 6) e.unidade = 'Use até 6 letras.';
  return e;
}

/**
 * O PUT do produto com SÓ o que mudou (um perfil igual, mesmo desativado, não vai: o servidor recusaria): códigos sem máscara, textos
 * aparados, vazio = null.
 */
export function produtoParaSalvar(p: ProdutoCupom, f: FormProduto): SalvarProdutoCupom {
  const r: SalvarProdutoCupom = {};
  const ncm = vazioNulo(semSeparador(f.ncm));
  const cest = vazioNulo(semSeparador(f.cest));
  const gtin = vazioNulo(semSeparador(f.gtin));
  const descricao = vazioNulo(f.descricao_cupom);
  const unidade = vazioNulo(f.unidade);
  const perfil = f.perfil_fiscal_id === '' ? null : f.perfil_fiscal_id;
  const origem = Number(f.origem);
  if (ncm !== p.ncm) r.ncm = ncm;
  if (cest !== p.cest) r.cest = cest;
  if (gtin !== p.gtin) r.gtin = gtin;
  if (Number.isInteger(origem) && origem !== p.origem) r.origem = origem;
  if (descricao !== p.descricao_cupom) r.descricao_cupom = descricao;
  if (unidade !== p.unidade) r.unidade = unidade;
  if (perfil !== p.perfil_fiscal_id) r.perfil_fiscal_id = perfil;
  return r;
}

/** Origem da mercadoria (UX 5.7; os números da tabela de origem do leiaute). */
export const OPCOES_ORIGEM: readonly { codigo: string; texto: string }[] = [
  { codigo: '0', texto: '0 Nacional' },
  { codigo: '1', texto: '1 Estrangeira, importação direta' },
  { codigo: '2', texto: '2 Estrangeira, comprada no Brasil' },
  { codigo: '3', texto: '3 Nacional, mais de 40% e até 70% importado' },
  { codigo: '4', texto: '4 Nacional, processo produtivo básico' },
  { codigo: '5', texto: '5 Nacional, até 40% importado' },
  { codigo: '6', texto: '6 Estrangeira sem similar nacional, importação direta' },
  { codigo: '7', texto: '7 Estrangeira sem similar nacional, comprada no Brasil' },
  { codigo: '8', texto: '8 Nacional, mais de 70% importado' },
];

// ----------------------------------------------------------------------------------------------------------------- perfis fiscais
// As listas e as combinações são as de `api/src/modules/cupom-fiscal/validacao-fiscal.ts` (a tela desabilita o que o servidor recusa).
/** CRT 1, 2 e 4 (Simples, acima do sublimite e MEI) usam CSOSN; o 3 (regime normal), CST. */
export const usaCsosn = (crt: number | null) => crt === 1 || crt === 2 || crt === 4;
const CFOP_SEM_ST = ['5101', '5102', '5103', '5104', '5115'];
const CFOP_CSOSN_500 = ['5405', '5656', '5667'];
const CFOP_CST_60 = ['5405'];
/** "5101" → "5.101". */
export const cfopTexto = (c: string) => (c.length === 4 ? `${c[0]}.${c.slice(1)}` : c);
const listaCfop = (cs: readonly string[]) => {
  const t = cs.map(cfopTexto);
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}`;
};

export type OpcaoFiscal = { codigo: string; texto: string; motivo?: string };
export const OPCOES_CSOSN: readonly OpcaoFiscal[] = [
  { codigo: '102', texto: '102 Tributado pelo Simples, sem permissão de crédito' },
  { codigo: '103', texto: '103 Isento pela faixa de receita' },
  { codigo: '300', texto: '300 Imune' },
  { codigo: '400', texto: '400 Não tributado pelo Simples' },
  { codigo: '500', texto: '500 ICMS já pago antes (substituição tributária)' },
  { codigo: '900', texto: '900 Outros' },
];
export const OPCOES_CST: readonly OpcaoFiscal[] = [
  { codigo: '00', texto: '00 Tributado integralmente' },
  { codigo: '20', texto: '20 Com redução da base', motivo: 'O CST 20 ainda não pode ser usado no Comanda. Fale com o contador.' },
  { codigo: '40', texto: '40 Isento' },
  { codigo: '41', texto: '41 Não tributado' },
  { codigo: '60', texto: '60 ICMS já pago antes (substituição tributária)' },
  { codigo: '90', texto: '90 Outros' },
];
export const OPCOES_CFOP: readonly OpcaoFiscal[] = [
  { codigo: '5101', texto: '5.101 Produção própria (feito na casa)' },
  { codigo: '5102', texto: '5.102 Revenda (comprado pronto)' },
  { codigo: '5103', texto: '5.103 Produção própria, vendida fora do estabelecimento' },
  { codigo: '5104', texto: '5.104 Revenda, vendida fora do estabelecimento' },
  { codigo: '5115', texto: '5.115 Revenda recebida em consignação' },
  { codigo: '5405', texto: '5.405 Revenda com imposto já pago antes (substituição tributária)' },
  { codigo: '5656', texto: '5.656 Combustível (raro)' },
  { codigo: '5667', texto: '5.667 Combustível (raro)' },
];
const PIS_BARRADO = 'Pede alíquota: ainda não pode ser usado no Comanda. Fale com o contador.';
/** CST de PIS/COFINS: os que vão só com o código (04–09) ou zerados (49, 99); os que pedem alíquota ficam desabilitados (o servidor recusa). */
export const OPCOES_PIS_COFINS: readonly OpcaoFiscal[] = [
  { codigo: '01', texto: '01 Tributável, alíquota básica', motivo: PIS_BARRADO },
  { codigo: '02', texto: '02 Tributável, alíquota diferenciada', motivo: PIS_BARRADO },
  { codigo: '03', texto: '03 Tributável, alíquota por unidade', motivo: PIS_BARRADO },
  { codigo: '04', texto: '04 Monofásica, revenda a alíquota zero' },
  { codigo: '05', texto: '05 Substituição tributária' },
  { codigo: '06', texto: '06 Alíquota zero' },
  { codigo: '07', texto: '07 Isenta' },
  { codigo: '08', texto: '08 Sem incidência' },
  { codigo: '09', texto: '09 Com suspensão' },
  { codigo: '49', texto: '49 Outras operações de saída' },
  { codigo: '99', texto: '99 Outras operações' },
];

/** Por que o CFOP não combina com o código do imposto (as frases do servidor); combina = null. */
export function motivoCfopFora(cfop: string, c: { csosn: string | null; cst_icms: string | null }): string | null {
  const csosn = c.csosn?.trim() || null;
  const cst = c.cst_icms?.trim() || null;
  if (csosn === '500') return CFOP_CSOSN_500.includes(cfop) ? null : 'O CSOSN 500 só vale com o CFOP 5.405.';
  if (csosn !== null) return CFOP_SEM_ST.includes(cfop) ? null : `O CSOSN ${csosn} só vale com o tipo de venda (CFOP) ${listaCfop(CFOP_SEM_ST)}.`;
  if (cst === '60') return CFOP_CST_60.includes(cfop) ? null : `O CST 60 só vale com o tipo de venda (CFOP) ${listaCfop(CFOP_CST_60)}.`;
  return null;
}

/** A ajuda do CFOP com o CSOSN 500 ou o CST 60 (UX 5.6). */
export const ajudaDoCfop = (c: { csosn: string; cst_icms: string }) =>
  c.csosn === '500' || c.cst_icms === '60' ? 'Com este código de imposto, o CFOP é 5.405.' : null;

export type FormPerfil = {
  nome: string;
  csosn: string;
  cst_icms: string;
  aliq_icms: string;
  cfop: string;
  pis_cst: string;
  cofins_cst: string;
  c_ativ_sn: string;
  ibs_sn_aliq: string;
  cbs_sn_aliq: string;
  ibscbs_cst: string;
  ibscbs_cclass_trib: string;
};
const pctTela = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
export const formDoPerfil = (p: PerfilFiscal | null): FormPerfil => ({
  nome: p?.nome ?? '',
  csosn: p?.csosn ?? '',
  cst_icms: p?.cst_icms ?? '',
  aliq_icms: pctTela(p?.aliq_icms ?? null),
  cfop: p?.cfop ?? '',
  pis_cst: p?.pis_cst ?? '',
  cofins_cst: p?.cofins_cst ?? '',
  c_ativ_sn: p?.c_ativ_sn ?? '',
  ibs_sn_aliq: pctTela(p?.ibs_sn_aliq ?? null),
  cbs_sn_aliq: pctTela(p?.cbs_sn_aliq ?? null),
  ibscbs_cst: p?.ibscbs_cst ?? '',
  ibscbs_cclass_trib: p?.ibscbs_cclass_trib ?? '',
});

/** Percentual da tela ("18,5") → texto do fio ("18.5"); vazio = null. */
const pctFio = (s: string) => vazioNulo(s.replace(',', '.'));
const pctOk = (s: string, casas: number) => new RegExp(`^\\d{1,3}(\\.\\d{1,${casas}})?$`).test(s) && Number(s) <= 100;

/**
 * Erros da folha do perfil (UX 5.6), campo a campo; o regime (`crt`) decide se o código é CSOSN ou CST (sem regime: o do próprio perfil).
 * As opções que não combinam já vêm desabilitadas: aqui fica o que a pessoa ainda pode deixar errado.
 */
export function errosDoPerfil(f: FormPerfil, crt: number | null): Partial<Record<keyof FormPerfil, string>> {
  const e: Partial<Record<keyof FormPerfil, string>> = {};
  const simples = crt === null ? f.csosn.trim() !== '' : usaCsosn(crt);
  const nome = f.nome.trim();
  if (nome === '') e.nome = 'Dê um nome ao perfil.';
  else if (Array.from(nome).length > 60) e.nome = 'O nome do perfil tem até 60 letras.';
  if (simples && f.csosn.trim() === '') e.csosn = 'No Simples, escolha o CSOSN.';
  if (!simples) {
    const cst = f.cst_icms.trim();
    const aliq = pctFio(f.aliq_icms);
    if (cst === '') e.cst_icms = 'No regime normal, escolha o CST.';
    if (aliq !== null && !pctOk(aliq, 2)) e.aliq_icms = 'Use um número de 0 a 100, com até 2 casas.';
    else if (cst === '00' && aliq === null) e.aliq_icms = 'Informe a alíquota do ICMS.';
  }
  const cfop = f.cfop.trim();
  if (cfop === '') e.cfop = 'Escolha o tipo de venda (CFOP).';
  else {
    const m = motivoCfopFora(cfop, simples ? { csosn: f.csosn, cst_icms: null } : { csosn: null, cst_icms: f.cst_icms });
    if (m) e.cfop = m;
  }
  for (const k of ['pis_cst', 'cofins_cst'] as const) if (f[k].trim() !== '' && !/^\d{2}$/.test(f[k].trim())) e[k] = 'Use 2 números.';
  if (simples) {
    if (f.c_ativ_sn.trim() !== '' && !/^\d{2}$/.test(f.c_ativ_sn.trim())) e.c_ativ_sn = 'Use 2 números.';
    for (const k of ['ibs_sn_aliq', 'cbs_sn_aliq'] as const) {
      const v = pctFio(f[k]);
      if (v !== null && !pctOk(v, 4)) e[k] = 'Use um número com até 4 casas.';
    }
  } else {
    if (f.ibscbs_cst.trim() !== '' && !/^\d{3}$/.test(f.ibscbs_cst.trim())) e.ibscbs_cst = 'Use 3 números.';
    if (f.ibscbs_cclass_trib.trim() !== '' && !/^\d{6}$/.test(f.ibscbs_cclass_trib.trim())) e.ibscbs_cclass_trib = 'Use 6 números.';
  }
  return e;
}

/** O corpo do POST/PATCH do perfil: aparado, vazio = null, alíquota com ponto; os campos do outro regime vão nulos (os dois = 422). */
export function perfilParaSalvar(f: FormPerfil, crt: number | null): SalvarPerfilFiscal & { nome: string; cfop: string } {
  const simples = crt === null ? f.csosn.trim() !== '' : usaCsosn(crt);
  return {
    nome: f.nome.trim(),
    cfop: f.cfop.trim(),
    csosn: simples ? vazioNulo(f.csosn) : null,
    cst_icms: simples ? null : vazioNulo(f.cst_icms),
    aliq_icms: simples ? null : pctFio(f.aliq_icms),
    pis_cst: vazioNulo(f.pis_cst),
    cofins_cst: vazioNulo(f.cofins_cst),
    c_ativ_sn: simples ? vazioNulo(f.c_ativ_sn) : null,
    ibs_sn_aliq: simples ? pctFio(f.ibs_sn_aliq) : null,
    cbs_sn_aliq: simples ? pctFio(f.cbs_sn_aliq) : null,
    ibscbs_cst: simples ? null : vazioNulo(f.ibscbs_cst),
    ibscbs_cclass_trib: simples ? null : vazioNulo(f.ibscbs_cclass_trib),
  };
}

/** "Prato da casa — CFOP 5.101 · CSOSN 102 · 64 produtos" (UX 5.6). */
export function linhaDoPerfil(p: Pick<PerfilFiscal, 'nome' | 'cfop' | 'csosn' | 'cst_icms' | 'produtos'>): string {
  const codigo = p.csosn ? `CSOSN ${p.csosn}` : p.cst_icms ? `CST ${p.cst_icms}` : null;
  return [`${p.nome} — CFOP ${cfopTexto(p.cfop)}`, codigo, `${p.produtos} ${plural(p.produtos, 'produto', 'produtos')}`]
    .filter(Boolean)
    .join(' · ');
}

/** O corpo do "Desativar" de um perfil em uso (UX 5.6). */
export const textoDesativarPerfil = (n: number) =>
  n === 1
    ? '1 produto usa este perfil e sai do cupom até você escolher outro perfil para ele.'
    : `${n} produtos usam este perfil e saem do cupom até você escolher outro perfil para eles.`;

/**
 * O aviso de trocar o regime entre Simples e normal (UX 5.2), com os perfis ativos do outro regime; sem troca de família ou sem perfil
 * afetado = null (sem diálogo).
 */
export function avisoTrocaRegime(
  perfis: readonly Pick<PerfilFiscal, 'ativo' | 'csosn' | 'cst_icms'>[],
  antes: number | null,
  depois: number,
): string | null {
  if (antes === null || usaCsosn(antes) === usaCsosn(depois)) return null;
  const paraNormal = !usaCsosn(depois);
  const n = perfis.filter((p) => p.ativo && (paraNormal ? p.csosn : p.cst_icms)).length;
  if (n === 0) return null;
  const quem = n === 1 ? 'O perfil fiscal usa' : `Os ${n} perfis fiscais usam`;
  const deixa = n === 1 ? 'ele deixa' : 'eles deixam';
  const desses = n === 1 ? 'desse perfil' : 'desses perfis';
  return paraNormal
    ? `${quem} códigos do Simples (CSOSN). No regime normal, ${deixa} de valer até você trocar por CST, e os produtos ${desses} saem do cupom até lá.`
    : `${quem} códigos do regime normal (CST). No Simples, ${deixa} de valer até você trocar por CSOSN, e os produtos ${desses} saem do cupom até lá.`;
}

// ----------------------------------------------------------------------------------------------------------------- Configurações
/** A ordem da UX 5.1 (a do servidor; a tela reordena por garantia). */
const ORDEM_FALTA: readonly string[] = [
  'certificado', 'cnpj', 'ie', 'crt', 'endereco', 'serie', 'csc', 'produto_pronto', 'teste_homologacao', 'lanca_venda', 'series_outro_sistema',
];
export function ordenarFalta<T extends { codigo: string; texto: string }>(f: readonly T[]): T[] {
  const pos = (c: string) => {
    const i = ORDEM_FALTA.indexOf(c);
    return i < 0 ? ORDEM_FALTA.length : i;
  };
  return f
    .map((x, i) => ({ x, i }))
    .sort((a, b) => pos(a.x.codigo) - pos(b.x.codigo) || a.i - b.i)
    .map((y) => y.x);
}

/** "Este servidor: …" (UX 5.1). */
export const linhaDoServidor = (a: AmbienteServidor) =>
  a === 'homologacao' ? 'Este servidor: modo de teste da SEFAZ' : a === 'producao' ? 'Este servidor: valendo' : 'Este servidor: desligado';

/** A tag da emissão (UX 5.1): parada, esperando a SEFAZ (bloqueio do 656), ligada ou desligada. */
export function tagDaEmissao(s: Pick<SituacaoCupomFiscal, 'situacao' | 'bloqueado_ate' | 'emissao_ligada'>, agora: Date): { tom: TomCupom; texto: string } {
  if (s.situacao !== 'ok') return { tom: 'bad', texto: 'Parada' };
  if (s.bloqueado_ate !== null && new Date(s.bloqueado_ate).getTime() > agora.getTime()) return { tom: 'warn', texto: 'Esperando a SEFAZ' };
  return s.emissao_ligada ? { tom: 'ok', texto: 'Emissão ligada' } : { tom: 'muted', texto: 'Emissão desligada' };
}

/**
 * O botão da emissão (UX 5.1): servidor desligado = nenhum; depois de uma parada = ligar de novo (só a do 656 desliga a emissão no
 * banco; nas outras ela segue "ligada", mas parada: ligar de novo limpa a parada); ligada = desligar.
 */
export function botaoDaEmissao(s: Pick<SituacaoCupomFiscal, 'ambiente' | 'emissao_ligada' | 'situacao'>): 'ligar' | 'desligar' | 'ligar_de_novo' | null {
  if (s.ambiente === 'desligado') return null;
  if (s.situacao !== 'ok') return 'ligar_de_novo';
  return s.emissao_ligada ? 'desligar' : 'ligar';
}

/** Para onde leva cada item de "Para ligar a emissão, falta:" dentro de Configurações (a aba e o id do campo), ou a outra tela. */
export type AlvoFalta = { rotulo: string; aba: 'geral' | 'cupom'; id: string } | { rotulo: string; href: string };
export function alvoDaFalta(codigo: CodigoFalta, ambiente: AmbienteSefaz): AlvoFalta {
  switch (codigo) {
    case 'certificado':
      return { rotulo: 'Ir para o certificado', aba: 'geral', id: 'certificado-digital' };
    case 'cnpj':
      return { rotulo: 'Preencher', aba: 'geral', id: 'empresa-cnpj' };
    case 'ie':
      return { rotulo: 'Preencher', aba: 'cupom', id: 'cupom-ie' };
    case 'crt':
      return { rotulo: 'Preencher', aba: 'cupom', id: 'cupom-crt' };
    case 'endereco':
      return { rotulo: 'Preencher', aba: 'cupom', id: 'cupom-logradouro' };
    case 'serie':
      return { rotulo: 'Preencher', aba: 'cupom', id: `cupom-serie-${ambiente}` };
    case 'csc':
      return { rotulo: 'Preencher', aba: 'cupom', id: `cupom-csc-${ambiente}` };
    case 'produto_pronto':
      return { rotulo: 'Ver produtos', href: '/cupom?aba=produtos' };
    case 'teste_homologacao':
      return { rotulo: 'Emitir um cupom de teste', href: '/cupom?aba=emitir' };
    case 'lanca_venda':
      return { rotulo: 'Responder', aba: 'cupom', id: 'cupom-lanca-venda' };
    case 'series_outro_sistema':
      return { rotulo: 'Preencher', aba: 'cupom', id: 'cupom-series' };
  }
}

const NOME_CAMPO: Record<string, string> = {
  serie: 'a série',
  proximo_numero: 'o próximo número',
  id_csc: 'o número do código (IdCSC)',
  csc: 'o código de segurança',
};
const juntarE = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/** O histórico do ambiente (UX 5.1, ponto 10.11), do mais novo para o mais velho: o nome do campo mudado, nunca o valor. */
export function linhasHistoricoCupom(h: AmbienteCupom['historico']): string[] {
  return h.map((e) => {
    const quando = dataHoraSp(e.feito_em);
    const por = e.feito_por_nome ? ` por ${e.feito_por_nome}` : '';
    switch (e.evento) {
      case 'ligada':
        return `Ligada${por} em ${quando}`;
      case 'desligada':
        return `Desligada${por} em ${quando}${e.mensagem ? `: ${e.mensagem}` : ''}`;
      case 'parada_automatica':
        return `Parou sozinha em ${quando}${e.mensagem ? `: ${e.mensagem}` : ''}`;
      case 'configuracao': {
        const campos = juntarE(e.campos.map((c) => NOME_CAMPO[c] ?? c));
        return `${e.feito_por_nome ?? 'Alguém'} mudou ${campos || 'a configuração'} em ${quando}`;
      }
      default:
        return `${e.evento} em ${quando}`;
    }
  });
}

/** "Ligada por Diego em 17/11/2026 às 10h05" (a última vez que ligou), para a emissão ligada. */
export function linhaLigadaPor(h: AmbienteCupom['historico']): string | null {
  const e = h.find((x) => x.evento === 'ligada');
  return e ? `Ligada${e.feito_por_nome ? ` por ${e.feito_por_nome}` : ''} em ${dataHoraSp(e.feito_em)}` : null;
}

/** "Guardado: ••••1234 (por Diego em 17/11/2026)" (UX 5.3): quem gravou o CSC sai do histórico; o valor nunca volta. */
export function linhaCscGuardado(a: Pick<AmbienteCupom, 'csc_dica' | 'historico' | 'alterada_por_nome' | 'alterada_em'>): string | null {
  if (!a.csc_dica) return null;
  const e = a.historico.find((x) => x.evento === 'configuracao' && x.campos.includes('csc'));
  const nome = e ? e.feito_por_nome : a.alterada_por_nome;
  const em = e ? e.feito_em : a.alterada_em;
  const quem = nome && em ? ` (por ${nome} em ${dataSp(em)})` : em ? ` (em ${dataSp(em)})` : '';
  return `Guardado: ••••${a.csc_dica}${quem}`;
}

/** Os rótulos do regime (UX 5.2), com o código na frente, na ordem da UX. */
export const OPCOES_CRT: readonly { crt: number; texto: string }[] = [
  { crt: 1, texto: '1 Simples Nacional' },
  { crt: 2, texto: '2 Simples Nacional, acima do sublimite' },
  { crt: 4, texto: '4 MEI' },
  { crt: 3, texto: '3 Regime normal (Lucro Presumido ou Real)' },
];

/** A linha só de leitura da Ficha Técnica (UX 5.8): completa = NCM e perfil + "Editar"; senão o que falta + "Completar". */
export function linhaCupomDaFicha(p: Pick<ProdutoCupom, 'item_cardapio_id' | 'ncm' | 'perfil_nome'>): { texto: string; acao: 'Editar' | 'Completar'; href: string } {
  const href = `/cupom?aba=produtos&item=${p.item_cardapio_id}`;
  if (p.ncm && p.perfil_nome) return { texto: `Cupom fiscal: NCM ${mascaraNcm(p.ncm)} · perfil ${p.perfil_nome}`, acao: 'Editar', href };
  const falta = [p.ncm ? null : 'NCM', p.perfil_nome ? null : 'perfil'].filter((x): x is string => x !== null);
  return { texto: `Cupom fiscal: ${falta.length > 1 ? 'faltam' : 'falta'} ${juntarE(falta)}`, acao: 'Completar', href };
}
