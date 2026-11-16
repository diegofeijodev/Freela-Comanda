'use client';

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { lancarNota, lerFotoNota, lerPdfNota, listarItensEstoque, listarSubgrupos, notaExiste, notasRecentes, vinculos } from "@/lib/erp-api";
import { ehImagem, MAX_FOTOS, reduzirImagem } from "@/lib/imagem";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { A_VISTA, FORMAS, parseNFeXML, sugerirInsumo, type FormaPgto, type NotaLida, type Parcela } from "@/lib/nfe";

import { brl, dataBR, isoDate, num, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";


type NovoInsumo = { nome: string; unidade: string; subgrupo: string };
type Linha = { codigo: string | null; descricao: string; unidade: string | null; quantidade: string; valor_unitario: string; item_estoque_id: string; fator: string; sugerido: boolean; novo: NovoInsumo | null };
const NOVO = "__novo__";
type Insumo = { id: string; nome: string; unidade: string };


const somaDias = (iso: string, d: number) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + d); return isoDate(x); };

export default function Notas() {
  const qc = useQueryClient();

  const [nota, setNota] = useState<NotaLida | null>(null);
  const [origem, setOrigem] = useState<"xml" | "pdf" | "foto">("xml");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [entrada, setEntrada] = useState(isoDate(new Date()));
  const [atualizarPreco, setAtualizarPreco] = useState(true);
  const [lendo, setLendo] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: insumos } = useQuery({ queryKey: ["insumos-ativos"], queryFn: async () => (await listarItensEstoque({ ativo: true })) as Insumo[] });
  const { data: subgrupos } = useQuery({ queryKey: ["subgrupos"], queryFn: listarSubgrupos });
  const { data: notas, refetch } = useQuery({ queryKey: ["notas-entrada"], queryFn: () => notasRecentes(30) });

  async function carregar(arquivos: File[]) {
    if (!arquivos.length) return;
    const fotos = arquivos.every(ehImagem);
    if (arquivos.length > 1 && (!fotos || arquivos.length > MAX_FOTOS)) return void toast.error("Envie até 4 fotos da mesma nota.");
    setLendo(true);
    try {
      const f = arquivos[0];
      const isPdf = !fotos && (/\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (isPdf && f.size > 10 * 1024 * 1024) throw new Error("Arquivo vazio ou grande demais (máx. 10 MB)");
      const lida = fotos ? await lerFotoNota<NotaLida>(await Promise.all(arquivos.map(reduzirImagem)))
        : isPdf ? await lerPdfNota<NotaLida>(f) : parseNFeXML(await f.text());
      if (!lida.itens?.length) throw new Error("Nenhum item encontrado na nota");
      if (lida.chave && (await notaExiste(lida.chave))) throw new Error("Esta nota já foi lançada");
      const cnpj = lida.emitente_cnpj ?? "";
      const vinc = await vinculos(cnpj);
      const vm = new Map(vinc.map((v) => [v.codigo_fornecedor, v]));
      const porIA = fotos || isPdf;
      setLinhas(lida.itens.map((it) => {
        const v = vm.get(it.codigo ?? it.descricao);
        let item_estoque_id = ""; let novo: NovoInsumo | null = null; let sugerido = false;
        if (v) item_estoque_id = v.item_estoque_id ?? "";
        else if (porIA) {
          if (it.item_estoque_id) { item_estoque_id = it.item_estoque_id; sugerido = true; }
          else if (it.novo) novo = { nome: it.novo.nome, unidade: it.novo.unidade, subgrupo: it.novo.subgrupo ?? "" };
        } else {
          const sug = sugerirInsumo(it.descricao, insumos ?? []);
          if (sug) { item_estoque_id = sug.id; sugerido = true; }
        }
        return {
          codigo: it.codigo, descricao: it.descricao, unidade: it.unidade,
          quantidade: String(it.quantidade).replace(".", ","), valor_unitario: String(it.valor_unitario).replace(".", ","),
          item_estoque_id, fator: String(v?.fator ?? (porIA ? it.fator : undefined) ?? 1).replace(".", ","), sugerido, novo,
        };
      }));
      const forma = lida.forma_pagamento in FORMAS ? lida.forma_pagamento : "outros";
      setParcelas(lida.parcelas?.length ? lida.parcelas : A_VISTA.includes(forma) ? [] : [{ numero: "1", vencimento: somaDias(lida.data_emissao || isoDate(new Date()), 30), valor: lida.valor_total }]);
      setNota({ ...lida, forma_pagamento: forma });
      setOrigem(fotos ? "foto" : isPdf ? "pdf" : "xml");
      toast.success(`${lida.itens.length} itens lidos`);
    } catch (e) { toast.error(errMsg(e)); } finally { setLendo(false); }
  }

  function escolherInsumo(i: number, valor: string) {
    if (valor === NOVO) setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, item_estoque_id: "", sugerido: false, novo: l.novo ?? { nome: l.descricao, unidade: (l.unidade ?? "UN").toUpperCase(), subgrupo: "" } } : l)));
    else setL(i, { item_estoque_id: valor, novo: null });
  }
  const setNovo = (i: number, p: Partial<NovoInsumo>) => setLinhas((ls) => ls.map((l, k) => (k === i && l.novo ? { ...l, novo: { ...l.novo, ...p } } : l)));

  const setL = (i: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...p, sugerido: p.item_estoque_id !== undefined ? false : l.sugerido } : l)));
  const setP = (i: number, p: Partial<Parcela>) => setParcelas((ps) => ps.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const aVista = nota ? A_VISTA.includes(nota.forma_pagamento) : false;
  const totalItens = linhas.reduce((s, l) => s + (parseNum(l.quantidade) ?? 0) * (parseNum(l.valor_unitario) ?? 0), 0);
  const totalParc = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const semVinculo = linhas.filter((l) => !l.item_estoque_id && !l.novo).length;
  const novos = linhas.filter((l) => l.novo).length;

  async function darEntrada() {
    if (!nota) return;
    if (!aVista && (!parcelas.length || parcelas.some((p) => !p.vencimento))) return toast.error("Informe o vencimento de cada parcela");
    if (linhas.some((l) => l.novo && !l.novo.nome.trim())) return toast.error("Informe o nome do insumo novo");
    setBusy(true);
    try {
      // Uma chamada só: nota + itens + estoque (lancar_nota) + contas a pagar + fornecedor novo, numa transação na API.
      const r = await lancarNota({
        chave: nota.chave, numero: nota.numero, serie: nota.serie, fornecedor_nome: nota.emitente_nome, fornecedor_cnpj: nota.emitente_cnpj,
        data_emissao: nota.data_emissao || entrada, data_entrada: entrada, valor_total: nota.valor_total || totalItens,
        forma_pagamento: nota.forma_pagamento, origem, atualizar_preco: atualizarPreco,
        itens: linhas.map((l) => ({
          codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, quantidade: parseNum(l.quantidade) ?? 0, valor_unitario: parseNum(l.valor_unitario) ?? 0,
          fator: parseNum(l.fator) || 1,
          ...(l.novo
            ? { item_estoque_id: null, novo_insumo: { nome: l.novo.nome.trim(), unidade: l.novo.unidade.trim().toUpperCase() || "UN", subgrupo: l.novo.subgrupo || null } }
            : { item_estoque_id: l.item_estoque_id || null }),
        })),
        parcelas: aVista ? [] : parcelas.map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) || 0 })),
      });
      toast.success("Entrada lançada no estoque" + (aVista ? "" : ` e ${parcelas.length} conta(s) a pagar`) + (r.insumos_criados > 0 ? ` · ${r.insumos_criados} insumo(s) cadastrado(s)` : ""));
      setNota(null); setLinhas([]); setParcelas([]);
      refetch(); qc.invalidateQueries({ queryKey: ["insumos-ativos"] }); qc.invalidateQueries({ queryKey: ["subgrupos"] }); qc.invalidateQueries();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Entrada de Notas" sub="NF-e ou cupom fiscal: envie o XML, o PDF ou a foto e confira antes de dar entrada" actions={<Button asChild variant="outline"><Link href="/contas">Contas a pagar</Link></Button>
} />
      <Panel title="1. Arquivo da nota">
        <Input type="file" multiple accept=".xml,.pdf,text/xml,application/pdf,image/jpeg,image/png,image/webp" className="max-w-sm" disabled={lendo} onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) carregar(fs); e.target.value = ""; }} />
        <p className="mt-2 text-xs text-muted-foreground">{lendo ? "Lendo a nota…" : "XML é lido na hora e com exatidão. PDF e foto são lidos por inteligência artificial — confira os valores."}</p>
        {!lendo && <p className="text-xs text-muted-foreground">Nota comprida? Tire mais de uma foto (até 4).</p>}
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

          <Panel title={`3. Itens · ${linhas.length}${semVinculo ? ` · ${semVinculo} sem insumo` : ""}${novos ? ` · ${novos} novos` : ""}`}>
            <p className="mb-3 text-xs text-muted-foreground">Escolha o insumo de cada produto. &ldquo;Fator&rdquo; converte a unidade da nota para a do estoque (ex.: caixa com 12 → 12). Itens sem insumo não entram no estoque. O vínculo fica salvo para as próximas notas deste fornecedor.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Produto na nota</th><th>Qtd</th><th>Preço un.</th><th>Insumo do estoque</th><th>Fator</th><th className="text-right">Entra no estoque</th></tr></thead>
              <tbody>{linhas.map((l, i) => {
                const ins = insumos?.find((x) => x.id === l.item_estoque_id);
                const un = ins?.unidade ?? l.novo?.unidade.trim().toUpperCase();
                const q = (parseNum(l.quantidade) ?? 0) * (parseNum(l.fator) || 1);
                return (
                  <tr key={i} className="border-t align-middle">
                    <td className="py-1.5 pr-2"><div>{l.descricao}</div><div className="text-xs text-muted-foreground">{l.codigo} · {l.unidade}</div></td>
                    <td><Input className="h-8 w-20" value={l.quantidade} onChange={(e) => setL(i, { quantidade: e.target.value })} /></td>
                    <td><Input className="h-8 w-24" value={l.valor_unitario} onChange={(e) => setL(i, { valor_unitario: e.target.value })} /></td>
                    <td className="pr-2">
                      <select className="h-8 w-full min-w-[180px] rounded-md border bg-background px-2 text-sm" aria-label="Insumo do estoque" value={l.novo ? NOVO : l.item_estoque_id} onChange={(e) => escolherInsumo(i, e.target.value)}>
                        <option value="">— não lançar —</option><option value={NOVO}>+ Cadastrar novo insumo</option>{insumos?.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                      {l.sugerido && <Tag tone="warn">sugestão — confira</Tag>}
                      {l.novo && (
                        <div className="mt-1.5 space-y-1.5">
                          <Tag tone="warn">novo — confira</Tag>
                          <Input className="h-8 w-full min-w-0" aria-label="Nome do insumo novo" placeholder="Nome" value={l.novo.nome} onChange={(e) => setNovo(i, { nome: e.target.value })} />
                          <div className="flex gap-1.5">
                            <Input className="h-8 w-20 shrink-0" aria-label="Unidade do insumo novo" placeholder="Un." value={l.novo.unidade} onChange={(e) => setNovo(i, { unidade: e.target.value })} />
                            <select className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Subgrupo do insumo novo" value={l.novo.subgrupo} onChange={(e) => setNovo(i, { subgrupo: e.target.value })}>
                              <option value="">Subgrupo (opcional)</option>{l.novo.subgrupo && !subgrupos?.some((g) => g.nome === l.novo!.subgrupo) && <option value={l.novo.subgrupo}>{l.novo.subgrupo}</option>}{subgrupos?.map((g) => <option key={g.id} value={g.nome}>{g.nome}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                    </td>
                    <td><Input className="h-8 w-16" value={l.fator} onChange={(e) => setL(i, { fator: e.target.value })} /></td>
                    <td className="text-right">{un ? `${num(q, 3)} ${un}` : "—"}</td>
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
