'use client';

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useEmpresaAtual, useMinhasEmpresas, type EmpresaResumo } from "@/lib/auth";
import {
  pontoAtualizarColaborador, pontoColaboradores, pontoCriarColaborador, pontoCriarFolga, pontoEscalas, pontoExcluirColaborador, pontoExcluirEscala,
  pontoExcluirFolga, pontoFolgas, pontoSalvarEscala, type PontoColaborador, type PontoDiaEscala, type PontoEscala, type TipoFolga,
} from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { DIAS } from "@/lib/format";
import { ROTULO_FOLGA } from "@/lib/ponto";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const dataBr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const soPin = (s: string) => s.replace(/\D/g, "").slice(0, 6);

// ---------------------------------------------------------------- colaboradores
type FormColab = { nome: string; cpf: string; cargo: string; admissao: string; escala_id: string; empresa_id: string; pin: string };
const vazio: FormColab = { nome: "", cpf: "", cargo: "", admissao: "", escala_id: "", empresa_id: "", pin: "" };

export function ColaboradoresPonto() {
  const { data, refetch } = useQuery({ queryKey: ["ponto-colaboradores"], queryFn: pontoColaboradores });
  const { data: escalas } = useQuery({ queryKey: ["ponto-escalas"], queryFn: pontoEscalas });
  // Multiempresa: o empregador é a empresa em uso (as outras têm os próprios colaboradores).
  const { data: todas } = useMinhasEmpresas();
  const { data: atual } = useEmpresaAtual();
  const empresas = atual ? (todas ?? []).filter((e) => e.id === atual.id) : todas;
  const [f, setF] = useState<FormColab>(vazio);
  const nomeEmpresa = (id: string | null) => { const e = empresas?.find((x) => x.id === id); return e ? (e.nome_fantasia || e.razao_social) : null; };
  const [editar, setEditar] = useState<PontoColaborador | null>(null);
  const nomeEscala = (id: string | null) => escalas?.find((e) => e.id === id)?.nome;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await pontoCriarColaborador({ ...f, cpf: f.cpf || null, cargo: f.cargo || null, admissao: f.admissao || null, escala_id: f.escala_id || null, empresa_id: f.empresa_id || null });
      toast.success("Colaborador cadastrado"); setF(vazio); refetch();
    } catch (error) { toast.error(errMsg(error)); }
  }
  async function alternar(c: PontoColaborador) {
    try { await pontoAtualizarColaborador(c.id, { ativo: !c.ativo }); refetch(); } catch (error) { toast.error(errMsg(error)); }
  }
  async function excluir(c: PontoColaborador) {
    if (!confirm(`Excluir ${c.nome}?`)) return;
    try { await pontoExcluirColaborador(c.id); toast.success("Excluído"); refetch(); } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <div className="space-y-4">
      <Panel title="Novo colaborador">
        <form onSubmit={criar} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <div className="lg:col-span-2"><Label>Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required maxLength={120} /></div>
          <div><Label>CPF</Label><Input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} maxLength={20} /></div>
          <div><Label>Cargo</Label><Input value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} maxLength={80} /></div>
          <div><Label>Admissão</Label><Input type="date" value={f.admissao} onChange={(e) => setF({ ...f, admissao: e.target.value })} /></div>
          <div><Label>Escala</Label>
            <select className={sel} value={f.escala_id} onChange={(e) => setF({ ...f, escala_id: e.target.value })}>
              <option value="">— sem escala —</option>
              {(escalas ?? []).filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div><Label>PIN (4 a 6 números)</Label><Input inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: soPin(e.target.value) })} required minLength={4} /></div>
          <div className="lg:col-span-2"><Label>Empresa (empregadora)</Label>
            <select className={sel} value={f.empresa_id} onChange={(e) => setF({ ...f, empresa_id: e.target.value })}>
              <option value="">— a principal —</option>
              {(empresas ?? []).filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}</option>)}
            </select>
          </div>
          <div className="flex items-end lg:col-span-5"><Button type="submit">Cadastrar</Button></div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">O PIN é o que o colaborador digita no computador da loja para bater o ponto. Ninguém consegue ver o PIN depois — só trocar.</p>
      </Panel>

      <Panel title={`Colaboradores · ${data?.length ?? 0}`}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Nome</th><th>CPF</th><th>Cargo</th><th>Admissão</th><th>Escala</th><th>Empresa</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className={cn("border-t", !c.ativo && "text-muted-foreground")}>
                <td className="py-1.5 font-medium">{c.nome}</td>
                <td>{c.cpf ?? "—"}</td>
                <td>{c.cargo ?? "—"}</td>
                <td>{dataBr(c.admissao)}</td>
                <td>{nomeEscala(c.escala_id) ?? <span className="text-warning">sem escala</span>}</td>
                <td className="text-xs">{nomeEmpresa(c.empresa_id) ?? <span className="text-muted-foreground">principal</span>}</td>
                <td>{c.ativo ? <Tag tone="ok">Ativo</Tag> : <Tag>Inativo</Tag>}</td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditar(c)}>Editar</Button>{" "}
                  <Button size="sm" variant="ghost" onClick={() => alternar(c)}>{c.ativo ? "Desativar" : "Ativar"}</Button>
                  <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => excluir(c)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Nenhum colaborador.</td></tr>}
          </tbody>
        </table></div>
      </Panel>

      {editar && <EditarColaborador c={editar} escalas={escalas ?? []} empresas={empresas ?? []} onFechar={() => setEditar(null)} onSalvo={() => { setEditar(null); refetch(); }} />}
    </div>
  );
}

