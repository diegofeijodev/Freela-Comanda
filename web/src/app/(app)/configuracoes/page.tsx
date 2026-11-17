'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  criarFornecedor, criarSubgrupo, excluirFornecedor, excluirSubgrupo, listarFornecedores, listarSazonalidade, listarSubgrupos, salvarConfig, salvarSazonalidade,
  type Config as ConfigRow,
} from "@/lib/erp-api";
import { PageHeader, Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DIAS, MESES, num, parseNum } from "@/lib/format";
import { errMsg, getConfig } from "@/lib/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanoContas } from "@/components/plano-contas";
import { IaChavePanel } from "@/components/ia-chave-panel";
import { CertificadoPanel } from "@/components/certificado-panel";
import { NotasSefazPainel } from "@/components/notas-sefaz-painel";
import { formatarCnpj } from "@/lib/certificado";
import { ErrorBoundary } from "@/components/error-boundary";
import { CERTIFICADO_QUERY_KEY } from "@/hooks/use-certificado";
import { SITUACAO_SEFAZ_KEY } from "@/hooks/use-notas-sefaz";
import { useMe } from "@/lib/auth";


const CAMPOS: [string, string][] = [
  ["tolerancia_pct", "Tolerância do inventário (%)"], ["tolerancia_abs_kg", "Tolerância absoluta KG/L"], ["tolerancia_abs_un", "Tolerância absoluta UN"],
  ["max_recontagens", "Nº máximo de recontagens"], ["custo_preparo_pct", "Custo de preparo (%)"], ["margem_seguranca_pct", "Margem de segurança (%)"],
  ["mkup_padrao", "Mkup padrão"], ["estoque_seguranca_pct", "Estoque de segurança padrão (%)"], ["semanas_media", "Semanas para média de consumo"],
];

