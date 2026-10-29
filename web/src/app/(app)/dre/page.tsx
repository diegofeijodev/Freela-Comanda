'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { criarDreSub, criarPlanoConta, excluirPlanoConta, listarCaixa, listarDreSubs, listarPlanoContas, pagosNoMes, salvarDreMeta } from "@/lib/erp-api";
import { PageHeader, Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { montarDRE, type SubDRE } from "@/lib/dre";
import { brl, isoDate, num, parseNum, pct } from "@/lib/format";
import { errMsg } from "@/lib/db";
import { cn } from "@/lib/utils";


export default function Dre() {
  const [mes, setMes] = useState(isoDate(new Date()).slice(0, 7));
  const [aberto, setAberto] = useState<string | null>(null);
  const [nsub, setNsub] = useState({ nome: "", sigla: "", meta: "" });
  const [nconta, setNconta] = useState<Record<string, string>>({});
  const { data: subs, refetch: rS } = useQuery({ queryKey: ["dre-subs"], queryFn: async () => (await listarDreSubs()) as SubDRE[] });
  const { data: planos, refetch: rP } = useQuery({
    queryKey: ["plano-contas-dre"],
    queryFn: async () => (await listarPlanoContas(true)).sort((a, b) => a.conta.localeCompare(b.conta)),
  });
  const { data: caixas } = useQuery({ queryKey: ["caixa", mes], queryFn: () => listarCaixa(mes) });
  const { data: pagos } = useQuery({ queryKey: ["dre-pagos", mes], queryFn: () => pagosNoMes(mes) });

  const d = montarDRE(caixas ?? [], (pagos ?? []).map((p) => ({ plano_conta_id: p.plano_conta_id, valor: Number(p.valor_pago ?? p.valor) })), planos ?? [], subs ?? []);

  async function addSub() {
    if (!nsub.nome) return;
    try {
      await criarDreSub({ nome: nsub.nome.toUpperCase(), sigla: nsub.sigla, meta_pct: parseNum(nsub.meta), ordem: (subs?.length ?? 0) + 1 });
    } catch (error) {
      return toast.error(errMsg(error));
    }
    setNsub({ nome: "", sigla: "", meta: "" }); rS();
  }
  async function addConta(s: string) {
    const c = nconta[s]?.trim(); if (!c) return;
    try {
      await criarPlanoConta({ grupo: "DRE", subgrupo: s, conta: c.toUpperCase() });
    } catch (error) {
      return toast.error(errMsg(error));
    }
    setNconta({ ...nconta, [s]: "" }); rP();
  }

  const Linha = ({ rot, v, forte, neg, p }: { rot: string; v: number; forte?: boolean; neg?: boolean; p?: number | null }) => (
    <tr className={cn("border-t", forte && "bg-secondary/40 font-semibold")}>
      <td className="py-1.5 pl-2">{rot}</td>
      <td className={cn("text-right", neg && "text-destructive")}>{neg && v ? `(${brl(v)})` : brl(v)}</td>
      <td className="pr-2 text-right text-xs text-muted-foreground">{p !== undefined ? pct(p) : ""}</td>
      <td />
    </tr>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="DRE" sub="Entradas da conciliação de caixa e despesas pagas no contas a pagar" />

      <Panel title="1. Subgrupos de despesas e contas">
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Subgrupo (ex.: DESPESAS COM MARKETING)" value={nsub.nome} onChange={(e) => setNsub({ ...nsub, nome: e.target.value })} />
          <Input placeholder="Sigla" value={nsub.sigla} onChange={(e) => setNsub({ ...nsub, sigla: e.target.value })} />
          <Input placeholder="Meta % do faturamento" inputMode="decimal" value={nsub.meta} onChange={(e) => setNsub({ ...nsub, meta: e.target.value })} />
          <Button onClick={addSub}>Adicionar subgrupo</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {(subs ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-semibold text-primary">{s.nome} <span className="text-xs text-muted-foreground">{s.sigla}{s.is_cmv ? " · CMV" : ""}{s.is_imposto ? " · Imposto" : ""}</span></div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">Meta %
                  <Input className="h-7 w-16 text-right" defaultValue={num(s.meta_pct)} onBlur={async (e) => { try { await salvarDreMeta(s.id, parseNum(e.target.value)); } catch (error) { toast.error(errMsg(error)); } rS(); }} /></label>
              </div>
              {(planos ?? []).filter((p) => p.subgrupo === s.nome).map((p) => (
                <div key={p.id} className="flex justify-between border-t py-1 text-sm"><span>{p.conta}</span>
                  <button aria-label="Remover" onClick={async () => { try { await excluirPlanoConta(p.id); } catch { toast.error("Conta já usada em pagamentos — não pode ser removida"); } rP(); }}
><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button></div>
              ))}
              <div className="mt-2 flex gap-2"><Input className="h-8" placeholder="Nova conta" value={nconta[s.nome] ?? ""} onChange={(e) => setNconta({ ...nconta, [s.nome]: e.target.value })} /><Button size="sm" variant="outline" onClick={() => addConta(s.nome)}>Adicionar</Button></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="2. Demonstrativo do mês" actions={<Input type="month" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="pl-2">Descrição</th><th className="text-right">Valor</th><th className="pr-2 text-right">% fat.</th><th className="text-right">Meta</th></tr></thead>
          <tbody>
            {d.entradas.map((e) => <Linha key={e.campo} rot={e.rotulo} v={e.valor} p={d.faturamento ? (e.valor / d.faturamento) * 100 : null} />)}
            <Linha rot="FATURAMENTO BRUTO (entradas)" v={d.faturamento} forte />
            <Linha rot="(−) Sangrias do caixa" v={d.sangria} neg />
            <Linha rot="SUBTOTAL DE ENTRADAS" v={d.subtotal} forte />
            <tr className="border-t text-xs text-muted-foreground"><td className="py-1.5 pl-2">Conferência: sangria para o cofre</td><td className="text-right">{brl(d.cofre)}</td><td className="pr-2 text-right">{d.sangria ? `${pct((d.cofre / d.sangria) * 100)} da sangria` : ""}</td><td /></tr>
            <tr><td colSpan={4} className="pt-4 pl-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Despesas (contas pagas no mês)</td></tr>
            {d.subgrupos.map((l) => {
              const estourou = l.sub.meta_pct != null && l.pct != null && l.pct > Number(l.sub.meta_pct);
              return [
                <tr key={l.sub.id} className="cursor-pointer border-t font-medium hover:bg-secondary/30" onClick={() => setAberto(aberto === l.sub.id ? null : l.sub.id)}>
                  <td className="py-1.5 pl-2">{aberto === l.sub.id ? "▾" : "▸"} {l.sub.nome}</td>
                  <td className="text-right text-destructive">{l.total ? `(${brl(l.total)})` : brl(0)}</td>
                  <td className={cn("pr-2 text-right text-xs", estourou ? "text-destructive" : "text-muted-foreground")}>{pct(l.pct)}</td>
                  <td className="text-right text-xs text-muted-foreground">{l.sub.meta_pct != null ? pct(Number(l.sub.meta_pct)) : "—"}</td>
                </tr>,
                ...(aberto === l.sub.id ? l.contas.map((c) => (
                  <tr key={l.sub.id + c.conta} className="text-xs text-muted-foreground"><td className="py-1 pl-8">{c.conta}</td><td className="text-right">{brl(c.total)}</td><td colSpan={2} /></tr>
                )) : []),
              ];
            })}
            {d.semClasse > 0 && <tr className="border-t text-destructive"><td className="py-1.5 pl-2">Pagamentos sem classificação</td><td className="text-right">({brl(d.semClasse)})</td><td colSpan={2} className="pr-2 text-right text-xs">classifique no Contas a Pagar</td></tr>}
            <tr><td colSpan={4} className="pt-4" /></tr>
            <Linha rot="LUCRO BRUTO (faturamento − CMV)" v={d.lucroBruto} forte p={d.faturamento ? (d.lucroBruto / d.faturamento) * 100 : null} />
            <Linha rot="RESULTADO ANTES DOS IMPOSTOS" v={d.antesImpostos} forte p={d.faturamento ? (d.antesImpostos / d.faturamento) * 100 : null} />
            <Linha rot="RESULTADO LÍQUIDO" v={d.liquido} forte p={d.liquidoPct} />
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