function EditarColaborador({ c, escalas, empresas, onFechar, onSalvo }: { c: PontoColaborador; escalas: PontoEscala[]; empresas: EmpresaResumo[]; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<FormColab>({ nome: c.nome, cpf: c.cpf ?? "", cargo: c.cargo ?? "", admissao: c.admissao ?? "", escala_id: c.escala_id ?? "", empresa_id: c.empresa_id ?? "", pin: "" });
  async function salvar() {
    try {
      await pontoAtualizarColaborador(c.id, {
        nome: f.nome, cpf: f.cpf || null, cargo: f.cargo || null, admissao: f.admissao || null, escala_id: f.escala_id || null, empresa_id: f.empresa_id || null, ...(f.pin ? { pin: f.pin } : {}),
      });
      toast.success(f.pin ? "Salvo (PIN trocado)" : "Salvo"); onSalvo();
    } catch (error) { toast.error(errMsg(error)); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar {c.nome}</DialogTitle></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div><Label>CPF</Label><Input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} /></div>
          <div><Label>Cargo</Label><Input value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} /></div>
          <div><Label>Admissão</Label><Input type="date" value={f.admissao} onChange={(e) => setF({ ...f, admissao: e.target.value })} /></div>
          <div><Label>Escala</Label>
            <select className={sel} value={f.escala_id} onChange={(e) => setF({ ...f, escala_id: e.target.value })}>
              <option value="">— sem escala —</option>
              {escalas.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.ativo ? "" : " (inativa)"}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><Label>Empresa (empregadora)</Label>
            <select className={sel} value={f.empresa_id} onChange={(e) => setF({ ...f, empresa_id: e.target.value })}>
              <option value="">— a principal —</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}{e.ativo ? "" : " (inativa)"}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><Label>Novo PIN (deixe vazio para manter)</Label><Input inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: soPin(e.target.value) })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Trocar a escala muda o cálculo de todos os dias, inclusive os já passados do mês.</p>
        <DialogFooter><Button variant="ghost" onClick={onFechar}>Cancelar</Button><Button onClick={salvar} disabled={!f.nome.trim() || (f.pin.length > 0 && f.pin.length < 4)}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- escalas
type DiaForm = Omit<PontoDiaEscala, "escala_id">;
const diasPadrao = (): DiaForm[] =>
  Array.from({ length: 7 }, (_, i) => (i === 0
    ? { dia_semana: 0, folga: true, entrada: null, saida: null, intervalo_min: 0 }
    : { dia_semana: i, folga: false, entrada: "08:00", saida: "17:00", intervalo_min: 60 }));

