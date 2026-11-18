'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { listarCupons, xmlDoMesCupom, type AmbienteSefaz, type CupomLinha, type FiltroCupons, type SituacaoCupomFiscal } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import {
  ambienteDoContador, dataHoraNaLista, diaSpDe, documentoNaLista, intervaloDoPeriodo, mesesDoContador, mesPadraoContador, nomeDoMes, nomesDosPagamentos,
  proximaAcao, quandoNaLista, reais, ROTULO_PERIODO, SITUACOES_DO_FILTRO, tagDoCupom, type IconeCupom, type PeriodoEmitidos,
  type SituacaoEmitidos,
} from '@/lib/cupom';
import { semToqueDuplo } from '@/lib/notas-sefaz';
import { Panel, Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Mostra 100 por vez; pede 101 para saber se há mais (UX 4.1, "Limite"). */
const LIMITE = 100;
const PERIODOS: readonly PeriodoEmitidos[] = ['hoje', 'ontem', '7dias', 'mes', 'mes_passado', 'datas'];
const SELECT = 'h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-64';

function IconeTag({ icone }: { icone: IconeCupom }) {
  if (icone === 'ok') return <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />;
  if (icone === 'alerta') return <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />;
  if (icone === 'carregando') return <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />;
  if (icone === 'ban') return <Ban className="mr-1 h-3.5 w-3.5" aria-hidden />;
  return null;
}

function TagSituacao({ l, teste }: { l: CupomLinha; teste: boolean }) {
  const t = tagDoCupom(l.situacao);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tag tone={t.tom}><IconeTag icone={t.icone} />{t.texto}</Tag>
      {teste && <Tag tone="muted">Teste</Tag>}
    </span>
  );
}

export type InicialEmitidos = { situacao: SituacaoEmitidos | null; ini: string | null; fim: string | null };

/**
 * Emitidos (UX 4.1 e 4.6): período e situação; um cartão por cupom no celular e a tabela no computador (o mesmo dado, `md:hidden` /
 * `hidden md:block`); o CPF já vem mascarado do servidor; "Para o contador" no fim. O dia de hoje é o do servidor (`agora` da situação).
 * Os filtros iniciais vêm da URL (`situacao=atencao` da faixa e dos avisos; `ini`/`fim` da importação). "Precisam de você" mostra os
 * pendentes de qualquer dia (a contagem do botão, a da faixa, é de todos os dias).
 */
