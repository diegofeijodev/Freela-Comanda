'use client';

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Copy, Printer, Download } from "lucide-react";
import {
  atualizarItemLista, itemAvulso, itensLista, lista as buscarLista, marcarEnviada, receberLista, removerItemLista, type ItemLista,
} from "@/lib/erp-api";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag, STATUS_LISTA } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl, dataBR, downloadCSV, MESES, num, parseNum } from "@/lib/format";
import { errMsg } from "@/lib/db";


type Item = ItemLista;

const valor = (i: Item) => (i.preco_unitario == null ? null : Number(i.embalagens) * Number(i.qtd_por_embalagem) * Number(i.preco_unitario));

export default function ListaPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const admin = me?.perfil === "admin";
  const [agrup, setAgrup] = useState<"subgrupo" | "fornecedor">("fornecedor");
  const { data: lista, refetch: rL } = useQuery({ queryKey: ["lista", id], queryFn: () => buscarLista(id) });
  // A API devolve a projeção sem valores para a loja (loja_lista_itens) e a linha inteira para o admin.
  const { data: itens, refetch } = useQuery({ queryKey: ["lista-itens", id, admin], enabled: me != null, queryFn: () => itensLista(id) });
  if (!lista) return <div className="text-muted-foreground">Carregando…</div>;
  const editavel = admin && lista.status === "gerada";
  const grupos = [...new Set((itens ?? []).map((i) => i[agrup] ?? "—"))].sort();
  const total = (itens ?? []).reduce((s, i) => s + (valor(i) ?? 0), 0);

  async function upd(itemId: string, patch: { embalagens?: number; qtd_recebida?: number | null; preco_pago?: number | null }) {
    try {
      await atualizarItemLista(itemId, patch);
      refetch();
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  async function status(s: "enviada") {
    if (s === "enviada") {
      try { await marcarEnviada(id); } catch (error) { toast.error(errMsg(error)); }
    }
    rL();
  }
  async function avulso() {
    const descricao = prompt("Descrição do item avulso:");
    if (!descricao) return;
    const q = parseNum(prompt("Quantidade:") ?? "") ?? 1;
    try { await itemAvulso(id, descricao, q); } catch (error) { toast.error(errMsg(error)); }
    refetch();
  }
  function whats() {
    const forn = [...new Set((itens ?? []).map((i) => i.fornecedor ?? "Sem fornecedor"))];
    const txt = forn.map((f) => `*${f}* — pedido ${dataBR(lista!.data)}\n` + (itens ?? []).filter((i) => (i.fornecedor ?? "Sem fornecedor") === f)
      .map((i) => `• ${i.descricao}: ${num(i.embalagens)} × ${i.embalagem ?? i.unidade}`).join("\n")).join("\n\n");
    navigator.clipboard.writeText(txt);
    toast.success("Texto copiado para o WhatsApp");
  }
  function csv() {
    downloadCSV(`lista_compras_${lista!.data}.csv`, [
      ["fornecedor", "subgrupo", "item", "pedido", "unidade", "embalagens", "embalagem", ...(admin ? ["valor_estimado"] : [])],
      ...(itens ?? []).map((i) => [i.fornecedor, i.subgrupo, i.descricao, Number(i.pedido), i.unidade, Number(i.embalagens), i.embalagem, ...(admin ? [valor(i)] : [])]),
    ]);
  }
  async function receber() {
    const atualizar = confirm("Atualizar o preço do cadastro com o preço pago? (OK = sim, Cancelar = não)");
    try {
      await receberLista(id, atualizar);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success("Recebimento registrado no estoque");
    rL(); refetch();
  }

  const tabela = (
    <div className="space-y-4">
      <div className="no-print flex gap-1"><Button size="sm" variant={agrup === "fornecedor" ? "default" : "outline"} onClick={() => setAgrup("fornecedor")}>Por fornecedor</Button><Button size="sm" variant={agrup === "subgrupo" ? "default" : "outline"} onClick={() => setAgrup("subgrupo")}>Por subgrupo</Button></div>
      {grupos.map((g) => {
        const ls = (itens ?? []).filter((i) => (i[agrup] ?? "—") === g);
        return (
          <Panel key={g} title={g} actions={admin && <span className="text-sm">{brl(ls.reduce((s, i) => s + (valor(i) ?? 0), 0))}</span>}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Item</th>{admin && <><th className="text-right">Contado</th><th className="text-right">Objetivo</th></>}<th className="text-right">Pedido</th><th className="text-right">Embalagens</th>{admin && <th className="text-right">Valor est.</th>}{editavel && <th />}</tr></thead>
              <tbody>{ls.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-1.5">{i.descricao}<div className="text-xs text-muted-foreground">{i.embalagem ?? i.unidade}{Number(i.qtd_por_embalagem) !== 1 && ` (${num(i.qtd_por_embalagem)} ${i.unidade})`}</div></td>
                  {admin && <><td className="text-right">{num(i.estoque_contado, 2)}</td><td className="text-right">{num(i.objetivo, 2)}</td></>}
                  <td className="text-right">{num(i.pedido, 2)} {i.unidade}</td>
                  <td className="text-right">{editavel ? <Input className="ml-auto h-8 w-20 text-right" defaultValue={num(i.embalagens)} onBlur={(e) => { const v = parseNum(e.target.value); if (v != null && v !== Number(i.embalagens)) upd(i.id, { embalagens: v }); }} /> : <span className="font-semibold">{num(i.embalagens)}</span>}</td>
                  {admin && <td className="text-right">{valor(i) == null ? <Tag tone="warn">a cotar</Tag> : brl(valor(i))}</td>}
                  {editavel && <td className="text-right"><button aria-label="Remover" onClick={async () => { try { await removerItemLista(i.id); } catch (error) { toast.error(errMsg(error)); } refetch(); }}
><Trash2 className="h-4 w-4 text-muted-foreground" /></button></td>}
                </tr>
              ))}</tbody>
            </table></div>
          </Panel>
        );
      })}
      {!itens?.length && <p className="text-sm text-muted-foreground">Nenhum item precisa ser comprado.</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={`Lista de compras · ${dataBR(lista.data)}`} sub={`Objetivo de ${MESES[lista.mes - 1]}${admin ? ` · Total estimado ${brl(total)}` : ""}`} actions={<>
        <Tag tone={STATUS_LISTA[lista.status].tone}>{STATUS_LISTA[lista.status].label}</Tag>
        <Button variant="outline" size="sm" onClick={whats}><Copy className="mr-1 h-4 w-4" />Copiar para WhatsApp</Button>
        <Button variant="outline" size="sm" onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />PDF</Button>
        {editavel && <Button variant="secondary" size="sm" onClick={avulso}>+ Item avulso</Button>}
        {editavel && <Button size="sm" onClick={() => status("enviada")}>Marcar como enviada</Button>}
      </>} />
      {admin && lista.status !== "gerada" ? (
        <Tabs defaultValue={lista.status === "recebida" ? "lista" : "receb"}>
          <TabsList><TabsTrigger value="lista">Lista</TabsTrigger><TabsTrigger value="receb">Recebimento</TabsTrigger></TabsList>
          <TabsContent value="lista" className="mt-4">{tabela}</TabsContent>
          <TabsContent value="receb" className="mt-4">
            <Panel title="Conferir recebimento">
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Item</th><th className="text-right">Pedido ({`un.`})</th><th className="text-right">Qtd recebida</th><th className="text-right">Preço pago (un.)</th><th className="text-right">Status</th></tr></thead>
                <tbody>{(itens ?? []).map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-1.5">{i.descricao}</td>
                    <td className="text-right">{num(Number(i.embalagens) * Number(i.qtd_por_embalagem), 2)} {i.unidade}</td>
                    <td className="text-right">{i.recebido ? num(i.qtd_recebida, 2) : <Input className="ml-auto h-8 w-24 text-right" inputMode="decimal" defaultValue={i.qtd_recebida != null ? num(i.qtd_recebida, 3) : ""} placeholder={num(Number(i.embalagens) * Number(i.qtd_por_embalagem), 2)} onBlur={(e) => upd(i.id, { qtd_recebida: parseNum(e.target.value) })} />}</td>
                    <td className="text-right">{i.recebido ? brl(i.preco_pago) : <Input className="ml-auto h-8 w-24 text-right" inputMode="decimal" defaultValue={i.preco_pago != null ? num(i.preco_pago) : i.preco_unitario != null ? num(i.preco_unitario) : ""} onBlur={(e) => upd(i.id, { preco_pago: parseNum(e.target.value) })} />}</td>
                    <td className="text-right">{i.recebido ? <Tag tone="ok">Recebido</Tag> : <Tag>Pendente</Tag>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              {lista.status !== "recebida" && <Button className="mt-4" onClick={receber}>Confirmar recebimento</Button>}
            </Panel>
          </TabsContent>
        </Tabs>
      ) : tabela}
    </div>
  );
}
