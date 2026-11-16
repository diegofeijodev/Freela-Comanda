'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleAlert, X } from 'lucide-react';
import { useCertificado } from '@/hooks/use-certificado';
import { faixaDoCertificado } from '@/lib/certificado';
import { cn } from '@/lib/utils';

const TOM = {
  warn: 'border-amber-500/30 bg-amber-500/10',
  warn_forte: 'border-amber-500/60 bg-amber-500/20',
  bad: 'border-destructive/40 bg-destructive/10',
} as const;

/**
 * Faixa de aviso do certificado digital, no topo do conteúdo. Só é montada para o admin (o layout decide), porque a consulta
 * é só dele. Compartilha o cache `['certificado']` com o painel de Configurações. Carregando ou com erro: não mostra nada.
 * "Esconder" vale só até recarregar a página (estado em memória, sem storage) e só existe a 8–30 dias.
 */
export function CertificadoFaixa() {
  const { data } = useCertificado(true);
  const [escondida, setEscondida] = useState(false);
  const faixa = faixaDoCertificado(data, new Date());
  if (!faixa || (escondida && faixa.dispensavel)) return null;

  return (
    <div
      role={faixa.tom === 'bad' ? 'alert' : 'status'}
      className={cn('no-print mb-4 flex items-stretch rounded-lg border text-sm', TOM[faixa.tom])}
    >
      <Link href="/configuracoes#certificado-digital" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2">
        <CircleAlert className={cn('h-4 w-4 shrink-0', faixa.tom === 'bad' ? 'text-destructive' : 'text-amber-500')} aria-hidden />
        <span className="min-w-0 flex-1 break-words">{faixa.texto}</span>
        <span className="flex shrink-0 items-center gap-1 font-medium">Ver <ArrowRight className="h-4 w-4" aria-hidden /></span>
      </Link>
      {faixa.dispensavel && (
        <button
          type="button"
          aria-label="Esconder aviso"
          onClick={() => setEscondida(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center self-center text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
