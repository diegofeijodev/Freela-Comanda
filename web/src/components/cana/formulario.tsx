'use client';

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, GlassWater, Loader2, Minus, Plus, Truck } from "lucide-react";
import { canaCorrigir, canaLancar, type CanaLancamento, type CanaRecentes, type TipoCana } from "@/lib/erp-api";
import { errCode, errMsg } from "@/lib/db";
import { botaoLancar, dataCurta, duzias, horaSp, lerNumero, litros, quandoLoja, TITULO_TIPO } from "@/lib/cana";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const ICONE_TIPO = { recebimento: Truck, producao: GlassWater, contagem: ClipboardCheck } as const;
const MOTIVOS = ["Lançado em dobro", "Número errado", "Data errada"];

type Campo = "duzias" | "litros_caldo" | "litros_frozen";
type Valores = Record<Campo, string>;

/** Um campo de número grande (mão molhada, luva): rótulo em cima, unidade fora do campo, erro junto. */
function CampoNumero({ id, rotulo, ajuda, unidade, valor, erro, onChange, passos, foco }: {
  id: string; rotulo: string; ajuda?: string; unidade: string; valor: string; erro?: string; onChange: (v: string) => void; passos?: boolean; foco?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (foco) ref.current?.focus(); }, [foco]);
  const somar = (d: number) => {
    const n = lerNumero(valor) ?? 0;
    if (Number.isNaN(n)) return;
    onChange(String(Math.max(0, n + d)).replace(".", ","));
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-base">{rotulo}</Label>
      <div className="flex items-center gap-2">
        {passos && <Button type="button" variant="outline" className="h-12 w-12 shrink-0" aria-label="Menos uma dúzia" onClick={() => somar(-1)}><Minus className="h-5 w-5" /></Button>}
        <Input
          ref={ref} id={id} inputMode="decimal" autoComplete="off" value={valor} onChange={(e) => onChange(e.target.value)}
          className="h-12 text-right text-xl" aria-invalid={!!erro} aria-describedby={`${id}-ajuda ${id}-erro`}
        />
        {passos && <Button type="button" variant="outline" className="h-12 w-12 shrink-0" aria-label="Mais uma dúzia" onClick={() => somar(1)}><Plus className="h-5 w-5" /></Button>}
        <span className="w-14 shrink-0 text-sm text-muted-foreground">{unidade}</span>
      </div>
      {ajuda && <p id={`${id}-ajuda`} className="text-sm text-muted-foreground">{ajuda}</p>}
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}

/** Mensagem do "Lançado: …" (caixa verde). Só o que a pessoa digitou. */
export function mensagemLancado(l: CanaLancamento, hoje: string, ontem: string) {
  const quando = `${dataCurta(l.data)}${l.data === hoje ? " (hoje)" : l.data === ontem ? " (ontem)" : ""}`;
  const as = `às ${horaSp(l.lancado_em)}`;
  if (l.tipo === "recebimento") return `Lançado: ${duzias(l.duzias ?? 0)} de cana ${(l.duzias ?? 0) < 2 ? "recebida" : "recebidas"} em ${quando}, ${as}.`;
  if (l.tipo === "producao") return `Lançado: ${litros(l.litros_caldo ?? 0, true)} de caldo em ${quando}, ${as}.`;
  const frozen = l.litros_frozen != null ? ` · ${litros(l.litros_frozen, true)} de frozen` : "";
  return `Lançado: contagem de ${quando}: ${duzias(l.duzias ?? 0)} · ${litros(l.litros_caldo ?? 0, true)} de caldo${frozen}, ${as}.`;
}

/**
 * Os três formulários (UX 3.3), iguais para a loja e o admin. A loja só escolhe Hoje ou Ontem (as datas vêm do servidor); o admin tem
 * "Outra data". Cada abertura nasce com uma chave de repetição: tocar de novo em "Lançar" depois de uma ida que chegou não lança duas vezes.
 * `corrigir` (só admin): abre preenchido, pede o motivo e manda "anular e lançar" numa ida só.
 */
