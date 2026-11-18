'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2 } from 'lucide-react';
import { cancelarCupom, statusDoErro, type CupomDetalhe } from '@/lib/erp-api';
import { errCode, errMsg } from '@/lib/db';
import { CHAVES_CUPOM, falhaIncerta, linhaPrazoCancelar, reais } from '@/lib/cupom';
import { horaSp, normalizarJustificativa, semToqueDuplo } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/** Atalhos do motivo (UX 4.3; decisão 9.4 em aberto): todos com 15 letras ou mais. */
const ATALHOS = ['Cliente desistiu da compra', 'Erro nos itens do cupom', 'Erro na forma de pagamento', 'Cupom emitido em duplicidade'];
// O tamanho como a SEFAZ vai receber: espaços repetidos viram um, sem espaço nas pontas (igual a `normalizarJustificativa`).
const tamanho = (t: string) => Array.from(t.replace(/[\s\u0085]+/g, ' ').trim()).length;

function erroDoMotivo(t: string): string | null {
  const j = normalizarJustificativa(t);
  if (j.ok) return null;
  if (j.erro === 'curta') return `Escreva o motivo com pelo menos 15 letras (faltam ${15 - tamanho(t)}).`;
  if (j.erro === 'longa') return 'Use no máximo 255 letras.';
  return 'Use só letras, números e pontuação comum (sem emoji).';
}

type CupomParaCancelar = Pick<CupomDetalhe, 'id' | 'numero' | 'ambiente' | 'valor_total_centavos' | 'autorizada_em' | 'dh_emi' | 'cancelar_ate'>;

/**
 * "Cancelar o cupom nº 12 na SEFAZ?" (UX 4.3): o prazo vem do servidor (`cancelar_ate`) e a contagem usa a hora do servidor (`agora`, que
 * a página atualiza). Foco inicial em "Voltar sem cancelar"; enviando, Esc e toque fora não fecham. O resultado vai para a página
 * (`onResultado`): 135 fecha com o toast, 573 e sem resposta fecham em `cancelando`; a recusa fica aqui, com "Tentar de novo".
 */
