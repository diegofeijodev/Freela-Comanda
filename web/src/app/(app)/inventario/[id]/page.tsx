'use client';

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { definirFinal, fecharInventario, inventario, itensContagem, itensInventarioAdmin, registrarContagem, type LojaItem } from "@/lib/erp-api";
import { gravarRascunho, lerRascunho } from "@/modules/inventario/infrastructure/rascunho.storage";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag, STATUS_INV } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl, dataBR, dataHoraBR, num, parseNum, pct } from "@/lib/format";
import { errMsg } from "@/lib/db";
import { cn } from "@/lib/utils";


export default function InvPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const { data: inv, refetch } = useQuery({ queryKey: ["inv", id], queryFn: () => inventario(id) });
  if (!inv) return <div className="text-muted-foreground">Carregando…</div>;
  const contando = inv.status === "aberto" || inv.status === "em_contagem";
  const titulo = `${inv.inicial ? "Inventário inicial" : "Inventário"} · ${dataBR(inv.data)}`;
  if (me?.perfil !== "admin") return <Contagem invId={id} titulo={titulo} status={inv.status} onChange={refetch} />;
  return (
    <div>
      <PageHeader title={titulo} actions={<Tag tone={STATUS_INV[inv.status].tone}>{STATUS_INV[inv.status].label}</Tag>} />
      <Tabs defaultValue={contando ? "contar" : "admin"}>
        <TabsList className="mb-4"><TabsTrigger value="admin">Visão do admin</TabsTrigger>{contando && <TabsTrigger value="contar">Contar</TabsTrigger>}</TabsList>
        <TabsContent value="admin"><VisaoAdmin invId={id} status={inv.status} inicial={inv.inicial} onChange={refetch} /></TabsContent>
        {contando && <TabsContent value="contar"><Contagem invId={id} status={inv.status} onChange={refetch} /></TabsContent>}
      </Tabs>
    </div>
  );
}


