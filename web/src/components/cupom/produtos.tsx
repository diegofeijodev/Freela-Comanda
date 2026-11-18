'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import {
  cupomFiscal, emitenteCupom, perfilEmLoteCupom, perfisFiscais, produtosCupom, salvarProdutoCupom, type PerfilFiscal, type ProdutoCupom,
} from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import {
  CHAVES_CUPOM, contarProdutos, errosDoProduto, filtrarProdutos, formDoProduto, linhaFiscalDoProduto, mascaraCest, mascaraNcm, OPCOES_ORIGEM,
  produtoParaSalvar, reais, tagsDoProduto, type FiltroProdutos, type FormProduto,
} from '@/lib/cupom';
import { semToqueDuplo } from '@/lib/notas-sefaz';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CHAVE_EMITENTE, CHAVE_PERFIS, Perfis, SEM_X } from './perfis';

const SELECT = 'h-11 w-full rounded-md border bg-background px-3 text-sm';
const ERRO_CAIXA = 'flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm';

function Tags({ p }: { p: ProdutoCupom }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tagsDoProduto(p).map((t) => (
        <Tag key={t.texto} tone={t.tom}>
          {t.tom === 'ok' ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />}
          {t.texto}
        </Tag>
      ))}
    </span>
  );
}

/**
 * Aba Produtos (UX 5.6 e 5.7): os perfis fiscais no alto e os dados do cupom de cada produto ativo do cardápio (filtros "Faltam dados",
 * "Prontos" e "Todos", busca e categoria); vindo de um cupom recusado (`cupomId`), só os produtos dele. "Escolher vários" aplica um perfil
 * a vários de uma vez (uma chamada, numa transação). A folha do produto abre pelo cartão, pelo "Editar" ou por `?item=<id>`.
 */
