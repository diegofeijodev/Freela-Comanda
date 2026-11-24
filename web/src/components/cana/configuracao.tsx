'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
import { canaParametros, canaProdutos, canaSalvarParametros, canaSalvarProduto, type CanaProduto } from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { contaUmaVenda, dataSp, horaSp, lerNumero } from "@/lib/cana";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const txt = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
const valorOuNulo = (s: string): number | null | "erro" => {
  const n = lerNumero(s);
  if (n === null) return null;
  return Number.isNaN(n) || n <= 0 ? "erro" : n;
};

function Numeros() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cana-parametros"], queryFn: canaParametros });
  const [esperado, setEsperado] = useState("");
  const [rendimento, setRendimento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (q.data) { setEsperado(txt(q.data.litros_por_duzia_esperado)); setRendimento(txt(q.data.rendimento_frozen)); } }, [q.data]);

  async function salvar() {
    const e = valorOuNulo(esperado);
    const r = valorOuNulo(rendimento);
    if (e === "erro" || r === "erro") { setErro("Use um número maior que zero (ex.: 5,5)."); return; }
    setSalvando(true); setErro(null);
    try {
      await canaSalvarParametros({ litros_por_duzia_esperado: e, rendimento_frozen: r });
      toast.success("Números da cana salvos.");
      void qc.invalidateQueries({ queryKey: ["cana-parametros"] });
      void qc.invalidateQueries({ queryKey: ["cana-semana"] });
      void qc.invalidateQueries({ queryKey: ["cana-semanas"] });
    } catch (x) { setErro(errMsg(x)); } finally { setSalvando(false); }
  }

  if (q.isLoading) return <Panel title="Números da cana"><Skeleton className="h-11 w-full" /><Skeleton className="mt-3 h-11 w-full" /></Panel>;
  if (q.isError)
    return <Panel title="Números da cana"><p className="text-sm">Não consegui ver os números da cana agora. <Button variant="link" className="h-auto p-0" onClick={() => q.refetch()}>Tentar de novo</Button></p></Panel>;
  return (
    <Panel title="Números da cana">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <div className="space-y-1">
          <Label htmlFor="cana-esperado">Litros de caldo esperados por dúzia (opcional)</Label>
          <div className="flex items-center gap-2">
            <Input id="cana-esperado" inputMode="decimal" className="h-11" value={esperado} onChange={(e) => setEsperado(e.target.value)} />
            <span className="w-24 shrink-0 text-sm text-muted-foreground">L por dúzia</span>
          </div>
          {!esperado && <p className="text-sm text-muted-foreground">não informado</p>}
          <p className="text-sm text-muted-foreground">Quanto caldo vocês esperam tirar de uma dúzia. Pode deixar em branco nas primeiras semanas e usar a média real que aparecer.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cana-rendimento">1 litro de caldo vira quantos litros de frozen?</Label>
          <div className="flex items-center gap-2">
            <Input id="cana-rendimento" inputMode="decimal" className="h-11" value={rendimento} onChange={(e) => setRendimento(e.target.value)} />
            <span className="w-24 shrink-0 text-sm text-muted-foreground">L de frozen</span>
          </div>
          {!rendimento && <p className="text-sm text-muted-foreground">não informado</p>}
          <p className="text-sm text-muted-foreground">Ex.: se 1 L de caldo vira 1,25 L de frozen, digite 1,25. Serve para trazer o frozen vendido e o contado de volta para litros de caldo.</p>
        </div>
        {erro && <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{erro}</div>}
        <Button type="submit" className="h-11 w-full md:w-auto" disabled={salvando}>{salvando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar os números"}</Button>
        <p className="text-sm text-muted-foreground">Muda as contas de todas as semanas: elas são calculadas na hora, com a configuração de hoje.</p>
        {q.data?.atualizado_por_nome && q.data.atualizado_em && (
          <div className="text-sm text-muted-foreground">
            Última mudança: {q.data.atualizado_por_nome}, {dataSp(q.data.atualizado_em)} às {horaSp(q.data.atualizado_em)}.
            {q.data.historico.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">Ver as mudanças</summary>
                <ul>{q.data.historico.map((h) => (
                  <li key={h.id}>{h.alterado_por_nome}, {dataSp(h.alterado_em)} às {horaSp(h.alterado_em)}: esperado {h.litros_por_duzia_esperado == null ? "não informado" : txt(h.litros_por_duzia_esperado)} · frozen {h.rendimento_frozen == null ? "não informado" : txt(h.rendimento_frozen)}</li>
                ))}</ul>
              </details>
            )}
          </div>
        )}
      </form>
    </Panel>
  );
}

