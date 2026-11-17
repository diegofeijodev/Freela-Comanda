'use client';

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { configurarBuscaSefaz, type SituacaoBuscaSefaz } from "@/lib/erp-api";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errMsg } from "@/lib/db";
import { SITUACAO_SEFAZ_KEY, useSituacaoSefaz } from "@/hooks/use-notas-sefaz";
import { linhasHistoricoSefaz, resumoPainel, semToqueDuplo, toastBuscaLigada } from "@/lib/notas-sefaz";

const ABERTURA =
  "Traz para a Entrada de Notas as notas emitidas para a sua empresa, para você ver o que falta lançar e saber se um fornecedor cancelou uma nota. " +
  "Só consulta: não envia nada à SEFAZ. Hoje chega o resumo da nota (fornecedor, valor e data); o arquivo completo só chega em alguns casos.";

const CAIXA: Record<"neutro" | "warn" | "bad", string> = {
  neutro: "border-border bg-muted/40",
  warn: "border-amber-500/30 bg-amber-500/10",
  bad: "border-destructive/30 bg-destructive/10",
};
const ICONE: Record<"neutro" | "warn" | "bad", string> = { neutro: "text-muted-foreground", warn: "text-amber-500", bad: "text-destructive" };

/**
 * Configurações → Notas da SEFAZ (só admin). Mostra a situação da busca e liga/desliga. Ligar pede confirmação (o contador pode já estar
 * buscando); desligar é direto, com "Desfazer". Todo texto de estado vem de `resumoPainel` (regras puras, testadas).
 */
export function NotasSefazPainel() {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useSituacaoSefaz(true);
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // toque duplo: o `disabled={ocupado}` só vale depois do re-render; a trava por ref barra o 2º toque na hora (sem 2 "ligada" no histórico)
  const emCurso = useRef(false);

  const guardar = (r: SituacaoBuscaSefaz) => qc.setQueryData<SituacaoBuscaSefaz>(SITUACAO_SEFAZ_KEY, r);

  const ligar = () => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    setErroAcao(null);
    try {
      const r = await configurarBuscaSefaz(true);
      guardar(r);
      setConfirmar(false);
      toast.success(toastBuscaLigada(r, new Date()));
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
      guardar(await configurarBuscaSefaz(false));
      toast.success("Busca desligada.", {
        action: {
          label: "Desfazer",
          onClick: () => {
            configurarBuscaSefaz(true).then(guardar, (e) => setErroAcao(errMsg(e)));
          },
        },
      });
    } catch (e) {
      setErroAcao(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  const resumo = data ? resumoPainel(data, new Date()) : null;
  const ligadaInfo = data && data.ambiente !== "desligado" ? data : null;
  const historico = ligadaInfo ? linhasHistoricoSefaz(ligadaInfo.historico) : [];
  const nParaConferir = ligadaInfo ? ligadaInfo.contagem.falta_lancar + ligadaInfo.contagem.parece_lancada : 0;

  return (
    <div id="notas-sefaz" className="scroll-mt-4">
      <Panel title="Notas da SEFAZ">
        <p className="mb-3 text-sm text-muted-foreground">{ABERTURA}</p>

        {isPending && <div className="space-y-2" aria-busy="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>}
        {isError && !data && (
          <div className="flex flex-col gap-2 text-sm">
            <p>Não consegui ver a situação da busca agora. Toque em Tentar de novo.</p>
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => refetch()}>Tentar de novo</Button>
          </div>
        )}

        {resumo && (
          <div className="min-w-0 space-y-4">
            {resumo.tag && (
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={resumo.tag.tom === "neutro" ? "muted" : resumo.tag.tom}>
                  {resumo.tag.tom === "ok" && <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />}
                  {(resumo.tag.tom === "warn" || resumo.tag.tom === "bad") && <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />}
                  {resumo.tag.texto}
                </Tag>
              </div>
            )}

            {resumo.caixas.map((c) => (
              <div key={c.texto} role={c.tom === "bad" ? "alert" : "status"} className={`flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm ${CAIXA[c.tom]}`}>
                <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${ICONE[c.tom]}`} aria-hidden />
                <div className="min-w-0 space-y-2">
                  <p className="break-words">{c.texto}</p>
                  {c.irParaCertificado && (
                    <a href="#certificado-digital" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ir para o certificado</a>
                  )}
                </div>
              </div>
            ))}

            {erroAcao && (
              <div role="alert" className={`flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm ${CAIXA.bad}`}>
                <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${ICONE.bad}`} aria-hidden />
                <span className="min-w-0 break-words">{erroAcao}</span>
              </div>
            )}

            {resumo.linhas.length > 0 && (
              <ul className="min-w-0 space-y-1 break-words text-sm" aria-live="polite">
                {resumo.linhas.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}

            {resumo.botao && (
              <div className="flex flex-col gap-2 sm:flex-row">
                {resumo.botao === "desligar" ? (
                  <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto" disabled={ocupado} onClick={() => void desligar()}>
                    {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Desligando…</> : "Desligar a busca"}
                  </Button>
                ) : (
                  <Button className="h-11 w-full whitespace-normal sm:w-auto" disabled={resumo.botaoDesabilitado || ocupado} onClick={() => setConfirmar(true)}>
                    {resumo.botao === "ligar_de_novo" ? "Ligar a busca de novo" : "Ligar a busca"}
                  </Button>
                )}
                {ligadaInfo?.busca_ligada && nParaConferir > 0 && (
                  <Link href="/notas#notas-sefaz" className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm sm:justify-start">Ver as notas</Link>
                )}
              </div>
            )}

            {historico.length > 0 && (
              <details className="text-sm">
                <summary className="flex min-h-11 cursor-pointer items-center text-primary">Ver histórico</summary>
                <ul className="mt-1 space-y-1 break-words">{historico.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </Panel>

      <AlertDialog open={confirmar} onOpenChange={(o) => !ocupado && setConfirmar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar a busca de notas?</AlertDialogTitle>
            <AlertDialogDescription>
              A busca usa o certificado digital da empresa.{" "}
              <strong>Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar</strong>: com dois sistemas buscando, a SEFAZ bloqueia os dois
              por 1 hora. Notas emitidas antes da primeira busca não aparecem.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={ocupado} className="h-11">Agora não</AlertDialogCancel>
            <Button className="h-11" disabled={ocupado} onClick={() => void ligar()}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Ligando…</> : "Ligar a busca"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
