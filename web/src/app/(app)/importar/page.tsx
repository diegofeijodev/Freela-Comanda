'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import {
  importacoesRecentes, importar as enviarImportacao, listarCardapio, listarDePara, listarItensEstoque, mapearDePara,
} from "@/lib/erp-api";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { lerArquivo, type Row } from "@/lib/parse";
import { dataBR, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";


// Vendas saíram daqui em 25/11: agora se importam em Vendas → Importar vendas (/vendas/importar), de qualquer sistema.
type Tipo = "insumos" | "fichas";
const COLS: Record<Tipo, string[]> = {
  insumos: ["codigo", "nome", "tipo", "subgrupo", "unidade", "preco_unitario", "embalagem_compra", "qtd_por_embalagem", "consumo_semanal_base", "estoque_seguranca_pct"],
  fichas: ["item_cardapio", "categoria", "preco_venda", "insumo", "quantidade", "unidade", "observacao"],
};
const OBRIG: Record<Tipo, string[]> = { insumos: ["nome", "unidade"], fichas: ["item_cardapio", "insumo", "quantidade"] };


function validar(tipo: Tipo, rows: Row[], insumos: Set<string>) {
  const erros: string[] = [];
  rows.forEach((r, i) => {
    for (const c of OBRIG[tipo]) if (!r[c]) erros.push(`Linha ${i + 2}: coluna "${c}" vazia`);
    if (tipo === "fichas" && r.insumo && !insumos.has(r.insumo.toLowerCase())) erros.push(`Linha ${i + 2}: insumo "${r.insumo}" não cadastrado`);
    if (tipo === "fichas" && r.quantidade && parseNum(r.quantidade) == null) erros.push(`Linha ${i + 2}: quantidade inválida`);
  });
  return erros;
}

export default function Importar() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>("insumos");
  const [modo, setModo] = useState<"acrescentar" | "substituir">("acrescentar");
  const [rows, setRows] = useState<Row[]>([]);
  const [arq, setArq] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: insumos } = useQuery({ queryKey: ["insumos-nomes"], queryFn: () => listarItensEstoque() });
  const { data: cardapio } = useQuery({ queryKey: ["cardapio-nomes"], queryFn: listarCardapio });
  const { data: dePara, refetch: rDP } = useQuery({ queryKey: ["depara"], queryFn: listarDePara });
  const { data: imps, refetch: rImp } = useQuery({ queryKey: ["importacoes"], queryFn: importacoesRecentes });

  const insSet = new Set((insumos ?? []).map((i) => i.nome.toLowerCase()));
  const erros = rows.length ? validar(tipo, rows, insSet) : [];
  const faltando = rows.length ? COLS[tipo].filter((c) => OBRIG[tipo].includes(c) && !(c in rows[0])) : [];

  async function importar() {
    setBusy(true);
    try {
      // Uma transação na API (spec, decisão 7): mesmas regras do protótipo — upsert pelo nome, "Substituir", de-para, baixas.
      await enviarImportacao(tipo, { arquivo: arq, modo, linhas: rows, erros: erros.length });
      toast.success(`Importação concluída: ${rows.length} linhas`);
      setRows([]); setArq("");
      rImp(); rDP(); qc.invalidateQueries();
    } catch (e) {
      toast.error(errMsg(e));
    } finally { setBusy(false); }
  }

  async function mapear(produto: string, itemId: string | null) {
    try {
      const { vendas } = await mapearDePara(produto, itemId);
      toast.success(`${produto} mapeado (${vendas} vendas atualizadas)`);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    rDP();
  }
  const pend = (dePara ?? []).filter((d) => !d.item_cardapio_id && !d.ignorar);

  return (
    <div className="space-y-5">
      <PageHeader title="Importar Dados" sub="CSV com ponto e vírgula e vírgula decimal (UTF-8) ou XLSX" />
      <Panel title="1. Tipo de arquivo">
        <div className="flex flex-wrap gap-2">{(["insumos", "fichas"] as Tipo[]).map((t) => (
          <Button key={t} variant={tipo === t ? "default" : "outline"} onClick={() => { setTipo(t); setRows([]); }}>{t === "fichas" ? "Fichas técnicas" : "Insumos"}</Button>
        ))}</div>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{COLS[tipo].join(";")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <span>Vendas agora se importam em <strong>Vendas → Importar vendas</strong>: planilha de qualquer sistema, XML de cupons ou PDF de relatório.</span>
          <Button asChild variant="outline" className="h-11"><Link href="/vendas/importar">Ir para Importar vendas <ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>
        </div>
      </Panel>
      <Panel title="2. Arquivo e modo">
        <div className="flex flex-wrap items-center gap-4">
          <Input type="file" accept=".csv,.xlsx,.xls" className="max-w-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setArq(f.name); setRows(await lerArquivo(f)); }} />
          <RadioGroup value={modo} onValueChange={(v) => setModo(v as typeof modo)} className="flex gap-4">
            <div className="flex items-center gap-2"><RadioGroupItem value="acrescentar" id="a" /><Label htmlFor="a">Acrescentar</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem value="substituir" id="s" /><Label htmlFor="s">Substituir</Label></div>
          </RadioGroup>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Substituir desativa os itens que não estão no arquivo.</p>
      </Panel>
      {rows.length > 0 && (
        <Panel title={`3. Pré-visualização · ${rows.length} linhas`}>
          {faltando.length > 0 && <p className="mb-2 text-sm text-destructive">Colunas obrigatórias ausentes: {faltando.join(", ")}</p>}
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr>{Object.keys(rows[0]).map((k) => <th key={k} className="px-2 py-1 text-left text-muted-foreground">{k}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 10).map((r, i) => <tr key={i} className="border-t">{Object.values(r).map((v, j) => <td key={j} className="px-2 py-1">{v}</td>)}</tr>)}</tbody>
          </table></div>
          {erros.length > 0 && (
            <div className="mt-3 max-h-40 overflow-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              <div className="mb-1 font-semibold">{erros.length} problemas (linhas com erro serão ignoradas)</div>
              {erros.slice(0, 50).map((e) => <div key={e}>{e}</div>)}
            </div>
          )}
          <Button className="mt-4" disabled={busy || faltando.length > 0} onClick={importar}>{busy ? "Importando…" : `Importar ${rows.length} linhas`}</Button>
        </Panel>
      )}
      <div id="ligacao-cardapio" className="scroll-mt-4" />
      <Panel title={`De-para do relatório de vendas · ${pend.length} pendentes`}>
        <p className="mb-3 text-xs text-muted-foreground">Nome do produto no relatório do PDV/iFood → item do cardápio. Itens sem ficha não geram baixa de estoque.</p>
        <div className="max-h-[420px] overflow-auto"><table className="w-full text-sm">
          <tbody>{[...pend, ...(dePara ?? []).filter((d) => d.item_cardapio_id)].map((d) => (
            <tr key={d.produto_relatorio} className="border-t">
              <td className="py-1.5">{d.produto_relatorio} {!d.item_cardapio_id && <Tag tone="warn">sem ficha</Tag>}</td>
              <td className="text-right">
                <select className="h-8 max-w-[260px] rounded-md border bg-background px-2 text-sm" value={d.item_cardapio_id ?? ""} onChange={(e) => mapear(d.produto_relatorio, e.target.value || null)}>
                  <option value="">— sem ficha —</option>{cardapio?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <Panel title="Últimas importações">
        <table className="w-full text-sm"><tbody>{(imps ?? []).map((i) => (
          <tr key={i.id} className="border-t"><td className="py-1.5">{dataBR(i.created_at)}</td><td>{i.tipo}</td><td className="text-muted-foreground">{i.arquivo}</td><td className="text-right">{i.linhas} linhas</td></tr>
        ))}</tbody></table>
      </Panel>
    </div>
  );
}
