'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { lancarMovimentacao, listarItensEstoque, listarMovimentacoes, listarSaldos } from "@/lib/erp-api";
import { PageHeader, Panel, Stat, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brl, dataBR, isoDate, num, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";
import { useMe } from "@/lib/auth";


const TIPOS: Record<string, string> = {
  inventario_inicial: "Inventário inicial", entrada_compra: "Entrada de compra", baixa_venda: "Baixa por venda",
  perda: "Perda / consumo interno", ajuste_inventario: "Ajuste de inventário", ajuste_manual: "Ajuste manual",
};

export default function Estoque() {
  const { data: me } = useMe();
  const [tipo, setTipo] = useState("todos");
  const [sub, setSub] = useState("todos");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<{ id: string; nome: string; unidade: string } | null>(null);
  const [lanc, setLanc] = useState<{ tipo: string; qtd: string; obs: string; data: string }>({ tipo: "perda", qtd: "", obs: "", data: isoDate(new Date()) });

  const { data, refetch } = useQuery({
    queryKey: ["estoque"], enabled: me?.perfil === "admin",
    queryFn: async () => {
      const [itens, saldos] = await Promise.all([listarItensEstoque(), listarSaldos()]);
      const sm = new Map((saldos ?? []).map((s) => [s.item_estoque_id, s]));
      return (itens ?? []).map((i) => ({ ...i, saldo: Number(sm.get(i.id)?.saldo ?? 0), ult: sm.get(i.id)?.data_ultimo_inventario }));
    },
  });
  const { data: movs, refetch: rMovs } = useQuery({
    queryKey: ["movs", sel?.id], enabled: !!sel,
    queryFn: () => listarMovimentacoes(sel!.id),
  });

  const fil = (data ?? []).filter((i) => (tipo === "todos" || i.tipo === tipo) && (sub === "todos" || i.subgrupo === sub) && i.nome.toLowerCase().includes(q.toLowerCase()));
  const valor = fil.reduce((s, i) => s + Math.max(0, i.saldo) * Number(i.preco_unitario ?? 0), 0);
  const subs = [...new Set((data ?? []).map((i) => i.subgrupo))].sort();

  async function lancar() {
    const v = parseNum(lanc.qtd);
    if (!sel || v == null || v === 0) return toast.error("Informe a quantidade");
    // O sinal da perda, o custo do cadastro, o usuário e a referência "manual" são postos pela API.
    try {
      await lancarMovimentacao({ item_estoque_id: sel.id, tipo: lanc.tipo, data: lanc.data, quantidade: v, observacao: lanc.obs || null });
    } catch (error) {
      return toast.error(errMsg(error));
    }

    toast.success("Lançamento registrado");
    setLanc({ ...lanc, qtd: "", obs: "" });
    rMovs(); refetch();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Estoque & Movimentações" sub="Saldo = último inventário fechado + entradas − baixas − perdas ± ajustes" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Valor do estoque (filtro)" value={brl(valor)} />
        <Stat label="Itens" value={fil.length} />
        <Stat label="Itens com saldo negativo" value={fil.filter((i) => i.saldo < 0).length} hint="Indica falta de inventário inicial ou entradas" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-56" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={tipo} onValueChange={setTipo}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os tipos</SelectItem><SelectItem value="Insumo">Insumo</SelectItem><SelectItem value="Produto de venda">Produto de venda</SelectItem></SelectContent></Select>
        <Select value={sub} onValueChange={setSub}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os subgrupos</SelectItem>{subs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Item</th><th className="text-left">Subgrupo</th><th className="text-right">Saldo teórico</th><th className="text-right">Preço</th><th className="text-right">Valor</th><th className="text-right">Últ. inventário</th></tr></thead>
            <tbody>{fil.map((i) => (
              <tr key={i.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSel({ id: i.id, nome: i.nome, unidade: i.unidade })}>
                <td className="py-1.5">{i.nome} {!i.ativo && <Tag>inativo</Tag>}</td><td className="text-muted-foreground">{i.subgrupo}</td>
                <td className={`text-right ${i.saldo < 0 ? "text-destructive" : ""}`}>{num(i.saldo, 3)} {i.unidade}</td>
                <td className="text-right">{i.preco_unitario == null ? <Tag tone="warn">a cotar</Tag> : brl(i.preco_unitario)}</td>
                <td className="text-right">{brl(Math.max(0, i.saldo) * Number(i.preco_unitario ?? 0))}</td>
                <td className="text-right text-muted-foreground">{dataBR(i.ult)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{sel?.nome}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <Select value={lanc.tipo} onValueChange={(v) => setLanc({ ...lanc, tipo: v })}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="perda">Perda / consumo</SelectItem><SelectItem value="ajuste_manual">Ajuste manual (±)</SelectItem></SelectContent></Select>
            <Input type="date" className="w-40" value={lanc.data} onChange={(e) => setLanc({ ...lanc, data: e.target.value })} />
            <Input className="w-28" inputMode="decimal" placeholder={`Qtd ${sel?.unidade}`} value={lanc.qtd} onChange={(e) => setLanc({ ...lanc, qtd: e.target.value })} />
            <Input className="min-w-40 flex-1" placeholder="Observação" value={lanc.obs} onChange={(e) => setLanc({ ...lanc, obs: e.target.value })} />
            <Button onClick={lancar}>Lançar</Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Data</th><th className="text-left">Tipo</th><th className="text-right">Qtd</th><th className="text-left pl-3">Referência</th></tr></thead>
            <tbody>{(movs ?? []).slice(0, 300).map((m) => (
              <tr key={m.id} className="border-t"><td className="py-1">{dataBR(m.data)}</td><td>{TIPOS[m.tipo]}</td><td className={`text-right ${m.quantidade < 0 ? "text-destructive" : "text-success"}`}>{num(m.quantidade, 3)}</td><td className="pl-3 text-xs text-muted-foreground">{m.observacao ?? m.referencia}</td></tr>
            ))}</tbody>
          </table>
          {(movs?.length ?? 0) > 300 && <p className="text-xs text-muted-foreground">Mostrando as 300 mais recentes de {movs?.length}.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
