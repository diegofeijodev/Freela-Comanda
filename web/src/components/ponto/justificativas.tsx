'use client';

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { pontoJustificativas, pontoResponderJustificativa, type PontoJustificativa, type StatusJustificativa } from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { ROTULO_OCORRENCIA } from "@/lib/ponto";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const dataBr = (s: string) => s.split("-").reverse().join("/");

/** Justificativas enviadas no terminal (faltas, atrasos e saídas antecipadas): o admin aceita (abonando ou não) ou recusa. */
export function JustificativasPonto() {
  const [status, setStatus] = useState<StatusJustificativa | "">("pendente");
  const { data, refetch } = useQuery({ queryKey: ["ponto-justificativas", status], queryFn: () => pontoJustificativas(status || undefined) });

  return (
    <Panel title="Justificativas" actions={
      <div className="flex gap-1">
        {(["pendente", "aceita", "recusada", ""] as const).map((s) => (
          <Button key={s || "todas"} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {{ pendente: "Pendentes", aceita: "Aceitas", recusada: "Recusadas", "": "Todas" }[s]}
          </Button>
        ))}
      </div>
    }>
      <div className="space-y-2">
        {(data ?? []).map((j) => <Linha key={j.id} j={j} onMudou={refetch} />)}
        {data?.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Nenhuma justificativa {status ? `${status}` : ""}.</div>}
      </div>
    </Panel>
  );
}

function Linha({ j, onMudou }: { j: PontoJustificativa; onMudou: () => void }) {
  const [abonar, setAbonar] = useState(true);
  const [resposta, setResposta] = useState("");
  async function responder(aceita: boolean) {
    try {
      await pontoResponderJustificativa(j.id, { aceita, abonar: aceita ? abonar : false, resposta: resposta || undefined });
      toast.success(aceita ? (abonar ? "Aceita e abonada" : "Aceita (sem abono)") : "Recusada");
      onMudou();
    } catch (error) { toast.error(errMsg(error)); }
  }
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><b>{j.colaborador.nome}</b> · {dataBr(j.data)} · {ROTULO_OCORRENCIA[j.tipo]}</div>
        <Tag tone={j.status === "aceita" ? "ok" : j.status === "recusada" ? "bad" : "gold"}>
          {j.status === "aceita" ? (j.abonar ? "Aceita · abonada" : "Aceita · sem abono") : j.status === "recusada" ? "Recusada" : "Pendente"}
        </Tag>
      </div>
      <p className="mt-1 whitespace-pre-wrap">“{j.texto}”</p>
      {j.resposta && <p className="mt-1 text-xs text-muted-foreground">Resposta: {j.resposta}</p>}
      {j.status === "pendente" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="h-8 max-w-xs" placeholder="Resposta (opcional)" maxLength={300} value={resposta} onChange={(e) => setResposta(e.target.value)} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={abonar} onChange={(e) => setAbonar(e.target.checked)} /> Abonar horas</label>
          <Button size="sm" onClick={() => responder(true)}>Aceitar</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => responder(false)}>Recusar</Button>
        </div>
      )}
    </div>
  );
}
