'use client';

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import type { PreviaVendas, ResultadoImportarVendas } from "@/lib/erp-api";
import { inteiro, periodoCurto, plural, quandoFoi, reais } from "@/lib/importar-vendas";
import { Button } from "@/components/ui/button";
import { Aviso } from "./previa";

/** O resultado (UX 2.7): os números são os da resposta do importar, não os da prévia (risco 9). */
export function Resultado({ r, previa, sistema, onOutro }: { r: ResultadoImportarVendas; previa: PreviaVendas | null; sistema: string; onOutro(): void }) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => titulo.current?.focus(), []);
  const mudou = previa && previa.linhas.novas !== r.inseridas;
  return (
    <section role="status" aria-labelledby="titulo-resultado" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 id="titulo-resultado" ref={titulo} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold">
        <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Vendas importadas
      </h2>
      {r.repetida && <p className="text-sm">Esta importação já tinha sido feita às {quandoFoi(r.confirmada_em).hora}.</p>}
      {mudou && <Aviso tom="ambar">Os números mudaram desde a prévia (outra importação no meio): entraram {inteiro(r.inseridas)}, não {inteiro(previa!.linhas.novas)}.</Aviso>}
      <p>{plural(r.inseridas, "venda nova", "vendas novas")} ({reais(r.valor_centavos)}){r.periodo ? `, de ${periodoCurto(r.periodo)}` : ""}, de {sistema}.</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {r.ignoradas > 0 && <li>{inteiro(r.ignoradas)} já {r.ignoradas === 1 ? "existia e foi ignorada" : "existiam e foram ignoradas"}.</li>}
        {r.apagadas > 0 && <li>{plural(r.apagadas, "venda antiga", "vendas antigas")} de {sistema} {r.apagadas === 1 ? "apagada" : "apagadas"} (Substituir, {reais(r.apagadas_valor_centavos)}).</li>}
        {r.canceladas.documentos > 0 && <li>{plural(r.canceladas.documentos, "cupom cancelado retirado", "cupons cancelados retirados")} ({plural(r.canceladas.linhas, "linha", "linhas")}, {reais(r.canceladas.valor_centavos)}).</li>}
        {r.novos_produtos > 0 && (
          <li>
            {plural(r.novos_produtos, "produto novo", "produtos novos")} no de-para; os sem ligação ao cardápio não baixam estoque.{" "}
            <Link href="/importar#ligacao-cardapio" className="text-primary underline underline-offset-2">Ligar agora</Link>
          </li>
        )}
        {r.mapeamento_salvo && <li>Colunas lembradas para {sistema}.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        {r.periodo && <Button asChild className="h-11"><Link href={`/vendas?ini=${r.periodo.ini}&fim=${r.periodo.fim}`}>Ver vendas do período</Link></Button>}
        <Button variant="outline" className="h-11" onClick={onOutro}>Importar outro arquivo</Button>
      </div>
    </section>
  );
}
