'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ignorarNotaSefaz, type MotivoIgnorar, type NotaSefaz } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import { avisoDoMotivo, normalizarJustificativa, ROTULO_AVISAR_COMPRA, TEXTO_MOTIVO, type Justificativa } from '@/lib/notas-sefaz';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type MotivoTela = Exclude<MotivoIgnorar, 'cancelamento_conferido'>;
// Os motivos que o usuário escolhe ("Marcada como vista" nasce do "Marcar como visto"). "A compra não aconteceu" só existe quando a SEFAZ
// pode ser avisada (respostas ligadas e nota respondível): sem o aviso o servidor recusa esse motivo.
const MOTIVOS_E2: MotivoTela[] = ['lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco', 'outro'];
const MOTIVOS_RESPOSTA: MotivoTela[] = ['lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco', 'compra_nao_aconteceu', 'outro'];
const ERRO_JUSTIFICATIVA: Record<Extract<Justificativa, { ok: false }>['erro'], string> = {
  curta: 'Conte o que houve com pelo menos 15 letras.',
  longa: 'Use no máximo 255 letras.',
  caractere: 'Use só letras, números e pontuação comum (sem emoji).',
};
// O contador mostra o tamanho como a SEFAZ vai receber: espaços repetidos viram um, sem espaço nas pontas (igual a normalizarJustificativa).
const tamanhoJustificativa = (t: string) => Array.from(t.replace(/[\s\u0085]+/g, ' ').trim()).length;

