'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { linhasConferir, mascaraCnpj, mascaraCpf, NOME_PAGAMENTO, reais, type TPag } from '@/lib/cupom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** O que o "Conferir o cupom" mostra (UX 2.5): tudo já calculado pela aba Emitir. */
export type ResumoConferir = {
  teste: boolean;
  itens: { nome: string; quantidade: string; valor: bigint }[];
  desconto: bigint;
  total: bigint;
  pagamentos: { tPag: TPag; valor: bigint }[];
  troco: bigint;
  documento: { tipo: 'cpf' | 'cnpj'; valor: string } | null;
};

/**
 * Fases do envio: conferir → enviando → (o cupom abre na página dele) | erro antes do envio (a venda fica, a chave também) | "não sei se
 * saiu" (`incerta`: a venda trava; `procurando` = a única leitura pela chave em andamento) | `nada` (a leitura não achou: destrava).
 */
export type FaseConferir =
  | { fase: 'conferir' }
  | { fase: 'enviando' }
  | { fase: 'erro'; mensagem: string; verEmitidos: boolean }
  | { fase: 'incerta'; procurando: boolean }
  | { fase: 'nada' };

const SEM_X = '[&>button.absolute]:hidden';

/**
 * "Conferir o cupom": `Sheet` de baixo no celular (até 85% da altura, rolagem interna) e `Dialog` no computador. Enquanto envia (e
 * enquanto procura pela chave), não fecha: Esc, toque fora e o X não fazem nada. O foco vai para o título ao abrir, para a caixa de erro
 * quando ela aparece e volta ao botão da barra ao fechar (`onFechado`).
 */
