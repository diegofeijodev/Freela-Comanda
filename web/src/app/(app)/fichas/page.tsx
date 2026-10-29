'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { criarItemCardapio, fichasLoja, fichasResumo } from "@/lib/erp-api";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag, Empty } from "@/components/ui-kit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { brl, num, pct } from "@/lib/format";
import { calcFicha } from "@/lib/ficha";
import { getConfig, errMsg } from "@/lib/db";


export default function Fichas() {
  const { data: me } = useMe();
  return me?.perfil === "admin" ? <FichasAdmin /> : <FichasLoja />;
}

function FichasLoja() {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["loja-fichas"], queryFn: fichasLoja });
  const fil = (data ?? []).filter((f) => f.nome.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(fil.map((f) => f.categoria))];
  return (
    <div className="space-y-4">
      <PageHeader title="Fichas Técnicas" sub="Modo consulta" />
      <Input placeholder="Buscar item…" value={q} onChange={(e) => setQ(e.target.value)} />
      {cats.map((c) => (
        <div key={c} className="space-y-2">
          <h2 className="pt-2 text-lg font-semibold text-primary">{c}</h2>
          {fil.filter((f) => f.categoria === c).map((f) => (
            <details key={f.id} className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer font-medium">{f.nome}</summary>
              <table className="mt-3 w-full text-sm"><tbody>
                {f.ingredientes.map((i, k) => (
                  <tr key={k} className="border-t"><td className="py-1.5">{i.insumo}{i.observacao && <div className="text-xs text-muted-foreground">{i.observacao}</div>}</td><td className="text-right">{num(i.quantidade, 4)} {i.unidade}</td></tr>
                ))}
              </tbody></table>
              {f.observacoes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{f.observacoes}</p>}
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}

type Ordem = "nome" | "custo_total" | "preco_sugerido" | "preco_venda" | "lucro" | "cmv";

function FichasAdmin() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<"cards" | "resumo">("cards");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  // Catálogo = só itens ativos (os inativos ficam para o histórico de vendas).
  const { data } = useQuery({ queryKey: ["fichas-resumo", "ativos"], queryFn: () => fichasResumo(true) });

  const linhas = useMemo(() => (data ?? []).map((f) => {
    const c = cfg ? calcFicha(Number(f.custo_ingredientes), cfg, f.mkup, f.preco_venda) : null;
    return { ...f, c };
  }), [data, cfg]);
  const fil = linhas.filter((f) => f.nome!.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...fil].sort((a, b) => {
    const v = (x: typeof a) => ordem === "nome" ? x.nome! : ordem === "lucro" ? x.c?.lucro ?? 0 : ordem === "cmv" ? x.c?.cmvPct ?? 0 : ordem === "custo_total" ? x.c?.total ?? 0 : ordem === "preco_sugerido" ? x.c?.sugerido ?? 0 : Number(x.preco_venda ?? 0);
    const A = v(a), B = v(b);
    return typeof A === "string" ? A.localeCompare(B as string) : (B as number) - (A as number);
  });
  const cats = [...new Set(fil.map((f) => f.categoria!))].sort();

  async function nova() {
    const nome = prompt("Nome do novo item do cardápio:");
    if (!nome) return;
    try {
      const d = await criarItemCardapio(nome);
      router.push(`/fichas/${d.id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }

  const Th = ({ k, children }: { k: Ordem; children: string }) => (
    <th className="cursor-pointer py-2 text-right hover:text-foreground" onClick={() => setOrdem(k)}>{children}{ordem === k && " ↓"}</th>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Fichas Técnicas" sub={`${linhas.length} itens do cardápio`} actions={<>
        <Button variant={modo === "cards" ? "default" : "outline"} onClick={() => setModo("cards")}>Por categoria</Button>
        <Button variant={modo === "resumo" ? "default" : "outline"} onClick={() => setModo("resumo")}>Resumo</Button>
        <Button variant="secondary" onClick={nova}>+ Nova ficha</Button>
      </>} />
      <Input placeholder="Buscar item…" value={q} onChange={(e) => setQ(e.target.value)} />
      {fil.length === 0 && <Empty>Nenhuma ficha encontrada.</Empty>}
      {modo === "cards" ? cats.map((c) => (
        <div key={c}>
          <h2 className="mb-2 mt-4 text-lg font-semibold text-primary">{c}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fil.filter((f) => f.categoria === c).sort((a, b) => a.nome!.localeCompare(b.nome!)).map((f) => (
              <Link key={f.id} href={`/fichas/${f.id}`} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/60">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{f.nome}</div>
                  {f.c && f.preco_venda != null && <Tag tone={f.c.ok ? "ok" : "bad"}>{f.c.ok ? "OK" : "Abaixo"}</Tag>}
                </div>
                <div className="mt-2 grid grid-cols-3 text-xs text-muted-foreground">
                  <div>Custo<div className="text-sm text-foreground">{brl(f.c?.total)}</div></div>
                  <div>Preço<div className="text-sm text-foreground">{brl(f.preco_venda)}</div></div>
                  <div>CMV<div className="text-sm text-foreground">{pct(f.c?.cmvPct)}</div></div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs uppercase text-muted-foreground"><tr>
                <th className="cursor-pointer py-2 text-left" onClick={() => setOrdem("nome")}>Item{ordem === "nome" && " ↓"}</th>
                <Th k="custo_total">Custo</Th><Th k="preco_sugerido">Sugerido</Th><Th k="preco_venda">Praticado</Th><Th k="lucro">Lucro</Th><Th k="cmv">CMV %</Th><th className="text-right">Situação</th>
              </tr></thead>
              <tbody>{sorted.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => router.push(`/fichas/${f.id}`)}>

                  <td className="py-1.5">{f.nome}<div className="text-xs text-muted-foreground">{f.categoria}</div></td>
                  <td className="text-right">{brl(f.c?.total)}</td><td className="text-right">{brl(f.c?.sugerido)}</td><td className="text-right">{brl(f.preco_venda)}</td>
                  <td className="text-right">{brl(f.c?.lucro)}</td><td className="text-right">{pct(f.c?.cmvPct)}</td>
                  <td className="text-right">{f.preco_venda != null && <Tag tone={f.c?.ok ? "ok" : "bad"}>{f.c?.ok ? "OK" : "Abaixo do sugerido"}</Tag>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
