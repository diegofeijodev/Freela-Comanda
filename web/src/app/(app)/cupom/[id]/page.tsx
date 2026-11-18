'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import {
  consultarCupom, cupomFiscal, danfeCupom, lancarVendaCupom, reenviarCupom, situacaoCupomFiscal, xmlCupom, type CupomDetalhe,
} from '@/lib/erp-api';
import { errCode, errMsg } from '@/lib/db';
import { useMe } from '@/lib/auth';
import {
  caixaDoCupom, caixaDoTopo, CHAVES_CUPOM, documentoFormatado, linhaPrazoCancelar, linhasConferir, linkDoAtalho, NOME_PAGAMENTO, nomeDoArquivo,
  nomesDosPagamentos, quandoSp, quantidadeParaTela, reais, tagDoCupom, textoTentativa, toastDaConsulta, vendaDoCupom, type IconeCupom,
  type TPag,
} from '@/lib/cupom';
import { horaSp, semToqueDuplo } from '@/lib/notas-sefaz';
import { Empty, Panel, Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DanfePapel, QrDoCupom } from '@/components/cupom/danfe';
import { CancelarDialog } from '@/components/cupom/cancelar-dialog';
import { DescartarDialog } from '@/components/cupom/descartar-dialog';
import { cn } from '@/lib/utils';

const ENVIANDO_ATE_MS = 120_000;
const MAX_ENVIOS = 3;
const semPonto = (s: string) => s.trim().replace(/[\s.]+$/u, '');
const CAIXA: Record<'ok' | 'warn' | 'bad' | 'muted', string> = {
  ok: 'border-success/30 bg-success/10',
  warn: 'border-amber-500/40 bg-amber-500/10',
  bad: 'border-destructive/30 bg-destructive/10',
  muted: 'border-border bg-muted/40',
};
const LINK = 'inline-flex min-h-11 items-center text-primary underline underline-offset-2';

function IconeTag({ icone }: { icone: IconeCupom }) {
  if (icone === 'ok') return <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />;
  if (icone === 'alerta') return <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />;
  if (icone === 'carregando') return <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />;
  if (icone === 'ban') return <Ban className="mr-1 h-3.5 w-3.5" aria-hidden />;
  return null;
}

/**
 * O cupom (UX 3): a situação (tag + caixa), as ações que o servidor permite (`acoes`), a venda no estoque, o DANFE (só autorizado) ou o
 * "Resumo da venda", e os diálogos de cancelar e descartar. As horas vêm do servidor (`agora`, `consultar_a_partir_de`, `cancelar_ate`); a
 * contagem é só local e nunca dispara nada sozinha. Em `enviando`, relê o cupom (só o nosso servidor) a cada 5 s, até 2 min.
 */
