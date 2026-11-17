'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, CircleAlert, Copy, EyeOff, Loader2 } from 'lucide-react';
import {
  buscarSefazAgora, listarNotasSefaz, reabrirNotaSefaz, ignorarNotaSefaz, xmlNotaSefaz,
  type NotaSefaz, type SituacaoBuscaSefaz, type SituacaoSefazLigada,
} from '@/lib/erp-api';
import { errCode, errMsg } from '@/lib/db';
import { brl } from '@/lib/format';
import { formatarCnpj } from '@/lib/certificado';
import {
  acoesDaNota, emissaoSp, estadoBuscar, linhaEspera, linhaProxima, linhaUltimaBusca, tagDaNota, TEXTO_ACAO, toastBuscaFeita,
  type AcaoNota, type TagNota,
} from '@/lib/notas-sefaz';
import { SITUACAO_SEFAZ_KEY } from '@/hooks/use-notas-sefaz';
import { Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NotasSefazIgnorar } from '@/components/notas-sefaz-ignorar';
import { cn } from '@/lib/utils';

type Filtro = 'a_conferir' | 'todas';

const POR_QUE =
  'A SEFAZ entrega só o resumo da nota (fornecedor, valor e data) até a empresa confirmar que a recebeu, e este sistema ainda não faz essa confirmação. ' +
  'Por isso, para dar entrada, envie o XML, o PDF ou a foto. Se o seu contador ou o portal da SEFAZ já confirmou o recebimento, a nota completa pode aparecer aqui.';
const DESLIGADA = 'A busca de notas na SEFAZ está desligada. As notas já recebidas continuam na lista.';
const VAZIO = 'A SEFAZ passa a separar as notas deste CNPJ a partir da primeira busca; as emitidas antes não aparecem aqui. A busca roda sozinha, de hora em hora. Enquanto isso, lance notas pela aba Lançar nota.';

const CAIXA = {
  neutro: 'border-border bg-muted/40',
  warn: 'border-amber-500/30 bg-amber-500/10',
  bad: 'border-destructive/30 bg-destructive/10',
} as const;
const ICONE_CAIXA = { neutro: 'text-muted-foreground', warn: 'text-amber-500', bad: 'text-destructive' } as const;

function Caixa({ tom, role, children }: { tom: keyof typeof CAIXA; role: 'alert' | 'status'; children: React.ReactNode }) {
  return (
    <div role={role} className={cn('flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm', CAIXA[tom])}>
      <CircleAlert className={cn('mt-0.5 h-4 w-4 shrink-0', ICONE_CAIXA[tom])} aria-hidden />
      <div className="min-w-0 space-y-2 break-words">{children}</div>
    </div>
  );
}

const ICONES = { CircleAlert, EyeOff, Ban, CheckCircle2, Copy } as const;

function TagSituacao({ tag, abrirPorQue }: { tag: TagNota; abrirPorQue(): void }) {
  const Icone = ICONES[tag.icone];
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={tag.tom === 'neutro' ? 'muted' : tag.tom}>
          <Icone className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="whitespace-normal break-words text-left">{tag.texto}</span>
        </Tag>
        {tag.podeNaoSerCompra && <Tag tone="muted">Pode não ser compra</Tag>}
      </div>
      {tag.detalhe && <p className="break-words text-xs text-muted-foreground">{tag.detalhe}</p>}
      {tag.soResumo && (
        <p className="text-xs text-muted-foreground">
          Só o resumo chegou.{' '}
          <button type="button" className="inline-flex min-h-11 items-center px-1 text-primary underline underline-offset-2 md:min-h-0" onClick={abrirPorQue}>Por quê?</button>
        </p>
      )}
    </div>
  );
}