export function Emitidos({ situacao, situacaoEm, inicial }: { situacao: SituacaoCupomFiscal | undefined; situacaoEm: number; inicial: InicialEmitidos }) {
  const desvio = situacao && situacaoEm > 0 ? new Date(situacao.agora).getTime() - situacaoEm : 0;
  const agora = new Date(Date.now() + desvio);
  const hoje = diaSpDe(agora);
  const servidor = situacao?.ambiente;

  const [periodo, setPeriodo] = useState<PeriodoEmitidos>(inicial.ini && inicial.fim ? 'datas' : 'hoje');
  const [datas, setDatas] = useState({ ini: inicial.ini ?? hoje, fim: inicial.fim ?? hoje });
  const [filtro, setFiltro] = useState<SituacaoEmitidos>(inicial.situacao ?? 'todos');
  const [verTeste, setVerTeste] = useState(false);

  // sem a situação ainda (ou com erro nela), o servidor escolhe o ambiente (o dele; desligado = valendo)
  const ambiente: AmbienteSefaz | undefined =
    servidor === undefined ? undefined : servidor === 'homologacao' || (servidor === 'producao' && verTeste) ? 'homologacao' : 'producao';
  const doServidor = servidor !== undefined && (servidor === ambiente || (servidor === 'desligado' && ambiente === 'producao'));
  const intervalo = periodo === 'datas' ? datas : intervaloDoPeriodo(periodo, hoje);
  // "Precisam de você" não usa o período (as datas erradas não travam a lista)
  const usaDatas = periodo === 'datas' && filtro !== 'atencao';
  const erroDatas = usaDatas && (!datas.ini || !datas.fim) ? 'Escolha as duas datas.'
    : usaDatas && datas.ini > datas.fim ? 'A primeira data tem de ser antes da segunda.' : null;

  const consulta: FiltroCupons = {
    ambiente,
    ...(filtro === 'atencao' ? { atencao: true } : { ini: intervalo.ini, fim: intervalo.fim }),
    ...(filtro === 'autorizados' || filtro === 'cancelados' || filtro === 'descartados' ? { situacao: SITUACOES_DO_FILTRO[filtro] } : {}),
    limite: LIMITE + 1,
  };
  const cuponsQ = useQuery({
    queryKey: ['cupom-fiscal', 'cupons', consulta],
    queryFn: () => listarCupons(consulta),
    enabled: erroDatas === null,
  });
  const linhas = (cuponsQ.data ?? []).slice(0, LIMITE);
  const temMais = (cuponsQ.data?.length ?? 0) > LIMITE;
  const nPendentes = doServidor ? (situacao?.pendentes.total ?? 0) : null;
  const teste = (l: CupomLinha) => l.ambiente === 'homologacao' && servidor !== 'homologacao';

  const BOTOES: { v: SituacaoEmitidos; texto: string }[] = [
    { v: 'todos', texto: 'Todos' },
    { v: 'atencao', texto: nPendentes !== null && nPendentes > 0 ? `Precisam de você (${nPendentes})` : 'Precisam de você' },
    { v: 'autorizados', texto: 'Autorizados' },
    { v: 'cancelados', texto: 'Cancelados' },
    { v: 'descartados', texto: 'Descartados' },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="emitidos-periodo">Período</Label>
          <select
            id="emitidos-periodo" className={SELECT} value={periodo} disabled={filtro === 'atencao'}
            aria-describedby={filtro === 'atencao' ? 'emitidos-periodo-ajuda' : undefined}
            onChange={(e) => setPeriodo(e.target.value as PeriodoEmitidos)}
          >
            {PERIODOS.map((p) => <option key={p} value={p}>{ROTULO_PERIODO[p]}</option>)}
          </select>
          {filtro === 'atencao' && (
            <p id="emitidos-periodo-ajuda" className="text-sm text-muted-foreground">“Precisam de você” mostra os cupons de qualquer dia.</p>
          )}
        </div>
        {periodo === 'datas' && filtro !== 'atencao' && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="space-y-1">
              <Label htmlFor="emitidos-ini">De</Label>
              <Input id="emitidos-ini" type="date" className="h-11 sm:w-48" value={datas.ini} onChange={(e) => setDatas((d) => ({ ...d, ini: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="emitidos-fim">Até</Label>
              <Input id="emitidos-fim" type="date" className="h-11 sm:w-48" value={datas.fim} onChange={(e) => setDatas((d) => ({ ...d, fim: e.target.value }))} />
            </div>
          </div>
        )}
        {erroDatas && <p role="alert" className="text-sm text-destructive">{erroDatas}</p>}
        <div role="group" aria-label="Situação" className="flex flex-wrap gap-2">
          {BOTOES.map((b) => (
            <Button
              key={b.v} type="button" variant={filtro === b.v ? 'default' : 'outline'} aria-pressed={filtro === b.v}
              className="h-auto min-h-11 whitespace-normal" onClick={() => setFiltro(b.v)}
            >
              {b.texto}
            </Button>
          ))}
        </div>
        {servidor === 'producao' && (
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" aria-pressed={verTeste} onClick={() => setVerTeste((v) => !v)}>
            {verTeste ? 'Ver cupons valendo' : 'Ver cupons de teste'}
          </Button>
        )}
      </div>

      {cuponsQ.isPending && erroDatas === null ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : cuponsQ.isError ? (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p>Não consegui ver os cupons agora. Toque em Tentar de novo.</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void cuponsQ.refetch()}>Tentar de novo</Button>
        </div>
      ) : erroDatas !== null ? null : linhas.length === 0 ? (
        <Vazio
          filtro={filtro} periodo={periodo}
          onVerTodos={() => { setFiltro('todos'); setPeriodo('hoje'); }}
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {linhas.map((l) => {
              const acao = proximaAcao(l, agora);
              return (
                <li key={l.id}>
                  <Link href={`/cupom/${l.id}`} className="block min-h-11 rounded-xl border bg-card p-4 hover:bg-muted/40">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">Cupom nº {l.numero}</span>
                      <span className="font-semibold">{reais(BigInt(l.valor_total_centavos))}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{quandoNaLista(l.dh_emi, agora)} · {nomesDosPagamentos(l.pagamentos)}</p>
                    <div className="mt-1"><TagSituacao l={l} teste={teste(l)} /></div>
                    {acao && <p className="mt-1 text-sm">{acao}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-sm text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3">Nº</th>
                  <th scope="col" className="pr-3">Data e hora</th>
                  <th scope="col" className="pr-3 text-right">Valor</th>
                  <th scope="col" className="pr-3">Pagamento</th>
                  <th scope="col" className="pr-3">Cliente</th>
                  <th scope="col" className="pr-3">Situação</th>
                  <th scope="col"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const acao = proximaAcao(l, agora);
                  return (
                    <tr key={l.id} className="border-t align-top">
                      <td className="py-2 pr-3 font-medium">{l.numero}</td>
                      <td className="py-2 pr-3">{dataHoraNaLista(l.dh_emi)}</td>
                      <td className="py-2 pr-3 text-right">{reais(BigInt(l.valor_total_centavos))}</td>
                      <td className="py-2 pr-3">{nomesDosPagamentos(l.pagamentos)}</td>
                      <td className="py-2 pr-3">{documentoNaLista(l.consumidor_doc)}</td>
                      <td className="py-2 pr-3">
                        <TagSituacao l={l} teste={teste(l)} />
                        {acao && <div className="mt-1 text-sm text-muted-foreground">{acao}</div>}
                      </td>
                      <td className="py-1 text-right">
                        <Link href={`/cupom/${l.id}`} className="inline-flex min-h-11 items-center px-2 text-primary underline underline-offset-2" aria-label={`Ver o cupom nº ${l.numero}`}>
                          Ver
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {temMais && <p className="text-sm text-muted-foreground">Mostrando os 100 mais novos. Escolha um período menor.</p>}
        </>
      )}

      <ParaOContador ambiente={ambienteDoContador(servidor)} hoje={hoje} />
    </div>
  );
}

function Vazio({ filtro, periodo, onVerTodos }: { filtro: SituacaoEmitidos; periodo: PeriodoEmitidos; onVerTodos(): void }) {
  if (filtro === 'atencao') {
    return (
      <p className="flex items-center gap-2 rounded-lg border p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />Tudo certo. Nenhum cupom precisa de você.
      </p>
    );
  }
  if (filtro === 'todos' && periodo === 'hoje') {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>Nenhum cupom emitido hoje.</p>
        <Button asChild className="h-11 w-full sm:w-auto"><Link href="/cupom?aba=emitir">Emitir cupom</Link></Button>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border p-4 text-sm">
      <p>Nenhum cupom com este filtro.</p>
      <button type="button" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2" onClick={onVerTodos}>Ver todos</button>
    </div>
  );
}

/**
 * "Para o contador" (UX 4.6): o zip do mês (`GET …/xml-do-mes`) do ambiente do SERVIDOR ("Ver cupons de teste" não muda o arquivo). Mês padrão: o passado até o dia 10. Erro
 * em caixa no painel, com "Tentar de novo"; o arquivo é baixado pelo navegador (nada fica no storage).
 */
function ParaOContador({ ambiente, hoje }: { ambiente: AmbienteSefaz | undefined; hoje: string }) {
  const meses = mesesDoContador(hoje);
  const [mes, setMes] = useState(() => mesPadraoContador(hoje));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emCurso = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const teste = ambiente === 'homologacao';
  const nome = nomeDoMes(mes);
  const rotuloMes = (m: string) => { const n = nomeDoMes(m); return n.charAt(0).toUpperCase() + n.slice(1); };

  useEffect(() => { if (erro) caixa.current?.focus(); }, [erro]);

  const baixar = () => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    setErro(null);
    try {
      const blob = await xmlDoMesCupom(mes, ambiente);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = teste ? `cupons-de-teste-${mes}.zip` : `cupons-${mes}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  return (
    <Panel title="Para o contador">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="contador-mes">Mês</Label>
          <select id="contador-mes" className={SELECT} value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
          </select>
        </div>
        <Button className="h-auto min-h-11 w-full whitespace-normal sm:w-auto" disabled={ocupado} onClick={() => void baixar()}>
          {ocupado
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Preparando o arquivo…</>
            : teste ? `Baixar os cupons de teste de ${nome}` : `Baixar os cupons de ${nome}`}
        </Button>
        {teste && <p className="text-sm text-muted-foreground">Cupons de teste não vão para o contador; o arquivo serve para conferir.</p>}
        <p className="text-sm text-muted-foreground">
          Um arquivo .zip com os cupons autorizados, com uso negado e cancelados do mês, mais a lista dos números que não foram usados. Mande ao contador todo mês.
        </p>
        {erro && (
          <div ref={caixa} tabIndex={-1} role="alert" className={cn('space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm')}>
            <p className="break-words">{erro}</p>
            <Button variant="outline" className="h-11 w-full sm:w-auto" disabled={ocupado} onClick={() => void baixar()}>Tentar de novo</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