function cargaSemanal(dias: DiaForm[]): string {
  let min = 0;
  for (const d of dias) {
    if (d.folga || !d.entrada || !d.saida) continue;
    const [eh, em] = d.entrada.split(":").map(Number); const [sh, sm] = d.saida.split(":").map(Number);
    const e = eh! * 60 + em!; const s = sh! * 60 + sm!;
    min += (s > e ? s - e : s + 1440 - e) - (d.intervalo_min || 0);
  }
  return `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
}

export function EscalasPonto() {
  const { data, refetch } = useQuery({ queryKey: ["ponto-escalas"], queryFn: pontoEscalas });
  const [ed, setEd] = useState<{ id?: string; nome: string; tolerancia_min: number; ativo: boolean; dias: DiaForm[] } | null>(null);

  function abrir(e?: PontoEscala) {
    if (!e) return setEd({ nome: "", tolerancia_min: 10, ativo: true, dias: diasPadrao() });
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = e.dias.find((x) => x.dia_semana === i);
      return d ? { dia_semana: i, folga: d.folga, entrada: d.entrada, saida: d.saida, intervalo_min: d.intervalo_min } : { dia_semana: i, folga: true, entrada: null, saida: null, intervalo_min: 0 };
    });
    setEd({ id: e.id, nome: e.nome, tolerancia_min: e.tolerancia_min, ativo: e.ativo, dias });
  }
  const mudarDia = (i: number, p: Partial<DiaForm>) => ed && setEd({ ...ed, dias: ed.dias.map((d) => (d.dia_semana === i ? { ...d, ...p } : d)) });

  async function salvar() {
    if (!ed) return;
    try { await pontoSalvarEscala(ed); toast.success("Escala salva"); setEd(null); refetch(); } catch (error) { toast.error(errMsg(error)); }
  }
  async function excluir(e: PontoEscala) {
    if (!confirm(`Excluir a escala ${e.nome}?`)) return;
    try { await pontoExcluirEscala(e.id); refetch(); } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <div className="space-y-4">
      <Panel title="Escalas e horários" actions={<Button size="sm" onClick={() => abrir()}>Nova escala</Button>}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Escala</th>{DIAS.map((d) => <th key={d}>{d.slice(0, 3)}</th>)}<th>Semana</th><th>Tolerância</th><th>Pessoas</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id} className={cn("border-t", !e.ativo && "text-muted-foreground")}>
                <td className="py-1.5 font-medium">{e.nome}{!e.ativo && " (inativa)"}</td>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = e.dias.find((x) => x.dia_semana === i);
                  return <td key={i} className="whitespace-nowrap text-xs">{!d || d.folga ? <span className="text-muted-foreground">folga</span> : `${d.entrada}–${d.saida}`}</td>;
                })}
                <td>{cargaSemanal(e.dias)}</td>
                <td>{e.tolerancia_min} min</td>
                <td>{e._count?.colaboradores ?? 0}</td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => abrir(e)}>Editar</Button>
                  <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => excluir(e)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-muted-foreground">Nenhuma escala. Crie a primeira (ex.: “Salão 6x1”).</td></tr>}
          </tbody>
        </table></div>
      </Panel>

      {ed && (
        <Dialog open onOpenChange={(o) => { if (!o) setEd(null); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>{ed.id ? "Editar escala" : "Nova escala"}</DialogTitle></DialogHeader>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-2"><Label>Nome</Label><Input value={ed.nome} onChange={(e) => setEd({ ...ed, nome: e.target.value })} placeholder="Ex.: Cozinha noite" /></div>
              <div><Label>Tolerância diária (min)</Label><Input type="number" min={0} max={60} value={ed.tolerancia_min} onChange={(e) => setEd({ ...ed, tolerancia_min: Number(e.target.value) || 0 })} /></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th>Dia</th><th>Folga</th><th>Entrada</th><th>Saída</th><th>Intervalo (min)</th></tr></thead>
              <tbody>
                {ed.dias.map((d) => (
                  <tr key={d.dia_semana} className="border-t">
                    <td className="py-1">{DIAS[d.dia_semana]}</td>
                    <td><input type="checkbox" checked={d.folga} onChange={(e) => mudarDia(d.dia_semana, e.target.checked ? { folga: true } : { folga: false, entrada: d.entrada ?? "08:00", saida: d.saida ?? "17:00" })} /></td>
                    <td><Input type="time" className="h-8 w-28" disabled={d.folga} value={d.entrada ?? ""} onChange={(e) => mudarDia(d.dia_semana, { entrada: e.target.value || null })} /></td>
                    <td><Input type="time" className="h-8 w-28" disabled={d.folga} value={d.saida ?? ""} onChange={(e) => mudarDia(d.dia_semana, { saida: e.target.value || null })} /></td>
                    <td><Input type="number" className="h-8 w-20" min={0} max={600} disabled={d.folga} value={d.intervalo_min} onChange={(e) => mudarDia(d.dia_semana, { intervalo_min: Number(e.target.value) || 0 })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">Carga semanal: <b>{cargaSemanal(ed.dias)}</b>. Saída menor que a entrada = o turno vira a noite (ex.: 18:00 às 02:00). Diferenças até a tolerância não contam como atraso nem extra (CLT art. 58).</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ed.ativo} onChange={(e) => setEd({ ...ed, ativo: e.target.checked })} /> Escala ativa</label>
            <DialogFooter><Button variant="ghost" onClick={() => setEd(null)}>Cancelar</Button><Button onClick={salvar} disabled={!ed.nome.trim()}>Salvar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- folgas e feriados
const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

export function FolgasPonto() {
  const [mes, setMes] = useState(mesAtual());
  const { data, refetch } = useQuery({ queryKey: ["ponto-folgas", mes], queryFn: () => pontoFolgas(mes) });
  const { data: colaboradores } = useQuery({ queryKey: ["ponto-colaboradores"], queryFn: pontoColaboradores });
  const [f, setF] = useState({ colaborador_id: "", tipo: "folga" as TipoFolga, data: "", ate: "", observacao: "" });

  async function lancar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await pontoCriarFolga({ colaborador_id: f.colaborador_id || null, tipo: f.tipo, data: f.data, ...(f.ate ? { ate: f.ate } : {}), observacao: f.observacao || undefined });
      toast.success(`${r.criadas} dia(s) lançado(s)${r.ja_existiam ? ` · ${r.ja_existiam} já existia(m)` : ""}`);
      setF({ ...f, data: "", ate: "", observacao: "" }); refetch();
    } catch (error) { toast.error(errMsg(error)); }
  }
  async function excluir(id: string) {
    try { await pontoExcluirFolga(id); refetch(); } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <div className="space-y-4">
      <Panel title="Lançar folga, férias, atestado ou feriado">
        <form onSubmit={lancar} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div><Label>Para</Label>
            <select className={sel} value={f.colaborador_id} onChange={(e) => setF({ ...f, colaborador_id: e.target.value, tipo: e.target.value ? f.tipo : "feriado" })}>
              <option value="">Todos (feriado da loja)</option>
              {(colaboradores ?? []).filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><Label>Tipo</Label>
            <select className={sel} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoFolga })}>
              {(f.colaborador_id ? (["folga", "ferias", "atestado", "feriado"] as TipoFolga[]) : (["feriado"] as TipoFolga[])).map((t) => <option key={t} value={t}>{ROTULO_FOLGA[t]}</option>)}
            </select>
          </div>
          <div><Label>De</Label><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} required /></div>
          <div><Label>Até (opcional)</Label><Input type="date" value={f.ate} min={f.data} onChange={(e) => setF({ ...f, ate: e.target.value })} /></div>
          <div><Label>Observação</Label><Input value={f.observacao} maxLength={200} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></div>
          <div className="flex items-end"><Button type="submit">Lançar</Button></div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Nesses dias não há horas esperadas (não conta falta). Se a pessoa trabalhar, as horas entram como extra 100%.</p>
      </Panel>
      <Panel title="Lançamentos do mês" actions={<Input type="month" className="h-8 w-40" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Data</th><th>Quem</th><th>Tipo</th><th>Observação</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((x) => (
              <tr key={x.id} className="border-t">
                <td className="py-1.5">{dataBr(x.data)}</td>
                <td>{x.colaborador?.nome ?? <b>Todos</b>}</td>
                <td><Tag tone={x.tipo === "feriado" ? "gold" : x.tipo === "atestado" ? "warn" : "muted"}>{ROTULO_FOLGA[x.tipo]}</Tag></td>
                <td className="text-muted-foreground">{x.observacao ?? ""}</td>
                <td className="text-right"><Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => excluir(x.id)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nada lançado neste mês.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
