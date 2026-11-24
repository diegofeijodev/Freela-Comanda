'use client';

import { useRef } from "react";
import { CircleAlert } from "lucide-react";
import {
  CAMPO_INFO, camposFaltando, exemplosDaColuna, OBRIGATORIOS, OPCIONAIS_RECOLHIDOS, type CampoVenda, type Mapeamento, type Separador,
} from "@/lib/importar-vendas";
import { Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PRINCIPAIS: CampoVenda[] = ["data", "produto", "quantidade", "valor_total", "pedido", "hora"];

/** Passo 2 da planilha (UX 2.3): "Qual coluna do arquivo é o quê?". */
export function Colunas({ arquivo, colunas, linhas, mapa, sugeridos, sumiram, sep, lembrar, sistema, erro, onMapa, onSep, onLembrar, onPrevia }: {
  arquivo: string;
  colunas: string[];
  linhas: Record<string, string>[];
  mapa: Mapeamento;
  sugeridos: ReadonlySet<CampoVenda>;
  /** Colunas lembradas que não estão neste arquivo (campo → nome que sumiu). */
  sumiram: Partial<Record<CampoVenda, string>>;
  sep: Separador;
  lembrar: boolean;
  sistema: string;
  erro: string | null;
  onMapa(m: Mapeamento): void;
  onSep(s: Separador): void;
  onLembrar(v: boolean): void;
  onPrevia(): void;
}) {
  const refs = useRef<Partial<Record<CampoVenda, HTMLSelectElement | null>>>({});
  const faltam = camposFaltando(mapa);
  const usadaEm = (coluna: string, campo: CampoVenda) =>
    (Object.entries(mapa) as [CampoVenda, string][]).find(([c, col]) => c !== campo && col === coluna)?.[0];
  const repetidas = (Object.entries(mapa) as [CampoVenda, string][]).filter(([, col], _, todos) => todos.filter(([, c]) => c === col).length > 1);
  const exemplosValores = mapa.valor_total ? exemplosDaColuna(linhas, mapa.valor_total) : [];
  const abrirOpcionais = OPCIONAIS_RECOLHIDOS.some((c) => mapa[c]);

  function bloco(campo: CampoVenda) {
    const info = CAMPO_INFO[campo];
    const obrig = OBRIGATORIOS.includes(campo);
    const id = `coluna-${campo}`;
    const valor = mapa[campo] ?? "";
    return (
      <div key={campo} className="space-y-1 rounded-lg border p-3 md:grid md:grid-cols-[12rem_16rem_1fr] md:items-start md:gap-3 md:space-y-0">
        <div>
          <Label htmlFor={id} className="font-medium">{info.rotulo}</Label>
          <span className="ml-2 text-xs text-muted-foreground">{obrig ? "obrigatória" : campo === "pedido" ? "recomendada" : "opcional"}</span>
          {info.ajuda && <p className="text-xs text-muted-foreground">{info.ajuda}</p>}
        </div>
        <div className="space-y-1">
          <select
            id={id}
            ref={(el) => { refs.current[campo] = el; }}
            aria-label={`Coluna do arquivo para ${info.rotulo}`}
            aria-invalid={obrig && !valor}
            className="h-11 w-full rounded-md border bg-background px-2 text-sm"
            value={valor}
            onChange={(e) => onMapa({ ...mapa, [campo]: e.target.value || undefined })}
          >
            <option value="">{obrig ? "— escolha a coluna —" : "— o arquivo não tem —"}</option>
            {colunas.map((c) => {
              const outro = usadaEm(c, campo);
              return <option key={c} value={c}>{outro ? `${c} (já usada em ${CAMPO_INFO[outro].rotulo})` : c}</option>;
            })}
          </select>
          {sugeridos.has(campo) && valor && <Tag tone="gold">sugerida</Tag>}
          {sumiram[campo] && !valor && (
            <p className="flex items-start gap-1 text-sm text-warning"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />A coluna “{sumiram[campo]}” não está neste arquivo. Escolha outra.</p>
          )}
        </div>
        <p className="break-words text-sm text-muted-foreground">
          {valor ? `Exemplos: ${exemplosDaColuna(linhas, valor).join(" · ") || "(vazia)"}` : ""}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="titulo-colunas" className="space-y-4">
      <div>
        <h2 id="titulo-colunas" tabIndex={-1} className="text-lg font-semibold">Qual coluna do arquivo é o quê?</h2>
        <p className="text-sm text-muted-foreground">{arquivo} · {linhas.length.toLocaleString("pt-BR")} linhas · O Comanda sugeriu as colunas pelos nomes. Confira.</p>
      </div>
      <div className="space-y-2">{PRINCIPAIS.map(bloco)}</div>
      {!mapa.pedido && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          Sem número de pedido, cada dia vira um pedido só. Em Vendas, “Pedidos” e “Ticket médio” vão contar 1 por dia para este sistema.
        </p>
      )}
      <details open={abrirOpcionais}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Outras colunas (opcional)</summary>
        <div className="space-y-2 pt-2">{OPCIONAIS_RECOLHIDOS.map(bloco)}</div>
      </details>
      {repetidas.length > 0 && (
        <p className="text-sm text-warning">
          A mesma coluna está em {repetidas.map(([c]) => CAMPO_INFO[c].rotulo).join(" e ")}. Confira.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="font-medium">Como os valores estão escritos?</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {(["virgula", "ponto"] as const).map((s) => (
            <Button key={s} type="button" role="radio" aria-checked={sep === s} variant={sep === s ? "default" : "outline"} className="h-11" onClick={() => onSep(s)}>
              {s === "virgula" ? "Com vírgula: 1.234,56" : "Com ponto: 1,234.56"}
            </Button>
          ))}
        </div>
        {exemplosValores.length > 0 && <p className="text-sm text-muted-foreground">No arquivo: {exemplosValores.join(" · ")}</p>}
      </fieldset>
      <div className="flex items-start gap-2">
        <Checkbox id="lembrar" checked={lembrar} onCheckedChange={(v) => onLembrar(v === true)} className="mt-1" />
        <div>
          <Label htmlFor="lembrar">Lembrar estas colunas para {sistema}</Label>
          <p className="text-xs text-muted-foreground">Na próxima importação deste sistema, a prévia abre direto.</p>
        </div>
      </div>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>}
      <div className={cn("space-y-1")}>
        {faltam.length > 0 && <p className="text-sm text-destructive">Escolha a coluna de: {faltam.map((c) => CAMPO_INFO[c].rotulo).join(", ")}</p>}
        <Button
          className="h-11 w-full md:w-auto"
          aria-disabled={faltam.length > 0}
          onClick={() => {
            if (faltam.length) return refs.current[faltam[0]!]?.focus();
            onPrevia();
          }}
        >
          Ver a prévia
        </Button>
      </div>
    </section>
  );
}