export default function CupomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = me?.perfil === 'admin';
  const inicio = useRef(Date.now());
  const cupomQ = useQuery({
    queryKey: CHAVES_CUPOM.cupom(id),
    queryFn: () => cupomFiscal(id),
    enabled: admin,
    retry: (n, e) => errCode(e) !== 'NOT_FOUND' && n < 1,
    refetchInterval: (q) => (q.state.data?.situacao === 'enviando' && Date.now() - inicio.current < ENVIANDO_ATE_MS ? 5_000 : false),
  });
  const c = cupomQ.data;
  const situacaoQ = useQuery({ queryKey: CHAVES_CUPOM.situacao, queryFn: situacaoCupomFiscal, enabled: admin });
  const danfeQ = useQuery({ queryKey: CHAVES_CUPOM.danfe(id), queryFn: () => danfeCupom(id), enabled: admin && c?.situacao === 'autorizado' });

  // relógio do servidor, andando aqui (o celular com o relógio errado não habilita nada antes da hora)
  const [desvio, setDesvio] = useState(0);
  const [, setTique] = useState(0);
  const chegouEm = cupomQ.dataUpdatedAt;
  useEffect(() => { if (c && chegouEm > 0) setDesvio(new Date(c.agora).getTime() - chegouEm); }, [c, chegouEm]);
  useEffect(() => {
    const t = setInterval(() => setTique((x) => x + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  const agora = new Date(Date.now() + desvio);

  const [ocupado, setOcupado] = useState<'consultar' | 'reenviar' | 'lancar' | 'xml' | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [erroVenda, setErroVenda] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<'cancelar' | 'descartar' | 'qr' | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const emCurso = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const focou = useRef(false);
  const podiaConsultar = useRef<boolean | null>(null);
  const marcoPrazo = useRef<'longe' | '5' | '1' | 'fim' | null>(null);

  // ao chegar (também do envio), o foco vai para o título
  useEffect(() => {
    if (c && !focou.current) { focou.current = true; titulo.current?.focus(); }
  }, [c]);

  const consultarAPartir = c?.consultar_a_partir_de ? new Date(c.consultar_a_partir_de) : null;
  const podeConsultar = !!c && c.acoes.includes('consultar') && (consultarAPartir === null || consultarAPartir.getTime() <= agora.getTime());
  const prazo = c?.situacao === 'autorizado' && c.cancelar_ate ? linhaPrazoCancelar(c.cancelar_ate, agora, 'curto') : null;

  // anúncios só nos marcos: "Já pode consultar." e o prazo do cancelamento faltando 5 min e 1 min (UX 3.1; WCAG 4.1.3)
  useEffect(() => {
    if (!c) return;
    if (podiaConsultar.current === false && podeConsultar) setAnuncio('Já pode consultar.');
    podiaConsultar.current = c.acoes.includes('consultar') ? podeConsultar : null;
  }, [c, podeConsultar]);
  const cancelarAte = c?.situacao === 'autorizado' ? c.cancelar_ate : null;
  const agoraMs = agora.getTime();
  useEffect(() => {
    if (!cancelarAte) return;
    const resta = new Date(cancelarAte).getTime() - agoraMs;
    const m = resta <= 0 ? 'fim' : resta <= 60_000 ? '1' : resta <= 5 * 60_000 ? '5' : 'longe';
    if (marcoPrazo.current !== null && m !== marcoPrazo.current) {
      if (m === '5') setAnuncio('Faltam 5 minutos para o prazo de cancelar.');
      else if (m === '1') setAnuncio('Falta 1 minuto para o prazo de cancelar.');
      else if (m === 'fim') setAnuncio(`O prazo para cancelar terminou às ${horaSp(cancelarAte)}.`);
    }
    marcoPrazo.current = m;
  }, [cancelarAte, agoraMs]);

  if (me && !admin) return <Empty>Acesso negado.</Empty>;
  if (!c) {
    if (cupomQ.isError) {
      const naoAchou = errCode(cupomQ.error) === 'NOT_FOUND';
      return (
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <p>{naoAchou ? 'Não achei este cupom.' : 'Não consegui ver o cupom agora. Toque em Tentar de novo.'}</p>
          {naoAchou
            ? <Button asChild variant="outline" className="h-11 w-full sm:w-auto"><Link href="/cupom?aba=emitidos">Ver cupons emitidos</Link></Button>
            : <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => cupomQ.refetch()}>Tentar de novo</Button>}
        </div>
      );
    }
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-72 max-w-full" /><Skeleton className="h-64 w-full max-w-[80mm]" />
      </div>
    );
  }

  const cupom = c;
  const tag = tagDoCupom(cupom.situacao);
  const caixa = caixaDoCupom(cupom);
  const teste = cupom.ambiente === 'homologacao';
  const s = situacaoQ.data;
  const topo = s ? caixaDoTopo(s, agora) : null;
  const envioBarrado = topo && topo.formulario ? topo.texto : null;
  const reenviavel = ['nao_enviado', 'nao_consta', 'rejeitado'].includes(cupom.situacao);
  const atalho = linkDoAtalho(cupom.atalho, cupom.id, cupom.ambiente);
  const botaoDoAtalho = atalho && (atalho.primario
    ? <Button asChild className="h-11 w-full sm:w-auto"><Link href={atalho.href}>{atalho.rotulo}</Link></Button>
    : <Link href={atalho.href} className={LINK}>{atalho.rotulo}</Link>);
  const esgotou = reenviavel && cupom.numero_reaproveitavel && cupom.envios >= MAX_ENVIOS;

  function atualizar(r: CupomDetalhe) {
    qc.setQueryData(CHAVES_CUPOM.cupom(id), r);
    void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao });
    void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.ultimo });
    if (r.situacao === 'autorizado') void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.danfe(id) });
  }

  const acao = (nome: 'consultar' | 'reenviar' | 'lancar', fazer: () => Promise<void>) => semToqueDuplo(emCurso, async () => {
    setOcupado(nome);
    setErroAcao(null);
    try {
      await fazer();
    } catch (e) {
      if (nome === 'lancar') setErroVenda(errMsg(e));
      else setErroAcao(errMsg(e));
    } finally {
      setOcupado(null);
    }
  });
  const consultar = () => acao('consultar', async () => {
    const antes = cupom.situacao;
    const r = await consultarCupom(id);
    atualizar(r);
    const t = toastDaConsulta(antes, r);
    if (t) toast(t);
  });
  const reenviar = () => acao('reenviar', async () => atualizar(await reenviarCupom(id)));
  const lancar = () => acao('lancar', async () => {
    setErroVenda(null);
    const r = await lancarVendaCupom(id);
    atualizar(r);
    if (r.venda_estoque === 'lancada') toast.success('Venda lançada no estoque.');
    else if (r.venda_estoque === 'desfeita') toast.success('Venda tirada do estoque.');
  });

  async function baixar(tipo: 'nota' | 'cancelamento') {
    setOcupado('xml');
    setErroAcao(null);
    try {
      const xml = await xmlCupom(id, tipo);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([xml], { type: 'text/xml;charset=utf-8' }));
      a.download = nomeDoArquivo(tipo, cupom.serie, cupom.numero);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
    } catch (e) {
      setErroAcao(errMsg(e));
    } finally {
      setOcupado(null);
    }
  }
  async function copiarChave() {
    try {
      await navigator.clipboard.writeText(cupom.chave);
      toast.success('Chave copiada.');
    } catch {
      setErroAcao('Não consegui copiar agora. A chave está no cupom, em "Consulte pela Chave de Acesso".');
    }
  }
  async function compartilhar() {
    const url = danfeQ.data?.qrCode;
    if (!url) return;
    const fantasia = danfeQ.data?.emit.xFant ?? danfeQ.data?.emit.xNome ?? '';
    const dados = {
      title: `Cupom fiscal nº ${cupom.numero}`,
      text: `Seu cupom fiscal de ${fantasia} (${reais(BigInt(cupom.valor_total_centavos))}):`,
      url,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(dados);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link do cupom copiado.');
    } catch {
      setErroAcao('Não consegui copiar o link agora.');
    }
  }
  function refazer() {
    qc.setQueryData(CHAVES_CUPOM.refazer, vendaDoCupom(cupom));
    router.push('/cupom?aba=emitir');
  }
  function aposCancelar(r: CupomDetalhe) {
    atualizar(r);
    if (r.situacao === 'cancelado') {
      setDialogo(null);
      toast.success(`Cupom nº ${r.numero} cancelado na SEFAZ.`);
    } else if (r.situacao === 'cancelando') setDialogo(null);
  }

  // ------------------------------------------------------------------------------------------------------------ ações por situação
  const botaoConsultar = (rotulo: string, primario: boolean) => (
    <div className="space-y-1">
      <Button
        variant={primario ? 'default' : 'outline'} className="h-11 w-full whitespace-normal sm:w-auto aria-disabled:opacity-60"
        aria-disabled={!podeConsultar || ocupado !== null} disabled={ocupado === 'consultar'}
        onClick={() => { if (podeConsultar && ocupado === null) void consultar(); }}
      >
        {ocupado === 'consultar' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Consultando…</> : rotulo}
      </Button>
      {!podeConsultar && consultarAPartir && <p className="text-xs text-muted-foreground">Disponível às {horaSp(consultarAPartir.toISOString())}.</p>}
    </div>
  );
  const botaoReenviar = (primario: boolean) => (
    <div className="space-y-1">
      <Button
        variant={primario ? 'default' : 'outline'} className="h-11 w-full whitespace-normal sm:w-auto aria-disabled:opacity-60"
        aria-disabled={envioBarrado !== null || ocupado !== null} disabled={ocupado === 'reenviar'}
        onClick={() => { if (envioBarrado === null && ocupado === null) void reenviar(); }}
      >
        {ocupado === 'reenviar' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Enviando à SEFAZ…</> : 'Enviar de novo'}
      </Button>
      <p className="text-xs text-muted-foreground">{textoTentativa(cupom.envios)}</p>
      {envioBarrado
        ? <p className="text-xs text-amber-500">{envioBarrado}</p>
        : (
          <p className="text-xs text-muted-foreground">
            Envia o mesmo cupom, com o mesmo número e a hora nova, relendo os dados fiscais dos produtos. Os itens, os preços e o pagamento não
            mudam. Para mudar a venda: Descartar e Refazer com estes itens.
          </p>
        )}
    </div>
  );
  const botaoDescartar = (primario: boolean) => (
    <Button variant={primario ? 'default' : 'outline'} className="h-11 w-full sm:w-auto" disabled={ocupado !== null} onClick={() => setDialogo('descartar')}>
      Descartar…
    </Button>
  );
  const maisOpcoes = (itens: ReactNode) => (
    <details className="no-print rounded-lg border px-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center">Mais opções</summary>
      <div className="flex flex-col items-start gap-1 pb-3">{itens}</div>
    </details>
  );
  const opcaoConferir = cupom.acoes.includes('consultar') && (
    <button type="button" className={LINK} aria-disabled={!podeConsultar || ocupado !== null}
      onClick={() => { if (podeConsultar && ocupado === null) void consultar(); }}>
      {ocupado === 'consultar' ? 'Consultando…' : `Conferir na SEFAZ${!podeConsultar && consultarAPartir ? ` (a partir das ${horaSp(consultarAPartir.toISOString())})` : ''}`}
    </button>
  );
  const opcaoXml = (tipo: 'nota' | 'cancelamento') => (
    <button type="button" className={LINK} disabled={ocupado === 'xml'} onClick={() => void baixar(tipo)}>
      {tipo === 'nota' ? 'Baixar o arquivo do cupom (XML)' : 'Baixar o arquivo do cancelamento (XML)'}
    </button>
  );

  let acoes: ReactNode = null;
  switch (cupom.situacao) {
    case 'sem_resposta':
    case 'cancelando':
      acoes = botaoConsultar('Consultar na SEFAZ', true);
      break;
    case 'nao_enviado':
    case 'nao_consta':
    case 'rejeitado': {
      // UX 3.1 e 6.1: com o atalho "Corrigir os produtos" (a primária, desenhada acima), "Enviar de novo" vem depois; sem ele, a primária
      // é "Enviar de novo" ou, sem ela (539, consumidor, valores), "Descartar…"
      const corrigir = atalho?.primario === true;
      const reenvia = cupom.acoes.includes('enviar_de_novo');
      acoes = (
        <>
          {reenvia && botaoReenviar(!corrigir)}
          {cupom.acoes.includes('descartar') && botaoDescartar(!corrigir && !reenvia)}
          {cupom.situacao !== 'nao_consta' && opcaoConferir && maisOpcoes(opcaoConferir)}
        </>
      );
      break;
    }
    case 'autorizado':
      acoes = (
        <>
          <div className="hidden flex-wrap gap-2 md:flex">
            <Button asChild className="h-11"><Link href={`/cupom/${id}/imprimir?imprimir=1`}>Imprimir</Link></Button>
            <Button asChild variant="outline" className="h-11"><Link href="/cupom?aba=emitir">Novo cupom</Link></Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="h-11" disabled={!danfeQ.data?.qrCode} onClick={() => setDialogo('qr')}>Mostrar QR para o cliente</Button>
            <Button variant="outline" className="h-11" disabled={!danfeQ.data?.qrCode} onClick={() => void compartilhar()}>Compartilhar o link</Button>
            {cupom.acoes.includes('cancelar') && prazo && !prazo.acabou && (
              <Button variant="outline" className="h-11 text-destructive" onClick={() => setDialogo('cancelar')}>Cancelar o cupom…</Button>
            )}
          </div>
          {maisOpcoes(
            <>
              {opcaoXml('nota')}
              <button type="button" className={LINK} onClick={() => void copiarChave()}>Copiar a chave de acesso</button>
              {opcaoConferir}
            </>,
          )}
        </>
      );
      break;
    case 'cancelado':
      acoes = <div className="flex flex-col items-start gap-1">{opcaoXml('nota')}{opcaoXml('cancelamento')}</div>;
      break;
    case 'denegado':
      acoes = opcaoXml('nota');
      break;
    case 'descartado':
      acoes = <Button className="h-11 w-full sm:w-auto" onClick={refazer}>Refazer com estes itens</Button>;
      break;
  }

  // ------------------------------------------------------------------------------------------------------------ venda no estoque
  const venda = cupom.situacao === 'autorizado' || cupom.situacao === 'cancelado' ? cupom.venda_estoque : null;
  const fraseVenda = semPonto(erroVenda ?? cupom.venda_erro ?? 'o servidor não conseguiu gravar a venda agora');
  const linhaVenda =
    venda === 'lancada' ? { tom: 'muted' as const, texto: 'A venda baixou o estoque.' }
    : venda === 'pendente' ? { tom: 'warn' as const, texto: `A venda deste cupom não baixou o estoque: ${fraseVenda}. O cupom vale; só o estoque está atrasado.`, botao: 'Lançar no estoque de novo' }
    : venda === 'desfazer_pendente' ? { tom: 'warn' as const, texto: `Este cupom foi cancelado, mas a venda ainda está no estoque: ${fraseVenda}.`, botao: 'Tirar a venda do estoque' }
    : venda === 'desfeita' ? { tom: 'muted' as const, texto: 'A venda saiu do estoque.' }
    : venda === 'teste' ? { tom: 'muted' as const, texto: 'Cupom de teste: não mexe no estoque.' }
    : venda === 'nao_lanca' ? { tom: 'muted' as const, texto: 'O cupom não mexe no estoque: a importação de vendas do caixa de hoje já conta esta venda.' }
    : null;

  const total = BigInt(cupom.valor_total_centavos);
  const resumo = linhasConferir(cupom.itens.map((i) => ({ nome: i.nome_cardapio, quantidade: quantidadeParaTela(i.quantidade), valor: BigInt(i.valor_bruto_centavos) })));

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="no-print space-y-1">
        <Link href="/cupom?aba=emitidos" className={LINK}>← Cupons emitidos</Link>
        <h1 ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-none md:text-3xl">Cupom nº {cupom.numero}</h1>
        <p className="text-sm text-muted-foreground">
          Série {cupom.serie} · {quandoSp(cupom.dh_emi, agora)} · {reais(total)} · {nomesDosPagamentos(cupom.pagamentos)}
        </p>
      </div>
      <p className="sr-only" aria-live="polite">{anuncio}</p>

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {/* ------------------------------------------------------------------------------------------- situação e ações */}
        <div className="no-print min-w-0 space-y-3">
          <Tag tone={tag.tom}><IconeTag icone={tag.icone} />{tag.texto}</Tag>
          <div role={caixa.tom === 'bad' ? 'alert' : 'status'} className={cn('space-y-2 rounded-lg border p-3 text-sm', CAIXA[caixa.tom])}>
            {caixa.textos.map((t) => <p key={t} className="break-words">{t}</p>)}
            {cupom.situacao === 'autorizado' && prazo && <p>{prazo.texto}</p>}
            {esgotou && <p>Este cupom já foi enviado 3 vezes. Descarte e emita outro.</p>}
            {caixa.detalhe && (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center">Mensagem da SEFAZ (código {caixa.detalhe.codigo})</summary>
                <p className="break-words pb-1 text-muted-foreground">{caixa.detalhe.texto}</p>
              </details>
            )}
          </div>
          {cupom.situacao === 'autorizado' && cupom.alerta?.x_msg && (
            <div role="status" className={cn('rounded-lg border p-3 text-sm', CAIXA.warn)}>
              Autorizado, com um aviso da SEFAZ: “{cupom.alerta.x_msg}”. O cupom vale. Mostre o aviso ao contador.
            </div>
          )}
          {cupom.situacao === 'autorizado' && prazo?.acabou && (
            <details className="rounded-lg border px-3 text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center">E agora?</summary>
              <p className="pb-3">
                A SEFAZ só aceita cancelar um cupom em até 30 minutos depois da autorização. Passado isso, o cupom continua valendo e a venda
                continua no estoque. Fale com o contador para saber como acertar.
              </p>
            </details>
          )}
          {linhaVenda && (
            <div className={cn('space-y-2 rounded-lg border p-3 text-sm', CAIXA[linhaVenda.tom])} role="status">
              <p className="break-words">{linhaVenda.texto}</p>
              {'botao' in linhaVenda && cupom.acoes.includes('lancar_venda') && (
                <Button variant="outline" className="h-11 w-full sm:w-auto" disabled={ocupado !== null} onClick={() => void lancar()}>
                  {ocupado === 'lancar' && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}{linhaVenda.botao}
                </Button>
              )}
            </div>
          )}
          {erroAcao && (
            <div role="alert" className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', CAIXA.warn)}>
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /><p className="min-w-0 break-words">{erroAcao}</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {/* o atalho que conserta a recusa vem do servidor (Ruling T14 I2): a tela não decide por código; a ordem é a da UX 6.1 (no 539,
                "Descartar · [Trocar a série]": o atalho depois dos botões) */}
            {atalho && !atalho.depoisDasAcoes && botaoDoAtalho}
            {acoes}
            {atalho && atalho.depoisDasAcoes && botaoDoAtalho}
          </div>
        </div>

        {/* ------------------------------------------------------------------------------------------- o papel */}
        <div className="min-w-0 space-y-2">
          {cupom.situacao === 'autorizado' ? (
            danfeQ.data ? (
              <>
                <DanfePapel danfe={danfeQ.data} />
                {teste && (
                  <p className="no-print text-xs text-muted-foreground">
                    No modo de teste, a SEFAZ exige que o 1º produto saia com o texto “NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR
                    FISCAL” no lugar do nome. No cupom valendo, sai o nome certo.
                  </p>
                )}
              </>
            ) : danfeQ.isError ? (
              <div className="no-print space-y-2 rounded-lg border p-3 text-sm">
                <p>{errMsg(danfeQ.error)}</p>
                <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => danfeQ.refetch()}>Tentar de novo</Button>
              </div>
            ) : (
              <Skeleton className="h-96 w-full max-w-[80mm]" />
            )
          ) : (
            <ResumoDaVenda cupom={cupom} resumo={resumo} />
          )}
        </div>
      </div>

      {/* celular: Imprimir e Novo cupom fixos embaixo (E6) */}
      {cupom.situacao === 'autorizado' && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <Button asChild className="h-12 flex-1"><Link href={`/cupom/${id}/imprimir?imprimir=1`}>Imprimir</Link></Button>
          <Button asChild variant="outline" className="h-12 flex-1"><Link href="/cupom?aba=emitir">Novo cupom</Link></Button>
        </div>
      )}

      <CancelarDialog cupom={cupom} aberto={dialogo === 'cancelar'} agora={agora} onFechar={() => setDialogo(null)} onResultado={aposCancelar} />
      <DescartarDialog
        cupom={cupom} aberto={dialogo === 'descartar'} onFechar={() => setDialogo(null)}
        onResultado={(r) => { atualizar(r); setDialogo(null); }}
      />
      <Dialog open={dialogo === 'qr'} onOpenChange={(o) => { if (!o) setDialogo(null); }}>
        <DialogContent
          className="left-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-4 rounded-none bg-white text-black sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-w-md sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg [&>button.absolute]:hidden"
        >
          <DialogTitle className="sr-only">QR Code do cupom nº {cupom.numero}</DialogTitle>
          {danfeQ.data?.qrCode && <QrDoCupom texto={danfeQ.data.qrCode} className="h-auto w-[min(80vw,22rem)]" />}
          <DialogDescription className="text-center text-base text-black">
            Peça ao cliente para apontar a câmera do celular: abre o cupom no site da SEFAZ.
          </DialogDescription>
          <DialogClose asChild><Button className="h-12 w-full max-w-xs">Fechar</Button></DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * O cupom que não é documento fiscal (UX 3.6): "Resumo da venda", nunca um DANFE. No papel (Ctrl+P), uma linha só de impressão em cima e
 * embaixo: "NÃO É DOCUMENTO FISCAL" (no cancelado, "CUPOM CANCELADO — NÃO É DOCUMENTO FISCAL").
 */
