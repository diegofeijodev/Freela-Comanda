'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { produtosCupom, situacaoCupomFiscal } from '@/lib/erp-api';
import { useMe } from '@/lib/auth';
import { CHAVES_CUPOM } from '@/lib/cupom';
import { Empty, PageHeader } from '@/components/ui-kit';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorBoundary } from '@/components/error-boundary';
import { Emitir } from '@/components/cupom/emitir';

type Aba = 'emitir' | 'emitidos' | 'produtos';
const ABAS: readonly Aba[] = ['emitir', 'emitidos', 'produtos'];

export default function CupomFiscalPage() {
  return <Suspense fallback={null}><CupomFiscal /></Suspense>;
}

/**
 * Cupom Fiscal (UX 1): só admin, sempre (também com o servidor desligado: cadastrar os dados do contador é o 1º trabalho). Abas por
 * `?aba=emitir|emitidos|produtos` (padrão `emitir`). A faixa do modo de teste vale nas três abas.
 */
function CupomFiscal() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const admin = me?.perfil === 'admin';
  const pedida = params.get('aba');
  const aba: Aba = ABAS.includes(pedida as Aba) ? (pedida as Aba) : 'emitir';
  const situacaoQ = useQuery({ queryKey: CHAVES_CUPOM.situacao, queryFn: situacaoCupomFiscal, enabled: admin });
  const produtosQ = useQuery({ queryKey: CHAVES_CUPOM.produtos, queryFn: () => produtosCupom(), enabled: admin });

  if (me && !admin) return <Empty>Acesso negado.</Empty>;

  const s = situacaoQ.data;
  const nPendentes = s?.pendentes.total ?? 0;
  const nFaltando = (produtosQ.data ?? []).filter((p) => p.ativo && !p.pronto).length;
  const trocar = (v: string) => router.replace(`/cupom?aba=${ABAS.includes(v as Aba) ? v : 'emitir'}`, { scroll: false });

  return (
    <div className="space-y-4">
      <PageHeader title="Cupom Fiscal" sub={s && s.serie !== null ? `Próximo cupom: nº ${s.proximo_numero} (série ${s.serie})` : undefined} />
      {s?.ambiente === 'homologacao' && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <p className="min-w-0 break-words">MODO DE TESTE da SEFAZ: estes cupons não valem como documento fiscal e não mexem no estoque.</p>
        </div>
      )}
      {/* Tarefa 15: a faixa de pendentes (UX 4.2) entra aqui, acima das abas. */}

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
        <TabsContent value="emitir" className="mt-0">
          <ErrorBoundary fallback={<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">Não consegui mostrar a aba Emitir agora. Recarregue a página.</p>}>
            <Emitir situacao={s} situacaoErro={situacaoQ.isError} onTentarSituacao={() => void situacaoQ.refetch()} />
          </ErrorBoundary>
        </TabsContent>
        {/* Tarefa 15: `emitidos.tsx` (UX 4.1 e 4.6) e `produtos.tsx` + `perfis.tsx` (UX 5.6 e 5.7). */}
        <TabsContent value="emitidos" className="mt-0">
          <p className="text-sm text-muted-foreground">Em preparação.</p>
        </TabsContent>
        <TabsContent value="produtos" className="mt-0">
          <p className="text-sm text-muted-foreground">Em preparação.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
