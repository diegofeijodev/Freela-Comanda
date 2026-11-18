'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, Minus, Plus } from 'lucide-react';
import {
  emitirCupom, listarCupons, produtosCupom, statusDoErro, type CupomDetalhe, type EmitirCupom, type ProdutoCupom, type SituacaoCupomFiscal,
} from '@/lib/erp-api';
import { errCode, errMsg } from '@/lib/db';
import {
  atalhosDinheiro, buscarProdutos, caixaDoTopo, calcularTotais, centavosDaTela, CHAVES_CUPOM, DOC_OBRIGATORIO_A_PARTIR, documentoDoPost,
  erroDocumento, erroQuantidade, falhaIncerta, FORMAS_DA_TELA, linkDaFalta, linhasDosPagamentos, MOTIVO_NA_FRASE, mascaraCnpj, mascaraCpf,
  NOME_PAGAMENTO, novaChaveIdempotencia, pagamentosDaTela, podeDiminuir, quantidadeDaTela, quantidadeValida, reais,
  rotuloBotaoEmitir, somarQuantidade, TAG_MOTIVO, tagDoCupom, textoCentavos, valorItemCentavos, type EstadoEmitir, type LinhaPagamento,
  type TPag, type VendaRefeita,
} from '@/lib/cupom';
import { horaSp, semToqueDuplo } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel } from '@/components/ui-kit';
import { cn } from '@/lib/utils';
import { ConferirSheet, type FaseConferir, type ResumoConferir } from './conferir-sheet';

/** Uma linha do carrinho: o preço visto ao entrar (para "Preço mudou: era …"); o preço que vale é o do cardápio relido. */
type LinhaCarrinho = { id: string; nome: string; quantidade: string; precoVisto: bigint | null; erroQtd: string | null };
type Doc = { tipo: 'cpf' | 'cnpj'; valor: string };
const TEXTO_ERRO_TOTAIS: Record<string, string> = {
  SEM_ITENS: 'Adicione pelo menos um produto.',
  DESCONTO_INVALIDO: 'O desconto tem de ser menor que o valor dos produtos.',
  PAGAMENTO_INSUFICIENTE: 'A soma dos pagamentos é menor que o total.',
  TROCO_INVALIDO: 'Troco só sai do dinheiro, e no máximo o valor recebido em dinheiro.',
  VALOR_MAXIMO: 'O total do cupom tem de ser menor que R$ 200.000,00.',
};
const TOTAL_MAXIMO = 20_000_000n;
const TRINTA_MIN_MS = 30 * 60_000;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/**
 * Aba Emitir (UX 2): a caixa do topo (o que destrava a emissão), a busca e o carrinho, o desconto, o pagamento, o CPF/CNPJ e o botão que
 * diz o que falta; "Conferir o cupom" envia. Nada da venda vai para o storage: recarregar perde a venda (a faixa de pendentes e o "Último
 * cupom" dizem se algo saiu). A `chave_idempotencia` nasce uma vez por venda e só muda depois de uma resposta com cupom.
 */