function LinhaProduto({ p, rendimento, onSalvo }: { p: CanaProduto; rendimento: number | null; onSalvo: () => void }) {
  const [leva, setLeva] = useState(!!p.config?.ativo);
  const [ml, setMl] = useState(txt(p.config?.ml_por_unidade));
  const [frozen, setFrozen] = useState(!!p.config?.frozen);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const mlNum = lerNumero(ml);
  const mudou = leva !== !!p.config?.ativo || (leva && (txt(p.config?.ml_por_unidade) !== ml || frozen !== !!p.config?.frozen));

  async function salvar() {
    const n = leva ? mlNum : p.config?.ml_por_unidade ?? null;
    if (leva && (n === null || Number.isNaN(n) || n <= 0)) { setErro("Digite os ml (maior que zero)."); return; }
    if (!leva && !p.config) return;
    setSalvando(true); setErro(null);
    try {
      await canaSalvarProduto(p.item_cardapio_id, { ml_por_unidade: n!, frozen: leva ? frozen : !!p.config?.frozen, ativo: leva });
      toast.success(leva ? `${p.nome} salvo: ${ml} ml ${frozen ? "de frozen" : "de caldo"} por unidade.` : `${p.nome} não entra mais na conta da cana.`);
      onSalvo();
    } catch (x) { setErro(errMsg(x)); } finally { setSalvando(false); }
  }

  return (
    <li className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>{p.nome}</b><span className="text-muted-foreground">{p.categoria}</span>
        {p.parece_cana && <Tag tone="gold">parece de caldo</Tag>}
        {!p.item_ativo && <Tag tone="muted">inativo no cardápio</Tag>}
      </div>
      <label className="flex h-11 items-center gap-2"><Switch checked={leva} onCheckedChange={setLeva} aria-label={`${p.nome} leva caldo`} /> Leva caldo</label>
      {leva && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`ml-${p.item_cardapio_id}`}>{frozen ? "ml de frozen em 1 unidade (o tamanho do copo)" : "ml de caldo em 1 unidade"}</Label>
            <div className="flex items-center gap-2">
              <Input id={`ml-${p.item_cardapio_id}`} inputMode="decimal" className="h-11 w-32 text-right" value={ml} onChange={(e) => setMl(e.target.value)} />
              <span className="text-muted-foreground">ml</span>
            </div>
          </div>
          <label className="flex h-11 items-center gap-2"><Checkbox checked={frozen} onCheckedChange={(c) => setFrozen(c === true)} aria-label={`${p.nome} é frozen`} /> É frozen</label>
          {mlNum !== null && !Number.isNaN(mlNum) && mlNum > 0 && <p className="text-muted-foreground">{contaUmaVenda(mlNum, frozen, rendimento)}</p>}
        </>
      )}
      {erro && <p role="alert" className="text-destructive">{erro}</p>}
      {mudou && (
        <Button className="h-11" disabled={salvando} aria-label={`Salvar ${p.nome}`} onClick={() => void salvar()}>
          {salvando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar"}
        </Button>
      )}
    </li>
  );
}

function Produtos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cana-produtos"], queryFn: canaProdutos });
  const par = useQuery({ queryKey: ["cana-parametros"], queryFn: canaParametros });
  const [busca, setBusca] = useState("");
  const configurados = (q.data ?? []).filter((p) => p.config?.ativo);
  // O filtro de partida é decidido uma vez (salvar o 1º produto não pode esconder os outros que parecem de caldo).
  const [filtro, setFiltro] = useState<"parecem" | "configurados" | "todos" | null>(null);
  useEffect(() => { if (q.data && filtro === null) setFiltro(q.data.some((p) => p.config?.ativo) ? "configurados" : "parecem"); }, [q.data, filtro]);
  const f = filtro ?? "parecem";
  const lista = useMemo(() => {
    const b = semAcento(busca.trim());
    return (q.data ?? []).filter((p) => (b ? semAcento(p.nome).includes(b) : f === "todos" || (f === "parecem" ? p.parece_cana : !!p.config?.ativo)));
  }, [q.data, busca, f]);

  if (q.isLoading) return <Panel title="Produtos que levam caldo">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="mb-2 h-20 w-full" />)}</Panel>;
  if (q.isError) return <Panel title="Produtos que levam caldo"><p className="text-sm">Não consegui ver o cardápio agora. <Button variant="link" className="h-auto p-0" onClick={() => q.refetch()}>Tentar de novo</Button></p></Panel>;
  if (!q.data?.length)
    return <Panel title="Produtos que levam caldo"><p className="text-sm">O cardápio não tem produtos ativos. Cadastre os produtos em Fichas Técnicas. <Link className="underline" href="/fichas">Ir para Fichas Técnicas</Link></p></Panel>;
  const n = { parecem: q.data.filter((p) => p.parece_cana).length, configurados: configurados.length, todos: q.data.length };
  return (
    <Panel title="Produtos que levam caldo">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cana-busca">Buscar no cardápio</Label>
          <Input id="cana-busca" type="search" className="h-11" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["parecem", "configurados", "todos"] as const).map((k) => (
            <Button key={k} variant={f === k ? "default" : "outline"} className="h-11" onClick={() => setFiltro(k)}>
              {{ parecem: "Parecem de caldo", configurados: "Configurados", todos: "Todos" }[k]} ({n[k]})
            </Button>
          ))}
        </div>
        {lista.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {busca ? `Nenhum produto do cardápio com “${busca}”.` : f === "parecem" ? "Nenhum produto do cardápio tem cana, caldo, garapa ou frozen no nome. Abra Todos e ligue os que levam caldo." : "Nenhum produto configurado."}
          </p>
        )}
        <ul className="space-y-2">
          {lista.map((p) => (
            <LinhaProduto key={`${p.item_cardapio_id}-${p.config?.atualizado_em ?? ""}`} p={p} rendimento={par.data?.rendimento_frozen ?? null}
              onSalvo={() => { void qc.invalidateQueries({ queryKey: ["cana-produtos"] }); void qc.invalidateQueries({ queryKey: ["cana-semana"] }); void qc.invalidateQueries({ queryKey: ["cana-semanas"] }); }} />
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** Aba Configuração (UX 3.6): nada vem preenchido. */
export function CanaConfiguracaoAba() {
  const q = useQuery({ queryKey: ["cana-produtos"], queryFn: canaProdutos });
  const nada = q.data && !q.data.some((p) => p.config?.ativo);
  return (
    <div className="space-y-4">
      {nada && (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /> Nada configurado: o caldo vendido aparece como 0. Comece pelos produtos que levam caldo, abaixo.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-1"><Numeros /></div>
        <div className="md:col-span-2"><Produtos /></div>
      </div>
    </div>
  );
}
