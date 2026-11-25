'use client';

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { canaAnular, canaLancamentos, canaRecentes, type CanaLancamento, type TipoCana } from "@/lib/erp-api";
import { errCode, errMsg } from "@/lib/db";
import { avisoListaCortada, dataCurta, dataSp, duzias, horaSp, litros, quandoLoja, resumoLancamento } from "@/lib/cana";
import { Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormularioCana } from "./formulario";
import { BotoesCana } from "./loja";

const MOTIVOS = ["Lançado em dobro", "Número errado", "Data errada"];
const FILTROS: { v: TipoCana | ""; r: string }[] = [{ v: "", r: "Todos" }, { v: "recebimento", r: "Recebimentos" }, { v: "producao", r: "Produções" }, { v: "contagem", r: "Contagens" }];
const menosDias = (hoje: string, n: number) => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const plural = (n: number, um: string, mais: string) => `${n} ${n === 1 ? um : mais}`;

function quantidade(l: CanaLancamento) {
  return resumoLancamento(l).split(" · ").slice(1).join(" · ");
}

function DialogoAnular({ l, onFechar, onAnulado }: { l: CanaLancamento; onFechar: () => void; onAnulado: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function anular() {
    if (motivo.trim().length < 3) { setErro("Escreva o motivo (pelo menos 3 letras)."); return; }
    setEnviando(true);
    try {
      await canaAnular(l.id, motivo.trim());
      toast.success("Lançamento anulado.");
      onAnulado();
    } catch (e) {
      setErro(errMsg(e));
      if (errCode(e) === "CANA_JA_ANULADO") onAnulado();
    } finally { setEnviando(false); }
  }
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Anular este lançamento?</AlertDialogTitle>
          <AlertDialogDescription>
            {resumoLancamento(l)} · {dataCurta(l.data)} · lançado por {l.lancado_por_nome} às {horaSp(l.lancado_em)}. Ele continua na lista, marcado como anulado, e sai das contas da semana.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cana-anular-motivo">Motivo (obrigatório)</Label>
          <div className="flex flex-wrap gap-2">{MOTIVOS.map((m) => <Button key={m} type="button" variant="outline" className="h-11" onClick={() => setMotivo(m)}>{m}</Button>)}</div>
          <Input id="cana-anular-motivo" className="h-11" maxLength={300} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(null); }} aria-invalid={!!erro} aria-describedby="cana-anular-erro" />
          {erro && <p id="cana-anular-erro" role="alert" className="text-sm text-destructive">{erro}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus className="h-11">Voltar sem anular</AlertDialogCancel>
          <Button variant="destructive" className="h-11" disabled={enviando} onClick={() => void anular()}>Anular o lançamento</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Aba Lançamentos (UX 3.5): os 3 formulários com "Outra data", a lista com os anulados e as correções, Anular e Corrigir. */
export function CanaLancamentosAba() {
  const qc = useQueryClient();
  const recentes = useQuery({ queryKey: ["cana-recentes"], queryFn: canaRecentes });
  const hoje = recentes.data?.hoje;
  const [dias, setDias] = useState(30);
  const [tipo, setTipo] = useState<TipoCana | "">("");
  const [anulados, setAnulados] = useState(true);
  const [novo, setNovo] = useState<TipoCana | null>(null);
  const [corrigir, setCorrigir] = useState<CanaLancamento | null>(null);
  const [anular, setAnular] = useState<CanaLancamento | null>(null);
  const ini = hoje ? menosDias(hoje, dias) : "";
  const lista = useQuery({ queryKey: ["cana-lancamentos", ini, hoje, tipo], queryFn: () => canaLancamentos(ini, hoje!, tipo || undefined), enabled: !!hoje });
  const todos = useMemo(() => lista.data?.lancamentos ?? [], [lista.data]);
  const visiveis = useMemo(() => todos.filter((l) => anulados || !l.anulado_em), [todos, anulados]);
  const ativos = todos.filter((l) => !l.anulado_em);
  const soma = (t: TipoCana, f: (l: CanaLancamento) => number) => ativos.filter((l) => l.tipo === t).reduce((s, l) => s + f(l), 0);
  const nAnulados = todos.length - ativos.length;
  const relerTudo = () => { void qc.invalidateQueries({ queryKey: ["cana-lancamentos"] }); void qc.invalidateQueries({ queryKey: ["cana-semanas"] });
    void qc.invalidateQueries({ queryKey: ["cana-semana"] }); void qc.invalidateQueries({ queryKey: ["cana-recentes"] }); };

  if (recentes.data && (novo || corrigir))
    return (
      <FormularioCana
        tipo={(corrigir?.tipo ?? novo)!} admin recentes={recentes.data} corrigir={corrigir ?? undefined}
        onVoltar={() => { setNovo(null); setCorrigir(null); }}
        onLancado={(m) => { toast.success(corrigir ? `Corrigido. ${m}` : m); setNovo(null); setCorrigir(null); relerTudo(); }}
      />
    );

  return (
    <div className="space-y-4">
      <BotoesCana compacto onEscolher={setNovo} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Período
          <select className="h-11 rounded-md border bg-background px-2" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option><option value={365}>Último ano</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo">
          {FILTROS.map((f) => <Button key={f.r} variant={tipo === f.v ? "default" : "outline"} className="h-11" onClick={() => setTipo(f.v)}>{f.r}</Button>)}
        </div>
        <label className="flex h-11 items-center gap-2 text-sm"><Switch checked={anulados} onCheckedChange={setAnulados} /> Mostrar anulados</label>
      </div>
      {lista.data && (
        <p className="text-sm text-muted-foreground">
          {hoje && `${dataCurta(ini)} a ${dataCurta(hoje)}: `}
          {plural(soma("recebimento", () => 1), "recebimento", "recebimentos")} = {duzias(soma("recebimento", (l) => l.duzias ?? 0))} ·{" "}
          {plural(soma("producao", () => 1), "produção", "produções")} = {litros(soma("producao", (l) => l.litros_caldo ?? 0))} ·{" "}
          {plural(soma("contagem", () => 1), "contagem", "contagens")}
          {nAnulados ? ` (sem contar ${nAnulados} ${nAnulados === 1 ? "lançamento anulado" : "lançamentos anulados"})` : ""}
        </p>
      )}
      {lista.data?.truncado && <p role="status" className="text-sm text-warning">{avisoListaCortada(lista.data.limite)}</p>}
      {(lista.isLoading || recentes.isLoading) && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
      {lista.isError && (
        <div className="rounded-lg border p-3 text-sm">Não consegui ver os lançamentos agora. <Button variant="link" className="h-auto p-0" onClick={() => lista.refetch()}>Tentar de novo</Button></div>
      )}
      {lista.data && visiveis.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lançamento neste período.</p>}
      {visiveis.length > 0 && hoje && recentes.data && (
        <ul className="space-y-2">
          {visiveis.map((l) => (
            <li key={l.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={l.anulado_em ? "line-through" : "font-medium"}>{resumoLancamento(l)}</span>
                {l.anulado_em && <Tag tone="muted">{l.corrigido_por_id ? "Corrigido" : "Anulado"}</Tag>}
                {l.substitui && <Tag tone="muted">Corrige o lançamento de {dataCurta(l.substitui.data)} ({quantidade({ ...l, ...l.substitui })})</Tag>}
              </div>
              <div className="text-muted-foreground">
                {quandoLoja(l.data, hoje, recentes.data.ontem)} · por {l.lancado_por_nome} às {horaSp(l.lancado_em)}
                {l.fornecedor ? ` · Fornecedor: ${l.fornecedor}` : ""}{l.observacao ? ` · ${l.observacao}` : ""}
              </div>
              {l.anulado_em && <div className="text-muted-foreground">por {l.anulado_por_nome} em {dataSp(l.anulado_em)} às {horaSp(l.anulado_em)}: {l.anulado_motivo}</div>}
              {!l.anulado_em && (
                <div className="mt-1 flex gap-4">
                  <Button variant="link" className="h-11 p-0" onClick={() => setCorrigir(l)}>Corrigir</Button>
                  <Button variant="link" className="h-11 p-0 text-destructive" aria-label={`Anular ${resumoLancamento(l).split(" · ")[0]} de ${dataCurta(l.data)}, ${quantidade(l)}`} onClick={() => setAnular(l)}>Anular…</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {anular && <DialogoAnular l={anular} onFechar={() => setAnular(null)} onAnulado={() => { setAnular(null); relerTudo(); }} />}
    </div>
  );
}
