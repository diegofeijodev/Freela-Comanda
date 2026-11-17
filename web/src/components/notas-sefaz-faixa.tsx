'use client';

import { CircleAlert } from 'lucide-react';
import type { SituacaoSefazLigada } from '@/lib/erp-api';
import { faixaCancelamento, faixaPrazo } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';

/**
 * Faixa vermelha acima das abas (visível nas duas): uma nota lançada que o fornecedor cancelou depois. Só avisa; nada no estoque ou nas
 * contas é mexido sozinho. Some quando todas forem marcadas como vistas (a lista vem da situação da busca).
 */
export function FaixaCancelamentoSefaz({ canceladas, onVer }: { canceladas: SituacaoSefazLigada['canceladas_depois']; onVer(): void }) {
  const frase = faixaCancelamento(canceladas);
  if (!frase) return null;
  return (
    <div role="alert" className="no-print rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm sm:p-4">
      <p className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span className="min-w-0 break-words font-medium">{frase}</span>
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={onVer}>Ver</Button>
      </div>
    </div>
  );
}

/**
 * Faixa âmbar do prazo (UX §8), abaixo da de cancelamento e acima das abas: notas que precisam de uma resposta final à SEFAZ (o servidor
 * manda em `respostas.prazos_perto`, a que vence primeiro na frente, mesmo sem a variável no servidor). Só avisa; "Ver" abre "A conferir"
 * com o foco na primeira. Com as respostas desligadas, a frase não sugere a ação (o botão "Não reconheço…" não existe).
 */
export function FaixaPrazoSefaz({ prazos, respostasLigadas, onVer }: {
  prazos: SituacaoSefazLigada['respostas']['prazos_perto']; respostasLigadas: boolean; onVer(): void;
}) {
  const frase = faixaPrazo(prazos, respostasLigadas);
  if (!frase) return null;
  return (
    <div role="status" data-faixa="prazo" className="no-print rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:p-4">
      <p className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <span className="min-w-0 break-words font-medium">{frase}</span>
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={onVer}>Ver</Button>
      </div>
    </div>
  );
}
