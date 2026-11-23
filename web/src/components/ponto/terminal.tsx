'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Clock, Delete, LockKeyhole, MonitorX } from "lucide-react";
import {
  pontoCriarTerminal, pontoIdentificar, pontoJustificar, pontoMarcar, pontoTerminalInicio,
  type PontoSituacao, type TipoMarcacao, type TipoOcorrencia,
} from "@/lib/erp-api";
import { errCode, errMsg } from "@/lib/db";
import { ROTULO_MARCACAO, ROTULO_OCORRENCIA } from "@/lib/ponto";
import { apagarTerminal, gravarTerminal, lerTerminal, type TerminalLocal } from "@/modules/ponto/infrastructure/terminal.storage";
import { Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const OCIOSO_MS = 45_000; // sem toque por 45 s, volta para a lista (o PIN não fica na tela)
const dataBr = (s: string) => s.split("-").reverse().join("/");

function useRelogio() {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

function Relogio() {
  const agora = useRelogio();
  if (!agora) return <div className="h-20" />;
  const hora = agora.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const data = agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="text-center">
      <div className="font-display text-5xl font-bold tabular-nums md:text-6xl" aria-live="off">{hora}</div>
      <div className="mt-1 text-sm capitalize text-muted-foreground">{data}</div>
    </div>
  );
}

/** Tela de bater ponto. Só funciona no computador liberado (token do terminal no navegador). */
export function TerminalPonto({ admin }: { admin: boolean }) {
  const [terminal, setTerminal] = useState<TerminalLocal | null | undefined>(undefined);
  useEffect(() => setTerminal(lerTerminal()), []);

  if (terminal === undefined) return null;
  if (!terminal) return <NaoLiberado admin={admin} onLiberado={setTerminal} />;
  return <Terminal terminal={terminal} admin={admin} onRevogado={() => { apagarTerminal(); setTerminal(null); }} />;
}

function NaoLiberado({ admin, onLiberado }: { admin: boolean; onLiberado: (t: TerminalLocal) => void }) {
  const [nome, setNome] = useState("Computador da loja");
  const [salvando, setSalvando] = useState(false);
  async function liberar() {
    setSalvando(true);
    try {
      const t = await pontoCriarTerminal(nome.trim());
      const local = { id: t.id, nome: t.nome, token: t.token };
      gravarTerminal(local);
      onLiberado(local);
      toast.success("Este computador foi liberado para bater ponto");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Panel>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <MonitorX className="h-10 w-10 text-muted-foreground" />
        <div className="text-lg font-semibold">Este computador não está liberado para bater ponto</div>
        <p className="max-w-md text-sm text-muted-foreground">
          O ponto só pode ser registrado no computador da loja. {admin
            ? "Se este é o computador da loja, dê um nome a ele e libere abaixo (faça isso no próprio computador da loja)."
            : "Peça ao administrador para entrar neste computador e liberá-lo em Ponto → Bater ponto."}
        </p>
        {admin && (
          <div className="mt-2 flex w-full max-w-sm gap-2">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do computador" maxLength={60} />
            <Button onClick={liberar} disabled={salvando || !nome.trim()}>Liberar este computador</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

type Escolhido = { id: string; nome: string };

function Terminal({ terminal, admin, onRevogado }: { terminal: TerminalLocal; admin: boolean; onRevogado: () => void }) {
  const inicio = useQuery({ queryKey: ["ponto-terminal", terminal.token], queryFn: () => pontoTerminalInicio(terminal.token), retry: false });
  const [escolhido, setEscolhido] = useState<Escolhido | null>(null);
  const [pin, setPin] = useState("");
  const [situacao, setSituacao] = useState<PontoSituacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [justificar, setJustificar] = useState<{ data: string; tipo: TipoOcorrencia; minutos: number; agora: boolean } | null>(null);
  const [busca, setBusca] = useState("");
  const ocioso = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recomecar = useCallback(() => {
    setEscolhido(null); setPin(""); setSituacao(null); setJustificar(null); setBusca("");
  }, []);

  // Volta sozinho para a lista quando ninguém mexe (o próximo colaborador não vê o ponto do anterior).
  const cutucar = useCallback(() => {
    if (ocioso.current) clearTimeout(ocioso.current);
    ocioso.current = setTimeout(recomecar, OCIOSO_MS);
  }, [recomecar]);
  useEffect(() => {
    if (escolhido) cutucar();
    return () => { if (ocioso.current) clearTimeout(ocioso.current); };
  }, [escolhido, situacao, cutucar]);

  useEffect(() => {
    if (inicio.error && errCode(inicio.error) === "TERMINAL_NAO_AUTORIZADO") {
      toast.error(errMsg(inicio.error));
      onRevogado();
    }
  }, [inicio.error, onRevogado]);

  async function entrar(p = pin) {
    if (!escolhido || p.length < 4) return;
    setOcupado(true);
    try {
      setSituacao(await pontoIdentificar(terminal.token, escolhido.id, p));
    } catch (error) {
      toast.error(errMsg(error));
      setPin("");
    } finally {
      setOcupado(false);
    }
  }

  async function marcar(tipo: TipoMarcacao) {
    if (!escolhido) return;
    setOcupado(true);
    try {
      const r = await pontoMarcar(terminal.token, escolhido.id, pin, tipo);
      setSituacao(r.situacao);
      toast.success(`${ROTULO_MARCACAO[r.marcacao.tipo]} registrada às ${r.marcacao.hora}`, { description: escolhido.nome });
      if (r.ocorrencia) setJustificar({ ...r.ocorrencia, agora: true });
      else if (tipo === "saida") setTimeout(recomecar, 2500);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setOcupado(false);
    }
  }

  if (inicio.isLoading) return <div className="py-10 text-center text-muted-foreground">Carregando…</div>;
  if (inicio.error) return <Panel><div className="py-8 text-center text-sm text-destructive">{errMsg(inicio.error)}</div></Panel>;

  const colaboradores = (inicio.data?.colaboradores ?? []).filter((c) => c.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-3xl space-y-4" onPointerDown={() => escolhido && cutucar()}>
      <Panel>
        <Relogio />
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Terminal: {inicio.data?.terminal}
          {admin && <button className="underline" onClick={() => { if (confirm("Desvincular este computador do ponto? (O terminal continua cadastrado; para bloquear de vez, revogue em Terminais.)")) onRevogado(); }}>desvincular</button>}
        </div>
      </Panel>

      {!escolhido && (
        <Panel title="Quem vai bater o ponto?">
          {(inicio.data?.colaboradores.length ?? 0) > 8 && (
            <Input className="mb-3" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
          )}
          {colaboradores.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Nenhum colaborador ativo. O administrador cadastra em Ponto → Colaboradores.</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {colaboradores.map((c) => (
              <Button key={c.id} variant="outline" className="h-14 justify-start text-base" onClick={() => setEscolhido(c)}>{c.nome}</Button>
            ))}
          </div>
        </Panel>
      )}

      {escolhido && !situacao && (
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={recomecar}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
            <div className="text-lg font-semibold">{escolhido.nome}</div>
          </div>
          <PinPad pin={pin} setPin={setPin} onOk={entrar} ocupado={ocupado} />
        </Panel>
      )}

      {escolhido && situacao && (
        <>
          <Panel>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">{situacao.colaborador.nome}</div>
                <div className="text-xs text-muted-foreground">
                  Jornada de {dataBr(situacao.data)}
                  {situacao.previsto ? ` · previsto ${situacao.previsto.entrada} às ${situacao.previsto.saida}${situacao.previsto.intervalo_min ? `, intervalo ${situacao.previsto.intervalo_min} min` : ""}` : " · folga pela escala"}
                </div>
              </div>
              <Button variant="outline" onClick={recomecar}>Concluir</Button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {situacao.marcacoes.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma batida ainda.</span>}
              {situacao.marcacoes.map((m, i) => (
                <span key={i} className="rounded-lg border bg-muted/40 px-3 py-1.5 text-sm"><b className="tabular-nums">{m.hora}</b> · {ROTULO_MARCACAO[m.tipo]}</span>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {situacao.proximos.map((t) => (
                <Button key={t} className={cn("h-16 text-lg", t === "intervalo_inicio" && "sm:order-first")} variant={t === "intervalo_inicio" ? "outline" : "default"} disabled={ocupado} onClick={() => marcar(t)}>
                  Registrar {ROTULO_MARCACAO[t].toLowerCase()}
                </Button>
              ))}
            </div>
          </Panel>

          {situacao.pendencias.length > 0 && (
            <Panel title={`Para justificar · ${situacao.pendencias.length}`}>
              <ul className="divide-y text-sm">
                {situacao.pendencias.map((p) => (
                  <li key={`${p.data}-${p.tipo}`} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <b>{dataBr(p.data)}</b> · {ROTULO_OCORRENCIA[p.tipo]}{p.tipo !== "falta" ? ` de ${p.minutos} min` : ""}
                      {p.justificativa === "recusada" && <span className="ml-2 text-xs text-destructive">justificativa recusada</span>}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setJustificar({ data: p.data, tipo: p.tipo, minutos: p.minutos, agora: false })}>Justificar</Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {justificar && escolhido && (
        <JustificarDialog
          alvo={justificar}
          onFechar={() => setJustificar(null)}
          onEnviar={async (texto) => {
            try {
              setSituacao(await pontoJustificar(terminal.token, { colaborador_id: escolhido.id, pin, data: justificar.data, tipo: justificar.tipo, texto }));
              toast.success("Justificativa enviada ao administrador");
              setJustificar(null);
            } catch (error) {
              toast.error(errMsg(error));
            }
          }}
        />
      )}
    </div>
  );
}

function PinPad({ pin, setPin, onOk, ocupado }: { pin: string; setPin: (p: string) => void; onOk: (p?: string) => void; ocupado: boolean }) {
  const tecla = (d: string) => { if (pin.length < 6) setPin(pin + d); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) tecla(e.key);
      else if (e.key === "Backspace") setPin(pin.slice(0, -1));
      else if (e.key === "Enter") onOk(pin);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="mx-auto max-w-xs">
      <div className="mb-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LockKeyhole className="h-4 w-4" /> Digite seu PIN</div>
      <div className="mb-4 flex justify-center gap-2" aria-label={`${pin.length} dígitos digitados`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className={cn("h-3 w-3 rounded-full border", i < pin.length ? "bg-primary border-primary" : "bg-transparent")} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button key={d} variant="outline" className="h-14 text-xl" onClick={() => tecla(d)}>{d}</Button>
        ))}
        <Button variant="ghost" className="h-14" aria-label="Apagar" onClick={() => setPin(pin.slice(0, -1))}><Delete className="h-5 w-5" /></Button>
        <Button variant="outline" className="h-14 text-xl" onClick={() => tecla("0")}>0</Button>
        <Button className="h-14" disabled={pin.length < 4 || ocupado} onClick={() => onOk(pin)}>OK</Button>
      </div>
    </div>
  );
}

function JustificarDialog({ alvo, onFechar, onEnviar }: {
  alvo: { data: string; tipo: TipoOcorrencia; minutos: number; agora: boolean };
  onFechar: () => void;
  onEnviar: (texto: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const titulo = alvo.tipo === "falta"
    ? `Falta em ${dataBr(alvo.data)}`
    : `${ROTULO_OCORRENCIA[alvo.tipo]} de ${alvo.minutos} min${alvo.agora ? "" : ` em ${dataBr(alvo.data)}`}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {alvo.agora ? "Esta batida ficou fora do horário da escala. " : ""}Explique o motivo; o administrador vai analisar.
          </DialogDescription>
        </DialogHeader>
        <Textarea autoFocus rows={4} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={alvo.tipo === "falta" ? "Ex.: consulta médica (vou trazer o atestado)" : "Ex.: ônibus atrasou"} />
        <DialogFooter>
          <Button variant="ghost" disabled={enviando} onClick={onFechar}>Justificar depois</Button>
          <Button disabled={enviando || texto.trim().length < 3} onClick={async () => { setEnviando(true); await onEnviar(texto.trim()); setEnviando(false); }}>
            Enviar justificativa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
