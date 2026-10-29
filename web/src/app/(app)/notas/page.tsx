'use client';

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { lancarNota, lerPdfNota, listarItensEstoque, notaExiste, notasRecentes, vinculos } from "@/lib/erp-api";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { A_VISTA, FORMAS, parseNFeXML, sugerirInsumo, type FormaPgto, type NotaLida, type Parcela } from "@/lib/nfe";

import { brl, dataBR, isoDate, num, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";


type Linha = { codigo: string | null; descricao: string; unidade: string | null; quantidade: string; valor_unitario: string; item_estoque_id: string; fator: string; sugerido: boolean };
type Insumo = { id: string; nome: string; unidade: string };


const somaDias = (iso: string, d: number) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + d); return isoDate(x); };

export default function Notas() {
  const qc = useQueryClient();

  const [nota, setNota] = useState<NotaLida | null>(null);
  const [origem, setOrigem] = useState<"xml" | "pdf">("xml");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [entrada, setEntrada] = useState(isoDate(new Date()));
  const [atualizarPreco, setAtualizarPreco] = useState(true);
  const [lendo, setLendo] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: insumos } = useQuery({ queryKey: ["insumos-ativos"], queryFn: async () => (await listarItensEstoque({ ativo: true })) as Insumo[] });
  const { data: notas, refetch } = useQuery({ queryKey: ["notas-entrada"], queryFn: () => notasRecentes(30) });

  async function carregar(f: File) {
    setLendo(true);
    try {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      if (isPdf && f.size > 10 * 1024 * 1024) throw new Error("Arquivo vazio ou grande demais (máx. 10 MB)");
      const lida = isPdf ? await lerPdfNota<NotaLida>(f) : parseNFeXML(await f.text());
      if (!lida.itens?.length) throw new Error("Nenhum item encontrado na nota");
      if (lida.chave && (await notaExiste(lida.chave))) throw new Error("Esta nota já foi lançada");
      const cnpj = lida.emitente_cnpj ?? "";
      const vinc = await vinculos(cnpj);
      const vm = new Map(vinc.map((v) => [v.codigo_fornecedor, v]));
      setLinhas(lida.itens.map((it) => {
        const v = vm.get(it.codigo ?? it.descricao);
        const sug = v ? null : sugerirInsumo(it.descricao, insumos ?? []);
        return {
          codigo: it.codigo, descricao: it.descricao, unidade: it.unidade,
          quantidade: String(it.quantidade).replace(".", ","), valor_unitario: String(it.valor_unitario).replace(".", ","),
          item_estoque_id: v?.item_estoque_id ?? sug?.id ?? "", fator: String(v?.fator ?? 1).replace(".", ","), sugerido: !v && !!sug,
        };
      }));
      const forma = lida.forma_pagamento in FORMAS ? lida.forma_pagamento : "outros";
      setParcelas(lida.parcelas?.length ? lida.parcelas : A_VISTA.includes(forma) ? [] : [{ numero: "1", vencimento: somaDias(lida.data_emissao || isoDate(new Date()), 30), valor: lida.valor_total }]);
      setNota({ ...lida, forma_pagamento: forma });
      setOrigem(isPdf ? "pdf" : "xml");
      toast.success(`${lida.itens.length} itens lidos`);
    } catch (e) { toast.error(errMsg(e)); } finally { setLendo(false); }
  }

  const setL = (i: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...p, sugerido: p.item_estoque_id !== undefined ? false : l.sugerido } : l)));
  const setP = (i: number, p: Partial<Parcela>) => setParcelas((ps) => ps.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const aVista = nota ? A_VISTA.includes(nota.forma_pagamento) : false;
  const totalItens = linhas.reduce((s, l) => s + (parseNum(l.quantidade) ?? 0) * (parseNum(l.valor_unitario) ?? 0), 0);
  const totalParc = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const semVinculo = linhas.filter((l) => !l.item_estoque_id).length;

  async function darEntrada() {
    if (!nota) return;
    if (!aVista && (!parcelas.length || parcelas.some((p) => !p.vencimento))) return toast.error("Informe o vencimento de cada parcela");
    setBusy(true);
    try {
      // Uma chamada só: nota + itens + estoque (lancar_nota) + contas a pagar + fornecedor novo, numa transação na API.
      await lancarNota({
        chave: nota.chave, numero: nota.numero, serie: nota.serie, fornecedor_nome: nota.emitente_nome, fornecedor_cnpj: nota.emitente_cnpj,
        data_emissao: nota.data_emissao || entrada, data_entrada: entrada, valor_total: nota.valor_total || totalItens,
        forma_pagamento: nota.forma_pagamento, origem, atualizar_preco: atualizarPreco,
        itens: linhas.map((l) => ({
          codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, quantidade: parseNum(l.quantidade) ?? 0, valor_unitario: parseNum(l.valor_unitario) ?? 0,
          item_estoque_id: l.item_estoque_id || null, fator: parseNum(l.fator) || 1,
        })),
        parcelas: aVista ? [] : parcelas.map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) || 0 })),
      });
      toast.success("Entrada lançada no estoque" + (aVista ? "" : ` e ${parcelas.length} conta(s) a pagar`));
      setNota(null); setLinhas([]); setParcelas([]);
      refetch(); qc.invalidateQueries();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Entrada de Notas" sub="NF-e ou cupom fiscal: envie o XML ou o PDF e confira antes de dar entrada" actions={<Button asChild variant="outline"><Link href="/contas">Contas a pagar</Link></Button>
} />
      <Panel title="1. Arquivo da nota">
        <Input type="file" accept=".xml,.pdf,text/xml,application/pdf" className="max-w-sm" disabled={lendo} onChange={(e) => { const f = e.target.files?.[0]; if (f) carregar(f); e.target.value = ""; }} />
        <p className="mt-2 text-xs text-muted-foreground">{lendo ? "Lendo a nota…" : "XML é lido na hora e com exatidão. PDF é lido por inteligência artificial — confira os valores."}</p>
      </Panel>

      {nota && (
        <>
          <Panel title="2. Dados da nota">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label>Fornecedor</Label><Input value={nota.emitente_nome} onChange={(e) => setNota({ ...nota, emitente_nome: e.target.value })} /></div>
              <div><Label>CNPJ</Label><Input value={nota.emitente_cnpj ?? ""} onChange={(e) => setNota({ ...nota, emitente_cnpj: e.target.value.replace(/\D/g, "") || null })} /></div>
              <div><Label>Número / série</Label><Input value={`${nota.numero ?? ""}${nota.serie ? " / " + nota.serie : ""}`} onChange={(e) => setNota({ ...nota, numero: e.target.value.split("/")[0].trim() })} /></div>
              <div><Label>Emissão</Label><Input value={dataBR(nota.data_emissao)} disabled /></div>
              <div><Label>Data de entrada</Label><Input type="date" value={entrada} onChange={(e) => setEntrada(e.target.value)} /></div>
              <div><Label>Valor total</Label><Input value={String(nota.valor_total).replace(".", ",")} onChange={(e) => setNota({ ...nota, valor_total: parseNum(e.target.value) ?? 0 })} /></div>
              <div><Label>Forma de pagamento</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={nota.forma_pagamento} onChange={(e) => {
                  const f = e.target.value as FormaPgto; setNota({ ...nota, forma_pagamento: f });
                  if (!A_VISTA.includes(f) && !parcelas.length) setParcelas([{ numero: "1", vencimento: somaDias(entrada, 30), valor: nota.valor_total }]);
                }}>{Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div className="flex items-end gap-2 pb-2"><Checkbox id="ap" checked={atualizarPreco} onCheckedChange={(v) => setAtualizarPreco(!!v)} /><Label htmlFor="ap">Atualizar preço de compra dos insumos</Label></div>
            </div>
          </Panel>

          <Panel title={`3. Itens · ${linhas.length}${semVinculo ? ` · ${semVinculo} sem insumo` : ""}`}>
            <p className="mb-3 text-xs text-muted-foreground">Escolha o insumo de cada produto. &ldquo;Fator&rdquo; converte a unidade da nota para a do estoque (ex.: caixa com 12 → 12). Itens sem insumo não entram no estoque. O vínculo fica salvo para as próximas notas deste fornecedor.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Produto na nota</th><th>Qtd</th><th>Preço un.</th><th>Insumo do estoque</th><th>Fator</th><th className="text-right">Entra no estoque</th></tr></thead>
              <tbody>{linhas.map((l, i) => {
                const ins = insumos?.find((x) => x.id === l.item_estoque_id);
                const q = (parseNum(l.quantidade) ?? 0) * (parseNum(l.fator) || 1);
                return (
                  <tr key={i} className="border-t align-middle">
                    <td className="py-1.5 pr-2"><div>{l.descricao}</div><div className="text-xs text-muted-foreground">{l.codigo} · {l.unidade}</div></td>
                    <td><Input className="h-8 w-20" value={l.quantidade} onChange={(e) => setL(i, { quantidade: e.target.value })} /></td>
                    <td><Input className="h-8 w-24" value={l.valor_unitario} onChange={(e) => setL(i, { valor_unitario: e.target.value })} /></td>
                    <td className="pr-2">
                      <select className="h-8 w-full min-w-[180px] rounded-md border bg-background px-2 text-sm" value={l.item_estoque_id} onChange={(e) => setL(i, { item_estoque_id: e.target.value })}>
                        <option value="">— não lançar —</option>{insumos?.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                      {l.sugerido && <Tag tone="warn">sugestão — confira</Tag>}
                    </td>
                    <td><Input className="h-8 w-16" value={l.fator} onChange={(e) => setL(i, { fator: e.target.value })} /></td>
                    <td className="text-right">{ins ? `${num(q, 3)} ${ins.unidade}` : "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <div className="mt-2 text-right text-sm text-muted-foreground">Soma dos itens: {brl(totalItens)}</div>
          </Panel>

          <Panel title="4. Pagamento" actions={!aVista && <Button size="sm" variant="outline" onClick={() => setParcelas([...parcelas, { numero: String(parcelas.length + 1), vencimento: somaDias(parcelas.at(-1)?.vencimento || entrada, 30), valor: 0 }])}><Plus className="h-4 w-4" /> Parcela</Button>}>
            {aVista ? <p className="text-sm text-muted-foreground">Pagamento à vista: será registrado como conta já paga em {dataBR(entrada)}.</p> : (
              <div className="space-y-2">
                {parcelas.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-12 text-sm text-muted-foreground">{i + 1}/{parcelas.length}</span>
                    <Input type="date" className="h-8 w-40" value={p.vencimento} onChange={(e) => setP(i, { vencimento: e.target.value })} />
                    <Input className="h-8 w-32" value={String(p.valor).replace(".", ",")} onChange={(e) => setP(i, { valor: parseNum(e.target.value) ?? 0 })} />
                    <Button size="icon" variant="ghost" onClick={() => setParcelas(parcelas.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                {Math.abs(totalParc - nota.valor_total) > 0.02 && <p className="text-xs text-warning">Soma das parcelas ({brl(totalParc)}) diferente do total da nota ({brl(nota.valor_total)}).</p>}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button disabled={busy} onClick={darEntrada}>{busy ? "Lançando…" : "Dar entrada"}</Button>
              <Button variant="ghost" onClick={() => { setNota(null); setLinhas([]); }}>Cancelar</Button>
            </div>
          </Panel>
        </>
      )}

      <Panel title="Notas lançadas">
        <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>{(notas ?? []).map((n) => (
          <tr key={n.id} className="border-t">
            <td className="py-1.5">{dataBR(n.data_entrada)}</td><td>NF {n.numero ?? "—"}</td><td>{n.fornecedor_nome}</td>
            <td>{FORMAS[n.forma_pagamento as FormaPgto] ?? n.forma_pagamento}</td><td><Tag>{n.origem.toUpperCase()}</Tag></td>
            <td className="text-right">{brl(n.valor_total)}</td>
          </tr>
        ))}{!notas?.length && <tr><td className="py-3 text-muted-foreground">Nenhuma nota lançada ainda.</td></tr>}</tbody></table></div>
      </Panel>
    </div>
  );
}
