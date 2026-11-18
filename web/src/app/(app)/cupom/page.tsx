'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { produtosCupom, situacaoCupomFiscal } from '@/lib/erp-api';
import { useMe } from '@/lib/auth';
import { CHAVES_CUPOM } from '@/lib/cupom';
import { Empty, PageHeader } from '@/components/ui-kit';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorBoundary } from '@/components/error-boundary';
import { Emitir } from '@/components/cupom/emitir';
import { Emitidos, type InicialEmitidos } from '@/components/cupom/emitidos';
import { FaixaPendentes } from '@/components/cupom/faixa-pendentes';
import { Produtos } from '@/components/cupom/produtos';

type Aba = 'emitir' | 'emitidos' | 'produtos';
const ABAS: readonly Aba[] = ['emitir', 'emitidos', 'produtos'];
const SITUACOES_URL: readonly NonNullable<InicialEmitidos['situacao']>[] = ['todos', 'atencao', 'autorizados', 'cancelados', 'descartados'];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ERRO_ABA = (nome: string) => (
  <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">Não consegui mostrar a aba {nome} agora. Recarregue a página.</p>
);

export default function CupomFiscalPage() {
  return <Suspense fallback={null}><CupomFiscal /></Suspense>;
}

/**
 * Cupom Fiscal (UX 1): só admin, sempre (também com o servidor desligado: cadastrar os dados do contador é o 1º trabalho). Abas por
 * `?aba=emitir|emitidos|produtos` (padrão `emitir`). A faixa do modo de teste e a de pendentes (UX 4.2) valem nas três abas.
 * Emitidos lê `situacao`, `ini` e `fim` da URL (a faixa, a importação e o inventário levam para lá); Produtos lê `item` (abre a folha do
 * produto) e `cupom` (só os produtos de um cupom recusado).
 */
function CupomFiscal() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const admin = me?.perfil === 'admin';
  const pedida = params.get('aba');
  const aba: Aba = ABAS.includes(pedida as Aba) ? (pedida as Aba) : 'emitir';
  const qc = useQueryClient();
  const situacaoQ = useQuery({ queryKey: CHAVES_CUPOM.situacao, queryFn: situacaoCupomFiscal, enabled: admin });
  const produtosQ = useQuery({ queryKey: CHAVES_CUPOM.produtos, queryFn: () => produtosCupom(), enabled: admin });

  // a aba Emitir fica montada (a venda em montagem e a chave sobrevivem à troca de aba): ao voltar para ela, os preços são relidos
  const abaAntes = useRef(aba);
  useEffect(() => {
    if (aba === 'emitir' && abaAntes.current !== 'emitir') void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.produtos });
    abaAntes.current = aba;
  }, [aba, qc]);

  if (me && !admin) return <Empty>Acesso negado.</Empty>;

  const s = situacaoQ.data;
  const nPendentes = s?.pendentes.total ?? 0;
  const nFaltando = (produtosQ.data ?? []).filter((p) => p.ativo && !p.pronto).length;
  const trocar = (v: string) => router.replace(`/cupom?aba=${ABAS.includes(v as Aba) ? v : 'emitir'}`, { scroll: false });
  const sitUrl = params.get('situacao');
  const iniUrl = params.get('ini');
  const fimUrl = params.get('fim');
  const inicialEmitidos: InicialEmitidos = {
    situacao: (SITUACOES_URL as readonly (string | null)[]).includes(sitUrl) ? (sitUrl as InicialEmitidos['situacao']) : null,
    ini: iniUrl && DIA.test(iniUrl) ? iniUrl : null,
    fim: fimUrl && DIA.test(fimUrl) ? fimUrl : null,
  };
  const itemUrl = params.get('item');
  const cupomUrl = params.get('cupom');

  return (
    <div className="space-y-4">
      <PageHeader title="Cupom Fiscal" sub={s && s.serie !== null ? `Próximo cupom: nº ${s.proximo_numero} (série ${s.serie})` : undefined} />
      {s?.ambiente === 'homologacao' && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <p className="min-w-0 break-words">MODO DE TESTE da SEFAZ: estes cupons não valem como documento fiscal e não mexem no estoque.</p>
        </div>
      )}
      {s && <FaixaPendentes pendentes={s.pendentes} />}

      <Tabs value={aba} onValueChange={trocar} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:inline-grid sm:w-auto">
          <TabsTrigger value="emitir" className="h-auto min-h-11 whitespace-normal px-4">Emitir</TabsTrigger>
          <TabsTrigger
            value="emitidos" className="h-auto min-h-11 whitespace-normal px-4"
            aria-label={nPendentes > 0 ? `Emitidos, ${nPendentes} ${nPendentes === 1 ? 'cupom precisa' : 'cupons precisam'} de você` : undefined}
          >
            {nPendentes > 0 ? `Emitidos · ${nPendentes}` : 'Emitidos'}
          </TabsTrigger>
          <TabsTrigger
            value="produtos" className="h-auto min-h-11 whitespace-normal px-4"
            aria-label={nFaltando > 0 ? `Produtos, ${nFaltando} com dados faltando` : undefined}
          >
            {nFaltando > 0 ? `Produtos · ${nFaltando}` : 'Produtos'}
          </TabsTrigger>
        </TabsList>
        {/* forceMount: a venda (e a chave da venda) não se perde ao olhar Emitidos ou Produtos */}
        <TabsContent value="emitir" forceMount className="mt-0 data-[state=inactive]:hidden">
          <ErrorBoundary fallback={<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">Não consegui mostrar a aba Emitir agora. Recarregue a página.</p>}>
            <Emitir
              situacao={s} situacaoEm={situacaoQ.dataUpdatedAt} situacaoErro={situacaoQ.isError}
              onTentarSituacao={() => void situacaoQ.refetch()}
            />
          </ErrorBoundary>
        </TabsContent>
        {/* a chave remonta a aba quando um link (faixa, importação, inventário) muda o filtro com ela aberta */}
        <TabsContent value="emitidos" className="mt-0">
          <ErrorBoundary fallback={ERRO_ABA('Emitidos')}>
            <Emitidos
              key={`${inicialEmitidos.situacao}-${inicialEmitidos.ini}-${inicialEmitidos.fim}`}
              situacao={s} situacaoEm={situacaoQ.dataUpdatedAt} inicial={inicialEmitidos}
            />
          </ErrorBoundary>
        </TabsContent>
        <TabsContent value="produtos" className="mt-0">
          <ErrorBoundary fallback={ERRO_ABA('Produtos')}>
            <Produtos key={cupomUrl ?? ''} itemInicial={itemUrl} cupomId={cupomUrl} />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
