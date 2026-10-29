'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { criarConta, excluirConta, listarCentros, listarContas, listarPlanoContas, reabrirConta } from "@/lib/erp-api";
import { PageHeader, Panel, Stat, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORMAS, type FormaPgto } from "@/lib/nfe";
import { brl, dataBR, isoDate, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";
import { DDAPanel, LiquidarDialog } from "@/components/dda-panel";


const hoje = () => isoDate(new Date());
type Filtro = "abertas" | "vencidas" | "semana" | "pagas" | "todas";

export default function Contas() {
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [ini, setIni] = useState(""); const [fim, setFim] = useState("");
  const [nova, setNova] = useState({ descricao: "", fornecedor_nome: "", valor: "", vencimento: hoje(), forma_pagamento: "boleto", categoria: "Fornecedores" });
  const { data: contas, refetch } = useQuery({ queryKey: ["contas-pagar"], queryFn: listarContas });
  const { data: planosRaw } = useQuery({ queryKey: ["plano-contas"], queryFn: () => listarPlanoContas(true) });
  const { data: centrosRaw } = useQuery({ queryKey: ["centros-custo"], queryFn: () => listarCentros(true) });
  const planos = (planosRaw ?? []).map((p) => ({ id: p.id, rotulo: [p.grupo, p.subgrupo, p.conta].filter(Boolean).join(" › ") }));
  const centros = (centrosRaw ?? []).map((c) => ({ id: c.id, rotulo: c.nome }));
  const rot = (l: { id: string; rotulo: string }[], id: string | null) => l.find((x) => x.id === id)?.rotulo;
  const [liq, setLiq] = useState<{ id: string; valor: number } | null>(null);

  const h = hoje(), sem = isoDate(new Date(Date.now() + 7 * 864e5));
  const abertas = (contas ?? []).filter((c) => c.status === "aberta");
  const vencidas = abertas.filter((c) => c.vencimento < h);
  const lista = (contas ?? []).filter((c) => {
    if (ini && c.vencimento < ini) return false;
    if (fim && c.vencimento > fim) return false;
    if (filtro === "abertas") return c.status === "aberta";
    if (filtro === "vencidas") return c.status === "aberta" && c.vencimento < h;
    if (filtro === "semana") return c.status === "aberta" && c.vencimento >= h && c.vencimento <= sem;
    if (filtro === "pagas") return c.status === "paga";
    return true;
  });
  const soma = (a: { valor: number }[]) => a.reduce((s, c) => s + Number(c.valor), 0);

  const pagar = (id: string, valor: number) => setLiq({ id, valor });
  async function reabrir(id: string) {
    try { await reabrirConta(id); } catch (error) { toast.error(errMsg(error)); }
    refetch();
  }
  async function excluir(id: string) {
    if (!confirm("Excluir esta conta?")) return;
    try { await excluirConta(id); } catch (error) { toast.error(errMsg(error)); }
    refetch();
  }
  async function lancar() {
    const valor = parseNum(nova.valor);
    if (!nova.descricao || !valor || !nova.vencimento) return toast.error("Preencha descrição, valor e vencimento");
    try {
      await criarConta({ ...nova, valor });
    } catch (error) {
      return toast.error(errMsg(error));
    }

    toast.success("Conta lançada"); setNova({ ...nova, descricao: "", valor: "" }); refetch();
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Contas a Pagar" sub="Boletos e parcelas das notas de entrada e lançamentos manuais" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Em aberto" value={brl(soma(abertas))} hint={`${abertas.length} contas`} />
        <Stat label="Vencidas" value={<span className={vencidas.length ? "text-destructive" : ""}>{brl(soma(vencidas))}</span>} hint={`${vencidas.length} contas`} />
        <Stat label="Vencem em 7 dias" value={brl(soma(abertas.filter((c) => c.vencimento >= h && c.vencimento <= sem)))} />
      </div>
      {vencidas.length > 0 && <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Atenção: {vencidas.length} conta(s) vencida(s) somando {brl(soma(vencidas))}.</div>}

      <DDAPanel contas={(contas ?? []) as never} planos={planos} centros={centros} onChange={refetch} />
      {liq && <LiquidarDialog ids={[liq.id]} total={liq.valor} planos={planos} centros={centros} onClose={() => setLiq(null)} onDone={() => { setLiq(null); refetch(); }} />}

      <Panel title="Nova conta (sem nota)">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="lg:col-span-2"><Label>Descrição</Label><Input value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} placeholder="Ex.: Aluguel outubro" /></div>
          <div><Label>Fornecedor</Label><Input value={nova.fornecedor_nome} onChange={(e) => setNova({ ...nova, fornecedor_nome: e.target.value })} /></div>
          <div><Label>Valor</Label><Input value={nova.valor} onChange={(e) => setNova({ ...nova, valor: e.target.value })} placeholder="0,00" /></div>
          <div><Label>Vencimento</Label><Input type="date" value={nova.vencimento} onChange={(e) => setNova({ ...nova, vencimento: e.target.value })} /></div>
          <div><Label>Forma</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={nova.forma_pagamento} onChange={(e) => setNova({ ...nova, forma_pagamento: e.target.value })}>
              {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><Label>Categoria</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={nova.categoria} onChange={(e) => setNova({ ...nova, categoria: e.target.value })}>
              {["Fornecedores", "Aluguel", "Energia/Água", "Folha", "Impostos", "Manutenção", "Outros"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-end"><Button onClick={lancar}>Lançar</Button></div>
        </div>
      </Panel>

      <Panel title={`Contas · ${lista.length} · ${brl(soma(lista))}`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(["abertas", "vencidas", "semana", "pagas", "todas"] as Filtro[]).map((f) => (
            <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} onClick={() => setFiltro(f)}>{{ abertas: "Em aberto", vencidas: "Vencidas", semana: "Próximos 7 dias", pagas: "Pagas", todas: "Todas" }[f]}</Button>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">Vencimento de</span><Input type="date" className="h-8 w-40" value={ini} onChange={(e) => setIni(e.target.value)} />
          <span className="text-xs text-muted-foreground">até</span><Input type="date" className="h-8 w-40" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Vencimento</th><th>Descrição</th><th>Parcela</th><th>Forma</th><th>Situação</th><th className="text-right">Valor</th><th /></tr></thead>
          <tbody>{lista.map((c) => {
            const venc = c.status === "aberta" && c.vencimento < h;
            return (
              <tr key={c.id} className="border-t">
                <td className={venc ? "py-1.5 text-destructive" : "py-1.5"}>{dataBR(c.vencimento)}</td>
                <td>{c.descricao}<div className="text-xs text-muted-foreground">{c.categoria}{c.fornecedor_nome && c.fornecedor_nome !== c.descricao ? ` · ${c.fornecedor_nome}` : ""}{c.origem_dda ? " · DDA" : ""}</div>
                  {c.plano_conta_id && <div className="text-xs text-primary">{rot(planos, c.plano_conta_id)}{c.centro_custo_id ? ` · ${rot(centros, c.centro_custo_id)}` : ""}</div>}</td>
                <td>{c.parcela ?? "—"}</td>
                <td>{FORMAS[c.forma_pagamento as FormaPgto] ?? c.forma_pagamento}</td>
                <td>{c.status === "paga" ? <Tag tone="ok">Paga {dataBR(c.pago_em)}</Tag> : venc ? <Tag tone="bad">Vencida</Tag> : <Tag tone="gold">Em aberto</Tag>}</td>
                <td className="text-right">{brl(c.valor)}</td>
                <td className="whitespace-nowrap text-right">
                  {c.status === "aberta" ? <Button size="sm" variant="outline" onClick={() => pagar(c.id, Number(c.valor))}>Pagar</Button> : <Button size="sm" variant="ghost" onClick={() => reabrir(c.id)}>Reabrir</Button>}
                  {!c.nota_id && <Button size="sm" variant="ghost" onClick={() => excluir(c.id)}>Excluir</Button>}
                </td>
              </tr>
            );
          })}{!lista.length && <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">Nenhuma conta neste filtro.</td></tr>}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
