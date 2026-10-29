'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  atualizarItemEstoque, criarItemEstoque, estoqueObjetivo, excluirItemEstoque, listarConsumoSemanal, listarFornecedores, listarItensEstoque,
  listarSazonalidade, listarSubgrupos, salvarSazonalidade, type ItemEstoque,
} from "@/lib/erp-api";
import { PageHeader, Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MESES, num, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";
import { objetivoPendente } from "@/lib/objetivo";


export default function Objetivo() {
  const m = new Date().getMonth() + 1;
  const prox = (m % 12) + 1;
  const [q, setQ] = useState("");
  const [inativos, setInativos] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["objetivo"],
    queryFn: async () => {
      const [itens, cs, a, b, c, forn, subs] = await Promise.all([
        listarItensEstoque({ ordem: "subgrupo" }),
        listarConsumoSemanal(),
        estoqueObjetivo(m), estoqueObjetivo(prox), estoqueObjetivo(12),
        listarFornecedores(), listarSubgrupos(),
      ]);
      const mp = (r: typeof a) => new Map(r.map((x) => [x.item_estoque_id, Number(x.objetivo)]));
      return { itens, calc: new Map(cs.map((x) => [x.item_estoque_id, Number(x.consumo_calc)])), oa: mp(a), ob: mp(b), oc: mp(c), forn: forn.map((f) => f.nome), subs: subs.map((s) => s.nome) };
    },
  });
  const { data: saz, refetch: rSaz } = useQuery({ queryKey: ["sazonalidade"], queryFn: listarSazonalidade });

  async function upd(id: string, patch: Record<string, unknown>) {
    try {
      await atualizarItemEstoque(id, patch as Partial<ItemEstoque>);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    refetch();
  }
  async function novo() {
    const nome = prompt("Nome do novo item:");
    if (!nome) return;
    try {
      await criarItemEstoque(nome);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    refetch();
  }
  async function excluir(id: string) {
    if (!confirm("Excluir item? Se ele estiver em fichas, desative em vez de excluir.")) return;
    try {
      await excluirItemEstoque(id);
    } catch (error) {
      return toast.error(errMsg(error, "Item em uso por fichas técnicas. Desative-o."));
    }
    refetch();
  }

  const C = ({ v, onSave, w = "w-24", type = "num" }: { v: unknown; onSave: (x: unknown) => void; w?: string; type?: "num" | "txt" }) => (
    <Input className={`h-8 ${w} ${type === "num" ? "text-right" : ""}`} defaultValue={v == null ? "" : type === "num" ? num(v as number, 3) : String(v)}
      onBlur={(e) => { const nv = type === "num" ? parseNum(e.target.value) : e.target.value || null; if (nv !== (v ?? null)) onSave(nv); }} />
  );
  const itens = (data?.itens ?? []).filter((i) => (inativos || i.ativo) && i.nome.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <PageHeader title="Estoque Objetivo" sub="Objetivo semanal = consumo base × (1 + sazonalidade do mês) × (1 + segurança %)" actions={<Button onClick={novo}>+ Novo item</Button>} />
      <Panel title="Sazonalidade por mês (%)">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
          {(saz ?? []).map((s) => (
            <div key={s.mes}><div className="text-xs text-muted-foreground">{MESES[s.mes - 1].slice(0, 3)}</div>
              <Input className="h-8 text-right" defaultValue={num(s.fator_pct)} onBlur={async (e) => { const v = parseNum(e.target.value) ?? 0; if (v !== Number(s.fator_pct)) { try { await salvarSazonalidade(s.mes, v); } catch (error) { toast.error(errMsg(error)); } rSaz(); refetch(); } }} />

            </div>
          ))}
        </div>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="w-64" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><Switch checked={inativos} onCheckedChange={setInativos} /> Mostrar inativos</label>
      </div>
      <Panel>
        <datalist id="forn">{data?.forn.map((f) => <option key={f} value={f} />)}</datalist>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1700px] text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr className="[&>th]:px-1 [&>th]:py-2 [&>th]:text-left">
              <th>Cód.</th><th>Nome</th><th>Tipo</th><th>Subgrupo</th><th>Un</th><th>Preço un.</th><th>Embalagem</th><th>Qtd/emb.</th><th>Fornecedor</th>
              <th>Consumo calc.</th><th>Consumo manual</th><th>Usar manual</th><th>Seg. %</th><th>Obj. manual</th>
              <th className="text-primary">{MESES[m - 1].slice(0, 3)}</th><th>{MESES[prox - 1].slice(0, 3)}</th><th>Dez</th><th>Ativo</th><th />
            </tr></thead>
            <tbody>{itens.map((i) => (
              <tr key={i.id} className="border-t [&>td]:px-1 [&>td]:py-1">
                <td><C v={i.codigo} type="txt" w="w-16" onSave={(v) => upd(i.id, { codigo: v })} /></td>
                 <td><C v={i.nome} type="txt" w="w-48" onSave={(v) => v && upd(i.id, { nome: v })} />{objetivoPendente(i, data?.calc.get(i.id) ?? 0) && <span className="text-xs text-warning">Consumo a definir</span>}</td>
                <td><select className="h-8 rounded-md border bg-background px-1" value={i.tipo} onChange={(e) => upd(i.id, { tipo: e.target.value })}><option>Insumo</option><option>Produto de venda</option></select></td>
                <td><select className="h-8 rounded-md border bg-background px-1" value={i.subgrupo} onChange={(e) => upd(i.id, { subgrupo: e.target.value })}>{data?.subs.map((s) => <option key={s}>{s}</option>)}</select></td>
                <td><C v={i.unidade} type="txt" w="w-14" onSave={(v) => v && upd(i.id, { unidade: String(v).toUpperCase() })} /></td>
                <td><C v={i.preco_unitario} onSave={(v) => upd(i.id, { preco_unitario: v })} /></td>
                <td><C v={i.embalagem_compra} type="txt" w="w-32" onSave={(v) => upd(i.id, { embalagem_compra: v })} /></td>
                <td><C v={i.qtd_por_embalagem} w="w-16" onSave={(v) => upd(i.id, { qtd_por_embalagem: v ?? 1 })} /></td>
                <td><Input list="forn" className="h-8 w-32" defaultValue={i.fornecedor ?? ""} onBlur={(e) => e.target.value !== (i.fornecedor ?? "") && upd(i.id, { fornecedor: e.target.value || null })} /></td>
                <td className="text-right text-muted-foreground">{num(data?.calc.get(i.id), 3)}</td>
                <td><C v={i.consumo_semanal_manual} w="w-20" onSave={(v) => upd(i.id, { consumo_semanal_manual: v })} /></td>
                <td className="text-center"><Switch checked={i.usar_manual} onCheckedChange={(v) => upd(i.id, { usar_manual: v })} /></td>
                <td><C v={i.estoque_seguranca_pct} w="w-14" onSave={(v) => upd(i.id, { estoque_seguranca_pct: v })} /></td>
                <td><C v={i.objetivo_manual} w="w-20" onSave={(v) => upd(i.id, { objetivo_manual: v })} /></td>
                 <td className="text-right font-semibold text-primary">{objetivoPendente(i, data?.calc.get(i.id) ?? 0) ? "—" : num(data?.oa.get(i.id), 2)}</td>
                 <td className="text-right">{objetivoPendente(i, data?.calc.get(i.id) ?? 0) ? "—" : num(data?.ob.get(i.id), 2)}</td>
                 <td className="text-right">{objetivoPendente(i, data?.calc.get(i.id) ?? 0) ? "—" : num(data?.oc.get(i.id), 2)}</td>
                <td className="text-center"><Switch checked={i.ativo} onCheckedChange={(v) => upd(i.id, { ativo: v })} /></td>
                 <td><Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => excluir(i.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
