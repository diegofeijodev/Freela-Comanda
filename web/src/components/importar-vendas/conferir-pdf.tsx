'use client';

import { useRef } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Plus } from "lucide-react";
import type { RelatorioVendasLido } from "@/lib/erp-api";
import { diaMes, plural, problemaDaLinha, reais, somaPdf, type LinhaConferencia } from "@/lib/importar-vendas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Aviso } from "./previa";
import { cn } from "@/lib/utils";

/** Passo 2 do PDF (UX 2.5): "Confira o que a IA leu". Nada é gravado sem a conferência (regra das notas por IA). */
export function ConferirPdf({ lido, linhas, onLinhas, dataPadrao, onDataPadrao, onPrevia }: {
  lido: RelatorioVendasLido;
  linhas: LinhaConferencia[];
  onLinhas(l: LinhaConferencia[]): void;
  dataPadrao: string;
  onDataPadrao(d: string): void;
  onPrevia(): void;
}) {
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const s = somaPdf(linhas, lido.total_relatorio);
  const semData = linhas.some((l) => !l.data);
  const variosDias = semData && !!lido.periodo_ini && !!lido.periodo_fim && lido.periodo_ini !== lido.periodo_fim;
  const ruins = linhas.filter((l) => problemaDaLinha(l));
  const faltaData = semData && !dataPadrao;
  const falta = faltaData ? "Escolha a data das vendas" : ruins.length ? `Corrija ${plural(ruins.length, "linha", "linhas")}` : linhas.length === 0 ? "Acrescente pelo menos uma linha" : null;
  const muda = (id: string, x: Partial<LinhaConferencia>) => onLinhas(linhas.map((l) => (l.id === id ? { ...l, ...x } : l)));
  function tirar(l: LinhaConferencia) {
    const antes = linhas;
    onLinhas(linhas.filter((x) => x.id !== l.id));
    toast("Linha tirada.", { duration: 8000, action: { label: "Desfazer", onClick: () => onLinhas(antes) } });
  }
  function acrescentar() {
    const id = crypto.randomUUID();
    onLinhas([...linhas, { id, pedido: null, data: null, hora: null, produto: "", quantidade: "", valor: "" }]);
    setTimeout(() => refs.current[id]?.focus(), 0);
  }

  return (
    <section aria-labelledby="titulo-conferir" className="space-y-4 pb-28 md:pb-0">
      <h2 id="titulo-conferir" tabIndex={-1} className="text-lg font-semibold">Confira o que a IA leu</h2>
      <Aviso tom="neutro">A IA pode errar. Compare com o relatório: produto, quantidade e valor de cada linha.</Aviso>
      {(lido.sistema || lido.periodo_ini) && (
        <p className="text-sm">
          Relatório{lido.sistema ? ` do sistema “${lido.sistema}”` : ""}
          {lido.periodo_ini ? `, de ${diaMes(lido.periodo_ini)}${lido.periodo_fim && lido.periodo_fim !== lido.periodo_ini ? ` a ${diaMes(lido.periodo_fim)}` : ""}` : ""}.
        </p>
      )}
      <div aria-live="polite">
        {s.bate === true && (
          <p className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            Soma das {linhas.length} linhas: {reais(s.soma_centavos)} · Total impresso no relatório: {reais(s.total_centavos!)}. Batem.</p>
        )}
        {s.bate === false && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Soma das {linhas.length} linhas: {reais(s.soma_centavos)} · Total impresso no relatório: {reais(s.total_centavos!)}. Diferença de {reais(Math.abs(s.soma_centavos - s.total_centavos!))}: falta alguma linha ou algum valor saiu errado.
          </p>
        )}
        {s.bate === null && (
          <p className="text-sm text-muted-foreground">O relatório não mostra um total (ou a IA não achou). Confira linha a linha. Soma das {linhas.length} linhas: {reais(s.soma_centavos)}.</p>
        )}
      </div>
      {semData && (
        <div className="space-y-1">
          <Label htmlFor="data-padrao">Data das vendas sem data (o relatório não traz por linha)</Label>
          <Input id="data-padrao" type="date" className="h-11 max-w-[12rem]" value={dataPadrao} onChange={(e) => onDataPadrao(e.target.value)} aria-invalid={faltaData} />
          {variosDias && dataPadrao && (
            <p className="text-sm text-warning">As vendas entram todas em {diaMes(dataPadrao)}. Para ver por dia (e na semana da cana), importe um relatório por dia.</p>
          )}
        </div>
      )}
      <ul className="space-y-3">
        {linhas.map((l, i) => {
          const p = problemaDaLinha(l);
          const nome = l.produto || `linha ${i + 1}`;
          return (
            <li key={l.id} className={cn("space-y-2 rounded-lg border p-3", p && "border-amber-500/60")}>
              <div className="space-y-1">
                <Label htmlFor={`produto-${l.id}`}>Produto</Label>
                <Input id={`produto-${l.id}`} ref={(el) => { refs.current[l.id] = el; }} className="h-11" value={l.produto} onChange={(e) => muda(l.id, { produto: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`qtd-${l.id}`}>Quantidade</Label>
                  <Input id={`qtd-${l.id}`} inputMode="decimal" className="h-11" value={l.quantidade} aria-label={`Quantidade da linha ${i + 1}, ${nome}`}
                    onChange={(e) => muda(l.id, { quantidade: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`valor-${l.id}`}>Valor (R$)</Label>
                  <Input id={`valor-${l.id}`} inputMode="decimal" className="h-11" value={l.valor} aria-label={`Valor da linha ${i + 1}, ${nome}`}
                    onChange={(e) => muda(l.id, { valor: e.target.value })} />
                </div>
                {l.data !== null && (
                  <div className="space-y-1">
                    <Label htmlFor={`data-${l.id}`}>Data</Label>
                    <Input id={`data-${l.id}`} type="date" className="h-11" value={l.data} onChange={(e) => muda(l.id, { data: e.target.value || null })} />
                  </div>
                )}
              </div>
              {p && <p className="text-sm text-warning">{p}</p>}
              <Button variant="ghost" className="h-11" aria-label={`Tirar a linha ${nome}`} onClick={() => tirar(l)}>Tirar esta linha</Button>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" className="h-11" onClick={acrescentar}><Plus className="h-4 w-4" aria-hidden /> Acrescentar uma linha</Button>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:border-0 md:p-0">
        {s.bate === false && <p className="mb-1 text-sm text-destructive">A soma não bate com o relatório</p>}
        {falta && <p className="mb-1 text-sm text-warning">{falta}</p>}
        <Button className="h-11 w-full md:w-auto" aria-disabled={!!falta}
          onClick={() => {
            if (faltaData) return document.getElementById("data-padrao")?.focus();
            if (ruins.length) return refs.current[ruins[0]!.id]?.focus();
            if (!linhas.length) return;
            onPrevia();
          }}>
          Ver a prévia
        </Button>
      </div>
    </section>
  );
}