function Conteudo({ nota, respostasLigadas, motivoInicial, onIgnorada }: {
  nota: NotaSefaz; respostasLigadas: boolean; motivoInicial?: MotivoIgnorar; onIgnorada(n: NotaSefaz, avisou: boolean): void;
}) {
  const podeResponder = nota.resposta?.pode_responder === true;
  const comResposta = respostasLigadas && podeResponder;
  const motivos = comResposta ? MOTIVOS_RESPOSTA : MOTIVOS_E2;
  const [motivo, setMotivo] = useState<MotivoIgnorar | ''>(motivoInicial && (motivos as MotivoIgnorar[]).includes(motivoInicial) ? motivoInicial : '');
  const [texto, setTexto] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [avisarCompra, setAvisarCompra] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroTexto, setErroTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);

  const doMotivo = motivo ? avisoDoMotivo(motivo, podeResponder, respostasLigadas) : null;

  async function confirmar() {
    if (enviando.current) return;
    if (!motivo || !doMotivo) return setAviso('Escolha o motivo.');
    if (motivo === 'outro' && !texto.trim()) return setAviso('Escreva o motivo.');
    let textoEnviado: string | undefined = motivo === 'outro' ? texto.trim() : undefined;
    if (motivo === 'compra_nao_aconteceu') {
      // Conferida aqui com as mesmas regras do servidor; vai já normalizada (o servidor confere de novo).
      const j = normalizarJustificativa(justificativa);
      if (!j.ok) return setErroTexto(ERRO_JUSTIFICATIVA[j.erro]);
      textoEnviado = j.texto;
    }
    // `sempre` avisa; `opcional` = o que a caixa diz; `nunca` = não manda o campo (o Ignorar da entrega 2).
    const avisar = doMotivo.avisa === 'sempre' ? true : doMotivo.avisa === 'opcional' ? avisarCompra : undefined;
    setAviso(null);
    setErroTexto(null);
    setErro(null);
    enviando.current = true;
    setOcupado(true);
    try {
      onIgnorada(await ignorarNotaSefaz(nota.id, motivo, textoEnviado, avisar), avisar === true);
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  }

  const semMotivo = !motivo || (motivo === 'outro' && !texto.trim()) || (motivo === 'compra_nao_aconteceu' && !justificativa.trim());
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Ignorar esta nota?</AlertDialogTitle>
        <AlertDialogDescription>
          {comResposta ? <>Ela sai da lista &lsquo;A conferir&rsquo;. Nada é lançado.</> : <>Ela sai da lista &lsquo;A conferir&rsquo;. Nada é enviado à SEFAZ e nada é lançado.</>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <RadioGroup
        value={motivo}
        onValueChange={(v) => { setMotivo(v as MotivoIgnorar); setAviso(null); setErroTexto(null); }}
        aria-label="Motivo" className="min-w-0 gap-1"
      >
        {motivos.map((m) => (
          <div key={m} className="min-w-0">
            <Label htmlFor={`motivo-${m}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm font-normal">
              <RadioGroupItem id={`motivo-${m}`} value={m} className="h-5 w-5 shrink-0" />
              <span className="min-w-0 break-words">{TEXTO_MOTIVO[m]}</span>
            </Label>
            {motivo === m && doMotivo && (
              <div className="ml-9 min-w-0 space-y-2">
                {doMotivo.avisa === 'opcional' && (
                  <Label htmlFor="motivo-avisar-compra" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-normal">
                    <Checkbox id="motivo-avisar-compra" checked={avisarCompra} onCheckedChange={(c) => setAvisarCompra(c === true)} className="h-5 w-5" />
                    <span className="min-w-0 break-words">{ROTULO_AVISAR_COMPRA}</span>
                  </Label>
                )}
                {m === 'compra_nao_aconteceu' && (
                  <div className="space-y-1">
                    <Label htmlFor="motivo-justificativa">Conte o que houve</Label>
                    <p id="motivo-justificativa-ajuda" className="text-xs text-muted-foreground">Por exemplo: mercadoria devolvida na entrega, pedido cancelado.</p>
                    <Textarea
                      id="motivo-justificativa" rows={3} value={justificativa} aria-describedby="motivo-justificativa-ajuda motivo-justificativa-contador"
                      aria-invalid={erroTexto !== null}
                      onChange={(e) => { setJustificativa(e.target.value); setAviso(null); setErroTexto(null); }}
                    />
                    <p id="motivo-justificativa-contador" className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span>15 a 255 letras</span><span aria-hidden>{tamanhoJustificativa(justificativa)}</span>
                    </p>
                    {erroTexto && <p role="alert" className="break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{erroTexto}</p>}
                  </div>
                )}
                {doMotivo.linha && <p className="break-words text-xs text-muted-foreground">{doMotivo.linha}</p>}
              </div>
            )}
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
        <Button className="h-11 whitespace-normal aria-disabled:opacity-50" aria-disabled={semMotivo || ocupado} disabled={ocupado} onClick={() => void confirmar()}>
          {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Ignorando…</> : erro ? 'Tentar de novo' : (doMotivo?.botao ?? 'Ignorar nota')}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export type AlvoIgnorar = { nota: NotaSefaz; motivoInicial?: MotivoIgnorar };

/**
 * Diálogo único de "Ignorar…" e "Não reconheço…" (aberto quando `alvo !== null`; "Não reconheço…" chega com o motivo já marcado). Motivo
 * obrigatório; com as respostas ligadas e a nota respondível, cada motivo diz se a SEFAZ é avisada (`avisoDoMotivo`). O conteúdo é recriado
 * a cada nota, então o estado nunca vaza. `onIgnorada` diz se a SEFAZ foi avisada (o toast muda).
 */
export function NotasSefazIgnorar({ alvo, respostasLigadas, onFechar, onIgnorada }: {
  alvo: AlvoIgnorar | null; respostasLigadas: boolean; onFechar(): void; onIgnorada(n: NotaSefaz, avisou: boolean): void;
}) {
  return (
    <AlertDialog open={alvo !== null} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        {alvo && (
          <Conteudo
            key={`${alvo.nota.id}:${alvo.motivoInicial ?? ''}`} nota={alvo.nota} respostasLigadas={respostasLigadas}
            motivoInicial={alvo.motivoInicial} onIgnorada={onIgnorada}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
