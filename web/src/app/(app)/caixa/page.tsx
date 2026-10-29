'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { excluirCaixa, listarCaixa, salvarCaixa } from "@/lib/erp-api";
import { PageHeader, Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ENTRADAS } from "@/lib/dre";
import { brl, dataBR, isoDate, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";


const CAMPOS = [...ENTRADAS, ["sangria", "Sangrias do caixa"], ["sangria_cofre", "Sangria para o cofre"]] as const;
const vazio = () => Object.fromEntries(CAMPOS.map(([k]) => [k, ""])) as Record<string, string>;

export default function Caixa() {
  const [mes, setMes] = useState(isoDate(new Date()).slice(0, 7));
  const [data, setData] = useState(isoDate(new Date()));
  const [f, setF] = useState(vazio());
  const { data: dias, refetch } = useQuery({
    queryKey: ["caixa", mes],
    // A API fecha o mês certo (o `-31` do protótipo quebrava nos meses de 30 dias).
    queryFn: () => listarCaixa(mes),
  });

  async function salvar() {
    const row: Record<string, unknown> = { data };
    for (const [k] of CAMPOS) { const v = parseNum(f[k] || "0"); if (v == null) return toast.error("Valor inválido"); row[k] = v; }
    try {
      await salvarCaixa(row);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success(`Caixa de ${dataBR(data)} salvo`); setF(vazio()); refetch();
  }
  const total = (d: Record<string, unknown>) => ENTRADAS.reduce((s, [k]) => s + Number(d[k] ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Conciliação de Caixa" sub="Fechamento diário — alimenta as entradas do DRE" />
      <Panel title="Lançar fechamento do dia">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div><Label>Data</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          {CAMPOS.map(([k, l]) => <div key={k}><Label>{l}</Label><Input inputMode="decimal" placeholder="0,00" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
          <div className="flex items-end"><Button onClick={salvar}>Salvar</Button></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Salvar de novo na mesma data substitui o fechamento daquele dia.</p>
      </Panel>
      <Panel title="Fechamentos do mês" actions={<Input type="month" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Data</th>{CAMPOS.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}<th className="text-right">Total entradas</th><th /></tr></thead>
          <tbody>{(dias ?? []).map((d) => (
            <tr key={d.id} className="border-t"><td className="py-1.5">{dataBR(d.data)}</td>
              {CAMPOS.map(([k]) => <td key={k} className="text-right">{brl((d as unknown as Record<string, number>)[k])}</td>)}
              <td className="text-right font-medium">{brl(total(d))}</td>
              <td className="text-right"><button aria-label="Excluir" onClick={async () => { if (!confirm("Excluir este fechamento?")) return; try { await excluirCaixa(d.id); } catch (error) { toast.error(errMsg(error)); } refetch(); }}
><Trash2 className="h-4 w-4 text-muted-foreground" /></button></td></tr>
          ))}{!dias?.length && <tr><td colSpan={12} className="py-4 text-center text-muted-foreground">Nenhum fechamento neste mês.</td></tr>}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
