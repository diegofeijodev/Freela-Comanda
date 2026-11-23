'use client';

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { pontoCriarTerminal, pontoRevogarTerminal, pontoTerminais, type PontoTerminal } from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { dataHoraBR } from "@/lib/format";
import { apagarTerminal, gravarTerminal, lerTerminal, type TerminalLocal } from "@/modules/ponto/infrastructure/terminal.storage";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Computadores liberados para bater ponto. Liberar = gravar o token neste navegador; revogar = o token para de valer na hora. */
export function TerminaisPonto() {
  const { data, refetch } = useQuery({ queryKey: ["ponto-terminais"], queryFn: pontoTerminais });
  const [local, setLocal] = useState<TerminalLocal | null>(null);
  const [nome, setNome] = useState("Computador da loja");
  useEffect(() => setLocal(lerTerminal()), []);

  async function liberar() {
    if (local && !confirm("Este navegador já está liberado. Liberar de novo cria outro terminal. Continuar?")) return;
    try {
      const t = await pontoCriarTerminal(nome.trim());
      const l = { id: t.id, nome: t.nome, token: t.token };
      gravarTerminal(l); setLocal(l);
      toast.success("Este computador foi liberado para bater ponto"); refetch();
    } catch (error) { toast.error(errMsg(error)); }
  }
  async function revogar(t: PontoTerminal) {
    if (!confirm(`Revogar "${t.nome}"? Esse computador para de bater ponto na hora.`)) return;
    try {
      await pontoRevogarTerminal(t.id);
      if (local?.id === t.id) { apagarTerminal(); setLocal(null); }
      toast.success("Terminal revogado"); refetch();
    } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <div className="space-y-4">
      <Panel title="Liberar este computador">
        <p className="mb-3 text-sm text-muted-foreground">
          O ponto só funciona nos computadores liberados aqui. Faça isto <b>no próprio computador da loja</b>: a liberação fica guardada neste navegador
          (se limpar os dados do navegador, é só liberar de novo e revogar o antigo). Em qualquer outro computador ou celular, o ponto fica bloqueado.
        </p>
        {local ? (
          <div className="text-sm">Este navegador está liberado como <b>{local.nome}</b>.</div>
        ) : (
          <div className="flex max-w-md gap-2">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
            <Button onClick={liberar} disabled={!nome.trim()}>Liberar</Button>
          </div>
        )}
      </Panel>
      <Panel title="Terminais">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Nome</th><th>Liberado em</th><th>Último uso</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((t) => (
              <tr key={t.id} className="border-t">
                <td className="py-1.5 font-medium">{t.nome}{local?.id === t.id && <span className="ml-2 text-xs text-primary">(este computador)</span>}</td>
                <td>{dataHoraBR(t.created_at)}</td>
                <td>{dataHoraBR(t.ultimo_uso)}</td>
                <td>{t.ativo ? <Tag tone="ok">Liberado</Tag> : <Tag tone="bad">Revogado</Tag>}</td>
                <td className="text-right">{t.ativo && <Button size="sm" variant="outline" className="text-destructive" onClick={() => revogar(t)}>Revogar</Button>}</td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nenhum computador liberado ainda.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