export default function Config() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const { data: cfg, refetch } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const { data: saz, refetch: rS } = useQuery({ queryKey: ["sazonalidade"], queryFn: listarSazonalidade });
  const { data: forn, refetch: rF } = useQuery({ queryKey: ["fornecedores"], queryFn: listarFornecedores });
  const { data: subs, refetch: rSub } = useQuery({ queryKey: ["subgrupos"], queryFn: listarSubgrupos });
  const [f, setF] = useState<Record<string, string>>({});
  const [empresa, setEmpresa] = useState({ razao_social: "", nome_fantasia: "", cnpj: "", endereco: "" });
  const [dia, setDia] = useState(1);
  const [lojaAbre, setLojaAbre] = useState(false);
  const [nf, setNf] = useState({ nome: "", telefone: "" });
  const [ns, setNs] = useState({ nome: "", grupo: "Insumos" });

  useEffect(() => {
    if (!cfg) return;
    setF(Object.fromEntries(CAMPOS.map(([k]) => [k, num((cfg as unknown as Record<string, number>)[k], 3)])));
    setEmpresa({ razao_social: cfg.razao_social, nome_fantasia: cfg.nome_fantasia, cnpj: formatarCnpj(cfg.cnpj), endereco: cfg.endereco });
    setDia(cfg.dia_inventario); setLojaAbre(cfg.loja_pode_abrir);
  }, [cfg]);

  async function salvar() {
    const patch: Record<string, unknown> = { ...empresa, dia_inventario: dia, loja_pode_abrir: lojaAbre };
    for (const [k] of CAMPOS) { const v = parseNum(f[k]); if (v == null) return toast.error("Valor inválido"); patch[k] = v; }
    try {
      await salvarConfig(patch as Partial<ConfigRow>);
    } catch (error) {
      return toast.error(errMsg(error));
    }
    toast.success("Configurações salvas"); refetch();
    queryClient.invalidateQueries({ queryKey: CERTIFICADO_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: SITUACAO_SEFAZ_KEY });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Configurações" />
      <Tabs defaultValue="geral">
        <TabsList><TabsTrigger value="geral">Geral</TabsTrigger><TabsTrigger value="despesas">Contas de despesas</TabsTrigger></TabsList>
        <TabsContent value="despesas"><PlanoContas /></TabsContent>
        <TabsContent value="geral" className="space-y-4">
      <div className="flex justify-end"><Button onClick={salvar}>Salvar</Button></div>
      <Panel title="Empresa">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label className="text-xs text-muted-foreground">Razão social</Label><Input value={empresa.razao_social} onChange={(e) => setEmpresa({ ...empresa, razao_social: e.target.value })} /></div>
          <div><Label className="text-xs text-muted-foreground">Nome fantasia</Label><Input value={empresa.nome_fantasia} onChange={(e) => setEmpresa({ ...empresa, nome_fantasia: e.target.value })} /></div>
          <div><Label className="text-xs text-muted-foreground">CNPJ</Label><Input autoCapitalize="characters" autoComplete="off" spellCheck={false} className="uppercase" placeholder="00.000.000/0000-00" value={empresa.cnpj} onChange={(e) => setEmpresa({ ...empresa, cnpj: e.target.value.toUpperCase() })} onBlur={() => setEmpresa((x) => ({ ...x, cnpj: formatarCnpj(x.cnpj) }))} /></div>
          <div><Label className="text-xs text-muted-foreground">Endereço completo</Label><Input value={empresa.endereco} onChange={(e) => setEmpresa({ ...empresa, endereco: e.target.value })} /></div>
        </div>
      </Panel>
      {me?.perfil === "admin" && <IaChavePanel />}
      {me?.perfil === "admin" && (
        <ErrorBoundary
          fallback={
            <Panel title="Certificado digital (A1)">
              <p className="text-sm text-muted-foreground">Não consegui mostrar o certificado agora. Recarregue a página.</p>
            </Panel>
          }
        >
          <CertificadoPanel />
        </ErrorBoundary>
      )}
      {me?.perfil === "admin" && (
        <ErrorBoundary
          fallback={
            <Panel title="Notas da SEFAZ">
              <p className="text-sm text-muted-foreground">Não consegui mostrar este quadro agora. Recarregue a página.</p>
            </Panel>
          }
        >
          <NotasSefazPainel />
        </ErrorBoundary>
      )}
      <Panel title="Geral">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label className="text-xs text-muted-foreground">Dia do inventário/compra</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={dia} onChange={(e) => setDia(Number(e.target.value))}>{DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
          {CAMPOS.map(([k, l]) => <div key={k}><Label className="text-xs text-muted-foreground">{l}</Label><Input inputMode="decimal" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
          <label className="flex items-center gap-2 text-sm"><Switch checked={lojaAbre} onCheckedChange={setLojaAbre} /> Loja pode abrir inventário</label>
        </div>
      </Panel>
      <Panel title="Sazonalidade mensal (%)">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
          {(saz ?? []).map((s) => (
            <div key={s.mes}><div className="text-xs text-muted-foreground">{MESES[s.mes - 1].slice(0, 3)}</div>
              <Input className="h-8 text-right" defaultValue={num(s.fator_pct)} onBlur={async (e) => { try { await salvarSazonalidade(s.mes, parseNum(e.target.value) ?? 0); } catch (error) { toast.error(errMsg(error)); } rS(); }} /></div>
          ))}
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Fornecedores">
          <div className="mb-3 flex gap-2"><Input className="min-w-0" placeholder="Nome" value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} /><Input className="min-w-0" placeholder="Telefone" value={nf.telefone} onChange={(e) => setNf({ ...nf, telefone: e.target.value })} />
            <Button onClick={async () => { if (!nf.nome) return; try { await criarFornecedor(nf); } catch (error) { toast.error(errMsg(error)); } setNf({ nome: "", telefone: "" }); rF(); }}>Adicionar</Button></div>
          {(forn ?? []).map((x) => <div key={x.id} className="flex justify-between border-t py-1.5 text-sm"><span>{x.nome} <span className="text-muted-foreground">{x.telefone}</span></span><button aria-label="Remover" onClick={async () => { try { await excluirFornecedor(x.id); } catch (error) { toast.error(errMsg(error)); } rF(); }}><Trash2 className="h-4 w-4 text-muted-foreground" /></button></div>)}
          {!forn?.length && <p className="text-sm text-muted-foreground">Nenhum fornecedor ainda.</p>}
        </Panel>
        <Panel title="Subgrupos">
          <div className="mb-3 flex gap-2"><Input className="min-w-0" placeholder="Nome" value={ns.nome} onChange={(e) => setNs({ ...ns, nome: e.target.value })} />
            <select className="h-9 min-w-0 rounded-md border bg-background px-2" value={ns.grupo} onChange={(e) => setNs({ ...ns, grupo: e.target.value })}><option>Insumos</option><option>Produtos de venda</option></select>
            <Button onClick={async () => { if (!ns.nome) return; try { await criarSubgrupo({ ...ns, ordem: (subs?.length ?? 0) + 1 }); } catch (error) { toast.error(errMsg(error)); } setNs({ nome: "", grupo: "Insumos" }); rSub(); }}>Adicionar</Button></div>
          {(subs ?? []).map((x) => <div key={x.id} className="flex justify-between border-t py-1.5 text-sm"><span>{x.nome} <span className="text-muted-foreground">· {x.grupo}</span></span><button aria-label="Remover" onClick={async () => { try { await excluirSubgrupo(x.id); } catch (error) { toast.error(errMsg(error)); } rSub(); }}
><Trash2 className="h-4 w-4 text-muted-foreground" /></button></div>)}
        </Panel>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
