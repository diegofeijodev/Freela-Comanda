'use client';

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { criarCentro, criarPlanoConta, excluirCentro, excluirPlanoConta, importarPlanoContas, listarCentros, listarPlanoContas, type PlanoConta } from "@/lib/erp-api";
import { Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMsg } from "@/lib/db";
import { lerArquivo } from "@/lib/parse";

export function PlanoContas() {
  const { data: planos, refetch } = useQuery({ queryKey: ["plano-contas-all"], queryFn: () => listarPlanoContas() });
  const { data: centros, refetch: rC } = useQuery({ queryKey: ["centros-custo-all"], queryFn: () => listarCentros() });
  const [n, setN] = useState({ grupo: "", subgrupo: "", conta: "" });
  const [cc, setCc] = useState("");

  async function add() {
    if (!n.grupo || !n.conta) return toast.error("Informe grupo e conta");
    try {
      await criarPlanoConta(n);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    setN({ ...n, conta: "" }); refetch();
  }
  async function importar(f: File) {
    const linhas = await lerArquivo(f);
    const get = (r: Record<string, string>, k: string) => r[Object.keys(r).find((h) => h.includes(k)) ?? ""] ?? "";
    const rows = linhas.map((r) => ({ grupo: get(r, "grupo"), subgrupo: get(r, "subgrupo"), conta: get(r, "conta") || get(r, "subgrupo") })).filter((r) => r.grupo && r.conta);
    if (!rows.length) return toast.error("Use colunas Grupo, Subgrupo e Conta");
    try {
      await importarPlanoContas(rows);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success(`${rows.length} contas importadas`); refetch();
  }

  const grupos = Object.entries((planos ?? []).reduce<Record<string, PlanoConta[]>>((m, p) => { (m[p.grupo] ??= []).push(p); return m; }, {}));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Panel className="md:col-span-2" title="Plano de contas de despesas" actions={
        <label className="cursor-pointer"><Button asChild size="sm" variant="outline"><span>Importar planilha</span></Button>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ""; }} /></label>}>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Grupo" value={n.grupo} onChange={(e) => setN({ ...n, grupo: e.target.value })} />
          <Input placeholder="Subgrupo" value={n.subgrupo} onChange={(e) => setN({ ...n, subgrupo: e.target.value })} />
          <Input placeholder="Conta" value={n.conta} onChange={(e) => setN({ ...n, conta: e.target.value })} />
          <Button onClick={add}>Adicionar</Button>
        </div>
        {grupos.map(([g, itens]) => (
          <div key={g} className="mb-3">
            <div className="text-sm font-semibold text-primary">{g}</div>
            {(itens ?? []).map((p) => (
              <div key={p.id} className="flex justify-between border-t py-1.5 pl-3 text-sm">
                <span><span className="text-muted-foreground">{p.subgrupo ? `${p.subgrupo} › ` : ""}</span>{p.conta}</span>
                <button aria-label="Remover" onClick={async () => { try { await excluirPlanoConta(p.id); } catch { toast.error("Conta em uso — não pode ser removida"); } refetch(); }}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            ))}
          </div>
        ))}
        {!planos?.length && <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada. Adicione manualmente ou importe uma planilha com colunas Grupo, Subgrupo e Conta.</p>}
      </Panel>
      <Panel title="Centros de custo">
        <div className="mb-3 flex gap-2"><Input placeholder="Nome" value={cc} onChange={(e) => setCc(e.target.value)} />
          <Button onClick={async () => { if (!cc) return; try { await criarCentro(cc); } catch (error) { toast.error(errMsg(error)); } setCc(""); rC(); }}>Adicionar</Button></div>
        {(centros ?? []).map((c) => (
          <div key={c.id} className="flex justify-between border-t py-1.5 text-sm"><span>{c.nome}</span>
            <button aria-label="Remover" onClick={async () => { try { await excluirCentro(c.id); } catch (error) { toast.error(errMsg(error)); } rC(); }}
><Trash2 className="h-4 w-4 text-muted-foreground" /></button></div>
        ))}
        {!centros?.length && <p className="text-sm text-muted-foreground">Nenhum centro de custo ainda.</p>}
      </Panel>
    </div>
  );
}