function Contagem({ invId, titulo, status, onChange }: { invId: string; titulo?: string; status: string; onChange: () => void }) {
  const { data: itens, refetch } = useQuery({ queryKey: ["loja-itens", invId], queryFn: () => itensContagem(invId) });
  const [rasc, setRasc] = useState<Record<string, string>>({});
  const [aberto, setAberto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setRasc(lerRascunho(invId)); }, [invId]);
  const set = (id: string, v: string) => setRasc((r) => { const n = { ...r, [id]: v }; gravarRascunho(invId, n); return n; });

  const grupos = useMemo(() => {
    const m = new Map<string, Map<string, LojaItem[]>>();
    for (const i of itens ?? []) {
      if (!m.has(i.grupo)) m.set(i.grupo, new Map());
      const g = m.get(i.grupo)!;
      if (!g.has(i.subgrupo)) g.set(i.subgrupo, []);
      g.get(i.subgrupo)!.push(i);
    }
    return [...m].sort((a) => (a[0] === "Produtos de venda" ? -1 : 1));
  }, [itens]);
  const recontar = (itens ?? []).filter((i) => i.situacao === "recontar");
  const total = itens?.length ?? 0, feitos = (itens ?? []).filter((i) => i.situacao === "contado").length;

  async function enviar(lista: LojaItem[]) {
    const alvo = lista.filter((i) => i.situacao !== "contado" && parseNum(rasc[i.id]) != null);
    if (!alvo.length) return toast.error("Preencha ao menos um item");
    setEnviando(true);
    let rec = 0;
    for (const i of alvo) {
      try {
        const { resultado } = await registrarContagem(i.id, parseNum(rasc[i.id])!);
        if (resultado === "recontar") rec++;
      } catch (error) {
        toast.error(`${i.nome}: ${errMsg(error)}`);
        continue;
      }
    }
    const n = { ...rasc };
    alvo.forEach((i) => delete n[i.id]);
    setRasc(n); gravarRascunho(invId, n);
    setEnviando(false);
    if (rec) toast.warning(`${rec} item(ns) com diferença, recontar`); else toast.success("Contagem enviada");
    refetch(); onChange();
  }

  const Campo = ({ i }: { i: LojaItem }) => (
    <div className={cn("flex items-center gap-3 border-t py-3", i.situacao === "recontar" && "rounded-lg border-destructive/50 bg-destructive/5 px-2")}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{i.nome}</div>
        <div className="text-xs text-muted-foreground">{i.unidade}{i.embalagem && i.embalagem !== i.unidade ? ` · ${i.embalagem}` : ""}</div>
        {i.situacao === "recontar" && <div className="mt-0.5 text-xs font-medium text-destructive">Item com diferença, recontar</div>}
      </div>
      {i.situacao === "contado" ? <Check className="h-6 w-6 text-success" /> : (
        <Input inputMode="decimal" className="h-12 w-28 text-right text-lg" placeholder="0" value={rasc[i.id] ?? ""} onChange={(e) => set(i.id, e.target.value)} />
      )}
    </div>
  );

  if (status === "aguardando_aprovacao" || status === "fechado")
    return (
      <div className="space-y-4">
        {titulo && <PageHeader title={titulo} />}
        <Panel><div className="flex items-center gap-3"><Check className="h-8 w-8 text-success" /><div><div className="font-semibold">Contagem concluída</div><div className="text-sm text-muted-foreground">{status === "fechado" ? "Inventário fechado." : "Aguardando aprovação do administrador."}</div></div></div></Panel>
      </div>
    );

  return (
    <div className="space-y-4 pb-24">
      {titulo && <PageHeader title={titulo} sub={`${feitos}/${total} itens contados`} />}
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-gold transition-all" style={{ width: `${total ? (feitos / total) * 100 : 0}%` }} /></div>
      {recontar.length > 0 && (
        <section className="rounded-xl border-2 border-destructive bg-card p-4">
          <h2 className="flex items-center gap-2 font-sans text-base font-semibold text-destructive"><AlertTriangle className="h-5 w-5" /> Recontar ({recontar.length})</h2>
          {recontar.map((i) => <Campo key={i.id} i={i} />)}
          <Button className="mt-3 w-full" size="lg" variant="destructive" disabled={enviando} onClick={() => enviar(recontar)}>Enviar recontagem</Button>
        </section>
      )}
      {grupos.map(([g, subs]) => (
        <div key={g} className="space-y-2">
          <h2 className="pt-2 text-lg font-semibold text-primary">{g}</h2>
          {[...subs].map(([s, lista]) => {
            const ok = lista.filter((i) => i.situacao === "contado").length;
            const k = g + s, open = aberto === k;
            return (
              <div key={s} className="rounded-xl border bg-card">
                <button className="flex w-full items-center justify-between p-4" onClick={() => setAberto(open ? null : k)}>
                  <span className="font-medium">{s}</span>
                  <span className="flex items-center gap-2 text-sm"><Tag tone={ok === lista.length ? "ok" : "muted"}>{ok}/{lista.length}</Tag><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /></span>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    {lista.map((i) => <Campo key={i.id} i={i} />)}
                    {ok < lista.length && <Button className="mt-3 w-full" size="lg" disabled={enviando} onClick={() => enviar(lista)}>Enviar {s}</Button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="no-print fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button className="w-full" size="lg" disabled={enviando} onClick={() => enviar(itens ?? [])}>Enviar tudo que foi preenchido</Button>
      </div>
    </div>
  );
}

const ST: Record<string, { l: string; t: "ok" | "bad" | "warn" | "gold" | "muted" }> = {
  pendente: { l: "Pendente", t: "muted" }, recontar: { l: "Recontar", t: "warn" }, ok: { l: "OK", t: "ok" },
  recontado_ok: { l: "Recontado OK", t: "ok" }, diferenca_confirmada: { l: "Diferença confirmada", t: "bad" },
};

function VisaoAdmin({ invId, status, inicial, onChange }: { invId: string; status: string; inicial: boolean; onChange: () => void }) {
  const router = useRouter();
  const { data: itens, refetch } = useQuery({ queryKey: ["inv-admin", invId], queryFn: () => itensInventarioAdmin(invId) });
  const linhas = (itens ?? []).map((i) => {
    const t = i.teorico_snapshot != null ? Number(i.teorico_snapshot) : null;
    const dif = i.final != null && t != null ? Number(i.final) - t : null;
    return { ...i, t, dif, difR: dif != null ? dif * Number(i.itens_estoque?.preco_unitario ?? 0) : null, difP: dif != null && t ? (dif / t) * 100 : null };
  }).sort((a, b) => (a.itens_estoque?.subgrupo ?? "").localeCompare(b.itens_estoque?.subgrupo ?? "") || (a.itens_estoque?.nome ?? "").localeCompare(b.itens_estoque?.nome ?? ""));
  const subs = [...new Set(linhas.map((l) => l.itens_estoque?.subgrupo ?? ""))];
  const tot = (ls: typeof linhas) => ({ perda: ls.reduce((s, l) => s + Math.min(0, l.difR ?? 0), 0), sobra: ls.reduce((s, l) => s + Math.max(0, l.difR ?? 0), 0) });
  const geral = tot(linhas);
  const pend = linhas.filter((l) => l.final == null).length;

  async function editarFinal(l: (typeof linhas)[number]) {
    const v = prompt(`Quantidade final de ${l.itens_estoque?.nome}:`, l.final != null ? num(l.final, 3) : "");
    if (v == null) return;
    const q = parseNum(v);
    if (q == null) return toast.error("Quantidade inválida");
    const j = prompt("Justificativa (obrigatória):", l.justificativa ?? "");
    if (!j) return toast.error("Informe a justificativa");
    try {
      await definirFinal(l.id, q, j);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    refetch();
  }
  async function fechar() {
    if (!confirm("Fechar o inventário? O saldo passa a ser o contado e a lista de compras será gerada.")) return;
    try {
      const { lista_id } = await fecharInventario(invId);
      toast.success("Inventário fechado e lista de compras gerada");
      onChange();
      router.push(`/compras/${lista_id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }

  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Itens</div><div className="text-2xl font-semibold">{linhas.length}</div></div>
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Sem quantidade final</div><div className="text-2xl font-semibold">{pend}</div></div>
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Perdas</div><div className="text-2xl font-semibold text-destructive">{brl(geral.perda)}</div></div>
        <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Sobras</div><div className="text-2xl font-semibold text-success">{brl(geral.sobra)}</div></div>
      </div>
      {status !== "fechado" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={fechar} disabled={pend > 0}>Aprovar e fechar inventário</Button>
          {pend > 0 && <span className="text-sm text-muted-foreground">Faltam {pend} itens. Você pode definir a quantidade final manualmente.</span>}
        </div>
      )}
      {subs.map((s) => {
        const ls = linhas.filter((l) => (l.itens_estoque?.subgrupo ?? "") === s);
        const t = tot(ls);
        return (
          <Panel key={s} title={s} actions={!inicial && <span className="text-xs"><span className="text-destructive">{brl(t.perda)}</span> · <span className="text-success">{brl(t.sobra)}</span></span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr>
                  <th className="py-2 text-left">Item</th><th className="text-right">Teórico</th><th className="text-right">Cont. 1</th><th className="text-right">Cont. 2</th><th className="text-right">Cont. 3</th>
                  <th className="text-right">Final</th><th className="text-right">Dif.</th><th className="text-right">Dif. R$</th><th className="text-right">Dif. %</th><th className="text-right">Status</th>
                </tr></thead>
                <tbody>{ls.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-1.5">{l.itens_estoque?.nome} <span className="text-xs text-muted-foreground">{l.itens_estoque?.unidade}</span>{l.justificativa && <div className="text-xs text-warning">{l.justificativa}</div>}</td>
                    <td className="text-right">{l.t != null ? num(l.t, 3) : "—"}</td>
                    {[1, 2, 3].map((n) => {
                      const v = l[`contagem_${n}` as "contagem_1"], h = l[`hora_${n}` as "hora_1"];
                      return <td key={n} className="text-right" title={h ? dataHoraBR(h) : ""}>{v != null ? num(v, 3) : "—"}</td>;
                    })}
                    <td className="text-right">{status !== "fechado" ? <button className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => editarFinal(l)}>{l.final != null ? num(l.final, 3) : "definir"}</button> : num(l.final, 3)}</td>
                    <td className={cn("text-right", (l.dif ?? 0) < 0 ? "text-destructive" : (l.dif ?? 0) > 0 ? "text-success" : "")}>{l.dif != null ? num(l.dif, 3) : "—"}</td>
                    <td className="text-right">{brl(l.difR)}</td>
                    <td className="text-right">{pct(l.difP)}</td>
                    <td className="text-right"><Tag tone={ST[l.status].t}>{ST[l.status].l}</Tag></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