function ResumoDaVenda({ cupom, resumo }: { cupom: CupomDetalhe; resumo: ReturnType<typeof linhasConferir> }) {
  const aviso = cupom.situacao === 'cancelado' ? 'CUPOM CANCELADO — NÃO É DOCUMENTO FISCAL' : 'NÃO É DOCUMENTO FISCAL';
  const troco = BigInt(cupom.valor_troco_centavos);
  return (
    <Panel title="Resumo da venda" className="min-w-0">
      <p className="hidden text-center text-2xl font-bold print:block">{aviso}</p>
      <div className="space-y-1 text-sm">
        <ul className="space-y-1">
          {resumo.linhas.map((l, k) => <li key={k} className="flex justify-between gap-3"><span className="min-w-0 break-words">{l.texto}</span><span className="shrink-0">{l.valor}</span></li>)}
          {resumo.resto && <li className="text-muted-foreground">{resumo.resto}</li>}
        </ul>
        {cupom.valor_desconto_centavos > 0 && <p className="flex justify-between"><span>Desconto</span><span>− {reais(BigInt(cupom.valor_desconto_centavos))}</span></p>}
        <p className="flex justify-between text-lg font-bold"><span>Total</span><span>{reais(BigInt(cupom.valor_total_centavos))}</span></p>
        {cupom.pagamentos.map((p, k) => (
          <p key={k} className="flex justify-between"><span>{NOME_PAGAMENTO[p.t_pag as TPag] ?? p.t_pag}</span><span>{reais(BigInt(p.valor_centavos))}</span></p>
        ))}
        {troco > 0n && <p className="flex justify-between"><span>Troco</span><span>{reais(troco)}</span></p>}
        <p>{cupom.consumidor_doc ? `${/^[0-9]{11}$/.test(cupom.consumidor_doc) ? 'CPF' : 'CNPJ'} ${documentoFormatado(cupom.consumidor_doc)}` : 'Sem CPF na nota'}</p>
      </div>
      <p className="hidden pt-2 text-center text-2xl font-bold print:block">{aviso}</p>
    </Panel>
  );
}
