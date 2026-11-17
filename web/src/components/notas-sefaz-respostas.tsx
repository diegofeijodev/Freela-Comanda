'use client';

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { configurarRespostasSefaz, type SituacaoBuscaSefaz, type SituacaoSefazLigada } from "@/lib/erp-api";
import { Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errMsg } from "@/lib/db";
import { SITUACAO_SEFAZ_KEY } from "@/hooks/use-notas-sefaz";
import { ABERTURA_RESPOSTAS, FRASE_RESPOSTAS_INDISPONIVEIS, papelDaCaixaRespostas, resumoRespostas, semToqueDuplo, toastRespostasLigadas } from "@/lib/notas-sefaz";

const CAIXA: Record<"neutro" | "warn" | "bad", string> = {
  neutro: "border-border bg-muted/40",
  warn: "border-amber-500/30 bg-amber-500/10",
  bad: "border-destructive/30 bg-destructive/10",
};
const ICONE: Record<"neutro" | "warn" | "bad", string> = { neutro: "text-muted-foreground", warn: "text-amber-500", bad: "text-destructive" };

/**
 * Quadro "Respostas à SEFAZ" dentro do painel "Notas da SEFAZ" (Configurações, só admin). Ligar pede confirmação (o contador precisa
 * concordar); desligar é direto, com "Desfazer". Todo texto de estado vem de `resumoRespostas` (regras puras, testadas); a `mensagem` de
 * espera ou parada vem do servidor e aparece como vem. Nada aqui fala com a SEFAZ: só liga e desliga a fila.
 */
export function NotasSefazRespostas({ data }: { data: SituacaoBuscaSefaz }) {
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // toque duplo: o `disabled={ocupado}` só vale depois do re-render; a trava por ref barra o 2º toque na hora
  const emCurso = useRef(false);

  const guardar = (r: SituacaoBuscaSefaz) => qc.setQueryData<SituacaoBuscaSefaz>(SITUACAO_SEFAZ_KEY, r);

  const ligar = () => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    setErroAcao(null);
    try {
      guardar(await configurarRespostasSefaz(true));
      setConfirmar(false);
      toast.success(toastRespostasLigadas());
    } catch (e) {
      setConfirmar(false);
      setErroAcao(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  const desligar = () => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    setErroAcao(null);
    try {
      guardar(await configurarRespostasSefaz(false));
      toast.success("Respostas desligadas.", {
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: () => {
            configurarRespostasSefaz(true).then(guardar, (e) => setErroAcao(errMsg(e)));
          },
        },
      });
    } catch (e) {
      setErroAcao(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  const titulo = <h3 className="text-sm font-semibold">Respostas à SEFAZ</h3>;

  // Servidor sem a busca ativada não diz nada das respostas: só a frase de "não ativadas", sem botões.
  if (data.ambiente === "desligado") {
    return (
      <section id="respostas-sefaz" className="mt-6 scroll-mt-4 space-y-3 border-t pt-4" aria-label="Respostas à SEFAZ">
        {titulo}
        <p className="text-sm text-muted-foreground">{FRASE_RESPOSTAS_INDISPONIVEIS}</p>
      </section>
    );
  }

  const ligada: SituacaoSefazLigada = data;
  const resumo = resumoRespostas(ligada, new Date());
  const r = ligada.respostas;

  return (
    <section id="respostas-sefaz" className="mt-6 min-w-0 scroll-mt-4 space-y-4 border-t pt-4" aria-label="Respostas à SEFAZ">
      {titulo}
      {r.disponivel && (
        <>
          <p className="text-sm text-muted-foreground">{ABERTURA_RESPOSTAS}</p>
          <p className="text-sm"><strong>Ligue só depois de o seu contador concordar.</strong></p>
        </>
      )}

      {resumo.tag && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={resumo.tag.tom === "neutro" ? "muted" : resumo.tag.tom}>
            {resumo.tag.tom === "ok" && <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {(resumo.tag.tom === "warn" || resumo.tag.tom === "bad") && <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {resumo.tag.texto}
          </Tag>
        </div>
      )}

      {resumo.caixa && (
        <div role={papelDaCaixaRespostas(resumo.caixa.tom)} className={`flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm ${CAIXA[resumo.caixa.tom]}`}>
          <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${ICONE[resumo.caixa.tom]}`} aria-hidden />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{resumo.caixa.texto}</p>
            {resumo.caixa.irParaCertificado && (
              <a href="#certificado-digital" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ir para o certificado</a>
            )}
          </div>
        </div>
      )}

      {erroAcao && (
        <div role="alert" className={`flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm ${CAIXA.bad}`}>
          <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${ICONE.bad}`} aria-hidden />
          <span className="min-w-0 break-words">{erroAcao}</span>
        </div>
      )}

      {resumo.linhas.length > 0 && (
        <ul className="min-w-0 space-y-1 break-words text-sm" aria-live="polite">
          {resumo.linhas.map((l) => (
            <li key={l.texto} className="flex min-w-0 flex-wrap items-center gap-x-3">
              <span className="min-w-0 break-words">{l.texto}</span>
              {l.ver && (
                <Link href="/notas#notas-sefaz" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">{l.ver}</Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {resumo.botao && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {resumo.botao === "desligar" ? (
            <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto" disabled={ocupado} onClick={() => void desligar()}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Desligando…</> : "Desligar as respostas"}
            </Button>
          ) : (
            <Button className="h-11 w-full whitespace-normal sm:w-auto" disabled={resumo.botaoDesabilitado || ocupado} onClick={() => setConfirmar(true)}>
              {resumo.botao === "ligar_de_novo" ? "Ligar as respostas de novo" : "Ligar as respostas"}
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirmar} onOpenChange={(o) => !ocupado && setConfirmar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar as respostas à SEFAZ?</AlertDialogTitle>
            <AlertDialogDescription>
              O sistema vai avisar a SEFAZ, em nome da empresa, que recebeu cada nota nova de compra. Depois desse aviso, cada nota precisa de uma resposta
              final em até 90 dias da data dela: lançar a nota já responde que a compra aconteceu; para as outras, o sistema avisa antes do prazo.{" "}
              <strong>Ligue só depois de o seu contador concordar.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={ocupado} className="h-11">Agora não</AlertDialogCancel>
            <Button className="h-11" disabled={ocupado} onClick={() => void ligar()}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Ligando…</> : "Ligar as respostas"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
