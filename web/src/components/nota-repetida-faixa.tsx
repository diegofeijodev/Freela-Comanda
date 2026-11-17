'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { NotaParecida } from '@/lib/erp-api';
import { fraseChaveIgual, linhaEntrada, linhaNota } from '@/lib/nota-repetida';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export type EstadoRepetida =
  | { tipo: 'chave_igual'; nota: NotaParecida }
  | { tipo: 'parecida'; parecidas: NotaParecida[]; confirmada: boolean };

// Botões altos (44 px) e com quebra de linha: o texto "É outra nota, lançar mesmo assim" não cabe numa linha em 360 px.
const BOTAO = 'h-auto min-h-11 w-full whitespace-normal py-2 text-center sm:w-auto';

/**
 * Faixa acima do quadro "2. Dados da nota". Uma coluna no celular, botões empilhados (lado a lado só de `sm` para cima).
 * Ao aparecer recebe foco e rolagem só se `focar` (o admin ainda não mexeu em nada); depois de confirmar ou voltar atrás, o foco
 * volta para a faixa (o botão que ele tocou saiu da tela).
 */
export function NotaRepetidaFaixa({ estado, focar, onNaoLancar, onConfirmar, onVoltarAtras }: {
  estado: EstadoRepetida; focar: boolean; onNaoLancar(): void; onConfirmar(): void; onVoltarAtras(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anterior = useRef<boolean | null>(null);
  const confirmada = estado.tipo === 'parecida' && estado.confirmada;

  useEffect(() => {
    if (anterior.current === null) {
      anterior.current = confirmada;
      if (!focar) return;
      ref.current?.focus();
      ref.current?.scrollIntoView?.({ block: 'center' });
    } else if (anterior.current !== confirmada) {
      anterior.current = confirmada;
      ref.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `focar` só vale na montagem
  }, [confirmada]);

  if (estado.tipo === 'chave_igual') {
    return (
      <div ref={ref} role="alert" tabIndex={-1} className="no-print rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm outline-none sm:p-4">
        <p className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 break-words font-medium">{fraseChaveIgual(estado.nota)}</span>
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className={BOTAO} onClick={onNaoLancar}>Não lançar esta nota</Button>
        </div>
      </div>
    );
  }

  if (estado.confirmada) {
    return (
      <div ref={ref} role="status" tabIndex={-1} className="no-print rounded-lg border bg-muted/40 p-3 text-sm outline-none sm:p-4">
        <p className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 break-words">Você confirmou que esta é outra nota. Ao dar entrada, ela fica marcada como possível repetição.</span>
        </p>
        <Button type="button" variant="link" className="mt-1 h-auto min-h-11 px-0" onClick={onVoltarAtras}>Voltar atrás</Button>
      </div>
    );
  }

  const [nova, ...outras] = estado.parecidas;
  return (
    <div ref={ref} role="alert" aria-live="assertive" tabIndex={-1} className="no-print rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm outline-none sm:p-4">
      <p className="flex items-start gap-2 font-medium">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <span className="min-w-0 break-words">Parece que esta nota já foi lançada</span>
      </p>
      <div className="mt-1 space-y-0.5 pl-6">
        <p className="break-words">{nova!.fornecedor_nome}</p>
        <p className="break-words">{linhaNota(nova!)}</p>
        <p className="break-words text-muted-foreground">{linhaEntrada(nova!)}</p>
        {outras.length > 0 && (
          <details className="pt-1">
            <summary className="flex min-h-11 cursor-pointer items-center">e mais {outras.length} {outras.length === 1 ? 'parecida' : 'parecidas'}</summary>
            <ul className="space-y-2 pb-1">
              {outras.slice(0, 4).map((n) => (
                <li key={n.id} className="break-words">
                  <div>{linhaNota(n)}</div>
                  <div className="text-muted-foreground">{linhaEntrada(n)}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className={cn('mt-3 flex flex-col gap-2 sm:flex-row')}>
        <Button type="button" variant="outline" className={BOTAO} onClick={onNaoLancar}>Não lançar esta nota</Button>
        <Button type="button" variant="outline" className={BOTAO} onClick={onConfirmar}>É outra nota, lançar mesmo assim</Button>
      </div>
    </div>
  );
}

/** Aberto quando `frase !== null`. "Não lançar" tem o foco inicial; Esc também só fecha. */
export function NotaRepetidaDialogo({ frase, onNaoLancar, onLancar }: { frase: string | null; onNaoLancar(): void; onLancar(): void }) {
  return (
    <AlertDialog open={frase !== null} onOpenChange={(o) => { if (!o) onNaoLancar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Esta nota parece já lançada</AlertDialogTitle>
          <AlertDialogDescription>{frase} Se for a mesma nota, o estoque e as contas a pagar ficam em dobro.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Não lançar</AlertDialogCancel>
          <AlertDialogAction className="h-11" onClick={(e) => { e.preventDefault(); onLancar(); }}>Lançar mesmo assim</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