export function Emitir({ situacao, situacaoEm, situacaoErro, onTentarSituacao }: {
  situacao: SituacaoCupomFiscal | undefined;
  /** Quando a situação chegou (`dataUpdatedAt`): o desvio do relógio é `agora` do servidor − essa hora. */
  situacaoEm: number;
  situacaoErro: boolean;
  onTentarSituacao(): void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const produtosQ = useQuery({
    queryKey: CHAVES_CUPOM.produtos,
    queryFn: () => produtosCupom(),
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  const ultimoQ = useQuery({ queryKey: CHAVES_CUPOM.ultimo, queryFn: () => listarCupons({ limite: 1 }) });

  // ---------------------------------------------------------------------------------------------------------------- venda
  const [chave, setChave] = useState(novaChaveIdempotencia);
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [desconto, setDesconto] = useState<string | null>(null);
  const [descontoTocado, setDescontoTocado] = useState(false);
  const [pagamentos, setPagamentos] = useState<LinhaPagamento[]>([]);
  const [pagTocado, setPagTocado] = useState<boolean[]>([]);
  const [doc, setDoc] = useState<Doc>({ tipo: 'cpf', valor: '' });
  const [docTocado, setDocTocado] = useState(false);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [foraDaVenda, setForaDaVenda] = useState<string[]>([]);
  const [travada, setTravada] = useState(false);
  const [conferir, setConferir] = useState<{ aberto: boolean; fase: FaseConferir }>({ aberto: false, fase: { fase: 'conferir' } });
  const corpoEnviado = useRef<EmitirCupom | null>(null);
  const emCurso = useRef(false);

  // ---------------------------------------------------------------------------------------------------------------- busca
  const [termo, setTermo] = useState('');
  const [destaque, setDestaque] = useState(0);
  const [verCategorias, setVerCategorias] = useState(false);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [recem, setRecem] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');

  const refBusca = useRef<HTMLInputElement>(null);
  const refTopo = useRef<HTMLDivElement>(null);
  const refDesconto = useRef<HTMLInputElement>(null);
  const refPagamento = useRef<HTMLDivElement>(null);
  const refDoc = useRef<HTMLInputElement>(null);
  const refBotao = useRef<HTMLButtonElement>(null);
  const refBotaoFixo = useRef<HTMLButtonElement>(null);

  // relógio do servidor (a caixa do bloqueio some na hora certa, mesmo com o relógio do aparelho errado)
  const [desvio, setDesvio] = useState(0);
  const [, setTique] = useState(0);
  useEffect(() => {
    if (situacao && situacaoEm > 0) setDesvio(new Date(situacao.agora).getTime() - situacaoEm);
  }, [situacao, situacaoEm]);
  useEffect(() => {
    const t = setInterval(() => setTique((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const agora = new Date(Date.now() + desvio);

  // a barra fixa do celular nunca cobre o campo com foco (WCAG 2.4.11)
  useEffect(() => {
    const html = document.documentElement;
    const antes = html.style.scrollPaddingBottom;
    html.style.scrollPaddingBottom = '7.5rem';
    return () => { html.style.scrollPaddingBottom = antes; };
  }, []);

  const produtos = useMemo(() => (produtosQ.data ?? []).filter((p) => p.ativo), [produtosQ.data]);
  const mapa = useMemo(() => new Map((produtosQ.data ?? []).map((p) => [p.item_cardapio_id, p])), [produtosQ.data]);

  // "Refazer com estes itens": a venda chega pela memória da página (cache do TanStack Query), com os preços relidos
  useEffect(() => {
    if (!produtosQ.data || produtosQ.isFetching) return;
    const r = qc.getQueryData<VendaRefeita>(CHAVES_CUPOM.refazer);
    if (!r) return;
    qc.removeQueries({ queryKey: CHAVES_CUPOM.refazer });
    const fora: string[] = [];
    const linhas: LinhaCarrinho[] = [];
    for (const i of r.itens) {
      const p = i.item_cardapio_id ? mapa.get(i.item_cardapio_id) : undefined;
      if (!p || !p.ativo || !p.pronto || p.preco_venda_centavos === null) {
        const motivo = !p || !p.ativo ? 'inativo' : (p.motivos[0] ?? 'sem_preco');
        fora.push(`${i.nome} ficou de fora: ${MOTIVO_NA_FRASE[motivo]}.`);
        continue;
      }
      linhas.push({ id: p.item_cardapio_id, nome: p.nome, quantidade: i.quantidade, precoVisto: BigInt(p.preco_venda_centavos), erroQtd: null });
    }
    setCarrinho(linhas);
    setForaDaVenda(fora);
    setDesconto(r.desconto_centavos > 0 ? textoCentavos(BigInt(r.desconto_centavos)) : null);
    const pg = linhasDosPagamentos(r.pagamentos);
    setPagamentos(pg);
    setPagTocado(pg.map(() => false));
    if (r.consumidor_doc) {
      const cpf = /^[0-9]{11}$/.test(r.consumidor_doc);
      setDoc({ tipo: cpf ? 'cpf' : 'cnpj', valor: cpf ? mascaraCpf(r.consumidor_doc) : mascaraCnpj(r.consumidor_doc) });
    }
  }, [produtosQ.data, produtosQ.isFetching, mapa, qc]);

  // ---------------------------------------------------------------------------------------------------------------- contas
  const linhas = carrinho.map((l) => {
    const p = mapa.get(l.id);
    const preco = p && p.preco_venda_centavos !== null ? BigInt(p.preco_venda_centavos) : null;
    const motivo = !p || !p.ativo ? 'inativo' : !p.pronto ? (p.motivos[0] ?? 'sem_preco') : preco === null ? 'sem_preco' : null;
    const q = quantidadeDaTela(l.quantidade);
    const qOk = quantidadeValida(q);
    const valor = qOk && preco !== null ? valorItemCentavos(q, preco) : 0n;
    return { ...l, preco, motivo, qOk, valor, mudou: preco !== null && l.precoVisto !== null && preco !== l.precoVisto };
  });
  const valorProdutos = linhas.reduce((a, l) => a + l.valor, 0n);
  const descontoLido = desconto === null ? 'vazio' : centavosDaTela(desconto);
  const descontoCent = typeof descontoLido === 'bigint' ? descontoLido : 0n;
  const erroDesconto =
    descontoLido === 'invalido'
      ? 'Use um valor como 3,70.'
      : descontoCent > 0n && descontoCent >= valorProdutos
        ? `O desconto tem de ser menor que o valor dos produtos (${reais(valorProdutos)}).`
        : null;
  const descontoValido = erroDesconto === null ? descontoCent : 0n;
  const total = valorProdutos - descontoValido;
  const acimaDoTeto = total >= TOTAL_MAXIMO;
  const pg = pagamentosDaTela(total, pagamentos);
  const obrigatorio = total >= DOC_OBRIGATORIO_A_PARTIR;
  const erroDoc = erroDocumento(doc.tipo, doc.valor, obrigatorio);
  const topo = situacao ? caixaDoTopo(situacao, agora) : null;
  const estado: EstadoEmitir = {
    itens: carrinho.length,
    produtosComAviso: linhas.some((l) => l.motivo !== null || !l.qOk) || erroDesconto !== null || acimaDoTeto,
    formaEscolhida: pagamentos.length > 0,
    falta: pagamentos.length > 0 ? pg.falta : 0n,
    pagamentoComErro: pg.erro,
    documento: { tipo: doc.tipo, erro: erroDoc !== null },
    bloqueio: topo && topo.formulario ? topo.botao : null,
  };
  const botao = rotuloBotaoEmitir(estado);
  const teste = situacao?.ambiente === 'homologacao';

  // ---------------------------------------------------------------------------------------------------------------- carrinho
  function anunciar(lista: LinhaCarrinho[], id: string) {
    const l = lista.find((x) => x.id === id);
    if (!l) return;
    const soma = lista.reduce((a, x) => {
      const p = mapa.get(x.id);
      const q = quantidadeDaTela(x.quantidade);
      return p?.preco_venda_centavos != null && quantidadeValida(q) ? a + valorItemCentavos(q, BigInt(p.preco_venda_centavos)) : a;
    }, 0n);
    setAnuncio(`${l.nome}: ${l.quantidade} no cupom. Total ${reais(soma > descontoValido ? soma - descontoValido : soma)}.`);
  }

  function adicionar(p: ProdutoCupom) {
    if (travada || !p.pronto || p.preco_venda_centavos === null) return;
    const ja = carrinho.find((l) => l.id === p.item_cardapio_id);
    const nova = ja
      ? carrinho.map((l) => (l.id === p.item_cardapio_id ? { ...l, quantidade: somarQuantidade(l.quantidade, 1), erroQtd: null } : l))
      : [...carrinho, { id: p.item_cardapio_id, nome: p.nome, quantidade: '1', precoVisto: BigInt(p.preco_venda_centavos), erroQtd: null }];
    setCarrinho(nova);
    setForaDaVenda([]);
    setRecem(p.item_cardapio_id);
    setTermo('');
    setDestaque(0);
    anunciar(nova, p.item_cardapio_id);
    refBusca.current?.focus();
  }

  function mudarQtd(id: string, quantidade: string) {
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, quantidade, erroQtd: null } : l)));
  }
  function somar(id: string, delta: 1 | -1) {
    const nova = carrinho.map((l) => (l.id === id ? { ...l, quantidade: somarQuantidade(l.quantidade, delta), erroQtd: null } : l));
    setCarrinho(nova);
    anunciar(nova, id);
  }
  function conferirQtd(id: string) {
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, erroQtd: erroQuantidade(l.quantidade) } : l)));
  }
  function tirar(id: string) {
    const i = carrinho.findIndex((l) => l.id === id);
    if (i < 0) return;
    const linha = carrinho[i];
    setCarrinho((c) => c.filter((l) => l.id !== id));
    if (recem === id) setRecem(null);
    toast(`${linha.nome} tirado do cupom.`, {
      duration: 8000,
      action: {
        label: 'Desfazer',
        onClick: () => setCarrinho((c) => (c.some((l) => l.id === id) ? c : [...c.slice(0, i), linha, ...c.slice(i)])),
      },
    });
  }

  // ---------------------------------------------------------------------------------------------------------------- pagamento
  function escolherForma(i: number, t: TPag) {
    setPagamentos((ps) => {
      if (ps.length === 0) return [{ tPag: t, valor: '' }];
      return ps.map((p, k) => (k === i ? { ...p, tPag: t } : p));
    });
    setPagTocado((ts) => (ts.length === 0 ? [false] : ts));
  }
  function mudarValor(i: number, valor: string) {
    setPagamentos((ps) => ps.map((p, k) => (k === i ? { tPag: p.tPag, valor } : p)));
  }
  function tocarValor(i: number) {
    setPagTocado((ts) => ts.map((t, k) => (k === i ? true : t)));
  }
  function pagarParte() {
    setPagamentos((ps) => {
      // a(s) linha(s) automática(s) ficam com o valor de agora; a forma única ganha campo de valor (vazio) e a nova fica com o que falta
      const fixas = ps.length === 1 ? [{ tPag: ps[0].tPag, valor: ps[0].tPag === '01' ? ps[0].valor : '' }]
        : ps.map((p, k) => (p.auto ? { tPag: p.tPag, valor: textoCentavos(pg.valores[k] ?? 0n) } : p));
      const outra: TPag = fixas.some((p) => p.tPag === '01') ? '17' : '01';
      return [...fixas, { tPag: outra, valor: '', auto: true }];
    });
    setPagTocado((ts) => [...(ts.length === 0 ? [false] : ts), false]);
  }
  function tirarForma(i: number) {
    setPagamentos((ps) => {
      const resto = ps.filter((_, k) => k !== i);
      if (resto.length === 1) return [{ tPag: resto[0].tPag, valor: resto[0].tPag === '01' ? (resto[0].auto ? '' : resto[0].valor) : '' }];
      return resto;
    });
    setPagTocado((ts) => ts.filter((_, k) => k !== i));
  }

  // ---------------------------------------------------------------------------------------------------------------- documento
  function trocarTipoDoc() {
    setDoc((d) => {
      if (d.tipo === 'cpf') return { tipo: 'cnpj', valor: mascaraCnpj(d.valor) };
      const so = d.valor.toUpperCase().replace(/[^0-9A-Z]/g, '');
      return { tipo: 'cpf', valor: /^[0-9]{0,11}$/.test(so) ? mascaraCpf(so) : '' };
    });
    setDocTocado(false);
    setTimeout(() => refDoc.current?.focus(), 0);
  }

  // ---------------------------------------------------------------------------------------------------------------- botão
  function irPara(alvo: ReturnType<typeof rotuloBotaoEmitir>['alvo']) {
    setMostrarErros(true);
    if (alvo === 'busca') return refBusca.current?.focus();
    if (alvo === 'topo') return refTopo.current?.focus();
    if (alvo === 'documento') { setDocTocado(true); return refDoc.current?.focus(); }
    if (alvo === 'produtos') {
      setCarrinho((c) => c.map((l) => ({ ...l, erroQtd: erroQuantidade(l.quantidade) })));
      setDescontoTocado(true);
      const aviso = document.querySelector<HTMLElement>('[data-aviso-produto]');
      if (aviso) return aviso.focus();
      return refDesconto.current?.focus();
    }
    if (alvo === 'pagamento') {
      setPagTocado((ts) => ts.map(() => true));
      const sec = refPagamento.current;
      const campo = pagamentos.length === 0
        ? sec?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
        : (sec?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? sec?.querySelector<HTMLElement>('input'));
      return campo?.focus();
    }
  }
  function tocarBotao() {
    if (travada) return setConferir((c) => ({ ...c, aberto: true }));
    if (botao.alvo !== 'conferir') return irPara(botao.alvo);
    setConferir({ aberto: true, fase: { fase: 'conferir' } });
  }

  // ---------------------------------------------------------------------------------------------------------------- envio
  function montarCorpo(): EmitirCupom | null {
    const t = calcularTotais(
      linhas.map((l) => ({ quantidade: quantidadeDaTela(l.quantidade), precoCentavos: l.preco ?? 0n })),
      descontoValido,
      pg.pagamentos,
    );
    if ('erro' in t) {
      setConferir((c) => ({ ...c, fase: { fase: 'erro', mensagem: TEXTO_ERRO_TOTAIS[t.erro] ?? 'Confira a venda.', verEmitidos: false } }));
      return null;
    }
    return {
      chave_idempotencia: chave,
      itens: linhas.map((l) => ({ item_cardapio_id: l.id, quantidade: quantidadeDaTela(l.quantidade) })),
      desconto_centavos: Number(descontoValido),
      pagamentos: pg.pagamentos.map((p) => ({ t_pag: p.tPag, valor_centavos: Number(p.valor) })),
      consumidor_doc: documentoDoPost(doc.tipo, doc.valor),
      total_esperado_centavos: Number(t.total),
    };
  }

  function zerarVenda() {
    setChave(novaChaveIdempotencia());
    setCarrinho([]);
    setDesconto(null);
    setDescontoTocado(false);
    setPagamentos([]);
    setPagTocado([]);
    setDoc({ tipo: 'cpf', valor: '' });
    setDocTocado(false);
    setMostrarErros(false);
    setForaDaVenda([]);
    setTravada(false);
    setRecem(null);
    corpoEnviado.current = null;
  }

  function abrirCupom(id: string, detalhe?: CupomDetalhe) {
    if (detalhe) qc.setQueryData(CHAVES_CUPOM.cupom(id), detalhe);
    void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao });
    void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.ultimo });
    zerarVenda();
    setConferir({ aberto: false, fase: { fase: 'conferir' } });
    router.push(`/cupom/${id}`);
  }

  const enviar = (corpoFixo?: EmitirCupom) => semToqueDuplo(emCurso, async () => {
    const corpo = corpoFixo ?? montarCorpo();
    if (!corpo) return;
    corpoEnviado.current = corpo;
    setConferir({ aberto: true, fase: { fase: 'enviando' } });
    try {
      const c = await emitirCupom(corpo);
      abrirCupom(c.id, c);
    } catch (e) {
      const code = errCode(e);
      if (!falhaIncerta(statusDoErro(e), code)) {
        setConferir({ aberto: true, fase: { fase: 'erro', mensagem: errMsg(e), verEmitidos: code === 'NFCE_CHAVE_REUSADA' } });
        if (code === 'NFCE_TOTAL_MUDOU' || code === 'NFCE_ITEM_INDISPONIVEL') void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.produtos });
        void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao });
        return;
      }
      // UX 2.7: a venda trava e a tela procura UMA vez pela chave, só no nosso servidor (nunca emite nem fala com a SEFAZ)
      setTravada(true);
      setConferir({ aberto: true, fase: { fase: 'incerta', procurando: true } });
      try {
        const achados = await listarCupons({ chave_idempotencia: corpo.chave_idempotencia, limite: 1 });
        if (achados[0]) return abrirCupom(achados[0].id);
        setTravada(false);
        setConferir({ aberto: true, fase: { fase: 'nada' } });
      } catch {
        setConferir({ aberto: true, fase: { fase: 'incerta', procurando: false } });
      }
    }
  });

  // ---------------------------------------------------------------------------------------------------------------- resumo
  const resumo: ResumoConferir = {
    teste,
    itens: linhas.map((l) => ({ nome: l.nome, quantidade: l.quantidade, valor: l.valor })),
    desconto: descontoValido,
    total,
    pagamentos: pg.pagamentos,
    troco: pg.troco,
    documento: documentoDoPost(doc.tipo, doc.valor) ? { tipo: doc.tipo, valor: documentoDoPost(doc.tipo, doc.valor) as string } : null,
  };

  // ---------------------------------------------------------------------------------------------------------------- busca
  const achados = useMemo(() => buscarProdutos(produtos, termo), [produtos, termo]);
  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [produtos]);
  const daCategoria = useMemo(() => (categoria === null ? [] : produtos.filter((p) => p.categoria === categoria)), [produtos, categoria]);
  const noCupom = (id: string) => carrinho.find((l) => l.id === id)?.quantidade;
  const nProntos = achados.prontos.length + achados.mais;

  function teclaBusca(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((d) => Math.min(d + 1, Math.max(achados.prontos.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const p = achados.prontos[destaque] ?? achados.prontos[0];
      if (p) adicionar(p);
    } else if (e.key === 'Escape') { setTermo(''); setDestaque(0); }
  }

  // ---------------------------------------------------------------------------------------------------------------- telas
  const ultimo = ultimoQ.data?.[0];
  const ultimoRecente = ultimo && agora.getTime() - new Date(ultimo.criado_em).getTime() < TRINTA_MIN_MS ? ultimo : null;

  if (!situacao) {
    if (situacaoErro) {
      return (
        <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <p>Não consegui ver se a emissão está pronta. Toque em Tentar de novo.</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onTentarSituacao}>Tentar de novo</Button>
        </div>
      );
    }
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-11 w-full" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" />
      </div>
    );
  }

  const recemLinha = recem ? carrinho.find((l) => l.id === recem) : undefined;
  const pagUnico = pagamentos.length <= 1;
  const formaUnica = pagamentos[0]?.tPag;

  return (
    <div className="space-y-4 pb-32 md:pb-0">
      {ultimoRecente && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>
            Último cupom: nº {ultimoRecente.numero} · {reais(BigInt(ultimoRecente.valor_total_centavos))} · {horaSp(ultimoRecente.criado_em)} ·{' '}
            {tagDoCupom(ultimoRecente.situacao).texto}
          </span>
          <Link href={`/cupom/${ultimoRecente.id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ver</Link>
        </p>
      )}

      <CaixaDoTopo topo={topo} refTopo={refTopo} />
      {topo && !topo.formulario ? null : (
        <div className="min-w-0 space-y-4">
          {travada && (
            <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Para mudar a venda, primeiro toque em Tentar de novo.
            </p>
          )}
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            {/* ------------------------------------------------------------------------------------------- produtos */}
            <fieldset disabled={travada} aria-disabled={travada} className="min-w-0">
            <Panel title="Produtos" className="min-w-0">
              <div
                className="space-y-2"
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRecem(null); }}
              >
                <Label htmlFor="cupom-busca">Buscar produto</Label>
                <Input
                  id="cupom-busca" ref={refBusca} type="search" autoComplete="off" autoCorrect="off" spellCheck={false}
                  className="h-11" value={termo} onKeyDown={teclaBusca}
                  onChange={(e) => { setTermo(e.target.value); setDestaque(0); setCategoria(null); setVerCategorias(false); }}
                  aria-describedby="cupom-busca-dica"
                />
                <p id="cupom-busca-dica" className="hidden text-xs text-muted-foreground md:block">↓ ↑ escolhem · Enter adiciona · Esc limpa</p>
                <button
                  type="button" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
                  aria-expanded={verCategorias} onClick={() => { setVerCategorias((v) => !v); setCategoria(null); }}
                >
                  Ver por categoria
                </button>

                {recemLinha && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2 text-sm">
                    <span className="min-w-0 break-words">Acabou de entrar: {recemLinha.nome}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Diminuir ${recemLinha.nome}`}
                        disabled={!podeDiminuir(recemLinha.quantidade)} onClick={() => somar(recemLinha.id, -1)}><Minus className="h-4 w-4" aria-hidden /></Button>
                      <span className="min-w-8 text-center">{recemLinha.quantidade}</span>
                      <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Aumentar ${recemLinha.nome}`}
                        onClick={() => somar(recemLinha.id, 1)}><Plus className="h-4 w-4" aria-hidden /></Button>
                    </span>
                  </div>
                )}
                <p className="sr-only" aria-live="polite">{anuncio}</p>

                {verCategorias && categoria === null && (
                  <div className="flex flex-wrap gap-2">
                    {categorias.map((c) => (
                      <Button key={c} type="button" variant="outline" className="h-11" onClick={() => setCategoria(c)}>{c}</Button>
                    ))}
                  </div>
                )}

                {categoria !== null ? (
                  <Resultados
                    prontos={daCategoria.filter((p) => p.pronto)} fora={daCategoria.filter((p) => !p.pronto)} mais={0} destaque={-1}
                    noCupom={noCupom} onAdicionar={adicionar} titulo={`${categoria}:`}
                  />
                ) : termo.trim() !== '' ? (
                  <>
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                      {nProntos > 0 ? `${nProntos} ${plural(nProntos, 'produto encontrado', 'produtos encontrados')}.` : ''}
                    </p>
                    {achados.prontos.length === 0 && achados.fora.length === 0 ? (
                      <p className="text-sm">Nenhum produto com “{termo.trim()}”. Confira o nome ou veja por categoria.</p>
                    ) : (
                      <Resultados
                        prontos={achados.prontos} fora={achados.fora} mais={achados.mais} destaque={destaque} noCupom={noCupom}
                        onAdicionar={adicionar}
                      />
                    )}
                  </>
                ) : null}
              </div>

              {/* ------------------------------------------------------------------------------------------- carrinho */}
              <div className="mt-4 space-y-2">
                <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  No cupom ({carrinho.length} {plural(carrinho.length, 'item', 'itens')})
                </h3>
                <p className="text-xs text-muted-foreground">Preços do cardápio (Fichas Técnicas).</p>
                {foraDaVenda.length > 0 && (
                  <div role="status" className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    {foraDaVenda.map((t) => <p key={t}>{t}</p>)}
                  </div>
                )}
                {produtosQ.isPending ? (
                  <div className="space-y-2" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
                ) : produtosQ.isError && !produtosQ.data ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <p>Não consegui carregar os produtos. Toque em Tentar de novo.</p>
                    <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => produtosQ.refetch()}>Tentar de novo</Button>
                  </div>
                ) : produtos.every((p) => !p.pronto) ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <p>Nenhum produto está pronto para o cupom. Complete o NCM e o perfil fiscal na aba Produtos.</p>
                    <Button asChild variant="outline" className="h-11 w-full sm:w-auto"><Link href="/cupom?aba=produtos">Ir para Produtos</Link></Button>
                  </div>
                ) : carrinho.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum produto no cupom ainda. Busque acima.</p>
                ) : (
                  <ul className="divide-y">
                    {linhas.map((l) => (
                      <li key={l.id} className="space-y-1 py-2 outline-none" data-aviso-produto={l.motivo !== null || !l.qOk ? '' : undefined}
                        tabIndex={l.motivo !== null || !l.qOk ? -1 : undefined}>
                        <div className="flex justify-between gap-3">
                          <span className="min-w-0 break-words font-medium">{l.nome}</span>
                          <span className="shrink-0">{reais(l.valor)}</span>
                        </div>
                        {l.preco !== null && <p className="text-xs text-muted-foreground">{reais(l.preco)} cada</p>}
                        {l.mudou && l.precoVisto !== null && (
                          <p className="text-xs text-amber-500">Preço mudou: era {reais(l.precoVisto)}.</p>
                        )}
                        {l.motivo !== null && (
                          <p className="flex items-start gap-1 text-sm text-amber-500">
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <span>Não entra mais no cupom: {MOTIVO_NA_FRASE[l.motivo]}. Tire o produto ou complete o cadastro.</span>
                          </p>
                        )}
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Diminuir ${l.nome}`}
                            disabled={!podeDiminuir(l.quantidade)} onClick={() => somar(l.id, -1)}><Minus className="h-4 w-4" aria-hidden /></Button>
                          <Input
                            inputMode="decimal" className="h-11 w-20 text-center" value={l.quantidade} aria-label={`Quantidade de ${l.nome}`}
                            aria-invalid={l.erroQtd !== null} aria-describedby={l.erroQtd ? `qtd-erro-${l.id}` : undefined}
                            onChange={(e) => mudarQtd(l.id, e.target.value)} onBlur={() => conferirQtd(l.id)}
                          />
                          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Aumentar ${l.nome}`}
                            onClick={() => somar(l.id, 1)}><Plus className="h-4 w-4" aria-hidden /></Button>
                          <Button type="button" variant="ghost" className="ml-auto h-11" aria-label={`Tirar ${l.nome} do cupom`} onClick={() => tirar(l.id)}>Tirar</Button>
                        </div>
                        {l.erroQtd && <p id={`qtd-erro-${l.id}`} className="text-sm text-destructive">{l.erroQtd}</p>}
                      </li>
                    ))}
                  </ul>
                )}

                {/* desconto */}
                {carrinho.length > 0 && (desconto === null ? (
                  <button type="button" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
                    onClick={() => { setDesconto(''); setTimeout(() => refDesconto.current?.focus(), 0); }}>+ Dar desconto</button>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="cupom-desconto">Desconto (R$)</Label>
                    <div className="flex items-center gap-2">
                      <Input id="cupom-desconto" ref={refDesconto} inputMode="decimal" className="h-11 max-w-40" value={desconto}
                        aria-invalid={descontoTocado && erroDesconto !== null} aria-describedby={descontoTocado && erroDesconto ? 'cupom-desconto-erro' : undefined}
                        onChange={(e) => { setDesconto(e.target.value); setDescontoTocado(false); }} onBlur={() => setDescontoTocado(true)} />
                      <button type="button" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
                        onClick={() => { setDesconto(null); setDescontoTocado(false); }}>Tirar desconto</button>
                    </div>
                    {(descontoTocado || mostrarErros) && erroDesconto && <p id="cupom-desconto-erro" className="text-sm text-destructive">{erroDesconto}</p>}
                  </div>
                ))}

                {carrinho.length > 0 && (
                  <div className="space-y-0.5 pt-2 text-right text-sm">
                    <p>Produtos {reais(valorProdutos)}</p>
                    {descontoValido > 0n && <p>Desconto − {reais(descontoValido)}</p>}
                    <p className="text-2xl font-bold">Total {reais(total)}</p>
                    {acimaDoTeto && <p className="text-sm text-destructive">O total do cupom tem de ser menor que R$ 200.000,00.</p>}
                  </div>
                )}
              </div>
            </Panel>
            </fieldset>

            {/* --------------------------------------------------------------------------------------------- pagamento */}
            <div className="min-w-0 space-y-4">
              <fieldset disabled={travada} aria-disabled={travada} className="min-w-0 space-y-4">
              <Panel title="Pagamento" className="min-w-0">
                <div ref={refPagamento} className="space-y-3">
                  <p className="text-xs text-muted-foreground">Cobre aqui só o valor do cupom. A taxa de serviço ainda não entra no cupom.</p>
                  {pagUnico ? (
                    <>
                      <Formas valor={formaUnica} onEscolher={(t) => escolherForma(0, t)} rotulo="Forma de pagamento" />
                      {formaUnica && formaUnica !== '01' && <p className="text-sm">{NOME_PAGAMENTO[formaUnica]}: {reais(total)} (o total)</p>}
                      {formaUnica === '01' && (
                        <div className="space-y-2">
                          <Label htmlFor="cupom-recebido">Recebido em dinheiro (R$)</Label>
                          <Input id="cupom-recebido" inputMode="decimal" className="h-11" value={pagamentos[0]?.valor ?? ''}
                            placeholder={textoCentavos(total)}
                            aria-invalid={(pagTocado[0] || mostrarErros) && pg.erros[0] !== null}
                            aria-describedby={(pagTocado[0] || mostrarErros) && pg.erros[0] ? 'cupom-recebido-erro' : undefined}
                            onChange={(e) => mudarValor(0, e.target.value)} onBlur={() => tocarValor(0)} />
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" className="h-11" onClick={() => mudarValor(0, '')}>Valor certo</Button>
                            {atalhosDinheiro(total).map((v) => (
                              <Button key={String(v)} type="button" variant="outline" className="h-11" onClick={() => mudarValor(0, textoCentavos(v))}>
                                {reais(v).replace(/,00$/, '')}
                              </Button>
                            ))}
                          </div>
                          {(pagTocado[0] || mostrarErros) && pg.erros[0] && <p id="cupom-recebido-erro" className="text-sm text-destructive">{pg.erros[0]}</p>}
                          <p className="text-2xl font-semibold" aria-live="polite">Troco: {reais(pg.troco)}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <ul className="space-y-3">
                      {pagamentos.map((p, i) => (
                        <li key={i} className="space-y-2 rounded-lg border p-2">
                          <Formas valor={p.tPag} onEscolher={(t) => escolherForma(i, t)} rotulo={`Forma de pagamento ${i + 1}`} />
                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <Label htmlFor={`cupom-pag-${i}`}>Valor em {NOME_PAGAMENTO[p.tPag]} (R$)</Label>
                              <Input id={`cupom-pag-${i}`} inputMode="decimal" className="h-11"
                                value={p.auto ? textoCentavos(pg.valores[i] ?? 0n) : p.valor}
                                aria-invalid={(pagTocado[i] || mostrarErros) && pg.erros[i] !== null}
                                aria-describedby={(pagTocado[i] || mostrarErros) && pg.erros[i] ? `cupom-pag-${i}-erro` : undefined}
                                onChange={(e) => mudarValor(i, e.target.value)} onBlur={() => tocarValor(i)} />
                            </div>
                            <Button type="button" variant="ghost" className="h-11" aria-label={`Tirar ${NOME_PAGAMENTO[p.tPag]}`} onClick={() => tirarForma(i)}>Tirar</Button>
                          </div>
                          {(pagTocado[i] || mostrarErros) && pg.erros[i] && <p id={`cupom-pag-${i}-erro`} className="text-sm text-destructive">{pg.erros[i]}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!pagUnico && (
                    pg.falta > 0n
                      ? <p className="flex items-center gap-1 text-sm text-amber-500"><CircleAlert className="h-4 w-4" aria-hidden />Falta {reais(pg.falta)}</p>
                      : <p className="flex items-center gap-1 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Pago</p>
                  )}
                  {!pagUnico && pg.troco > 0n && <p className="text-2xl font-semibold" aria-live="polite">Troco: {reais(pg.troco)}</p>}
                  {(mostrarErros || pagTocado.some(Boolean)) && pg.erroGeral && <p className="text-sm text-destructive">{pg.erroGeral}</p>}
                  {pagamentos.length > 0 && pagamentos.length < FORMAS_DA_TELA.length && (
                    <button type="button" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2" onClick={pagarParte}>
                      + Pagar parte em outra forma
                    </button>
                  )}
                </div>
              </Panel>

              <Panel className="min-w-0">
                <div className="space-y-1">
                  <Label htmlFor="cupom-doc">
                    {obrigatorio ? 'CPF ou CNPJ na nota (obrigatório acima de R$ 10.000,00)' : doc.tipo === 'cpf' ? 'CPF na nota (opcional)' : 'CNPJ na nota (opcional)'}
                  </Label>
                  <Input
                    id="cupom-doc" ref={refDoc} className="h-11" autoComplete="off" value={doc.valor}
                    inputMode={doc.tipo === 'cpf' ? 'numeric' : 'text'} autoCapitalize={doc.tipo === 'cnpj' ? 'characters' : undefined}
                    placeholder={doc.tipo === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}
                    aria-invalid={(docTocado || mostrarErros) && erroDoc !== null}
                    aria-describedby={`cupom-doc-ajuda${(docTocado || mostrarErros) && erroDoc ? ' cupom-doc-erro' : ''}`}
                    onChange={(e) => { setDoc((d) => ({ ...d, valor: d.tipo === 'cpf' ? mascaraCpf(e.target.value) : mascaraCnpj(e.target.value) })); setDocTocado(false); }}
                    onBlur={() => setDocTocado(true)}
                  />
                  <button type="button" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2" onClick={trocarTipoDoc}>
                    {doc.tipo === 'cpf' ? 'É CNPJ?' : 'É CPF?'}
                  </button>
                  <p id="cupom-doc-ajuda" className="text-xs text-muted-foreground">Com CPF, o cliente também acha o cupom na Nota Fiscal Paulista.</p>
                  {(docTocado || mostrarErros) && erroDoc && <p id="cupom-doc-erro" className="text-sm text-destructive">{erroDoc}</p>}
                </div>
              </Panel>
              </fieldset>

              {/* computador: o bloco do botão no fim da coluna da direita (fora do fieldset: com a venda travada ele reabre o "não sei se saiu") */}
              <div className="hidden space-y-2 md:block">
                <p className="text-right text-sm">Total <span className="text-xl font-bold">{reais(total)}</span></p>
                {pg.troco > 0n && <p className="text-right text-sm">Troco {reais(pg.troco)}</p>}
                <Button ref={refBotao} type="button" className="h-12 w-full whitespace-normal aria-disabled:opacity-60"
                  aria-disabled={!travada && botao.alvo !== 'conferir'} onClick={tocarBotao}>
                  {travada ? 'Conferir e emitir' : botao.rotulo}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* celular: a barra fixa embaixo (fora do fieldset: com a venda travada ela reabre o "não sei se saiu") */}
      {(!topo || topo.formulario) && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold">{reais(total)}</p>
              {pg.troco > 0n && <p className="text-xs">Troco {reais(pg.troco)}</p>}
            </div>
            <Button ref={refBotaoFixo} type="button" className="ml-auto h-12 min-w-0 flex-1 whitespace-normal aria-disabled:opacity-60"
              aria-disabled={!travada && botao.alvo !== 'conferir'} onClick={tocarBotao}>
              {travada ? 'Conferir e emitir' : botao.rotulo}
            </Button>
          </div>
        </div>
      )}

      <ConferirSheet
        aberto={conferir.aberto}
        fase={conferir.fase}
        resumo={resumo}
        onEmitir={() => void enviar()}
        onTentarDeNovo={() => void enviar(corpoEnviado.current ?? undefined)}
        onVerEmitidos={() => {
          // no 409 NFCE_CHAVE_REUSADA o servidor já tem um cupom com esta chave: a venda é abandonada (sem isso, só recarregando);
          // no "não sei se saiu" a venda continua travada (a aba Emitir fica montada) para o "Tentar de novo" na volta
          if (conferir.fase.fase === 'erro' && conferir.fase.verEmitidos) zerarVenda();
          setConferir((c) => ({ ...c, aberto: false, fase: c.fase.fase === 'incerta' ? c.fase : { fase: 'conferir' } }));
          router.push('/cupom?aba=emitidos');
        }}
        onFechar={() => setConferir((c) => ({ ...c, aberto: false, fase: c.fase.fase === 'incerta' ? c.fase : { fase: 'conferir' } }))}
        onFechado={() => {
          const visivel = refBotaoFixo.current && refBotaoFixo.current.offsetParent !== null ? refBotaoFixo.current : refBotao.current;
          visivel?.focus();
        }}
      />
    </div>
  );
}

/** A caixa do alto da aba (UX 2.1). */
function CaixaDoTopo({ topo, refTopo }: { topo: ReturnType<typeof caixaDoTopo>; refTopo: React.RefObject<HTMLDivElement | null> }) {
  if (topo === null) return null;
  if (topo.linha === 1) {
    return (
      <div role="status" className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <p>A emissão de cupom fiscal não está ativada neste servidor. Você já pode cadastrar os dados fiscais dos produtos e da empresa; para ativar, fale com o suporte do Freela Comanda.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button asChild className="h-11 w-full sm:w-auto"><Link href="/cupom?aba=produtos">Preparar os produtos</Link></Button>
          <Link href="/configuracoes?aba=cupom" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Dados da empresa no cupom</Link>
        </div>
      </div>
    );
  }
  if (topo.linha === 2) {
    const primeiro = topo.falta[0];
    const link = primeiro ? linkDaFalta(primeiro.codigo) : null;
    return (
      <div role="status" className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Para emitir, falta:</p>
        <ul className="space-y-1">
          {topo.falta.map((f) => {
            const l = linkDaFalta(f.codigo);
            return (
              <li key={f.codigo} className="flex flex-wrap items-start gap-x-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{f.texto}</span>
                {l && <Link href={l.href} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">{l.rotulo}</Link>}
              </li>
            );
          })}
        </ul>
        {primeiro && link && (
          <Button asChild className="h-11 w-full whitespace-normal sm:w-auto"><Link href={link.href}>Completar: {primeiro.texto}</Link></Button>
        )}
      </div>
    );
  }
  if (topo.linha === 3) {
    return (
      <div role="status" className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <p>Tudo pronto. Ligue a emissão em Configurações → Cupom fiscal.</p>
        {topo.aviso && <p className="text-amber-500">{topo.aviso}</p>}
        <Button asChild className="h-11 w-full sm:w-auto"><Link href="/configuracoes?aba=cupom">Ligar a emissão</Link></Button>
      </div>
    );
  }
  return (
    <div
      ref={refTopo} tabIndex={-1} role={topo.tom === 'bad' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm outline-none sm:p-4',
        topo.tom === 'bad' ? 'border-destructive/30 bg-destructive/10' : 'border-amber-500/40 bg-amber-500/10')}
    >
      <CircleAlert className={cn('mt-0.5 h-4 w-4 shrink-0', topo.tom === 'bad' ? 'text-destructive' : 'text-amber-500')} aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="break-words">{topo.texto}</p>
        {topo.link && <Link href={topo.link.href} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">{topo.link.rotulo}</Link>}
      </div>
    </div>
  );
}

/** As 6 formas de pagamento como botões de escolha (UX 2.3): borda + ícone + texto no escolhido, nunca só cor; nenhuma vem marcada. */
function Formas({ valor, onEscolher, rotulo }: { valor: TPag | undefined; onEscolher(t: TPag): void; rotulo: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function tecla(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (passo === 0) return;
    e.preventDefault();
    const n = (i + passo + FORMAS_DA_TELA.length) % FORMAS_DA_TELA.length;
    onEscolher(FORMAS_DA_TELA[n]);
    refs.current[n]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={rotulo} className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      {FORMAS_DA_TELA.map((t, i) => {
        const marcado = valor === t;
        return (
          <button
            key={t} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={marcado}
            tabIndex={marcado || (valor === undefined && i === 0) ? 0 : -1}
            onClick={() => onEscolher(t)} onKeyDown={(e) => tecla(e, i)}
            className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-sm',
              marcado ? 'border-2 border-primary bg-primary/10 font-semibold' : 'border-input hover:bg-accent')}
          >
            {marcado && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />}
            <span className="break-words">{NOME_PAGAMENTO[t]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Resultados da busca (UX 2.2): a linha inteira é botão; os que não entram ficam no fim, em cinza, com "Completar". */
function Resultados({ prontos, fora, mais, destaque, noCupom, onAdicionar, titulo }: {
  prontos: ProdutoCupom[];
  fora: ProdutoCupom[];
  mais: number;
  destaque: number;
  noCupom(id: string): string | undefined;
  onAdicionar(p: ProdutoCupom): void;
  titulo?: string;
}) {
  return (
    <div className="space-y-2">
      {titulo && <p className="text-sm font-medium">{titulo}</p>}
      {prontos.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {prontos.map((p, i) => {
            const q = noCupom(p.item_cardapio_id);
            return (
              <li key={p.item_cardapio_id}>
                <button
                  type="button" onClick={() => onAdicionar(p)} data-destaque={i === destaque ? '' : undefined}
                  className={cn('flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent', i === destaque && 'bg-accent')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{p.nome}</span>
                    {q && <span className="block text-xs text-muted-foreground">{q} no cupom</span>}
                  </span>
                  <span className="shrink-0">{p.preco_venda_centavos === null ? '' : reais(BigInt(p.preco_venda_centavos))}</span>
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mais > 0 && <p className="text-sm text-muted-foreground">Mais {mais} {plural(mais, 'produto', 'produtos')}: continue digitando.</p>}
      {fora.length > 0 && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Não entram no cupom:</p>
          <ul className="space-y-1">
            {fora.map((p) => (
              <li key={p.item_cardapio_id} className="flex flex-wrap items-center gap-x-2">
                <span className="break-words">{p.nome} · {p.motivos[0] ? TAG_MOTIVO[p.motivos[0]] : TAG_MOTIVO.sem_preco}</span>
                <Link href={`/cupom?aba=produtos&item=${p.item_cardapio_id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Completar</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

