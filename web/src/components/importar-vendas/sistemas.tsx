'use client';

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Plus } from "lucide-react";
import {
  criarOrigemVendas, editarOrigemVendas, type FormatoVendas, type ImportacaoVendasRecente, type OrigemVendas, type OrigensVendas,
} from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { inteiro, quandoFoi } from "@/lib/importar-vendas";
import { Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Valor do sistema "Planilha padrão do Comanda" (origem nula no servidor). */
export const PADRAO = "padrao";

export const NOME_FORMATO: Record<FormatoVendas, string> = { planilha: "Planilha", xml: "XML", pdf: "PDF" };
const quando = (iso: string | null) => (iso ? `última importação em ${quandoFoi(iso).dia}` : "ainda não usado");

function linhaDoSistema(o: OrigemVendas) {
  if (o.formato_padrao === "planilha") return `Planilha · ${o.mapeamento ? "colunas lembradas" : "colunas ainda não escolhidas"} · ${quando(o.ultima_importacao_em)}`;
  return `${NOME_FORMATO[o.formato_padrao]} · ${quando(o.ultima_importacao_em)}`;
}

/** O último usado (sistema ou planilha padrão), para já vir marcado (UX 2.2). */
export function sistemaInicial(d: OrigensVendas): string {
  const ativos = d.origens.filter((o) => o.ativo);
  const usado = ativos.filter((o) => o.ultima_importacao_em).sort((a, b) => (b.ultima_importacao_em ?? "").localeCompare(a.ultima_importacao_em ?? ""))[0];
  const padrao = d.planilha_padrao.ultima_importacao_em;
  if (usado && (!padrao || (usado.ultima_importacao_em ?? "") >= padrao)) return usado.id;
  return PADRAO;
}

function Cartao({ marcado, onClick, titulo, linha }: { marcado: boolean; onClick(): void; titulo: string; linha: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcado}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-start gap-3 rounded-lg border p-3 text-left",
        marcado ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      {marcado ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> : <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border" aria-hidden />}
      <span className="min-w-0">
        <span className="block font-medium">{titulo}{marcado && <span className="sr-only"> (escolhido)</span>}</span>
        <span className="block text-sm text-muted-foreground">{linha}</span>
      </span>
    </button>
  );
}

/** "De qual sistema vêm as vendas?" + "+ Novo sistema" + "Editar sistemas". */
export function Sistemas({ dados, carregando, erro, onTentar, valor, onEscolher, onMudou }: {
  dados: OrigensVendas | undefined;
  carregando: boolean;
  erro: boolean;
  onTentar(): void;
  valor: string | null;
  onEscolher(id: string, formato: FormatoVendas): void;
  onMudou(): void;
}) {
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState(false);
  const ativos = (dados?.origens ?? []).filter((o) => o.ativo);
  return (
    <section aria-labelledby="titulo-sistema" className="space-y-3">
      <h2 id="titulo-sistema" className="font-semibold">De qual sistema vêm as vendas?</h2>
      {carregando && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {erro && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <CircleAlert className="h-4 w-4 text-destructive" aria-hidden /> Não consegui ver os sistemas agora. Toque em Tentar de novo.
          <Button variant="outline" className="h-11" onClick={onTentar}>Tentar de novo</Button>
        </div>
      )}
      <div role="radiogroup" aria-labelledby="titulo-sistema" className="space-y-2">
        {ativos.map((o) => (
          <Cartao key={o.id} marcado={valor === o.id} onClick={() => onEscolher(o.id, o.formato_padrao)} titulo={o.nome} linha={linhaDoSistema(o)} />
        ))}
        <Cartao
          marcado={valor === PADRAO}
          onClick={() => onEscolher(PADRAO, "planilha")}
          titulo="Planilha padrão do Comanda"
          linha="as colunas de sempre: pedido;data;hora;produto_relatorio;…"
        />
      </div>
      {!carregando && !erro && ativos.length === 0 && (
        <p className="text-sm text-muted-foreground">Vai importar de outro sistema? Crie ele uma vez: o Comanda lembra as colunas.</p>
      )}
      {novo ? (
        <NovoSistema
          onCancelar={() => setNovo(false)}
          onCriado={(o) => { setNovo(false); onMudou(); onEscolher(o.id, o.formato_padrao); }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="h-11" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden /> Novo sistema</Button>
          {(dados?.origens.length ?? 0) > 0 && <Button variant="ghost" className="h-11" onClick={() => setEditar(true)}>Editar sistemas</Button>}
        </div>
      )}
      <EditarSistemas aberto={editar} onFechar={() => setEditar(false)} origens={dados?.origens ?? []} onSalvo={onMudou} />
    </section>
  );
}

function NovoSistema({ onCancelar, onCriado }: { onCancelar(): void; onCriado(o: OrigemVendas): void }) {
  const [nome, setNome] = useState("");
  const [formato, setFormato] = useState<FormatoVendas | null>(null);
  const [prefixo, setPrefixo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const erroNome = tentou && !nome.trim() ? "Dê um nome ao sistema." : null;
  const erroFormato = tentou && !formato ? "Escolha o tipo de arquivo." : null;
  const erroPrefixo = prefixo.length > 10 ? "Use até 10 letras." : null;
  async function criar() {
    setTentou(true);
    if (!nome.trim() || !formato || erroPrefixo) return;
    setSalvando(true);
    setErro(null);
    try {
      const o = await criarOrigemVendas({ nome: nome.trim(), formato_padrao: formato, prefixo_pedido: prefixo.trim() });
      toast.success(`Sistema “${o.nome}” criado.`);
      onCriado(o);
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1">
        <Label htmlFor="novo-nome">Como você chama esse sistema?</Label>
        <Input id="novo-nome" autoFocus className="h-11" value={nome} onChange={(e) => setNome(e.target.value)} aria-invalid={!!erroNome}
          aria-describedby="novo-nome-ajuda" maxLength={60} />
        <p id="novo-nome-ajuda" className={cn("text-sm", erroNome ? "text-destructive" : "text-muted-foreground")}>
          {erroNome ?? "Ex.: PDV do balcão, iFood, Sistema da loja 2."}
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Que arquivo esse sistema exporta?</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {(["planilha", "xml", "pdf"] as const).map((f) => (
            <Cartao key={f} marcado={formato === f} onClick={() => setFormato(f)} titulo={{ planilha: "Planilha (CSV ou Excel)", xml: "XML (cupons)", pdf: "PDF (relatório)" }[f]} linha="" />
          ))}
        </div>
        {erroFormato && <p className="text-sm text-destructive">{erroFormato}</p>}
      </fieldset>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm">Mais opções</summary>
        <div className="space-y-1 pt-2">
          <Label htmlFor="novo-prefixo">Letras antes do pedido (opcional)</Label>
          <Input id="novo-prefixo" className="h-11 max-w-[12rem]" value={prefixo} onChange={(e) => setPrefixo(e.target.value)} aria-invalid={!!erroPrefixo} />
          <p className={cn("text-sm", erroPrefixo ? "text-destructive" : "text-muted-foreground")}>
            {erroPrefixo ?? "Use se este sistema pode ter o mesmo número de pedido que outro. Ex.: IF- faz o pedido 1001 virar IF-1001."}
          </p>
        </div>
      </details>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" onClick={criar} disabled={salvando}>{salvando ? "Criando…" : "Criar o sistema"}</Button>
        <Button variant="ghost" className="h-11" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  );
}

function EditarSistemas({ aberto, onFechar, origens, onSalvo }: { aberto: boolean; onFechar(): void; origens: OrigemVendas[]; onSalvo(): void }) {
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar sistemas</SheetTitle>
          <SheetDescription>Os sistemas nunca são apagados: parar de usar só tira da lista.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {origens.map((o) => <EditarUm key={`${o.id}-${o.ativo}`} origem={o} onSalvo={onSalvo} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditarUm({ origem, onSalvo }: { origem: OrigemVendas; onSalvo(): void }) {
  const [nome, setNome] = useState(origem.nome);
  const [prefixo, setPrefixo] = useState(origem.prefixo_pedido);
  const [sep, setSep] = useState(origem.separador_decimal);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(extra: Partial<OrigemVendas> = {}) {
    setSalvando(true);
    setErro(null);
    try {
      await editarOrigemVendas(origem.id, { nome: nome.trim(), prefixo_pedido: prefixo.trim(), separador_decimal: sep, ...extra });
      toast.success("Sistema salvo.");
      onSalvo();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor={`nome-${origem.id}`}>Nome</Label>
      <Input id={`nome-${origem.id}`} className="h-11" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
      <Label htmlFor={`prefixo-${origem.id}`}>Letras antes do pedido</Label>
      <Input id={`prefixo-${origem.id}`} className="h-11 max-w-[12rem]" value={prefixo} onChange={(e) => setPrefixo(e.target.value)} maxLength={10} />
      <fieldset>
        <legend className="text-sm font-medium">Os números vêm com vírgula ou ponto?</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(["virgula", "ponto"] as const).map((s) => (
            <Button key={s} type="button" variant={sep === s ? "default" : "outline"} className="h-11" aria-pressed={sep === s} onClick={() => setSep(s)}>
              {s === "virgula" ? "Com vírgula: 1.234,56" : "Com ponto: 1,234.56"}
            </Button>
          ))}
        </div>
      </fieldset>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" disabled={salvando} onClick={() => salvar()}>Salvar</Button>
        <Button variant="outline" className="h-11" disabled={salvando} onClick={() => salvar({ ativo: !origem.ativo })}>
          {origem.ativo ? "Parar de usar este sistema" : "Voltar a usar"}
        </Button>
      </div>
      {origem.ativo && <p className="text-xs text-muted-foreground">Ao parar: as vendas que vieram dele continuam. Ele só sai da lista.</p>}
    </div>
  );
}

/** "Últimas importações de vendas" (UX 2.2): responde "já importei isso?" sem abrir Vendas. */
export function UltimasImportacoes({ dados }: { dados: ImportacaoVendasRecente[] | undefined }) {
  return (
    <Panel title="Últimas importações de vendas">
      {!dados?.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma importação de vendas ainda.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {dados.map((i) => {
            const q = quandoFoi(i.created_at);
            return (
              <li key={i.id} className="break-words border-t pt-2 first:border-0 first:pt-0">
                {q.dia} às {q.hora} · {i.origem_nome} · {NOME_FORMATO[i.formato] ?? i.formato.toLowerCase()}
                {i.arquivo ? ` · ${i.arquivo}` : ""} · {i.inseridas == null ? `${inteiro(i.linhas)} linhas` : `${inteiro(i.inseridas)} vendas novas`}
                {i.usuario_nome ? ` · por ${i.usuario_nome}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
