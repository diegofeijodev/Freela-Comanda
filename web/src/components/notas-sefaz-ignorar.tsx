'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ignorarNotaSefaz, type MotivoIgnorar, type NotaSefaz } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import { TEXTO_MOTIVO } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// Só os 4 motivos que o usuário escolhe; "Marcada como vista" nasce do "Marcar como visto".
const MOTIVOS: Exclude<MotivoIgnorar, 'cancelamento_conferido'>[] = ['lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco', 'outro'];
const AJUDA_NAO_RECONHECO = 'Se você não conhece este fornecedor, fale com o seu contador. Aqui a nota só fica escondida.';

function Conteudo({ nota, onIgnorada }: { nota: NotaSefaz; onIgnorada(n: NotaSefaz): void }) {
  const [motivo, setMotivo] = useState<MotivoIgnorar | ''>('');
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);

  async function confirmar() {
    if (enviando.current) return;
    if (!motivo) return setAviso('Escolha o motivo.');
    if (motivo === 'outro' && !texto.trim()) return setAviso('Escreva o motivo.');
    setAviso(null);
    setErro(null);
    enviando.current = true;
    setOcupado(true);
    try {
      onIgnorada(await ignorarNotaSefaz(nota.id, motivo, motivo === 'outro' ? texto.trim() : undefined));
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  }

  const semMotivo = !motivo || (motivo === 'outro' && !texto.trim());
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Ignorar esta nota?</AlertDialogTitle>
        <AlertDialogDescription>Ela sai da lista &lsquo;A conferir&rsquo;. Nada é enviado à SEFAZ e nada é lançado.</AlertDialogDescription>
      </AlertDialogHeader>
      <RadioGroup value={motivo} onValueChange={(v) => { setMotivo(v as MotivoIgnorar); setAviso(null); }} aria-label="Motivo" className="gap-1">
        {MOTIVOS.map((m) => (
          <div key={m}>
            <Label htmlFor={`motivo-${m}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm font-normal">
              <RadioGroupItem id={`motivo-${m}`} value={m} className="h-5 w-5 shrink-0" />
              <span className="min-w-0 break-words">{TEXTO_MOTIVO[m]}</span>
            </Label>
            {m === 'nao_reconheco' && motivo === m && <p className="ml-9 text-xs text-muted-foreground">{AJUDA_NAO_RECONHECO}</p>}
          </div>
        ))}
      </RadioGroup>
      {motivo === 'outro' && (
        <div className="space-y-1">
          <Label htmlFor="motivo-texto">Escreva o motivo</Label>
          <Textarea id="motivo-texto" rows={2} maxLength={200} value={texto} onChange={(e) => { setTexto(e.target.value); setAviso(null); }} />
        </div>
      )}
      {aviso && <p role="alert" className="text-sm text-destructive">{aviso}</p>}
      {erro && <p role="alert" className="break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{erro}</p>}
      <AlertDialogFooter className="gap-2">
        <AlertDialogCancel disabled={ocupado} className="h-11">Cancelar</AlertDialogCancel>
        <Button className="h-11 aria-disabled:opacity-50" aria-disabled={semMotivo || ocupado} disabled={ocupado} onClick={() => void confirmar()}>
          {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Ignorando…</> : erro ? 'Tentar de novo' : 'Ignorar nota'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/** Diálogo único de "Ignorar…" (aberto quando `nota !== null`). Motivo obrigatório; o conteúdo é recriado a cada nota, então o estado nunca vaza. */
export function NotasSefazIgnorar({ nota, onFechar, onIgnorada }: { nota: NotaSefaz | null; onFechar(): void; onIgnorada(n: NotaSefaz): void }) {
  return (
    <AlertDialog open={nota !== null} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <AlertDialogContent>{nota && <Conteudo key={nota.id} nota={nota} onIgnorada={onIgnorada} />}</AlertDialogContent>
    </AlertDialog>
  );
}