export function CancelarDialog({ cupom, aberto, agora, onFechar, onResultado }: {
  cupom: CupomParaCancelar;
  aberto: boolean;
  agora: Date;
  onFechar(): void;
  onResultado(c: CupomDetalhe): void;
}) {
  // enviando, o diálogo fica preso: Esc não fecha (o AlertDialog já não fecha no toque fora)
  const preso = useRef(false);
  return (
    <AlertDialog open={aberto} onOpenChange={(o) => { if (!o && !preso.current) onFechar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={(e) => { if (preso.current) e.preventDefault(); }}>
        {aberto && <Conteudo cupom={cupom} agora={agora} preso={preso} onResultado={onResultado} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Conteudo({ cupom, agora, preso, onResultado }: {
  cupom: CupomParaCancelar; agora: Date; preso: { current: boolean }; onResultado(c: CupomDetalhe): void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foraDoPrazo, setForaDoPrazo] = useState(false);
  const [recusado, setRecusado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [anuncio, setAnuncio] = useState('');
  const emCurso = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const marco = useRef<'longe' | '5' | '1' | 'fim'>('longe');

  const hora = horaSp(cupom.autorizada_em ?? cupom.dh_emi);
  const prazo = cupom.cancelar_ate ? linhaPrazoCancelar(cupom.cancelar_ate, agora, 'longo') : null;
  const acabou = foraDoPrazo || prazo === null || prazo.acabou;
  const fraseFora = `Passaram 30 minutos da autorização (às ${hora}). A SEFAZ não aceita mais cancelar este cupom. Fale com o contador.`;

  // anúncio só nos marcos (faltando 5 min, 1 min e no fim), nunca a cada minuto (UX 4.3, WCAG 4.1.3)
  useEffect(() => {
    if (!cupom.cancelar_ate) return;
    const resta = new Date(cupom.cancelar_ate).getTime() - agora.getTime();
    const agoraMarco = resta <= 0 ? 'fim' : resta <= 60_000 ? '1' : resta <= 5 * 60_000 ? '5' : 'longe';
    if (agoraMarco === marco.current) return;
    marco.current = agoraMarco;
    if (agoraMarco === '5') setAnuncio('Faltam 5 minutos para o prazo.');
    else if (agoraMarco === '1') setAnuncio('Falta 1 minuto para o prazo.');
    else if (agoraMarco === 'fim') setAnuncio(fraseFora);
  }, [agora, cupom.cancelar_ate, fraseFora]);

  useEffect(() => {
    if (erro || erroMotivo || (acabou && !ocupado)) caixa.current?.focus();
  }, [erro, erroMotivo, acabou, ocupado]);

  const cancelar = () => semToqueDuplo(emCurso, async () => {
    const e = erroDoMotivo(motivo);
    if (motivo.trim() === '') return;
    if (e) return setErroMotivo(e);
    setErroMotivo(null);
    setErro(null);
    setOcupado(true);
    preso.current = true;
    try {
      const c = await cancelarCupom(cupom.id, motivo);
      if (c.situacao === 'autorizado') {
        // recusa desta resposta (o GET depois não a repete): fica no diálogo, com "Tentar de novo"
        setRecusado(true);
        setErro(c.mensagem ?? 'A SEFAZ não aceitou o cancelamento. O cupom continua valendo.');
        onResultado(c);
        return;
      }
      onResultado(c);
    } catch (x) {
      if (errCode(x) === 'NFCE_CANCELAMENTO_FORA_DO_PRAZO') setForaDoPrazo(true);
      setErro(errMsg(x));
      // sem resposta do nosso servidor o pedido pode ter saído: relê o cupom (pode já estar `cancelando`; leva pré-final, item 16)
      if (falhaIncerta(statusDoErro(x), errCode(x))) void qc.invalidateQueries({ queryKey: CHAVES_CUPOM.cupom(cupom.id) });
    } finally {
      preso.current = false;
      setOcupado(false);
    }
  });

  const n = tamanho(motivo);
  const semMotivo = motivo.trim() === '';
  return (
    <div className="min-w-0 space-y-4">
      <AlertDialogHeader>
        <AlertDialogTitle>Cancelar o cupom nº {cupom.numero} na SEFAZ?</AlertDialogTitle>
        <AlertDialogDescription className="space-y-1">
          <span className="block">
            O cupom de {reais(BigInt(cupom.valor_total_centavos))}, das {hora}, deixa de valer e a venda sai do estoque. Depois de cancelado, não dá
            para desfazer.
          </span>
          {cupom.ambiente === 'homologacao' && <span className="block">É um cupom de teste: o cancelamento também é de teste.</span>}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {!acabou && prazo && (
        <p className={cn('flex items-start gap-1 text-sm', prazo.perto && 'text-amber-500')}>
          {prazo.perto && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{prazo.texto}</span>
        </p>
      )}
      <p className="sr-only" aria-live="polite">{anuncio}</p>

      {!acabou && (
        <div className="space-y-2">
          <Label htmlFor="cancelar-motivo">Por que está cancelando? (vai para a SEFAZ)</Label>
          <div className="flex flex-wrap gap-2">
            {ATALHOS.map((a) => (
              <Button key={a} type="button" variant="outline" className="h-11 whitespace-normal" disabled={ocupado}
                onClick={() => { setMotivo(a); setErroMotivo(null); }}>{a}</Button>
            ))}
          </div>
          <Textarea
            id="cancelar-motivo" rows={3} value={motivo} disabled={ocupado} aria-invalid={erroMotivo !== null}
            aria-describedby="cancelar-motivo-contador"
            onChange={(e) => { setMotivo(e.target.value); setErroMotivo(null); }}
            onBlur={() => { if (!semMotivo) setErroMotivo(erroDoMotivo(motivo)); }}
          />
          <p id="cancelar-motivo-contador" className="text-xs text-muted-foreground">{n} {n === 1 ? 'letra' : 'letras'} (mínimo 15, máximo 255)</p>
        </div>
      )}

      {(erroMotivo || erro || acabou) && (
        <div ref={caixa} tabIndex={-1} role="alert" className="break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm outline-none">
          {acabou ? (foraDoPrazo && erro ? erro : fraseFora) : (erroMotivo ?? erro)}
        </div>
      )}

      {ocupado && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Cancelando na SEFAZ…
        </p>
      )}

      <AlertDialogFooter className="gap-2">
        <AlertDialogCancel disabled={ocupado} className="h-11">Voltar sem cancelar</AlertDialogCancel>
        {!acabou && (
          <div className="flex flex-col gap-1">
            <Button
              variant="destructive" className="h-11 whitespace-normal aria-disabled:opacity-50" aria-disabled={semMotivo || ocupado} disabled={ocupado}
              onClick={() => void cancelar()}
            >
              {recusado && erro ? 'Tentar de novo' : 'Cancelar o cupom'}
            </Button>
            {semMotivo && <p className="text-xs text-muted-foreground">Escreva o motivo.</p>}
          </div>
        )}
      </AlertDialogFooter>
    </div>
  );
}
