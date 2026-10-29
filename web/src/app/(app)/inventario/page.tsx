'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { abrirInventario, cmvPeriodos, historicoInventarios, listarCaixa, listarInventarios } from "@/lib/erp-api";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag, Empty, STATUS_INV } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brl, dataBR, isoDate, num, pct } from "@/lib/format";
import { errMsg, getConfig } from "@/lib/db";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


const PERIOD: Record<string, string> = { diario: "Diário", semanal: "Semanal", mensal: "Mensal" };

function proxDia(dow: number) {
  const d = new Date();
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return isoDate(d);
}

export default function Inventarios() {
  const { data: me } = useMe();
  const router = useRouter();
  const admin = me?.perfil === "admin";
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const [data, setData] = useState("");
  const [periodo, setPeriodo] = useState("semanal");
  const { data: invs, refetch } = useQuery({ queryKey: ["inventarios"], queryFn: listarInventarios });
  const { data: hist } = useQuery({ queryKey: ["inv-hist"], enabled: admin, queryFn: historicoInventarios });
  const aberto = invs?.find((i) => i.status !== "fechado");
  const podeAbrir = admin || cfg?.loja_pode_abrir;
  const { data: cmv } = useQuery({
    queryKey: ["cmv"], enabled: admin,
    queryFn: async () => {
      const [linhas, caixa] = await Promise.all([cmvPeriodos(), listarCaixa()]);
      const perMap = new Map((invs ?? []).map((i) => [i.id, i.periodicidade]));
      const porInv = new Map<string, { data: string; anterior: string; periodicidade: string; cmv: number }>();
      for (const l of (linhas ?? []) as { inventario_id: string; data: string; data_anterior: string | null; cmv_valor: number | null }[]) {
        const x = porInv.get(l.inventario_id) ?? { data: l.data, anterior: l.data_anterior ?? l.data, periodicidade: perMap.get(l.inventario_id) ?? "semanal", cmv: 0 };
        x.cmv += Number(l.cmv_valor ?? 0);
        porInv.set(l.inventario_id, x);
      }
      const fat = (caixa ?? []).reduce((m, c) => {
        const v = Number(c.dinheiro) + Number(c.debito) + Number(c.credito) + Number(c.pix) + Number(c.ifood) + Number(c.delivery_proprio) + Number(c.cartao_alimentacao);
        m.set(c.data, (m.get(c.data) ?? 0) + v);
        return m;
      }, new Map<string, number>());
      return [...porInv.values()].map((x) => {
        let f = 0;
        for (const [d, v] of fat) if (d > x.anterior && d <= x.data) f += v;
        return { ...x, faturamento: f, pct: f > 0 ? (x.cmv / f) * 100 : null };
      }).sort((a, b) => b.data.localeCompare(a.data));
    },
  });

  async function abrir() {
    const d = data || proxDia(cfg?.dia_inventario ?? 1);
    try {
      const { id } = await abrirInventario(d, periodo);
      toast.success("Inventário aberto");
      refetch();
      router.push(`/inventario/${id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }

  const porInv = new Map<string, { perda: number; sobra: number }>();
  const porItem = new Map<string, number>();
  for (const h of hist ?? []) {
    const d = (Number(h.final) - Number(h.teorico_snapshot ?? h.final)) * Number(h.itens_estoque?.preco_unitario ?? 0);
    const x = porInv.get(h.inventario_id) ?? { perda: 0, sobra: 0 };
    if (d < 0) x.perda += d; else x.sobra += d;
    porInv.set(h.inventario_id, x);
    if (d < 0) porItem.set(h.itens_estoque?.nome ?? "", (porItem.get(h.itens_estoque?.nome ?? "") ?? 0) + d);
  }
  const ranking = [...porItem].sort((a, b) => a[1] - b[1]).slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader title="Inventário" sub="Contagem cega · diária, semanal ou mensal" />
      {aberto ? (
        <Link href={`/inventario/${aberto.id}`} className="block rounded-2xl bg-gold p-6 text-primary-foreground shadow-gold">
          <div className="font-display text-2xl font-bold">{aberto.inicial ? "Inventário inicial" : `Inventário ${PERIOD[aberto.periodicidade] ?? ""}`} de {dataBR(aberto.data)}</div>
          <div className="mt-1 text-sm opacity-80">{STATUS_INV[aberto.status].label} · toque para {admin ? "acompanhar" : "contar"}</div>
        </Link>
      ) : podeAbrir ? (
        <Panel title="Abrir novo inventário">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="diario">Diário</SelectItem>
                <SelectItem value="semanal">Semanal</SelectItem>
                <SelectItem value="mensal">Mensal</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" className="w-44" value={data || proxDia(cfg?.dia_inventario ?? 1)} onChange={(e) => setData(e.target.value)} />
            <Button onClick={abrir}>Abrir inventário</Button>
          </div>
          {!invs?.some((i) => i.status === "fechado") && <p className="mt-2 text-xs text-muted-foreground">Será o inventário inicial: todas as contagens viram saldo inicial.</p>}
        </Panel>
      ) : <Empty>Nenhum inventário aberto. Aguarde o administrador abrir.</Empty>}

      {admin && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Histórico" className="lg:col-span-2">
            {!invs?.length ? <p className="text-sm text-muted-foreground">Nenhum inventário ainda.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Data</th><th className="text-left">Tipo</th><th className="text-left">Status</th><th className="text-right">Perdas</th><th className="text-right">Sobras</th></tr></thead>
                <tbody>{invs.map((i) => (
                  <tr key={i.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => router.push(`/inventario/${i.id}`)}>

                    <td className="py-2">{dataBR(i.data)} {i.inicial && <Tag tone="gold">inicial</Tag>}</td>
                    <td className="text-muted-foreground">{PERIOD[i.periodicidade] ?? "Semanal"}</td>
                    <td><Tag tone={STATUS_INV[i.status].tone}>{STATUS_INV[i.status].label}</Tag></td>
                    <td className="text-right text-destructive">{porInv.get(i.id) ? brl(porInv.get(i.id)!.perda) : "—"}</td>
                    <td className="text-right text-success">{porInv.get(i.id) ? brl(porInv.get(i.id)!.sobra) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
          <Panel title="Itens com mais perda">
            {!ranking.length ? <p className="text-sm text-muted-foreground">Sem dados ainda.</p> : (
              <ol className="space-y-1.5 text-sm">{ranking.map(([n, v], k) => <li key={n} className="flex justify-between"><span>{k + 1}. {n}</span><span className="text-destructive">{brl(v)}</span></li>)}</ol>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Total acumulado: {num(ranking.length)} itens</p>
          </Panel>
        </div>
      )}

      {admin && (
        <Panel title="Apuração do CMV" >
          <p className="mb-3 text-xs text-muted-foreground">CMV = estoque inicial + entradas (NF) − estoque contado, ao custo médio das entradas do período. Faturamento vem da Conciliação de Caixa.</p>
          {!cmv?.length ? <p className="text-sm text-muted-foreground">Feche um segundo inventário para apurar o CMV do período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Período</th><th className="text-left">Tipo</th><th className="text-right">CMV (consumo)</th><th className="text-right">Faturamento</th><th className="text-right">CMV %</th></tr></thead>
                <tbody>{cmv.map((c) => (
                  <tr key={c.data} className="border-t">
                    <td className="py-2">{dataBR(c.anterior)} → {dataBR(c.data)}</td>
                    <td className="text-muted-foreground">{PERIOD[c.periodicidade] ?? "Semanal"}</td>
                    <td className="text-right font-medium">{brl(c.cmv)}</td>
                    <td className="text-right">{c.faturamento > 0 ? brl(c.faturamento) : "—"}</td>
                    <td className={`text-right font-semibold ${c.pct != null && c.pct > 35 ? "text-destructive" : "text-success"}`}>{c.pct != null ? pct(c.pct) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