function Acoes({ nota, modoTeste, ocupado, onAcao, compacto }: {
  nota: NotaSefaz; modoTeste: boolean; ocupado: boolean; onAcao(a: AcaoNota, n: NotaSefaz): void; compacto?: boolean;
}) {
  // No modo de teste as notas são de mentira: nunca oferece "Conferir".
  const { primaria, secundarias } = acoesDaNota(modoTeste ? { ...nota, pode_conferir: false } : nota);
  if (!primaria) return null;
  const altura = compacto ? 'h-10' : 'h-11 w-full sm:w-auto';
  const destaque = primaria === 'conferir' || primaria === 'lancar_por_arquivo' || primaria === 'mesma_nota';
  return (
    <div className={cn('flex gap-2', compacto ? 'flex-wrap' : 'flex-col sm:flex-row sm:flex-wrap')}>
      <Button type="button" variant={destaque ? 'default' : 'outline'} className={cn(altura, 'whitespace-normal')} disabled={ocupado} onClick={() => onAcao(primaria, nota)}>
        {ocupado && primaria === 'conferir' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Abrindo…</> : TEXTO_ACAO[primaria]}
      </Button>
      {secundarias.length > 0 && (
        <div className={cn('flex gap-2', compacto ? 'flex-wrap' : '')}>
          {secundarias.map((a) => (
            <Button key={a} type="button" variant="outline" className={cn(compacto ? 'h-10' : 'h-11 flex-1 sm:flex-none', 'whitespace-normal')} disabled={ocupado} onClick={() => onAcao(a, nota)}>
              {TEXTO_ACAO[a]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Aba "Notas da SEFAZ" da Entrada de Notas (só admin, só com a busca disponível no servidor). Mostra o que a SEFAZ separou para a empresa e
 * leva "Conferir" à mesma conferência de hoje. Nada aqui envia nada à SEFAZ além do pedido de busca. Textos: UX §3; ações: `acoesDaNota`.
 */
export function NotasSefazAba({ situacao, focarId, onConferir, onLancarPorArquivo, onFocoFeito }: {
  situacao: SituacaoSefazLigada; focarId: string | null; onConferir(xml: string): void; onLancarPorArquivo(): void; onFocoFeito?(): void;
}) {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('a_conferir');
  const [agora, setAgora] = useState(() => new Date());
  const [pendente, setPendente] = useState(false);
  const [erroBusca, setErroBusca] = useState<{ code: string | null; msg: string } | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [alvoIgnorar, setAlvoIgnorar] = useState<NotaSefaz | null>(null);
  const [porQueAberto, setPorQueAberto] = useState(false);
  const porQueRef = useRef<HTMLDetailsElement>(null);
  const emAndamentoAntes = useRef(situacao.em_andamento);
  const acaoEmCurso = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lista = useQuery({ queryKey: ['notas-sefaz', 'lista', filtro], queryFn: () => listarNotasSefaz(filtro) });
  const aConferirVazia = filtro === 'a_conferir' && lista.isSuccess && lista.data.length === 0;
  const todas = useQuery({ queryKey: ['notas-sefaz', 'lista', 'todas'], queryFn: () => listarNotasSefaz('todas'), enabled: aConferirVazia });

  const recarregar = useCallback(() => qc.invalidateQueries({ queryKey: ['notas-sefaz'] }), [qc]);

  // Fim da busca: em_andamento passa de true para false.
  useEffect(() => {
    if (emAndamentoAntes.current && !situacao.em_andamento) {
      toast.success(toastBuscaFeita(situacao.ultima_consulta?.novas ?? 0));
      void recarregar();
    }
    emAndamentoAntes.current = situacao.em_andamento;
  }, [situacao.em_andamento, situacao.ultima_consulta, recarregar]);

  // "Ver" da faixa: filtro "A conferir" e foco no cartão da nota cancelada.
  useEffect(() => { if (focarId) setFiltro('a_conferir'); }, [focarId]);
  useEffect(() => {
    if (!focarId || filtro !== 'a_conferir' || !lista.isSuccess) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-nota-id="${focarId}"]`)).find((e) => e.offsetParent !== null);
    el?.focus();
    el?.scrollIntoView?.({ block: 'center' });
    onFocoFeito?.();
  }, [focarId, filtro, lista.isSuccess, lista.data, onFocoFeito]);

  const modoTeste = situacao.ambiente === 'homologacao';
  const estado = estadoBuscar(situacao, agora);
  const buscando = estado === 'buscando' || pendente;
  const parada = situacao.situacao.startsWith('parada_');
  const nAConferir = situacao.contagem.falta_lancar + situacao.contagem.parece_lancada + situacao.contagem.cancelada_depois_de_lancada;

  async function buscar() {
    if (buscando || estado !== 'normal') return;
    const antes = situacao.ultima_consulta?.em ?? null;
    setErroBusca(null);
    setPendente(true);
    try {
      await buscarSefazAgora();
      await qc.invalidateQueries({ queryKey: SITUACAO_SEFAZ_KEY });
      const s = qc.getQueryData<SituacaoBuscaSefaz>(SITUACAO_SEFAZ_KEY);
      // A busca já acabou antes da primeira releitura: o toast sai aqui, porque o "true → false" não vai aparecer.
      if (s && s.ambiente !== 'desligado' && !s.em_andamento && (s.ultima_consulta?.em ?? null) !== antes) {
        toast.success(toastBuscaFeita(s.ultima_consulta?.novas ?? 0));
        void recarregar();
      }
    } catch (e) {
      setErroBusca({ code: errCode(e) ?? null, msg: errMsg(e) });
    } finally {
      setPendente(false);
    }
  }

  function desfazer(id: string) {
    reabrirNotaSefaz(id).then(() => recarregar(), (e) => setErroAcao(errMsg(e)));
  }
  const avisoDesfazer = (texto: string, id: string) => toast.success(texto, { duration: 8000, action: { label: 'Desfazer', onClick: () => desfazer(id) } });

  async function executar(n: NotaSefaz, fn: () => Promise<void>) {
    if (acaoEmCurso.current) return;
    acaoEmCurso.current = true;
    setOcupado(n.id);
    setErroAcao(null);
    try { await fn(); } catch (e) { setErroAcao(errMsg(e)); } finally { acaoEmCurso.current = false; setOcupado(null); }
  }

  function aoAcionar(acao: AcaoNota, n: NotaSefaz) {
    const conferir = () => executar(n, async () => { onConferir(await xmlNotaSefaz(n.id)); });
    switch (acao) {
      case 'marcar_visto':
        return void executar(n, async () => { await ignorarNotaSefaz(n.id, 'cancelamento_conferido'); await recarregar(); avisoDesfazer('Nota marcada como vista.', n.id); });
      case 'voltar_lista':
        return void executar(n, async () => { await reabrirNotaSefaz(n.id); await recarregar(); toast.success('Nota de volta à lista.'); });
      case 'mesma_nota':
        return void executar(n, async () => { await ignorarNotaSefaz(n.id, 'lancada_de_outro_jeito'); await recarregar(); avisoDesfazer('Nota ignorada.', n.id); });
      case 'lancar_mesmo_assim':
        return n.pode_conferir && !modoTeste ? void conferir() : onLancarPorArquivo();
      case 'conferir':
        return void conferir();
      case 'lancar_por_arquivo':
        return onLancarPorArquivo();
      case 'ignorar':
        return setAlvoIgnorar(n);
      case 'copiar_chave':
        return void navigator.clipboard.writeText(n.chave).then(() => toast.success('Chave copiada.'), () => setErroAcao('Não consegui copiar a chave.'));
    }
  }

  function abrirPorQue() {
    setPorQueAberto(true);
    porQueRef.current?.scrollIntoView?.({ block: 'center' });
    porQueRef.current?.querySelector('summary')?.focus();
  }

  const botaoBuscar = estado === 'sem_botao' ? null : (
    <div className="space-y-1">
      <div aria-live="polite">
        <Button
          type="button" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto"
          disabled={buscando} aria-disabled={buscando || estado === 'espera'}
          onClick={() => void buscar()}
        >
          {buscando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Buscando na SEFAZ…</> : 'Buscar agora'}
        </Button>
      </div>
      {!buscando && estado === 'espera' && <p className="text-sm text-muted-foreground">{linhaEspera(situacao)}</p>}
      {!buscando && estado === 'normal' && linhaProxima(situacao) && <p className="text-sm text-muted-foreground">{linhaProxima(situacao)}</p>}
    </div>
  );

  const notas = lista.data ?? [];
  const todasVazia = aConferirVazia && todas.isSuccess && todas.data.length === 0;
  const vazioTotal = (filtro === 'todas' && lista.isSuccess && notas.length === 0) || todasVazia;
  const aguardandoTodas = aConferirVazia && todas.isPending;

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">{linhaUltimaBusca(situacao, agora)}</p>

        {estado === 'sem_botao' && !parada && !vazioTotal && (
          <Caixa tom="neutro" role="status">
            <p>{DESLIGADA}</p>
            <Link href="/configuracoes#notas-sefaz" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ligar em Configurações</Link>
          </Caixa>
        )}
        {parada && (
          <Caixa tom="bad" role="alert">
            <p>{situacao.mensagem ?? 'A busca parou. Veja os detalhes em Configurações.'}</p>
            <Link href="/configuracoes#notas-sefaz" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ver em Configurações</Link>
          </Caixa>
        )}
        {!vazioTotal && botaoBuscar}
        {erroBusca && (erroBusca.code === 'SEFAZ_AGUARDE'
          ? <Caixa tom="warn" role="status"><p>{erroBusca.msg}</p></Caixa>
          : <Caixa tom="bad" role="alert"><p>{erroBusca.msg}</p></Caixa>)}
      </div>

      {situacao.aviso && <Caixa tom="warn" role="status"><p>{situacao.aviso}</p></Caixa>}
      {situacao.lacunas > 0 && (
        <Caixa tom="warn" role="status">
          <p>Uma resposta da SEFAZ se perdeu e até {situacao.lacunas} notas podem não ter chegado. Essas entram pelo arquivo ou pela foto.</p>
        </Caixa>
      )}
      {modoTeste && <Caixa tom="warn" role="status"><p>MODO DE TESTE da SEFAZ: estas notas são de mentira e não entram no estoque.</p></Caixa>}

      <details ref={porQueRef} open={porQueAberto} onToggle={(e) => setPorQueAberto(e.currentTarget.open)} className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-primary">Por quê?</summary>
        <p className="mt-1 break-words text-muted-foreground">{POR_QUE}</p>
      </details>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtro das notas">
        <Button type="button" variant={filtro === 'a_conferir' ? 'default' : 'outline'} className="h-11" aria-pressed={filtro === 'a_conferir'} onClick={() => setFiltro('a_conferir')}>
          A conferir ({nAConferir})
        </Button>
        <Button type="button" variant={filtro === 'todas' ? 'default' : 'outline'} className="h-11" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
          Todas
        </Button>
      </div>

      {erroAcao && <Caixa tom="bad" role="alert"><p>{erroAcao}</p></Caixa>}

      {(lista.isPending || aguardandoTodas) && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" />
        </div>
      )}

      {(lista.isError || (aConferirVazia && todas.isError)) && (
        <div className="space-y-2 text-sm">
          <p role="alert">Não consegui ver as notas da SEFAZ agora. Toque em Tentar de novo.</p>
          <p className="break-words text-xs text-muted-foreground">{errMsg(lista.error ?? todas.error)}</p>
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void (lista.isError ? lista.refetch() : todas.refetch())}>Tentar de novo</Button>
        </div>
      )}

      {vazioTotal && (
        <div className="space-y-3 rounded-xl border border-dashed p-4 text-sm">
          <p className="font-medium">Nenhuma nota chegou ainda</p>
          {estado === 'sem_botao' && !parada
            ? <><p className="text-muted-foreground">{DESLIGADA}</p><Link href="/configuracoes#notas-sefaz" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ligar em Configurações</Link></>
            : <p className="text-muted-foreground">{VAZIO}</p>}
          {botaoBuscar}
        </div>
      )}

      {aConferirVazia && todas.isSuccess && todas.data.length > 0 && (
        <div className="space-y-2 rounded-xl border border-dashed p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Tudo certo. Nenhuma nota para conferir.</p>
          <button type="button" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2" onClick={() => setFiltro('todas')}>Ver todas</button>
        </div>
      )}

      {notas.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden" aria-label="Notas da SEFAZ">
            {notas.map((n) => (
              <li key={n.id} data-nota-id={n.id} tabIndex={-1} className="min-w-0 space-y-2 rounded-xl border bg-card p-3 outline-none">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="break-words font-medium">{n.emitente_nome}</p><p className="text-xs text-muted-foreground">{formatarCnpj(n.emitente_cnpj)}</p></div>
                  <p className="shrink-0 font-medium">{n.valor_total === null ? '—' : brl(n.valor_total)}</p>
                </div>
                <p className="text-sm text-muted-foreground">NF {n.numero} · série {n.serie} · {emissaoSp(n.emitida_em)}</p>
                <TagSituacao tag={tagDaNota(n)} abrirPorQue={abrirPorQue} />
                <Acoes nota={n} modoTeste={modoTeste} ocupado={ocupado === n.id} onAcao={aoAcionar} />
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Fornecedor</th><th className="pr-2 font-medium">NF / série</th><th className="pr-2 font-medium">Emissão</th>
                  <th className="pr-2 text-right font-medium">Valor</th><th className="pl-4 font-medium">Situação</th><th className="font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id} data-nota-id={n.id} tabIndex={-1} className="border-t align-top outline-none">
                    <td className="py-2 pr-2"><div className="break-words font-medium">{n.emitente_nome}</div><div className="text-xs text-muted-foreground">{formatarCnpj(n.emitente_cnpj)}</div></td>
                    <td className="pr-2">{n.numero} / {n.serie}</td>
                    <td className="pr-2">{emissaoSp(n.emitida_em)}</td>
                    <td className="pr-2 text-right">{n.valor_total === null ? '—' : brl(n.valor_total)}</td>
                    <td className="max-w-[18rem] py-2 pl-4"><TagSituacao tag={tagDaNota(n)} abrirPorQue={abrirPorQue} /></td>
                    <td className="py-2"><Acoes nota={n} modoTeste={modoTeste} ocupado={ocupado === n.id} onAcao={aoAcionar} compacto /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <NotasSefazIgnorar
        nota={alvoIgnorar}
        onFechar={() => setAlvoIgnorar(null)}
        onIgnorada={(n) => { setAlvoIgnorar(null); void recarregar(); avisoDesfazer('Nota ignorada.', n.id); }}
      />
    </div>
  );
}
