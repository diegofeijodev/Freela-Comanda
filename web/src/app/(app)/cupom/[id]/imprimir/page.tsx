'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cupomFiscal, danfeCupom } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import { useMe } from '@/lib/auth';
import { CHAVES_CUPOM } from '@/lib/cupom';
import { horaSp } from '@/lib/notas-sefaz';
import { Empty } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DanfePapel } from '@/components/cupom/danfe';

// Papel de 80 mm (desenho §5.6; UX 3.4). Só nesta página (no `globals.css` mudaria toda impressão do app): a margem do `main` sai e só o
// DANFE vai para o papel (o menu, a barra e a ajuda já são `no-print`). O papel de 80 mm se escolhe no diálogo de impressão (vem do
// driver da impressora): `size: 80mm auto` não é CSS válido e o Chromium o descarta (Ruling T16-2). Na impressora térmica de 80 mm a
// largura útil é de 72 mm (as bordas não imprimem): margem 0 e o DANFE com 72 mm, no meio. Também imprime em A4.
const CSS_IMPRESSAO = `
@page { margin: 0; }
@media print {
  main { padding: 0 !important; max-width: none !important; }
  section.danfe { width: 72mm !important; max-width: 72mm !important; margin: 0 auto !important; padding: 0 !important; }
}
`;

export default function ImprimirPage() {
  return <Suspense fallback={null}><Imprimir /></Suspense>;
}

/**
 * `/cupom/[id]/imprimir` (UX 3.4): o DANFE do XML guardado. Com `?imprimir=1` (o botão "Imprimir" do cupom), chama `window.print()` UMA
 * vez, depois que o QR desenha. Cupom que não está autorizado não tem o que imprimir.
 */
function Imprimir() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { data: me } = useMe();
  const admin = me?.perfil === 'admin';
  const cupomQ = useQuery({ queryKey: CHAVES_CUPOM.cupom(id), queryFn: () => cupomFiscal(id), enabled: admin });
  const c = cupomQ.data;
  const danfeQ = useQuery({ queryKey: CHAVES_CUPOM.danfe(id), queryFn: () => danfeCupom(id), enabled: admin && c?.situacao === 'autorizado' });
  const imprimiu = useRef(false);
  const automatico = params.get('imprimir') === '1';

  useEffect(() => {
    if (c) document.title = `Cupom nº ${c.numero} — imprimir`;
  }, [c]);

  const qrPronto = useCallback(() => {
    if (!automatico || imprimiu.current) return;
    imprimiu.current = true;
    // um quadro depois do QR, para o navegador já ter pintado a página
    requestAnimationFrame(() => window.print());
  }, [automatico]);

  if (me && !admin) return <Empty>Acesso negado.</Empty>;

  const voltar = (
    <Link href={`/cupom/${id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">← Voltar ao cupom</Link>
  );

  if (cupomQ.isError) {
    return (
      <div className="no-print space-y-3 rounded-lg border p-4 text-sm">
        <p>{errMsg(cupomQ.error)}</p>
        {voltar}
      </div>
    );
  }
  if (!c) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-11 w-48" /><Skeleton className="mx-auto h-96 w-full max-w-[80mm]" /></div>;

  if (c.situacao !== 'autorizado') {
    return (
      <div className="space-y-3 rounded-lg border p-4 text-sm">
        <p>
          {c.situacao === 'cancelado' && c.cancelado_em
            ? `Cupom cancelado às ${horaSp(c.cancelado_em)}: não se imprime de novo.`
            : 'Este cupom não está autorizado, então não há cupom para imprimir.'}
        </p>
        <Button asChild variant="outline" className="no-print h-11 w-full sm:w-auto"><Link href={`/cupom/${id}`}>Voltar ao cupom</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <style>{CSS_IMPRESSAO}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        {voltar}
        <Button className="h-11" onClick={() => window.print()}>Imprimir</Button>
      </div>
      <p className="no-print text-sm text-muted-foreground">
        Escolha a impressora de cupom (80 mm). Na janela de impressão, deixe as margens em “Nenhuma” e a escala em 100%. Também imprime em folha A4.
      </p>
      {danfeQ.data ? (
        <DanfePapel danfe={danfeQ.data} onQrPronto={qrPronto} />
      ) : danfeQ.isError ? (
        <div className="no-print space-y-2 rounded-lg border p-3 text-sm">
          <p>{errMsg(danfeQ.error)}</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => danfeQ.refetch()}>Tentar de novo</Button>
        </div>
      ) : (
        <Skeleton className="mx-auto h-96 w-full max-w-[80mm]" />
      )}
    </div>
  );
}
