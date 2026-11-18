'use client';

import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import type { SituacaoCupomFiscal } from '@/lib/erp-api';
import { linkPendentes, textoPendentes } from '@/lib/cupom';

/**
 * Faixa de pendentes (UX 4.2), acima das abas do Cupom Fiscal (vale nas três): âmbar, `role="status"`, com o link de 44 px. Um cupom =
 * direto a ele ("Ver o cupom"); vários = Emitidos em "Precisam de você" ("Ver"). O `pendentes` vem da situação do servidor.
 */
export function FaixaPendentes({ pendentes }: { pendentes: SituacaoCupomFiscal['pendentes'] }) {
  const texto = textoPendentes(pendentes);
  const link = linkPendentes(pendentes);
  if (!texto || !link) return null;
  return (
    <div role="status" className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="break-words">{texto}</p>
        <Link href={link.href} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
          {link.rotulo}
        </Link>
      </div>
    </div>
  );
}
