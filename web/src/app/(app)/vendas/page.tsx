'use client';

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Panel, Stat, Empty } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, dataBR, DIAS, downloadCSV, isoDate, num, pct } from "@/lib/format";
import { carregarFichasResumo, carregarVendas, delta, resumo, type Ficha } from "@/lib/vendas";
import { useMe } from "@/lib/auth";


const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "oklch(0.6 0.1 300)", "oklch(0.7 0.1 20)", "oklch(0.55 0.05 80)", "oklch(0.8 0.05 200)", "oklch(0.5 0.1 120)"];
const tt = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" } };

function periodo(p: string, ci: string, cf: string): [string, string] {
  const h = new Date();
  const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return isoDate(x); };
  switch (p) {
    case "hoje": return [isoDate(h), isoDate(h)];
    case "7": return [d(6), isoDate(h)];
    case "30": return [d(29), isoDate(h)];
    case "mes": return [isoDate(new Date(h.getFullYear(), h.getMonth(), 1)), isoDate(h)];
    case "mesant": return [isoDate(new Date(h.getFullYear(), h.getMonth() - 1, 1)), isoDate(new Date(h.getFullYear(), h.getMonth(), 0))];
    default: return [ci, cf];
  }
}
function anterior(ini: string, fim: string): [string, string] {
  const a = new Date(ini + "T12:00"), b = new Date(fim + "T12:00");
  const dias = Math.round((b.getTime() - a.getTime()) / 864e5) + 1;
  const f = new Date(a); f.setDate(a.getDate() - 1);
  const i = new Date(f); i.setDate(f.getDate() - dias + 1);
  return [isoDate(i), isoDate(f)];
}
const semana = (s: string) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };

