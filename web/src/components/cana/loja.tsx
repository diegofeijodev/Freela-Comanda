'use client';

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { canaRecentes, type TipoCana } from "@/lib/erp-api";
import { horaSp, quandoLoja, resumoLancamento } from "@/lib/cana";
import { PageHeader, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormularioCana, ICONE_TIPO } from "./formulario";

const BOTOES: { tipo: TipoCana; titulo: string; ajuda: string }[] = [
  { tipo: "recebimento", titulo: "Recebi cana", ajuda: "Chegou cana do fornecedor (em dúzias)" },
  { tipo: "producao", titulo: "Produzi caldo", ajuda: "Moeu cana e tirou caldo (em litros)" },
  { tipo: "contagem", titulo: "Contagem do que sobrou", ajuda: "No fim do dia: cana e caldo que sobraram" },
];
const TIPOS = BOTOES.map((b) => b.tipo);

/** Os 3 botões grandes (loja e admin, na aba Lançamentos). */
export function BotoesCana({ onEscolher, compacto }: { onEscolher: (t: TipoCana) => void; compacto?: boolean }) {
  return (
    <div className={compacto ? "grid gap-2 md:grid-cols-3" : "space-y-3"}>
      {BOTOES.map((b) => {
        const Icone = ICONE_TIPO[b.tipo];
        return (
          <button key={b.tipo} type="button" onClick={() => onEscolher(b.tipo)}
            className={`flex w-full items-center gap-3 rounded-xl border bg-card px-4 text-left hover:bg-accent ${compacto ? "min-h-12 py-2" : "min-h-[72px] py-3"}`}>
            <Icone className="h-7 w-7 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block text-lg font-semibold">{compacto ? `Novo: ${b.titulo}` : b.titulo}</span>
              {!compacto && <span className="block text-sm text-muted-foreground">{b.ajuda}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Visão da loja (UX 3.2): lança às cegas. Só chama as duas rotas da loja (recentes e lançar); nenhuma conta, nenhum número de
 * outra pessoa. `?lancar=recebimento|producao|contagem` abre o formulário (o Voltar do navegador volta aos 3 botões).
 */
export function CanaLoja() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const lancar = params.get("lancar");
  const tipo = TIPOS.includes(lancar as TipoCana) ? (lancar as TipoCana) : null;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["cana-recentes"], queryFn: canaRecentes });
  const [lancado, setLancado] = useState<string | null>(null);
  const [novoId, setNovoId] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { if (lancado && !tipo) caixa.current?.focus(); }, [lancado, tipo]);

  if (tipo && data)
    return (
      <div>
        <PageHeader title="Cana" />
        <FormularioCana
          tipo={tipo} admin={false} recentes={data}
          onVoltar={() => router.push(pathname)}
          onLancado={async (m) => {
            setLancado(m);
            const r = await refetch();
            setNovoId(r.data?.lancamentos[0]?.id ?? null);
            router.push(pathname);
          }}
        />
      </div>
    );

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Cana" sub="Anote o que chegou, o que produziu e o que sobrou." />
      {lancado && (
        <div ref={caixa} tabIndex={-1} role="status" className="mb-4 flex gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden /> {lancado}
        </div>
      )}
      <BotoesCana onEscolher={(t) => { setLancado(null); router.push(`${pathname}?lancar=${t}`); }} />

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Seus lançamentos dos últimos 7 dias</h2>
      {isLoading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {isError && (
        <div className="rounded-lg border p-3 text-sm">
          Não consegui mostrar seus lançamentos agora. Lançar continua funcionando.{" "}
          <Button variant="link" className="h-auto p-0" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      )}
      {data && data.lancamentos.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não lançou nada nos últimos 7 dias.</p>}
      {data && data.lancamentos.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {data.lancamentos.map((l) => (
            <li key={l.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={l.anulado ? "line-through" : "font-medium"}>{resumoLancamento(l)}</span>
                {l.id === novoId && <Tag tone="ok">agora</Tag>}
                {l.anulado && <Tag tone="muted">{l.corrigido ? "Corrigido pelo gerente" : "Anulado pelo gerente"}</Tag>}
              </div>
              <div className="text-muted-foreground">{quandoLoja(l.data, data.hoje, data.ontem)} · lançado às {horaSp(l.lancado_em)}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-muted-foreground">Errou um número? Avise o gerente: só ele corrige.</p>
    </div>
  );
}