export function Produtos({ itemInicial, cupomId }: { itemInicial: string | null; cupomId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const produtosQ = useQuery({ queryKey: CHAVES_CUPOM.produtos, queryFn: () => produtosCupom() });
  const perfisQ = useQuery({ queryKey: CHAVE_PERFIS, queryFn: perfisFiscais });
  const emitenteQ = useQuery({ queryKey: CHAVE_EMITENTE, queryFn: emitenteCupom });
  const cupomQ = useQuery({ queryKey: CHAVES_CUPOM.cupom(cupomId ?? ''), queryFn: () => cupomFiscal(cupomId!), enabled: cupomId !== null });

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroProdutos | null>(cupomId ? 'todos' : null);
  const [categoria, setCategoria] = useState('');
  const [escolhendo, setEscolhendo] = useState(false);
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [aplicar, setAplicar] = useState(false);
  const [aberto, setAberto] = useState<string | null>(itemInicial);

  const produtos = useMemo(() => produtosQ.data ?? [], [produtosQ.data]);
  const contagem = contarProdutos(produtos);
  const filtroAtual: FiltroProdutos = filtro ?? (contagem.faltam > 0 ? 'faltam' : 'todos');
  const so = cupomId && cupomQ.data
    ? cupomQ.data.itens.map((i) => i.item_cardapio_id).filter((x): x is string => x !== null)
    : null;
  const categorias = [...new Set(produtos.filter((p) => p.ativo).map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const lista = filtrarProdutos(produtos, { busca, filtro: filtroAtual, categoria: categoria || null, so });
  const perfisAtivos = (perfisQ.data ?? []).filter((p) => p.ativo);
  const produtoAberto = aberto ? produtos.find((p) => p.item_cardapio_id === aberto) ?? null : null;

  // `?item=<id>` abre a folha; ao fechar, o parâmetro sai da URL (voltar não reabre)
  useEffect(() => { if (itemInicial) setAberto(itemInicial); }, [itemInicial]);
  const fecharFolha = () => {
    setAberto(null);
    if (params.get('item')) {
      const q = new URLSearchParams(params.toString());
      q.delete('item');
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    }
  };
  const verTodos = () => router.replace('/cupom?aba=produtos', { scroll: false });

  const marcar = (id: string, sim: boolean) => setEscolhidos((s) => { const n = new Set(s); if (sim) n.add(id); else n.delete(id); return n; });
  const pararDeEscolher = () => { setEscolhendo(false); setEscolhidos(new Set()); };

  const BOTOES: { v: FiltroProdutos; texto: string }[] = [
    { v: 'faltam', texto: `Faltam dados (${contagem.faltam})` },
    { v: 'prontos', texto: `Prontos (${contagem.prontos})` },
    { v: 'todos', texto: `Todos (${contagem.todos})` },
  ];

  return (
    <div className="space-y-4">
      <Perfis
        perfis={perfisQ.data} crt={emitenteQ.data ? emitenteQ.data.crt : undefined}
        carregando={perfisQ.isPending} erro={perfisQ.isError} onTentar={() => void perfisQ.refetch()}
      />

      {cupomId && (
        <div className="flex flex-wrap items-center gap-x-3 text-sm">
          <span>{cupomQ.data ? `Produtos do cupom nº ${cupomQ.data.numero}` : cupomQ.isError ? 'Não consegui ver os produtos deste cupom.' : 'Produtos do cupom…'}</span>
          <button type="button" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2" onClick={verTodos}>Ver todos</button>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="produtos-busca">Buscar produto</Label>
          <Input id="produtos-busca" type="search" className="h-11 sm:max-w-sm" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
        </div>
        <div role="group" aria-label="Situação dos produtos" className="flex flex-wrap gap-2">
          {BOTOES.map((b) => (
            <Button
              key={b.v} type="button" variant={filtroAtual === b.v ? 'default' : 'outline'} aria-pressed={filtroAtual === b.v}
              className="h-auto min-h-11 whitespace-normal" onClick={() => setFiltro(b.v)}
            >
              {b.texto}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="produtos-categoria">Categoria</Label>
            <select id="produtos-categoria" className={cn(SELECT, 'sm:w-56')} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Button
            type="button" variant="outline" className="h-11 w-full sm:w-auto" aria-pressed={escolhendo}
            onClick={() => (escolhendo ? pararDeEscolher() : setEscolhendo(true))}
          >
            {escolhendo ? 'Parar de escolher' : 'Escolher vários'}
          </Button>
        </div>
      </div>

      {produtosQ.isPending || (cupomId !== null && cupomQ.isPending) ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : produtosQ.isError ? (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p>Não consegui ver os produtos agora. Toque em Tentar de novo.</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void produtosQ.refetch()}>Tentar de novo</Button>
        </div>
      ) : contagem.todos === 0 && !so ? (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p>O cardápio não tem produtos ativos. Cadastre em Fichas Técnicas.</p>
          <Button asChild variant="outline" className="h-11 w-full sm:w-auto"><Link href="/fichas">Ir para Fichas Técnicas</Link></Button>
        </div>
      ) : lista.length === 0 ? (
        filtroAtual === 'faltam' && busca.trim() === '' && !categoria && !so ? (
          <p className="flex items-center gap-2 rounded-lg border p-4 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />Tudo certo: todos os produtos estão prontos para o cupom.
          </p>
        ) : (
          <p className="rounded-lg border p-4 text-sm">Nenhum produto com este filtro.</p>
        )
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {lista.map((p) => (
              <li key={p.item_cardapio_id} className="flex items-stretch gap-2">
                {escolhendo && (
                  <label className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`Escolher ${p.nome}`}>
                    <Checkbox checked={escolhidos.has(p.item_cardapio_id)} onCheckedChange={(v) => marcar(p.item_cardapio_id, v === true)} />
                  </label>
                )}
                <button
                  type="button" className="block min-h-11 w-full min-w-0 rounded-xl border bg-card p-4 text-left hover:bg-muted/40"
                  onClick={() => setAberto(p.item_cardapio_id)}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">{p.nome}</span>
                    <span className="shrink-0">{p.preco_venda_centavos !== null ? reais(BigInt(p.preco_venda_centavos)) : '—'}</span>
                  </span>
                  <span className="block text-sm text-muted-foreground">{p.categoria}</span>
                  {linhaFiscalDoProduto(p) && <span className="block text-sm">{linhaFiscalDoProduto(p)}</span>}
                  <span className="mt-1 block"><Tags p={p} /></span>
                </button>
              </li>
            ))}
          </ul>
          {/* `relative`: o `sr-only` (absolute) do cabeçalho fica dentro da rolagem da tabela, sem rolar a página (visto em 768 px) */}
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-sm text-muted-foreground">
                <tr>
                  {escolhendo && <th scope="col" className="w-12 py-2"><span className="sr-only">Escolher</span></th>}
                  <th scope="col" className="py-2 pr-3">Produto</th>
                  <th scope="col" className="pr-3">Categoria</th>
                  <th scope="col" className="pr-3 text-right">Preço</th>
                  <th scope="col" className="pr-3">NCM</th>
                  <th scope="col" className="pr-3">Perfil</th>
                  <th scope="col" className="pr-3">Situação</th>
                  <th scope="col"><span className="sr-only">Editar</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.item_cardapio_id} className="border-t align-top">
                    {escolhendo && (
                      <td className="py-1">
                        <label className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`Escolher ${p.nome}`}>
                          <Checkbox checked={escolhidos.has(p.item_cardapio_id)} onCheckedChange={(v) => marcar(p.item_cardapio_id, v === true)} />
                        </label>
                      </td>
                    )}
                    <td className="py-2 pr-3 font-medium">{p.nome}</td>
                    <td className="py-2 pr-3">{p.categoria}</td>
                    <td className="py-2 pr-3 text-right">{p.preco_venda_centavos !== null ? reais(BigInt(p.preco_venda_centavos)) : '—'}</td>
                    <td className="py-2 pr-3">{p.ncm ? mascaraNcm(p.ncm) : '—'}</td>
                    <td className="py-2 pr-3">{p.perfil_nome ?? '—'}</td>
                    <td className="py-2 pr-3"><Tags p={p} /></td>
                    <td className="py-1 text-right">
                      <Button variant="ghost" className="h-11 text-primary" aria-label={`Editar ${p.nome}`} onClick={() => setAberto(p.item_cardapio_id)}>Editar</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {escolhendo && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur" role="region" aria-label="Produtos escolhidos">
          <span className="text-sm" aria-live="polite">{escolhidos.size} {escolhidos.size === 1 ? 'escolhido' : 'escolhidos'}</span>
          <Button className="h-11" disabled={escolhidos.size === 0} onClick={() => setAplicar(true)}>Aplicar perfil…</Button>
          <Button variant="outline" className="h-11" onClick={pararDeEscolher}>Cancelar</Button>
        </div>
      )}

      {aplicar && (
        <AplicarPerfil
          ids={[...escolhidos]} perfis={perfisAtivos}
          onFechar={() => setAplicar(false)}
          onFeito={() => { setAplicar(false); pararDeEscolher(); }}
        />
      )}

      {produtoAberto && (
        <FolhaProduto
          key={produtoAberto.item_cardapio_id} produto={produtoAberto} perfis={perfisQ.data ?? []} onFechar={fecharFolha}
          onSalvo={(novo) => {
            qc.setQueryData<ProdutoCupom[]>(CHAVES_CUPOM.produtos, (xs) => xs?.map((x) => (x.item_cardapio_id === novo.item_cardapio_id ? novo : x)));
            void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao });
            void qc.invalidateQueries({ queryKey: CHAVE_PERFIS });
          }}
        />
      )}
    </div>
  );
}

/** "Aplicar perfil…" (UX 5.7): o perfil num `select` e "Aplicar a 3 produtos" (uma chamada, numa transação). */
function AplicarPerfil({ ids, perfis, onFechar, onFeito }: { ids: string[]; perfis: PerfilFiscal[]; onFechar(): void; onFeito(): void }) {
  const qc = useQueryClient();
  const [perfil, setPerfil] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const n = ids.length;

  const aplicar = () => semToqueDuplo(emCurso, async () => {
    if (!perfil) return setAviso('Escolha o perfil fiscal.');
    setAviso(null);
    setErro(null);
    setOcupado(true);
    try {
      const r = await perfilEmLoteCupom(ids, perfil);
      await Promise.all([
        qc.invalidateQueries({ queryKey: CHAVES_CUPOM.produtos }),
        qc.invalidateQueries({ queryKey: CHAVE_PERFIS }),
        qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao }),
      ]);
      toast.success(`Perfil “${r.perfil_nome}” aplicado a ${r.atualizados} ${r.atualizados === 1 ? 'produto' : 'produtos'}.`);
      onFeito();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !ocupado) onFechar(); }}>
      <DialogContent className={SEM_X}>
        <DialogTitle>Aplicar perfil</DialogTitle>
        <DialogDescription>O perfil escolhido vale para {n} {n === 1 ? 'produto' : 'produtos'}.</DialogDescription>
        <div className="space-y-3">
          {erro && <div role="alert" className={ERRO_CAIXA}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /><span className="min-w-0 break-words">{erro}</span></div>}
          <div className="space-y-1">
            <Label htmlFor="lote-perfil">Perfil fiscal</Label>
            <select id="lote-perfil" className={SELECT} value={perfil} aria-describedby={aviso ? 'lote-perfil-erro' : undefined} onChange={(e) => setPerfil(e.target.value)}>
              <option value="">Escolha o perfil</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            {aviso && <p id="lote-perfil-erro" className="text-sm text-destructive">{aviso}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button className="h-11" disabled={ocupado} onClick={() => void aplicar()}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Aplicando…</> : `Aplicar a ${n} ${n === 1 ? 'produto' : 'produtos'}`}
            </Button>
            <Button variant="outline" className="h-11" disabled={ocupado} onClick={onFechar}>Voltar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A folha do produto (UX 5.7; título "Espetinho de carne: dados do cupom"): o preço só de leitura (muda na ficha técnica), NCM com máscara
 * e o perfil; "Mais dados (opcional)" com CEST, GTIN, origem, nome e unidade no cupom. Manda só o que mudou; erro do servidor em caixa
 * vermelha com o foco nela.
 */
function FolhaProduto({ produto: p, perfis, onFechar, onSalvo }: {
  produto: ProdutoCupom;
  perfis: PerfilFiscal[];
  onFechar(): void;
  onSalvo(p: ProdutoCupom): void;
}) {
  const celular = useIsMobile();
  const [f, setF] = useState<FormProduto>(() => formDoProduto(p));
  const [tocados, setTocados] = useState<Set<keyof FormProduto>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const erros = errosDoProduto(f);
  const ver = (k: keyof FormProduto) => (tocados.has(k) ? erros[k] : undefined);
  const tocar = (k: keyof FormProduto) => setTocados((t) => new Set(t).add(k));
  const mudar = (k: keyof FormProduto, v: string) => setF((x) => ({ ...x, [k]: v }));
  const maisAberto = useRef<HTMLDetailsElement>(null);
  // o perfil atual pode estar desativado: fica na lista (desabilitado) para o valor aparecer
  const opcoesPerfil = perfis.filter((x) => x.ativo || x.id === p.perfil_fiscal_id);

  useEffect(() => { if (erro) caixa.current?.focus(); }, [erro]);

  const salvar = () => semToqueDuplo(emCurso, async () => {
    const todos = Object.keys(erros) as (keyof FormProduto)[];
    if (todos.length > 0) {
      setTocados(new Set(todos));
      if (todos.some((k) => k !== 'ncm') && maisAberto.current) maisAberto.current.open = true;
      document.getElementById(`produto-${todos[0]}`)?.focus();
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const corpo = produtoParaSalvar(p, f);
      const novo = Object.keys(corpo).length === 0 ? p : await salvarProdutoCupom(p.item_cardapio_id, corpo);
      onSalvo(novo);
      toast.success(`Dados de ${p.nome} salvos.`);
      onFechar();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  const campoTexto = (k: keyof FormProduto, rotulo: string, ajuda: string | null, extra: Partial<React.ComponentProps<typeof Input>> = {}, mascara?: (s: string) => string) => (
    <div className="space-y-1">
      <Label htmlFor={`produto-${k}`}>{rotulo}</Label>
      <Input
        id={`produto-${k}`} className="h-11" value={f[k]} autoComplete="off" aria-invalid={ver(k) ? true : undefined}
        aria-describedby={[ajuda ? `produto-${k}-ajuda` : null, ver(k) ? `produto-${k}-erro` : null].filter(Boolean).join(' ') || undefined}
        onChange={(e) => mudar(k, mascara ? mascara(e.target.value) : e.target.value)} onBlur={() => tocar(k)} {...extra}
      />
      {ajuda && <p id={`produto-${k}-ajuda`} className="text-sm text-muted-foreground">{ajuda}</p>}
      {ver(k) && <p id={`produto-${k}-erro`} className="text-sm text-destructive">{ver(k)}</p>}
    </div>
  );

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !ocupado) onFechar(); }}>
      <SheetContent
        side={celular ? 'bottom' : 'right'}
        className={cn('overflow-y-auto p-4', SEM_X, celular ? 'max-h-[90dvh] rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]' : 'w-full sm:max-w-md')}
      >
        <SheetTitle className="break-words">{p.nome}: dados do cupom</SheetTitle>
        <SheetDescription asChild>
          {p.preco_venda_centavos !== null ? (
            <p className="text-sm text-muted-foreground">Preço de venda {reais(BigInt(p.preco_venda_centavos))} (muda na ficha técnica)</p>
          ) : (
            <p className="text-sm">
              Sem preço de venda: preencha na ficha técnica.{' '}
              <Link href={`/fichas/${p.item_cardapio_id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Abrir a ficha</Link>
            </p>
          )}
        </SheetDescription>
        <form className="mt-4 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          {erro && <div ref={caixa} tabIndex={-1} role="alert" className={ERRO_CAIXA}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /><span className="min-w-0 break-words">{erro}</span></div>}
          {campoTexto('ncm', 'NCM', 'Código de 8 números que classifica o produto. O contador informa.', { inputMode: 'numeric', placeholder: '0000.00.00' }, mascaraNcm)}
          <div className="space-y-1">
            <Label htmlFor="produto-perfil_fiscal_id">Perfil fiscal</Label>
            <select
              id="produto-perfil_fiscal_id" className={SELECT} value={f.perfil_fiscal_id} aria-describedby="produto-perfil_fiscal_id-ajuda"
              onChange={(e) => mudar('perfil_fiscal_id', e.target.value)}
            >
              <option value="">Sem perfil</option>
              {opcoesPerfil.map((x) => <option key={x.id} value={x.id} disabled={!x.ativo}>{x.ativo ? x.nome : `${x.nome} (desativado)`}</option>)}
            </select>
            <p id="produto-perfil_fiscal_id-ajuda" className="text-sm text-muted-foreground">
              Os códigos de imposto do produto. Se nenhum serve, feche e toque em + Novo perfil, no alto desta aba.
            </p>
          </div>
          <details ref={maisAberto} className="rounded-lg border p-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm">Mais dados (opcional)</summary>
            <div className="mt-2 space-y-4">
              {campoTexto('cest', 'CEST', 'Só para produto com imposto já pago antes (substituição tributária), como bebidas. O contador informa.', { inputMode: 'numeric', placeholder: '00.000.00' }, mascaraCest)}
              {campoTexto('gtin', 'Código de barras (GTIN)', 'Os números sob o código de barras da embalagem. Prato da casa não tem: deixe vazio.', { inputMode: 'numeric' })}
              <div className="space-y-1">
                <Label htmlFor="produto-origem">Origem</Label>
                <select id="produto-origem" className={SELECT} value={f.origem} aria-describedby="produto-origem-ajuda" onChange={(e) => mudar('origem', e.target.value)}>
                  {OPCOES_ORIGEM.map((o) => <option key={o.codigo} value={o.codigo}>{o.texto}</option>)}
                </select>
                <p id="produto-origem-ajuda" className="text-sm text-muted-foreground">Quase sempre 0 (nacional). Mude só se o contador pedir.</p>
              </div>
              {campoTexto('descricao_cupom', 'Nome no cupom', `Vazio = o nome do cardápio (${p.nome}).`)}
              {campoTexto('unidade', 'Unidade no cupom', `Vazio = a unidade de venda da ficha (${p.unidade_venda}).`)}
            </div>
          </details>
          <div className="flex flex-col gap-2 pt-2">
            <Button type="submit" className="h-11 w-full" disabled={ocupado}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Salvando…</> : 'Salvar dados do cupom'}
            </Button>
            <Button type="button" variant="outline" className="h-11 w-full" disabled={ocupado} onClick={onFechar}>Fechar</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
