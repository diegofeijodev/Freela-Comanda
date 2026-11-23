'use client';

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import {
  pontoAnularMarcacao, pontoColaboradores, pontoCorrigirMarcacao, pontoEspelho, pontoEspelhoGeral, pontoJustificarAdmin, pontoMarcacaoManual,
  pontoMarcacoes, type PontoDia, type PontoEspelho, type PontoMarcacao, type TipoMarcacao, type TipoOcorrencia,
} from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import {
  DIA_CURTO, ROTULO_MARCACAO, ROTULO_OCORRENCIA, baixarPlanilha, batidasTexto, diaSeguinte, horaSp, horas, horasOuTraco, previstoTexto, situacaoDia,
} from "@/lib/ponto";
import { Panel, Stat, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const dataBr = (s: string) => s.split("-").reverse().join("/");
const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const sel = "h-9 rounded-md border bg-background px-2 text-sm";

export function EspelhoPonto() {
  const [mes, setMes] = useState(mesAtual());
  const [colab, setColab] = useState<string>("todos");
  const [dia, setDia] = useState<PontoDia | null>(null);
  const { data: colaboradores } = useQuery({ queryKey: ["ponto-colaboradores"], queryFn: pontoColaboradores });
  const geral = useQuery({ queryKey: ["ponto-espelho-geral", mes], queryFn: () => pontoEspelhoGeral(mes), enabled: colab === "todos" });
  const um = useQuery({ queryKey: ["ponto-espelho", colab, mes], queryFn: () => pontoEspelho(colab, mes), enabled: colab !== "todos" });

  const espelhos: PontoEspelho[] = colab === "todos" ? (geral.data ?? []) : um.data ? [um.data] : [];
  const carregando = colab === "todos" ? geral.isLoading : um.isLoading;
  const erro = colab === "todos" ? geral.error : um.error;

  function excel() {
    if (!espelhos.length) return toast.error("Nada para exportar");
    const nome = colab === "todos" ? "todos" : espelhos[0]!.colaborador.nome.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();
    baixarPlanilha(espelhos, mes, `ponto-${mes}-${nome}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <div><Label>Mês</Label><Input type="month" className="w-44" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
        <div><Label>Colaborador</Label>
          <select className={cn(sel, "w-64")} value={colab} onChange={(e) => setColab(e.target.value)}>
            <option value="todos">Todos (resumo do mês)</option>
            {(colaboradores ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativo)"}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={excel}><FileSpreadsheet className="mr-1 h-4 w-4" />Excel</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />PDF</Button>
        </div>
      </div>

      {carregando && <div className="py-8 text-center text-muted-foreground">Calculando…</div>}
      {erro && <div className="text-sm text-destructive">{errMsg(erro)}</div>}

      {colab === "todos" && geral.data && (
        <>
          <Resumo espelhos={geral.data} mes={mes} onAbrir={setColab} />
          {/* No PDF de "todos" sai o resumo e, em seguida, o espelho de cada um (uma página por colaborador). */}
          <div className="hidden print:block">
            {geral.data.map((e) => <div key={e.colaborador.id} className="break-before-page"><Folha espelho={e} /></div>)}
          </div>
        </>
      )}
      {colab !== "todos" && um.data && <Folha espelho={um.data} onDia={setDia} />}

      {dia && um.data && (
        <AjusteDia
          colaboradorId={um.data.colaborador.id}
          nome={um.data.colaborador.nome}
          mes={mes}
          dia={dia}
          onFechar={() => setDia(null)}
          onMudou={async () => {
            const r = await um.refetch();
            setDia(r.data?.dias.find((d) => d.data === dia.data) ?? null);
          }}
        />
      )}
    </div>
  );
}

function Resumo({ espelhos, mes, onAbrir }: { espelhos: PontoEspelho[]; mes: string; onAbrir: (id: string) => void }) {
  return (
    <Panel title={`Resumo de ${mes.split("-").reverse().join("/")}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">Colaborador</th><th>Escala</th><th className="text-right">Faltas</th><th className="text-right">Esperado</th><th className="text-right">Trabalhado</th>
            <th className="text-right">Extra 50%</th><th className="text-right">Extra 100%</th><th className="text-right">Noturno</th><th className="text-right">Débito</th><th className="text-right">Saldo</th><th className="text-right">Pendências</th>
          </tr></thead>
          <tbody>
            {espelhos.map((e) => (
              <tr key={e.colaborador.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onAbrir(e.colaborador.id)}>
                <td className="py-1.5 font-medium">{e.colaborador.nome}{!e.colaborador.ativo && <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}</td>
                <td>{e.colaborador.escala ?? <span className="text-warning">sem escala</span>}</td>
                <td className="text-right">{e.totais.faltas || "—"}</td>
                <td className="text-right tabular-nums">{horas(e.totais.esperado_min)}</td>
                <td className="text-right tabular-nums">{horas(e.totais.trabalhado_min)}</td>
                <td className="text-right tabular-nums">{horasOuTraco(e.totais.extra_50_min)}</td>
                <td className="text-right tabular-nums">{horasOuTraco(e.totais.extra_100_min)}</td>
                <td className="text-right tabular-nums">{horasOuTraco(e.totais.noturno_min)}</td>
                <td className="text-right tabular-nums">{horasOuTraco(e.totais.debito_min)}</td>
                <td className={cn("text-right font-medium tabular-nums", e.totais.saldo_min < 0 ? "text-destructive" : e.totais.saldo_min > 0 ? "text-success" : "")}>{horas(e.totais.saldo_min)}</td>
                <td className="text-right">{e.totais.pendencias ? <Tag tone="warn">{e.totais.pendencias}</Tag> : "—"}</td>
              </tr>
            ))}
            {espelhos.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">Nenhum colaborador cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="no-print mt-2 text-xs text-muted-foreground">Clique num colaborador para ver o espelho dia a dia e fazer ajustes.</p>
    </Panel>
  );
}

/** Espelho de um colaborador (tela e impressão). */
function Folha({ espelho: e, onDia }: { espelho: PontoEspelho; onDia?: (d: PontoDia) => void }) {
  const t = e.totais;
  return (
    <div className="space-y-4">
      <div className="hidden print:block">
        {e.empresa && (
          <div className="mb-2 border-b pb-1 text-xs">
            <b>{e.empresa.razao_social}</b>{e.empresa.nome_fantasia ? ` (${e.empresa.nome_fantasia})` : ""} · CNPJ {e.empresa.cnpj}
            {e.empresa.endereco && <div>{e.empresa.endereco}</div>}
          </div>
        )}
        <h2 className="text-lg font-bold">Espelho de ponto — {e.colaborador.nome}</h2>
        <div className="text-xs">CPF: {e.colaborador.cpf ?? "—"} · Cargo: {e.colaborador.cargo ?? "—"} · Escala: {e.colaborador.escala ?? "—"} · Período: {dataBr(e.ini)} a {dataBr(e.fim)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
        <Stat label="Trabalhado" value={horas(t.trabalhado_min)} hint={`de ${horas(t.esperado_min)} previstas`} />
        <Stat label="Extra 50%" value={horas(t.extra_50_min)} />
        <Stat label="Extra 100%" value={horas(t.extra_100_min)} hint="folgas e feriados" />
        <Stat label="Noturno" value={horas(t.noturno_min)} hint="22h às 5h" />
        <Stat label="Faltas / débito" value={`${t.faltas} · ${horas(t.debito_min)}`} hint={t.abonado_min ? `${horas(t.abonado_min)} abonadas` : undefined} />
        <Stat label="Saldo do mês" value={<span className={t.saldo_min < 0 ? "text-destructive" : t.saldo_min > 0 ? "text-success" : ""}>{horas(t.saldo_min)}</span>} />
      </div>
      {!e.colaborador.escala && <div className="no-print rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">Sem escala: as horas aparecem, mas não há cálculo de falta, atraso ou extra. Defina a escala em Colaboradores.</div>}
      <Panel title="Dia a dia" actions={onDia ? <span className="no-print text-xs text-muted-foreground">Clique num dia para ajustar</span> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm print:text-[10px]">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Data</th><th>Previsto</th><th>Batidas</th><th>Situação</th><th className="text-right">Trab.</th><th className="text-right">Extra</th>
              <th className="text-right">Noturno</th><th className="text-right">Saldo</th><th className="pl-3">Ocorrências</th>
            </tr></thead>
            <tbody>
              {e.dias.filter((d) => d.situacao !== "antes_admissao").map((d) => {
                const sit = situacaoDia(d);
                return (
                  <tr key={d.data} className={cn("border-t", onDia && "cursor-pointer hover:bg-muted/40", d.dia_semana === 0 && "bg-muted/20")} onClick={() => onDia?.(d)}>
                    <td className="whitespace-nowrap py-1.5">{dataBr(d.data).slice(0, 5)} <span className="text-xs text-muted-foreground">{DIA_CURTO[d.dia_semana]}</span></td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{previstoTexto(d)}</td>
                    <td className="whitespace-nowrap tabular-nums">{batidasTexto(d) || (d.situacao === "futuro" ? "" : "—")}</td>
                    <td className={cn("text-xs", d.falta || d.incompleto ? "text-destructive" : "")}>{sit}</td>
                    <td className="text-right tabular-nums">{horasOuTraco(d.trabalhado_min)}</td>
                    <td className="text-right tabular-nums">{d.extra_100_min ? `${horas(d.extra_100_min)} (100%)` : horasOuTraco(d.extra_50_min)}</td>
                    <td className="text-right tabular-nums">{horasOuTraco(d.noturno_min)}</td>
                    <td className={cn("text-right tabular-nums", d.saldo_min < 0 ? "text-destructive" : d.saldo_min > 0 ? "text-success" : "")}>{horasOuTraco(d.saldo_min)}</td>
                    <td className="pl-3 text-xs">
                      {d.ocorrencias.map((o) => (
                        <span key={o.tipo} className="mr-1 inline-block">
                          <Tag tone={o.justificativa === "aceita" ? "ok" : o.justificativa === "pendente" ? "gold" : "bad"}>
                            {ROTULO_OCORRENCIA[o.tipo]}{o.tipo !== "falta" ? ` ${o.minutos}′` : ""}{o.justificativa === "aceita" ? " ✓" : o.justificativa === "pendente" ? " ?" : o.justificativa === "recusada" ? " ✗" : ""}
                          </Tag>
                        </span>
                      ))}
                      {d.abonado_min > 0 && <span className="text-success">abonado {horas(d.abonado_min)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">⁺¹ = batida no dia seguinte (turno que vira a noite). ✓ justificativa aceita · ? em análise · ✗ recusada.</p>
      </Panel>
      <div className="hidden pt-10 text-xs print:grid print:grid-cols-2 print:gap-16">
        <div className="border-t pt-1 text-center">Assinatura do colaborador</div>
        <div className="border-t pt-1 text-center">Assinatura do responsável</div>
      </div>
    </div>
  );
}

const TIPOS: TipoMarcacao[] = ["entrada", "intervalo_inicio", "intervalo_fim", "saida"];

/** Ajustes do dia: lançar batida esquecida, corrigir horário, anular batida errada e lançar justificativa (abono). */
function AjusteDia({ colaboradorId, nome, mes, dia, onFechar, onMudou }: {
  colaboradorId: string; nome: string; mes: string; dia: PontoDia; onFechar: () => void; onMudou: () => Promise<void>;
}) {
  const marcas = useQuery({ queryKey: ["ponto-marcacoes", colaboradorId, mes], queryFn: () => pontoMarcacoes(colaboradorId, mes) });
  const doDia = (marcas.data ?? []).filter((m) => m.data === dia.data);
  const [nova, setNova] = useState({ hora: "", tipo: "entrada" as TipoMarcacao, dia_seguinte: false, motivo: "" });
  const [editando, setEditando] = useState<PontoMarcacao | null>(null);
  const [just, setJust] = useState<{ tipo: TipoOcorrencia; texto: string; abonar: boolean } | null>(null);

  async function depois() { await Promise.all([marcas.refetch(), onMudou()]); }

  async function lancar() {
    try {
      if (editando) await pontoCorrigirMarcacao(editando.id, { hora: nova.hora, tipo: nova.tipo, dia_seguinte: nova.dia_seguinte, motivo: nova.motivo });
      else await pontoMarcacaoManual({ colaborador_id: colaboradorId, data: dia.data, ...nova });
      toast.success(editando ? "Marcação corrigida (a original fica anulada no histórico)" : "Marcação lançada");
      setNova({ hora: "", tipo: "entrada", dia_seguinte: false, motivo: "" }); setEditando(null);
      await depois();
    } catch (error) { toast.error(errMsg(error)); }
  }
  async function anular(m: PontoMarcacao) {
    const motivo = prompt(`Anular a batida das ${horaSp(m.momento)}? Escreva o motivo:`);
    if (!motivo) return;
    try { await pontoAnularMarcacao(m.id, motivo); toast.success("Marcação anulada"); await depois(); }
    catch (error) { toast.error(errMsg(error)); }
  }
  async function justificar() {
    if (!just) return;
    try {
      await pontoJustificarAdmin({ colaborador_id: colaboradorId, data: dia.data, ...just });
      toast.success("Justificativa lançada"); setJust(null); await depois();
    } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{nome} · {dataBr(dia.data)} ({DIA_CURTO[dia.dia_semana]})</DialogTitle>
          <DialogDescription>
            {dia.previsto ? `Previsto ${previstoTexto(dia)}` : situacaoDia(dia) || "Sem horário previsto"} · trabalhado {horas(dia.trabalhado_min)} · saldo {horas(dia.saldo_min)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Batidas</div>
          {doDia.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma batida neste dia.</div>}
          {doDia.map((m) => (
            <div key={m.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", m.anulada && "opacity-60")}>
              <div>
                <b className={cn("tabular-nums", m.anulada && "line-through")}>{horaSp(m.momento)}{diaSeguinte(m.momento, m.data) ? "⁺¹" : ""}</b> · {ROTULO_MARCACAO[m.tipo]}
                <span className="ml-2 text-xs text-muted-foreground">{m.origem === "manual" ? `manual: ${m.motivo}` : `terminal ${m.terminal?.nome ?? ""}`}</span>
                {m.anulada && <div className="text-xs text-destructive">Anulada: {m.anulada_motivo}</div>}
              </div>
              {!m.anulada && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => { setEditando(m); setNova({ hora: horaSp(m.momento), tipo: m.tipo, dia_seguinte: diaSeguinte(m.momento, m.data), motivo: "" }); }}>Corrigir</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => anular(m)}>Anular</Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{editando ? `Corrigir a batida das ${horaSp(editando.momento)}` : "Lançar batida manual"}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div><Label>Hora</Label><Input type="time" value={nova.hora} onChange={(e) => setNova({ ...nova, hora: e.target.value })} /></div>
            <div><Label>Tipo</Label>
              <select className={cn(sel, "w-full")} value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value as TipoMarcacao })}>
                {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_MARCACAO[t]}</option>)}
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={nova.dia_seguinte} onChange={(e) => setNova({ ...nova, dia_seguinte: e.target.checked })} /> No dia seguinte</label>
          </div>
          <div><Label>Motivo (fica no histórico)</Label><Input value={nova.motivo} maxLength={300} onChange={(e) => setNova({ ...nova, motivo: e.target.value })} placeholder="Ex.: esqueceu de bater a saída" /></div>
          <div className="flex justify-end gap-2">
            {editando && <Button variant="ghost" onClick={() => { setEditando(null); setNova({ hora: "", tipo: "entrada", dia_seguinte: false, motivo: "" }); }}>Cancelar</Button>}
            <Button disabled={!nova.hora || nova.motivo.trim().length < 3} onClick={lancar}>{editando ? "Salvar correção" : "Lançar"}</Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Ocorrências</div>
          {dia.ocorrencias.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma.</div>}
          {dia.ocorrencias.map((o) => (
            <div key={o.tipo} className="flex items-center justify-between gap-2 text-sm">
              <span>{ROTULO_OCORRENCIA[o.tipo]}{o.tipo !== "falta" ? ` de ${o.minutos} min` : ""} · {o.justificativa ?? "sem justificativa"}</span>
              <Button size="sm" variant="outline" onClick={() => setJust({ tipo: o.tipo, texto: "", abonar: true })}>Lançar justificativa</Button>
            </div>
          ))}
          {just && (
            <div className="space-y-2 rounded-lg border p-3">
              <Textarea rows={3} maxLength={500} value={just.texto} onChange={(e) => setJust({ ...just, texto: e.target.value })} placeholder="Ex.: atestado médico entregue" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={just.abonar} onChange={(e) => setJust({ ...just, abonar: e.target.checked })} /> Abonar (não descontar as horas)</label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setJust(null)}>Cancelar</Button>
                <Button disabled={just.texto.trim().length < 3} onClick={justificar}>Salvar (aceita)</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