export function FormularioCana({ tipo, admin, recentes, corrigir, onVoltar, onLancado }: {
  tipo: TipoCana; admin: boolean; recentes: Pick<CanaRecentes, "hoje" | "ontem" | "contagens_lancadas" | "fornecedores">;
  corrigir?: CanaLancamento; onVoltar: () => void; onLancado: (mensagem: string) => void;
}) {
  const { hoje, ontem } = recentes;
  const inicial = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
  const [quando, setQuando] = useState<"hoje" | "ontem" | "outra">(corrigir ? (corrigir.data === hoje ? "hoje" : corrigir.data === ontem ? "ontem" : "outra") : "hoje");
  const [outra, setOutra] = useState(corrigir?.data ?? hoje);
  const [v, setV] = useState<Valores>({ duzias: inicial(corrigir?.duzias), litros_caldo: inicial(corrigir?.litros_caldo), litros_frozen: inicial(corrigir?.litros_frozen) });
  const [fornecedor, setFornecedor] = useState(corrigir?.fornecedor ?? "");
  const [observacao, setObservacao] = useState(corrigir?.observacao ?? "");
  const [comObs, setComObs] = useState(!!corrigir?.observacao);
  const [motivo, setMotivo] = useState("");
  const [erros, setErros] = useState<Partial<Record<Campo | "motivo", string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(crypto.randomUUID());
  const Icone = ICONE_TIPO[tipo];

  const data = quando === "hoje" ? hoje : quando === "ontem" ? ontem : outra;
  const quandoTexto = quando === "hoje" ? "hoje" : quando === "ontem" ? "ontem" : `em ${dataCurta(outra)}`;
  const num = (c: Campo) => { const n = lerNumero(v[c]); return n === null || Number.isNaN(n) ? null : n; };
  const contagemDoDia = tipo === "contagem" && !corrigir ? recentes.contagens_lancadas.find((c) => c.data === data) : undefined;
  const digitou = Object.values(v).some(Boolean) || !!fornecedor || !!observacao;

  function conferir(): boolean {
    const e: typeof erros = {};
    const exigir = (c: Campo, vazio: string, podeZero: boolean, opcional = false) => {
      const n = lerNumero(v[c]);
      if (n === null) { if (!opcional) e[c] = vazio; return; }
      if (Number.isNaN(n)) e[c] = "Use só números (ex.: 12 ou 12,5).";
      else if (podeZero ? n < 0 : n <= 0) e[c] = podeZero ? "Não pode ser negativo. Não sobrou? Digite 0." : "O número tem de ser maior que zero.";
    };
    if (tipo === "recebimento") exigir("duzias", "Digite quantas dúzias chegaram.", false);
    if (tipo === "producao") { exigir("litros_caldo", "Digite quantos litros de caldo saíram.", false); exigir("duzias", "", false, true); }
    if (tipo === "contagem") {
      exigir("duzias", "Digite as dúzias de cana que sobraram (não sobrou? digite 0).", true);
      exigir("litros_caldo", "Digite os litros de caldo que sobraram (não sobrou? digite 0).", true);
      exigir("litros_frozen", "", true, true);
    }
    if (corrigir && motivo.trim().length < 3) e.motivo = "Escreva o motivo (pelo menos 3 letras).";
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function lancar() {
    if (enviando || !conferir()) return;
    setEnviando(true);
    setErro(null);
    const corpo = {
      data,
      duzias: num("duzias"),
      litros_caldo: tipo === "recebimento" ? null : num("litros_caldo"),
      litros_frozen: tipo === "contagem" ? num("litros_frozen") : null,
      fornecedor: tipo === "recebimento" ? fornecedor.trim() || null : null,
      observacao: observacao.trim() || null,
    };
    try {
      const l = corrigir ? await canaCorrigir(corrigir.id, { ...corpo, motivo: motivo.trim() }) : await canaLancar({ tipo, ...corpo, chave_idempotencia: chave.current });
      onLancado(mensagemLancado(l, hoje, ontem));
    } catch (e) {
      const code = errCode(e);
      if (code === "SEM_CONEXAO") setErro("Não consegui lançar. Confira a internet e toque de novo em Lançar. O que você digitou continua aqui.");
      else if (code === "CANA_DATA_FORA" && !admin) setErro("Virou o dia. Volte e abra o formulário de novo para escolher Hoje ou Ontem.");
      else setErro(errMsg(e));
    } finally {
      setEnviando(false);
    }
  }

  const voltar = () => { if (!digitou || window.confirm("Sair sem lançar? O que você digitou se perde.")) onVoltar(); };
  const textoBotao = corrigir
    ? `Anular o antigo e lançar ${tipo === "recebimento" ? duzias(num("duzias") ?? 0) : tipo === "producao" ? litros(num("litros_caldo") ?? 0, true) : "a contagem"}`
    : botaoLancar(tipo, { duzias: num("duzias"), litros_caldo: num("litros_caldo") }, quandoTexto);
  const resumoContagem = tipo === "contagem" && num("duzias") !== null && num("litros_caldo") !== null
    ? `${duzias(num("duzias")!)} · ${litros(num("litros_caldo")!, true)} de caldo${num("litros_frozen") !== null ? ` · ${litros(num("litros_frozen")!, true)} de frozen` : ""}`
    : null;

  return (
    <form className="mx-auto max-w-md space-y-5 pb-28 md:pb-0" style={{ scrollPaddingBottom: "7rem" }} onSubmit={(e) => { e.preventDefault(); void lancar(); }}>
      <button type="button" onClick={voltar} className="flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Icone className="h-6 w-6 text-primary" aria-hidden />
        {corrigir ? `Corrigir: ${TITULO_TIPO[tipo]} de ${dataCurta(corrigir.data)} (por ${corrigir.lancado_por_nome})` : TITULO_TIPO[tipo]}
      </h2>

      {tipo === "contagem" && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">Conte no fim do dia, depois de fechar. Se contar de manhã, antes de abrir, marque <b>Ontem</b>.</div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-base font-medium">Quando?</legend>
        <div role="radiogroup" aria-label="Quando?" className="grid grid-cols-2 gap-2">
          {(["hoje", "ontem"] as const).map((q) => (
            <button key={q} type="button" role="radio" aria-checked={quando === q} onClick={() => setQuando(q)}
              className={cn("flex h-12 items-center justify-center gap-1 rounded-lg border text-sm font-medium", quando === q ? "border-primary bg-primary/10" : "bg-background")}>
              {quando === q && <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />}
              {q === "hoje" ? `Hoje · ${dataCurta(hoje)}` : `Ontem · ${dataCurta(ontem)}`}
            </button>
          ))}
        </div>
        {admin && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" role="radio" aria-checked={quando === "outra"} onClick={() => setQuando("outra")}
              className={cn("h-11 rounded-lg border px-3 text-sm", quando === "outra" ? "border-primary bg-primary/10" : "bg-background")}>Outra data</button>
            {quando === "outra" && <Input type="date" aria-label="Data do lançamento" className="h-11 w-44" max={hoje} value={outra} onChange={(e) => setOutra(e.target.value)} />}
          </div>
        )}
      </fieldset>

      {contagemDoDia ? (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          A contagem de {quandoLoja(data, hoje, ontem)} já foi lançada por {contagemDoDia.por_nome} às {horaSp(contagemDoDia.em)}.{" "}
          {admin ? "Para trocar, anule ou corrija a anterior na lista de lançamentos." : "Se ela está errada, avise o gerente."}
        </div>
      ) : (
        <>
          {tipo === "recebimento" && (
            <>
              <CampoNumero id="cana-duzias" rotulo="Quantas dúzias chegaram?" ajuda="Meia dúzia = 0,5." unidade="dúzias" valor={v.duzias} erro={erros.duzias}
                onChange={(x) => setV({ ...v, duzias: x })} passos foco />
              <div className="space-y-1">
                <Label htmlFor="cana-fornecedor">Fornecedor (opcional)</Label>
                <Input id="cana-fornecedor" className="h-11" list="cana-fornecedores" autoComplete="off" maxLength={120} value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
                <datalist id="cana-fornecedores">{recentes.fornecedores.map((f) => <option key={f} value={f} />)}</datalist>
              </div>
            </>
          )}
          {tipo === "producao" && (
            <>
              <CampoNumero id="cana-litros" rotulo="Quantos litros de caldo saíram?" ajuda="Meio litro = 0,5." unidade="litros" valor={v.litros_caldo} erro={erros.litros_caldo}
                onChange={(x) => setV({ ...v, litros_caldo: x })} foco />
              <CampoNumero id="cana-duzias" rotulo="Quantas dúzias moeu? (opcional)" ajuda="Se souber." unidade="dúzias" valor={v.duzias} erro={erros.duzias}
                onChange={(x) => setV({ ...v, duzias: x })} passos />
            </>
          )}
          {tipo === "contagem" && (
            <>
              <CampoNumero id="cana-duzias" rotulo="Dúzias de cana que sobraram" ajuda="Não sobrou? Digite 0." unidade="dúzias" valor={v.duzias} erro={erros.duzias}
                onChange={(x) => setV({ ...v, duzias: x })} passos foco />
              <CampoNumero id="cana-litros" rotulo="Litros de caldo que sobraram" ajuda="Todo o caldo já pronto." unidade="litros" valor={v.litros_caldo} erro={erros.litros_caldo}
                onChange={(x) => setV({ ...v, litros_caldo: x })} />
              <CampoNumero id="cana-frozen" rotulo="Litros de frozen pronto (se tiver)" ajuda="Deixe em branco se não tiver." unidade="litros" valor={v.litros_frozen} erro={erros.litros_frozen}
                onChange={(x) => setV({ ...v, litros_frozen: x })} />
            </>
          )}
          {comObs ? (
            <div className="space-y-1">
              <Label htmlFor="cana-obs">Observação</Label>
              <Textarea id="cana-obs" maxLength={200} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
          ) : (
            <button type="button" className="h-11 text-sm text-primary" onClick={() => setComObs(true)}>+ Observação</button>
          )}
          {corrigir && (
            <div className="space-y-2">
              <Label htmlFor="cana-motivo">Motivo da correção (obrigatório)</Label>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS.map((m) => <Button key={m} type="button" variant="outline" className="h-11" onClick={() => setMotivo(m)}>{m}</Button>)}
              </div>
              <Input id="cana-motivo" className="h-11" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={!!erros.motivo} aria-describedby="cana-motivo-erro" />
              {erros.motivo && <p id="cana-motivo-erro" role="alert" className="text-sm text-destructive">{erros.motivo}</p>}
            </div>
          )}
        </>
      )}

      {erro && <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{erro}</div>}

      {!contagemDoDia && (
        <div className="fixed inset-x-0 bottom-0 z-10 space-y-1 border-t bg-background/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          {resumoContagem && <p className="text-center text-sm text-muted-foreground">{resumoContagem}</p>}
          <Button type="submit" className="h-12 w-full text-base" disabled={enviando}>
            {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lançando…</> : textoBotao}
          </Button>
        </div>
      )}
    </form>
  );
}
