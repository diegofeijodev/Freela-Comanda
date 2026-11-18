'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { descartarCupom, type CupomDetalhe } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import { semToqueDuplo } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Motivos do descarte (UX 4.5); "Outro motivo" pede o texto. */
const MOTIVOS = ['Vou corrigir e emitir de novo', 'A venda não aconteceu', 'Emiti por engano', 'Outro motivo'] as const;
const OUTRO = 'Outro motivo';

type CupomParaDescartar = Pick<CupomDetalhe, 'id' | 'numero' | 'numero_reaproveitavel'>;

/**
 * "Descartar o cupom nº 12?" (UX 4.5; só em não saiu, a SEFAZ não tem e recusado): motivo obrigatório; foco inicial em "Manter o cupom".
 * Sucesso: toast "Cupom descartado." e a página mostra `descartado` com "Refazer com estes itens" (`onResultado`).
 */
export function DescartarDialog({ cupom, aberto, onFechar, onResultado }: {
  cupom: CupomParaDescartar;
  aberto: boolean;
  onFechar(): void;
  onResultado(c: CupomDetalhe): void;
}) {
  const preso = useRef(false);
  return (
    <AlertDialog open={aberto} onOpenChange={(o) => { if (!o && !preso.current) onFechar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={(e) => { if (preso.current) e.preventDefault(); }}>
        {aberto && <Conteudo cupom={cupom} preso={preso} onResultado={onResultado} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Conteudo({ cupom, preso, onResultado }: { cupom: CupomParaDescartar; preso: { current: boolean }; onResultado(c: CupomDetalhe): void }) {
  const [motivo, setMotivo] = useState<string>('');
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const caixa = useRef<HTMLParagraphElement>(null);

  const descartar = () => semToqueDuplo(emCurso, async () => {
    if (!motivo) return setAviso('Escolha o motivo.');
    if (motivo === OUTRO && !texto.trim()) return setAviso('Escreva o motivo.');
    setAviso(null);
    setErro(null);
    setOcupado(true);
    preso.current = true;
    try {
      const c = await descartarCupom(cupom.id, motivo === OUTRO ? texto.trim() : motivo);
      toast.success('Cupom descartado.');
      onResultado(c);
    } catch (e) {
      setErro(errMsg(e));
      setTimeout(() => caixa.current?.focus(), 0);
    } finally {
      preso.current = false;
      setOcupado(false);
    }
  });

  const semMotivo = !motivo || (motivo === OUTRO && !texto.trim());
  return (
    <div className="min-w-0 space-y-4">
      <AlertDialogHeader>
        <AlertDialogTitle>Descartar o cupom nº {cupom.numero}?</AlertDialogTitle>
        <AlertDialogDescription>
          {cupom.numero_reaproveitavel
            ? `A SEFAZ não registrou este cupom, então não precisa cancelar. O número ${cupom.numero} vai para o próximo cupom.`
            : 'A SEFAZ diz que outra nota já usa este número; ele não volta a ser usado.'}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <RadioGroup value={motivo} onValueChange={(v) => { setMotivo(v); setAviso(null); }} aria-label="Motivo do descarte" aria-required className="min-w-0 gap-1">
        {MOTIVOS.map((m, i) => (
          <Label key={m} htmlFor={`descarte-${i}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm font-normal">
            <RadioGroupItem id={`descarte-${i}`} value={m} className="h-5 w-5 shrink-0" disabled={ocupado} />
            <span className="min-w-0 break-words">{m}</span>
          </Label>
        ))}
      </RadioGroup>
      {motivo === OUTRO && (
        <div className="space-y-1">
          <Label htmlFor="descarte-texto">Escreva o motivo</Label>
          <Textarea id="descarte-texto" rows={2} maxLength={255} value={texto} disabled={ocupado} aria-required
            onChange={(e) => { setTexto(e.target.value); setAviso(null); }} />
        </div>
      )}
      {aviso && <p role="alert" className="text-sm text-destructive">{aviso}</p>}
      {erro && <p ref={caixa} tabIndex={-1} role="alert" className="break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm outline-none">{erro}</p>}
      <AlertDialogFooter className="gap-2">
        <AlertDialogCancel disabled={ocupado} className="h-11">Manter o cupom</AlertDialogCancel>
        <Button variant="destructive" className="h-11 whitespace-normal aria-disabled:opacity-50" aria-disabled={semMotivo || ocupado} disabled={ocupado}
          onClick={() => void descartar()}>
          {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Descartando…</> : 'Descartar o cupom'}
        </Button>
      </AlertDialogFooter>
      {semMotivo && !aviso && <p className="text-xs text-muted-foreground">Escolha o motivo.</p>}
    </div>
  );
}
