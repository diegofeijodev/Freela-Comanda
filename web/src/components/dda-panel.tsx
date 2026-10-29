'use client';

import { useState } from "react";
import { toast } from "sonner";
import { criarConta, lerPdfDDA, liquidarContas } from "@/lib/erp-api";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { boletosDePlanilha, conciliar, type BoletoDDA, type Conciliacao, type ContaRef } from "@/lib/dda";
import { lerArquivo } from "@/lib/parse";
import { brl, dataBR, isoDate } from "@/lib/format";
import { errMsg } from "@/lib/db";

export type Opcao = { id: string; rotulo: string };

/** Diálogo de liquidação: data, classe (plano de contas) e centro de custo */
export function LiquidarDialog({ ids, total, planos, centros, onClose, onDone }: {
  ids: string[]; total: number; planos: Opcao[]; centros: Opcao[]; onClose: () => void; onDone: () => void;
}) {
  const [data, setData] = useState(isoDate(new Date()));
  const [plano, setPlano] = useState(""); const [centro, setCentro] = useState("");
  async function confirmar() {
    if (!plano || !centro) return toast.error("Escolha a classe e o centro de custo");
    try {
      await liquidarContas({ ids, pago_em: data, plano_conta_id: plano, centro_custo_id: centro });
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success(`${ids.length} conta(s) liquidada(s)`); onDone();
  }
  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Liquidar {ids.length} conta(s) · {brl(total)}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Data do pagamento</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          <div><Label>Classe (plano de contas)</Label>
            <select className={sel} value={plano} onChange={(e) => setPlano(e.target.value)}><option value="">Selecione…</option>{planos.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}</select></div>
          <div><Label>Centro de custo</Label>
            <select className={sel} value={centro} onChange={(e) => setCentro(e.target.value)}><option value="">Selecione…</option>{centros.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}</select></div>
          {(!planos.length || !centros.length) && <p className="text-xs text-muted-foreground">Cadastre o plano de contas e os centros de custo em Configurações.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={confirmar}>Liquidar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DDAPanel({ contas, planos, centros, onChange }: { contas: ContaRef[]; planos: Opcao[]; centros: Opcao[]; onChange: () => void }) {

  const [res, setRes] = useState<Conciliacao | null>(null);
  const [lendo, setLendo] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [liq, setLiq] = useState(false);

  async function carregar(file: File) {
    setLendo(true);
    try {
      let boletos;
      if (/\.pdf$/i.test(file.name)) {
        if (file.size > 10 * 1024 * 1024) throw new Error("Arquivo vazio ou grande demais (máx. 10 MB)");
        boletos = await lerPdfDDA<BoletoDDA[]>(file);
      } else boletos = boletosDePlanilha(await lerArquivo(file));
      if (!boletos.length) toast.error("Nenhum boleto encontrado no arquivo");
      const r = conciliar(boletos, contas);
      setRes(r); setMarcados(new Set(r.encontrados.map((e) => e.conta.id)));
    } catch (e) { toast.error(errMsg(e)); } finally { setLendo(false); }
  }

  async function incluir(i: number) {
    if (!res) return;
    const b = res.soNoDDA[i];
    let data: ContaRef;
    try {
      data = await criarConta({
        descricao: b.beneficiario || "Boleto DDA", fornecedor_nome: b.beneficiario, valor: b.valor, vencimento: b.vencimento,
        forma_pagamento: "boleto", categoria: "Fornecedores", linha_digitavel: b.linha_digitavel, origem_dda: true,
      });
    } catch (error) {
      return toast.error(errMsg(error));
    }

    setRes({ ...res, soNoDDA: res.soNoDDA.filter((_, j) => j !== i), encontrados: [...res.encontrados, { dda: b, conta: data as ContaRef }] });
    setMarcados(new Set([...marcados, data.id])); onChange();
  }

  const totalMarcado = res?.encontrados.filter((e) => marcados.has(e.conta.id)).reduce((s, e) => s + e.dda.valor, 0) ?? 0;

  return (
    <Panel title="Conciliação do DDA" actions={
      <label className="cursor-pointer"><Button asChild size="sm" disabled={lendo}><span>{lendo ? "Lendo…" : "Enviar DDA (PDF ou Excel)"}</span></Button>
        <input type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) carregar(f); e.target.value = ""; }} /></label>}>
      {!res ? <p className="text-sm text-muted-foreground">Envie o relatório de DDA do banco. O sistema compara cada boleto (valor e vencimento) com as contas em aberto.</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Tag tone="ok">{res.encontrados.length} conferidos</Tag><Tag tone="bad">{res.soNoDDA.length} só no DDA</Tag><Tag tone="gold">{res.soNoSistema.length} só no sistema</Tag>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Conferidos</h3>
              <Button size="sm" disabled={!marcados.size} onClick={() => setLiq(true)}>Liquidar selecionados · {brl(totalMarcado)}</Button></div>
            <table className="w-full text-sm"><tbody>{res.encontrados.map((e) => (
              <tr key={e.conta.id} className="border-t"><td className="w-8 py-1.5"><input type="checkbox" checked={marcados.has(e.conta.id)} onChange={(ev) => { const s = new Set(marcados); if (ev.target.checked) s.add(e.conta.id); else s.delete(e.conta.id); setMarcados(s); }} /></td>
                <td>{dataBR(e.dda.vencimento)}</td><td>{e.dda.beneficiario}<div className="text-xs text-muted-foreground">No sistema: {e.conta.descricao} · {dataBR(e.conta.vencimento)}</div></td><td className="text-right">{brl(e.dda.valor)}</td></tr>
            ))}{!res.encontrados.length && <tr><td className="py-2 text-muted-foreground">Nenhum.</td></tr>}</tbody></table>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-destructive">No DDA, mas não lançados no sistema</h3>
            <table className="w-full text-sm"><tbody>{res.soNoDDA.map((b, i) => (
              <tr key={i} className="border-t"><td className="py-1.5">{dataBR(b.vencimento)}</td><td>{b.beneficiario}{b.cnpj && <div className="text-xs text-muted-foreground">{b.cnpj}</div>}</td><td className="text-right">{brl(b.valor)}</td>
                <td className="text-right"><Button size="sm" variant="outline" onClick={() => incluir(i)}>Lançar conta</Button></td></tr>
            ))}{!res.soNoDDA.length && <tr><td className="py-2 text-muted-foreground">Nenhum.</td></tr>}</tbody></table>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Em aberto no sistema, sem boleto no DDA (mesmo período)</h3>
            <table className="w-full text-sm"><tbody>{res.soNoSistema.map((c) => (
              <tr key={c.id} className="border-t"><td className="py-1.5">{dataBR(c.vencimento)}</td><td>{c.descricao}</td><td className="text-right">{brl(c.valor)}</td></tr>
            ))}{!res.soNoSistema.length && <tr><td className="py-2 text-muted-foreground">Nenhuma.</td></tr>}</tbody></table>
          </div>
        </div>
      )}
      {liq && <LiquidarDialog ids={[...marcados]} total={totalMarcado} planos={planos} centros={centros} onClose={() => setLiq(false)}
        onDone={() => { setLiq(false); setRes(res && { ...res, encontrados: res.encontrados.filter((e) => !marcados.has(e.conta.id)) }); setMarcados(new Set()); onChange(); }} />}
    </Panel>
  );
}
