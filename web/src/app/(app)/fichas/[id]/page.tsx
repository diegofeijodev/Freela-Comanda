'use client';

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, Printer, Copy } from "lucide-react";
import {
  adicionarIngrediente, atualizarIngrediente, atualizarItemCardapio, duplicarItemCardapio, excluirItemCardapio, itemCardapio, listarIngredientes,
  listarItensEstoque, removerIngrediente,
} from "@/lib/erp-api";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, num, parseNum, pct } from "@/lib/format";
import { calcFicha } from "@/lib/ficha";
import { getConfig, errMsg } from "@/lib/db";


const CATS = ["Pratos", "Espetinhos", "Porções", "Tábuas", "Adicionais", "Chopp", "Bebidas", "Burgers", "Combos"];

export default function FichaPage() {
  const { data: me } = useMe();
  if (me?.perfil !== "admin") return <div className="text-muted-foreground">Consulte as fichas pela lista. <Link href="/fichas" className="text-primary">Voltar</Link></div>;
  return <FichaAdmin />;
}

function FichaAdmin() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const { data: item, refetch: rItem } = useQuery({ queryKey: ["ficha", id], queryFn: () => itemCardapio(id) });
  const { data: ings, refetch: rIng } = useQuery({ queryKey: ["ficha-ing", id], queryFn: () => listarIngredientes(id) });
  const { data: insumos } = useQuery({ queryKey: ["insumos-lista"], queryFn: () => listarItensEstoque({ ativo: true }) });
  const [f, setF] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState({ insumo: "", qtd: "" });

  useEffect(() => {
    if (item) setF({
      nome: item.nome, codigo: item.codigo ?? "", categoria: item.categoria, grupo: item.grupo, unidade_venda: item.unidade_venda,
      preco_venda: item.preco_venda?.toString().replace(".", ",") ?? "", mkup: item.mkup?.toString().replace(".", ",") ?? "",
      ncm: item.ncm ?? "", cfop: item.cfop ?? "", cst: item.cst ?? "", aliquota: item.aliquota?.toString() ?? "", observacoes: item.observacoes ?? "",
    });
  }, [item]);

  if (!item || !cfg) return <div className="text-muted-foreground">Carregando…</div>;
  const soma = (ings ?? []).reduce((s, i) => s + Number(i.quantidade) * Number(i.itens_estoque?.preco_unitario ?? 0), 0);
  const c = calcFicha(soma, cfg, parseNum(f.mkup), parseNum(f.preco_venda));

  async function salvar() {
    try {
      await atualizarItemCardapio(id, {
        nome: f.nome, codigo: f.codigo || null, categoria: f.categoria, grupo: f.grupo, unidade_venda: f.unidade_venda,
        preco_venda: parseNum(f.preco_venda), mkup: parseNum(f.mkup), ncm: f.ncm || null, cfop: f.cfop || null, cst: f.cst || null,
        aliquota: parseNum(f.aliquota), observacoes: f.observacoes || null,
      });
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success("Ficha salva");
    rItem(); qc.invalidateQueries({ queryKey: ["fichas-resumo"] });
  }
  async function updIng(ingId: string, patch: { quantidade?: number; rendimento?: number | null }) {
    try {
      await atualizarIngrediente(ingId, patch);
      rIng(); qc.invalidateQueries({ queryKey: ["fichas-resumo"] });
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  async function addIng() {
    const ins = insumos?.find((i) => i.id === novo.insumo);
    if (!ins || !parseNum(novo.qtd)) return toast.error("Escolha o insumo e a quantidade");
    try {
      await adicionarIngrediente(id, { item_estoque_id: ins.id, quantidade: parseNum(novo.qtd)!, unidade: ins.unidade, ordem: (ings?.length ?? 0) + 1 });
    } catch (error) {
      return toast.error(errMsg(error));
    }
    setNovo({ insumo: "", qtd: "" }); rIng(); qc.invalidateQueries({ queryKey: ["fichas-resumo"] });
  }
  async function duplicar() {
    try {
      const n = await duplicarItemCardapio(id);
      toast.success("Ficha duplicada");
      qc.invalidateQueries({ queryKey: ["fichas-resumo"] });
      router.push(`/fichas/${n.id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  async function excluir() {
    if (!confirm("Excluir esta ficha? As vendas deste item deixam de gerar baixa.")) return;
    try {
      await excluirItemCardapio(id);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    qc.invalidateQueries({ queryKey: ["fichas-resumo"] });
    router.push("/fichas");
  }
  const fld = (k: string, label: string, cls = "") => (
    <div className={cls}><Label className="text-xs text-muted-foreground">{label}</Label><Input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={item.nome} sub="Ficha Técnica Gerencial" actions={<>
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Imprimir / PDF</Button>
        <Button variant="outline" onClick={duplicar}><Copy className="mr-1 h-4 w-4" />Duplicar</Button>
        <Button variant="outline" onClick={excluir}><Trash2 className="mr-1 h-4 w-4" />Excluir</Button>
        <Button onClick={salvar}>Salvar</Button>
      </>} />
      <Panel title="Cabeçalho">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {fld("nome", "Nome do item", "col-span-2 md:col-span-3")}
          {fld("codigo", "Código")}
          <div><Label className="text-xs text-muted-foreground">Grupo</Label>
            <Select value={f.grupo} onValueChange={(v) => setF({ ...f, grupo: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Alimentos">Alimentos</SelectItem><SelectItem value="Bebidas">Bebidas</SelectItem></SelectContent></Select></div>
          <div><Label className="text-xs text-muted-foreground">Subgrupo</Label>
            <Select value={f.categoria} onValueChange={(v) => setF({ ...f, categoria: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
          {fld("unidade_venda", "Unid. venda")}{fld("ncm", "NCM")}{fld("cfop", "CFOP")}{fld("cst", "CST")}{fld("aliquota", "Alíquota %")}
        </div>
      </Panel>
      <Panel title="Ingredientes">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Insumo</th><th className="text-right">Qtd</th><th>Un</th><th className="text-right">Preço insumo</th><th className="text-right">Rend.</th><th className="text-right">Custo</th><th className="no-print" /></tr></thead>
            <tbody>
              {(ings ?? []).map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-1.5">{i.itens_estoque?.nome}{i.observacao && <div className="text-xs text-muted-foreground">{i.observacao}</div>}</td>
                  <td className="text-right"><Input className="ml-auto h-8 w-24 text-right" defaultValue={num(i.quantidade, 4)} onBlur={(e) => { const v = parseNum(e.target.value); if (v != null && v !== Number(i.quantidade)) updIng(i.id, { quantidade: v }); }} /></td>
                  <td className="text-center">{i.unidade ?? i.itens_estoque?.unidade}</td>
                  <td className="text-right">{i.itens_estoque?.preco_unitario == null ? <Tag tone="warn">a cotar</Tag> : brl(i.itens_estoque.preco_unitario)}</td>
                  <td className="text-right"><Input className="ml-auto h-8 w-16 text-right" defaultValue={i.rendimento != null ? num(i.rendimento) : ""} onBlur={(e) => updIng(i.id, { rendimento: parseNum(e.target.value) })} /></td>
                  <td className="text-right font-medium">{brl(Number(i.quantidade) * Number(i.itens_estoque?.preco_unitario ?? 0))}</td>
                  <td className="no-print text-right"><button aria-label="Remover" onClick={async () => { try { await removerIngrediente(i.id); } catch (error) { toast.error(errMsg(error)); } rIng(); qc.invalidateQueries({ queryKey: ["fichas-resumo"] }); }}
><Trash2 className="h-4 w-4 text-muted-foreground" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="no-print mt-3 flex flex-wrap gap-2">
          <Select value={novo.insumo} onValueChange={(v) => setNovo({ ...novo, insumo: v })}><SelectTrigger className="w-64"><SelectValue placeholder="Adicionar insumo…" /></SelectTrigger><SelectContent>{insumos?.map((i) => <SelectItem key={i.id} value={i.id}>{i.nome} ({i.unidade})</SelectItem>)}</SelectContent></Select>
          <Input className="w-28" placeholder="Qtd" inputMode="decimal" value={novo.qtd} onChange={(e) => setNovo({ ...novo, qtd: e.target.value })} />
          <Button variant="secondary" onClick={addIng}>Adicionar</Button>
        </div>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Custos e preço">
          <dl className="space-y-1.5 text-sm">
            {[["Soma dos ingredientes", brl(soma)], [`Custo de preparo (${num(cfg.custo_preparo_pct)}%)`, brl(c.preparo)], ["Custo total", brl(c.total)],
              [`Com margem de segurança (${num(cfg.margem_seguranca_pct)}%)`, brl(c.comMargem)]].map(([a, b]) => (
              <div key={a} className="flex justify-between"><dt className="text-muted-foreground">{a}</dt><dd>{b}</dd></div>
            ))}
            <div className="flex items-center justify-between"><dt className="text-muted-foreground">Mkup</dt><dd><Input className="h-8 w-24 text-right" placeholder={num(cfg.mkup_padrao)} value={f.mkup ?? ""} onChange={(e) => setF({ ...f, mkup: e.target.value })} /></dd></div>
            <div className="flex justify-between border-t pt-2 text-base"><dt>Preço sugerido</dt><dd className="font-semibold text-primary">{brl(c.sugerido)}</dd></div>
            <div className="flex items-center justify-between"><dt>Preço praticado</dt><dd><Input className="h-9 w-28 text-right" inputMode="decimal" value={f.preco_venda ?? ""} onChange={(e) => setF({ ...f, preco_venda: e.target.value })} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Lucro</dt><dd>{brl(c.lucro)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">CMV %</dt><dd>{pct(c.cmvPct)}</dd></div>
            <div className="pt-1 text-right">{parseNum(f.preco_venda) != null && <Tag tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Abaixo do sugerido"}</Tag>}</div>
          </dl>
        </Panel>
        <Panel title="Observações / modo de preparo">
          <Textarea rows={10} value={f.observacoes ?? ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
        </Panel>
      </div>
    </div>
  );
}