export function ConferirSheet({
  aberto, fase, resumo, onEmitir, onTentarDeNovo, onVerEmitidos, onFechar, onFechado,
}: {
  aberto: boolean;
  fase: FaseConferir;
  resumo: ResumoConferir | null;
  onEmitir(): void;
  onTentarDeNovo(): void;
  onVerEmitidos(): void;
  onFechar(): void;
  onFechado(): void;
}) {
  const celular = useIsMobile();
  const titulo = useRef<HTMLHeadingElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const idResumo = useId();
  const preso = fase.fase === 'enviando' || (fase.fase === 'incerta' && fase.procurando);

  // a caixa de erro (ou do "não sei se saiu") ganha o foco quando aparece
  useEffect(() => {
    if (fase.fase === 'erro' || fase.fase === 'incerta' || fase.fase === 'nada') caixa.current?.focus();
  }, [fase]);

  const trava = {
    onEscapeKeyDown: (e: Event) => { if (preso) e.preventDefault(); },
    onPointerDownOutside: (e: Event) => { if (preso) e.preventDefault(); },
    onInteractOutside: (e: Event) => { if (preso) e.preventDefault(); },
    onOpenAutoFocus: (e: Event) => { e.preventDefault(); titulo.current?.focus(); },
    onCloseAutoFocus: (e: Event) => { e.preventDefault(); onFechado(); },
    'aria-describedby': idResumo,
  };
  const mudou = (o: boolean) => { if (!o && !preso) onFechar(); };

  const corpo = resumo && (
    <Corpo
      fase={fase} resumo={resumo} idResumo={idResumo} titulo={titulo} caixa={caixa}
      onEmitir={onEmitir} onTentarDeNovo={onTentarDeNovo} onVerEmitidos={onVerEmitidos} onFechar={onFechar}
    />
  );

  if (celular) {
    return (
      <Sheet open={aberto} onOpenChange={mudou}>
        <SheetContent side="bottom" {...trava} className={cn('max-h-[85dvh] overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]', SEM_X)}>
          {corpo}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={aberto} onOpenChange={mudou}>
      <DialogContent {...trava} className={cn('max-h-[90dvh] overflow-y-auto sm:max-w-lg', SEM_X)}>{corpo}</DialogContent>
    </Dialog>
  );
}

function Corpo({
  fase, resumo, idResumo, titulo, caixa, onEmitir, onTentarDeNovo, onVerEmitidos, onFechar,
}: {
  fase: FaseConferir;
  resumo: ResumoConferir;
  idResumo: string;
  titulo: React.RefObject<HTMLHeadingElement | null>;
  caixa: React.RefObject<HTMLDivElement | null>;
  onEmitir(): void;
  onTentarDeNovo(): void;
  onVerEmitidos(): void;
  onFechar(): void;
}) {
  const { linhas, resto } = linhasConferir(resumo.itens);
  const enviando = fase.fase === 'enviando';
  return (
    <div className="space-y-4" aria-busy={enviando || (fase.fase === 'incerta' && fase.procurando)}>
      <SheetTitle ref={titulo} tabIndex={-1} className="text-lg font-semibold outline-none">Conferir o cupom</SheetTitle>
      <div id={idResumo} className="space-y-3 text-sm">
        <SheetDescription className="text-sm text-muted-foreground">
          {resumo.teste
            ? 'Cupom de teste: vai para a SEFAZ, mas não vale como documento fiscal.'
            : 'Este cupom vale como documento fiscal e vai para a SEFAZ em nome da empresa.'}
        </SheetDescription>
        <ul className="space-y-1">
          {linhas.map((l, k) => (
            <li key={k} className="flex justify-between gap-3"><span className="min-w-0 break-words">{l.texto}</span><span className="shrink-0">{l.valor}</span></li>
          ))}
          {resto && <li className="text-muted-foreground">{resto}</li>}
        </ul>
        {resumo.desconto > 0n && <Linha rotulo="Desconto" valor={`− ${reais(resumo.desconto)}`} />}
        <Linha rotulo={<strong>Total</strong>} valor={<strong>{reais(resumo.total)}</strong>} />
        {resumo.pagamentos.map((p, k) => <Linha key={k} rotulo={NOME_PAGAMENTO[p.tPag]} valor={reais(p.valor)} />)}
        {resumo.troco > 0n && <Linha rotulo="Troco" valor={reais(resumo.troco)} />}
        <p>
          {resumo.documento
            ? resumo.documento.tipo === 'cpf'
              ? `CPF ${mascaraCpf(resumo.documento.valor)}`
              : `CNPJ ${mascaraCnpj(resumo.documento.valor)}`
            : 'Sem CPF na nota'}
        </p>
      </div>

      {fase.fase === 'erro' && (
        <div ref={caixa} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm outline-none">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 break-words">{fase.mensagem}</p>
        </div>
      )}
      {fase.fase === 'incerta' && (
        <div ref={caixa} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm outline-none">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="break-words">Não consegui falar com o servidor do Freela Comanda. O cupom pode ter saído ou não.</p>
            <p className="break-words">Tentar de novo não emite dois cupons: se o primeiro chegou, você vê esse mesmo cupom.</p>
          </div>
        </div>
      )}
      {fase.fase === 'nada' && (
        <div ref={caixa} tabIndex={-1} role="status" className="rounded-lg border bg-muted/40 p-3 text-sm outline-none">
          Nada foi emitido. Pode corrigir a venda ou emitir de novo.
        </div>
      )}

      {enviando ? (
        <div role="status" aria-live="polite" className="space-y-1 text-sm">
          <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Enviando à SEFAZ…</p>
          <p className="text-muted-foreground">Leva alguns segundos. Não feche esta tela.</p>
        </div>
      ) : fase.fase === 'incerta' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-12 w-full sm:flex-1" aria-disabled={fase.procurando} disabled={fase.procurando} onClick={onTentarDeNovo}>
            {fase.procurando && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}Tentar de novo
          </Button>
          <Button variant="outline" className="h-12 w-full sm:flex-1" disabled={fase.procurando} onClick={onVerEmitidos}>Ver cupons emitidos</Button>
        </div>
      ) : fase.fase === 'erro' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-12 w-full sm:flex-1" onClick={onFechar}>Voltar e corrigir</Button>
          {fase.verEmitidos && <Button variant="outline" className="h-12 w-full sm:flex-1" onClick={onVerEmitidos}>Ver cupons emitidos</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-12 w-full sm:flex-1" onClick={onEmitir}>Emitir cupom</Button>
          <Button variant="outline" className="h-12 w-full sm:flex-1" onClick={onFechar}>Voltar e corrigir</Button>
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: ReactNode; valor: ReactNode }) {
  return <p className="flex justify-between gap-3"><span>{rotulo}</span><span className="shrink-0">{valor}</span></p>;
}