export default function Vendas() {
  const { data: me } = useMe();
  const [p, setP] = useState("30");
  const [ci, setCi] = useState(isoDate(new Date(Date.now() - 30 * 864e5)));
  const [cf, setCf] = useState(isoDate(new Date()));
  const [cat, setCat] = useState("todas");
  const [item, setItem] = useState("todos");
  const [rankBy, setRankBy] = useState<"qtd" | "fat">("qtd");
  const [agrup, setAgrup] = useState<"semana" | "mes">("semana");
  const [ini, fim] = periodo(p, ci, cf);
  const [ai, af] = anterior(ini, fim);

  const { data: fichas } = useQuery({ queryKey: ["fichas-resumo"], queryFn: carregarFichasResumo });
  const fm = useMemo(() => new Map<string, Ficha>((fichas ?? []).map((f) => [f.id, f])), [fichas]);
  const { data: vendas, isLoading } = useQuery({ queryKey: ["vendas", ini, fim], queryFn: () => carregarVendas(ini, fim), enabled: me?.perfil === "admin" });
  const { data: vendasAnt } = useQuery({ queryKey: ["vendas", ai, af], queryFn: () => carregarVendas(ai, af), enabled: me?.perfil === "admin" });

  const catDe = (id: string | null) => (id ? fm.get(id)?.categoria ?? "Sem ficha" : "Sem ficha");
  const filtra = (vs: typeof vendas) => (vs ?? []).filter((v) => (cat === "todas" || catDe(v.item_cardapio_id) === cat) && (item === "todos" || v.item_cardapio_id === item));
  const vf = filtra(vendas), va = filtra(vendasAnt);
  const r = resumo(vf, fm), ra = resumo(va, fm);

  const g = useMemo(() => {
    const porDia = new Map<string, number>(), porAg = new Map<string, number>(), porCat = new Map<string, number>();
    const rank = new Map<string, { nome: string; qtd: number; fat: number }>();
    const dow = Array.from({ length: 7 }, (_, i) => ({ dia: DIAS[i].slice(0, 3), fat: 0, pedidos: new Set<string>() }));
    const horas = Array.from({ length: 24 }, (_, h) => ({ h: `${String(h).padStart(2, "0")}h`, pedidos: new Set<string>() }));
    let temHora = false;
    for (const v of vf) {
      const val = Number(v.valor_total);
      porDia.set(v.data, (porDia.get(v.data) ?? 0) + val);
      const k = agrup === "semana" ? semana(v.data) : v.data.slice(0, 7);
      porAg.set(k, (porAg.get(k) ?? 0) + val);
      const c = catDe(v.item_cardapio_id);
      porCat.set(c, (porCat.get(c) ?? 0) + val);
      const nome = v.item_cardapio_id ? fm.get(v.item_cardapio_id)?.nome ?? v.produto_relatorio : v.produto_relatorio;
      const rk = rank.get(nome) ?? { nome, qtd: 0, fat: 0 };
      rk.qtd += Number(v.quantidade); rk.fat += val; rank.set(nome, rk);
      const wd = new Date(v.data + "T12:00").getDay();
      dow[wd].fat += val; dow[wd].pedidos.add(v.pedido);
      if (v.hora) { temHora = true; horas[Number(v.hora.slice(0, 2))].pedidos.add(v.pedido); }
    }
    return {
      dia: [...porDia].sort().map(([d, fat]) => ({ d: dataBR(d).slice(0, 5), fat })),
      ag: [...porAg].sort().map(([d, fat]) => ({ d: agrup === "semana" ? dataBR(d).slice(0, 5) : d.slice(5) + "/" + d.slice(0, 4), fat })),
      cat: [...porCat].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      rank: [...rank.values()],
      dow: [...dow.slice(1), dow[0]].map((x) => ({ dia: x.dia, fat: x.fat, pedidos: x.pedidos.size })),
      horas: horas.map((x) => ({ h: x.h, pedidos: x.pedidos.size })),
      temHora,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vf.length, ini, fim, cat, item, agrup, fm]);

  const top = [...g.rank].sort((a, b) => (rankBy === "qtd" ? b.qtd - a.qtd : b.fat - a.fat)).slice(0, 15);
  const categorias = [...new Set((fichas ?? []).map((f) => f.categoria))].sort();
  const semFicha = vf.filter((v) => !v.item_cardapio_id);

  return (
    <div className="space-y-5">
      <PageHeader title="Vendas" sub={`${dataBR(ini)} a ${dataBR(fim)}`} actions={
        <Button variant="outline" onClick={() => downloadCSV(`vendas_${ini}_${fim}.csv`, [
          ["pedido", "data", "produto", "item", "categoria", "quantidade", "valor_total"],
          ...vf.map((v) => [v.pedido, dataBR(v.data), v.produto_relatorio, v.item_cardapio_id ? fm.get(v.item_cardapio_id)?.nome : "", catDe(v.item_cardapio_id), Number(v.quantidade), Number(v.valor_total)]),
        ])}>Exportar CSV</Button>
      } />
      <div className="flex flex-wrap gap-2">
        <Select value={p} onValueChange={setP}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hoje">Hoje</SelectItem><SelectItem value="7">Últimos 7 dias</SelectItem><SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="mes">Mês atual</SelectItem><SelectItem value="mesant">Mês anterior</SelectItem><SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        {p === "custom" && <><Input type="date" className="w-40" value={ci} onChange={(e) => setCi(e.target.value)} /><Input type="date" className="w-40" value={cf} onChange={(e) => setCf(e.target.value)} /></>}
        <Select value={cat} onValueChange={(v) => { setCat(v); setItem("todos"); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todas">Todas categorias</SelectItem>{categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={item} onValueChange={setItem}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos os itens</SelectItem>
            {(fichas ?? []).filter((f) => cat === "todas" || f.categoria === cat).sort((a, b) => a.nome.localeCompare(b.nome)).map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <Empty>Carregando vendas…</Empty> : vf.length === 0 ? <Empty>Sem vendas no período.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Faturamento" value={brl(r.fat)} delta={delta(r.fat, ra.fat)} />
            <Stat label="Pedidos" value={num(r.pedidos)} delta={delta(r.pedidos, ra.pedidos)} />
            <Stat label="Ticket médio" value={brl(r.ticket)} delta={delta(r.ticket, ra.ticket)} />
            <Stat label="Itens vendidos" value={num(r.itens)} delta={delta(r.itens, ra.itens)} hint={`${num(r.itensPorPedido, 1)} por pedido`} />
            <Stat label="CMV teórico" value={brl(r.cmv)} delta={delta(r.cmv, ra.cmv)} />
            <Stat label="CMV %" value={pct(r.cmvPct)} hint={`anterior ${pct(ra.cmvPct)}`} />
          </div>
          {semFicha.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {semFicha.length} lançamentos sem ficha técnica (não geram baixa nem CMV): {[...new Set(semFicha.map((v) => v.produto_relatorio))].slice(0, 6).join(", ")}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Faturamento por dia">
              <ResponsiveContainer width="100%" height={240}><LineChart data={g.dia}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tt} formatter={(v: number) => brl(v)} /><Line dataKey="fat" stroke="var(--chart-1)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
            </Panel>
            <Panel title={`Faturamento por ${agrup}`} actions={
              <div className="flex gap-1">{(["semana", "mes"] as const).map((a) => <Button key={a} size="sm" variant={agrup === a ? "default" : "outline"} onClick={() => setAgrup(a)}>{a === "semana" ? "Semana" : "Mês"}</Button>)}</div>
            }>
              <ResponsiveContainer width="100%" height={240}><BarChart data={g.ag}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tt} formatter={(v: number) => brl(v)} /><Bar dataKey="fat" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </Panel>
            <Panel title="Top 15 itens" className="lg:col-span-2" actions={
              <div className="flex gap-1"><Button size="sm" variant={rankBy === "qtd" ? "default" : "outline"} onClick={() => setRankBy("qtd")}>Quantidade</Button><Button size="sm" variant={rankBy === "fat" ? "default" : "outline"} onClick={() => setRankBy("fat")}>Faturamento</Button></div>
            }>
              <ResponsiveContainer width="100%" height={420}><BarChart data={top} layout="vertical" margin={{ left: 20 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} /><YAxis type="category" dataKey="nome" width={190} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tt} formatter={(v: number) => (rankBy === "fat" ? brl(v) : num(v))} /><Bar dataKey={rankBy} fill="var(--chart-1)" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
            </Panel>
            <Panel title="Participação por categoria">
              <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={g.cat} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>{g.cat.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Pie><Tooltip {...tt} formatter={(v: number) => brl(v)} /></PieChart></ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{g.cat.map((c, i) => <span key={c.name} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CORES[i % CORES.length] }} />{c.name} {pct((c.value / r.fat) * 100)}</span>)}</div>
            </Panel>
            <Panel title="Vendas por dia da semana">
              <ResponsiveContainer width="100%" height={260}><BarChart data={g.dow}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tt} formatter={(v: number) => brl(v)} /><Bar dataKey="fat" fill="var(--chart-2)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </Panel>
            <Panel title="Pedidos por horário" className="lg:col-span-2">
              {g.temHora ? (
                <ResponsiveContainer width="100%" height={240}><BarChart data={g.horas}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="h" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} /><Tooltip {...tt} /><Bar dataKey="pedidos" fill="var(--chart-3)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              ) : (
                <>
                  <p className="mb-3 rounded-md bg-muted p-2 text-sm text-muted-foreground">Importe o relatório com a coluna de hora para ver o histograma. Mostrando pedidos por dia da semana.</p>
                  <ResponsiveContainer width="100%" height={220}><BarChart data={g.dow}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={11} /><YAxis stroke="var(--muted-foreground)" fontSize={11} /><Tooltip {...tt} /><Bar dataKey="pedidos" fill="var(--chart-3)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
                </>
              )}
            </Panel>
          </div>
          <Panel title="Itens vendidos no período">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Item</th><th className="text-right">Qtd</th><th className="text-right">Faturamento</th><th className="text-right">% fat.</th></tr></thead>
                <tbody>{[...g.rank].sort((a, b) => b.fat - a.fat).map((x) => (
                  <tr key={x.nome} className="border-t"><td className="py-1.5">{x.nome}</td><td className="text-right">{num(x.qtd)}</td><td className="text-right">{brl(x.fat)}</td><td className="text-right">{pct((x.fat / r.fat) * 100)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
