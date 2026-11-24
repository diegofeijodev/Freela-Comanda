'use client';

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { canaSemana, canaSemanaAtual, canaSemanas, type CanaAviso, type CanaSemana } from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import {
  contaCanaMoida, contaMoagem, contaPerda, contaProduto, contaProduzido, contaRendimento, contaVendido, dataCurta, duzias, fraseAviso, litros, lPorDz, rotuloSemana,
} from "@/lib/cana";
import { Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const LINK_AVISO: Partial<Record<CanaAviso["codigo"], { texto: string; href: string }>> = {
  vendas_incompletas: { texto: "Importar vendas", href: "/vendas/importar" },
  nada_configurado: { texto: "Configurar os produtos", href: "/cana?aba=configuracao" },
  produto_sem_ml: { texto: "Configurar os produtos", href: "/cana?aba=configuracao" },
  venda_sem_cardapio: { texto: "Ligar ao cardápio", href: "/importar#ligacao-cardapio" },
  frozen_sem_rendimento: { texto: "Informar o rendimento", href: "/cana?aba=configuracao" },
  cana_moida_negativa: { texto: "Ver os lançamentos da semana", href: "/cana?aba=lancamentos" },
  cana_moida_zero: { texto: "Ver os lançamentos da semana", href: "/cana?aba=lancamentos" },
  producao_zero_com_venda: { texto: "Lançar produção", href: "/cana?aba=lancamentos" },
};

function Avisos({ s }: { s: CanaSemana }) {
  if (!s.avisos.length) return null;
  return (
    <div className="space-y-2">
      {s.avisos.map((a) => (
        <div key={a.codigo} className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <div>
            {fraseAviso(a, { inicial: s.contagem_inicial.data, final: s.contagem_final?.data ?? null })}{" "}
            {LINK_AVISO[a.codigo] && <Link className="font-medium underline" href={LINK_AVISO[a.codigo]!.href}>{LINK_AVISO[a.codigo]!.texto}</Link>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cartao({ titulo, numero, rotuloNumero, linhas, children }: { titulo: string; numero: string; rotuloNumero?: string; linhas: string[]; children?: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="mt-1 text-[28px] font-semibold leading-tight" aria-label={rotuloNumero}>{numero}</div>
      <div className="mt-2 space-y-0.5 text-sm">{linhas.map((l) => <div key={l}>{l}</div>)}</div>
      {children}
    </section>
  );
}

function Numeros({ s }: { s: CanaSemana }) {
  const semConta = "Não dá para calcular: a cana moída deu zero ou negativa (ver o aviso acima).";
  const perda = s.caldo.perda;
  const sobra = perda !== null && perda < 0;
  const [m1, m2] = contaMoagem(s);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {!s.em_andamento && (
        <>
          <Cartao titulo="Rendimento da semana" numero={s.rendimento.litros_vendidos_por_duzia === null ? "—" : `${lPorDz(s.rendimento.litros_vendidos_por_duzia).replace(" L por dúzia", " L vendidos por dúzia")}`}
            linhas={s.rendimento.litros_vendidos_por_duzia === null ? [semConta] : [contaRendimento(s)]}>
            <p className="mt-2 text-sm text-muted-foreground">Inclui o caldo que sumiu e a diferença entre o caldo do início e o do fim. Para a moagem em si, veja Caldo por dúzia na moagem.</p>
          </Cartao>
          <Cartao titulo={sobra ? "Sobra de caldo" : "Perda de caldo"} numero={perda === null ? "—" : litros(Math.abs(perda))} linhas={contaPerda(s)}>
            <p className="mt-2 text-sm text-muted-foreground">{sobra ? "Saiu mais caldo em vendas do que o lançado como produzido. Falta lançar produção?" : "Positivo = caldo que sumiu."}</p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Ver o caldo no início e no fim</summary>
              {[["No início", s.caldo.inicio, s.contagem_inicial.data] as const, ["No fim", s.caldo.fim, s.contagem_final?.data] as const].map(([r, c, d]) =>
                c && d ? (
                  <p key={r}>
                    {r}: {litros(c.litros)} = {litros(c.caldo)} de caldo
                    {c.frozen !== null ? ` + ${litros(c.frozen)} de frozen ${s.parametros.rendimento_frozen ? `÷ ${s.parametros.rendimento_frozen.toLocaleString("pt-BR")}` : "(fora: falta o rendimento)"}` : ""} (contagem de {dataCurta(d)})
                  </p>
                ) : null,
              )}
            </details>
          </Cartao>
        </>
      )}
      <Cartao titulo={s.em_andamento ? "Cana no início" : "Cana moída"} numero={s.em_andamento ? duzias(s.cana.inicio) : s.cana.moida === null ? "—" : duzias(s.cana.moida)}
        linhas={s.em_andamento ? [`contagem de ${dataCurta(s.contagem_inicial.data)}`, contaCanaMoida(s)[1]!] : contaCanaMoida(s)}>
        {s.cana.anotada_nas_producoes.producoes_com > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Nas produções, a loja anotou {duzias(s.cana.anotada_nas_producoes.duzias)} moídas ({s.cana.anotada_nas_producoes.producoes_com} de {s.cana.anotada_nas_producoes.producoes} produções).
          </p>
        )}
      </Cartao>
      {!s.em_andamento && (
        <Cartao titulo="Caldo por dúzia na moagem" numero={s.moagem.litros_por_duzia === null ? "—" : lPorDz(s.moagem.litros_por_duzia)}
          linhas={s.moagem.litros_por_duzia === null ? [semConta] : [m1, m2]}>
          {s.moagem.esperado === null && <Link className="mt-1 inline-block text-sm underline" href="/cana?aba=configuracao">Informar</Link>}
        </Cartao>
      )}
      <Cartao titulo="Caldo produzido" numero={litros(s.caldo.produzido.litros)} linhas={[contaProduzido(s)]} />
      <Cartao titulo={s.em_andamento ? "Caldo vendido até agora" : "Caldo vendido"} numero={litros(s.caldo.vendido.litros)}
        linhas={[contaVendido(s), `vendas de ${dataCurta(s.periodo.ini)} a ${dataCurta(s.periodo.fim)}, venham de onde vierem (planilha, XML, PDF ou cupom do Comanda)`,
          s.vendas_importadas_ate ? `vendas importadas até ${dataCurta(s.vendas_importadas_ate)}` : "nenhuma venda importada"]} />
    </div>
  );
}

function PorProduto({ s }: { s: CanaSemana }) {
  const r = s.parametros.rendimento_frozen;
  const fora = [
    ...s.nao_entram.sem_ml.map((p) => ({ k: p.item_cardapio_id, t: `${p.nome} · ${p.quantidade.toLocaleString("pt-BR")} vendidos · sem ml configurado`, href: "/cana?aba=configuracao", l: "Configurar" })),
    ...s.nao_entram.frozen_sem_rendimento.map((p) => ({ k: p.item_cardapio_id, t: `${p.nome} · ${p.quantidade.toLocaleString("pt-BR")} vendidos · falta o rendimento do frozen`, href: "/cana?aba=configuracao", l: "Informar" })),
    ...s.nao_entram.sem_cardapio.map((p) => ({ k: p.produto_relatorio, t: `“${p.produto_relatorio}” · ${p.vendas} vendas · não ligado ao cardápio`, href: "/importar#ligacao-cardapio", l: "Ligar ao cardápio" })),
  ];
  return (
    <Panel title="Caldo vendido por produto">
      {s.por_produto.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma venda de produto configurado entre {dataCurta(s.periodo.ini)} e {dataCurta(s.periodo.fim)}.</p>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {s.por_produto.map((p) => (
              <li key={p.item_cardapio_id} className="rounded-lg border p-3 text-sm"><b>{p.nome}</b><div>{contaProduto(p, r)}</div></li>
            ))}
            <li className="px-3 text-sm font-semibold">Total: {litros(s.caldo.vendido.litros)}</li>
          </ul>
          <table className="hidden w-full text-sm md:table">
            <thead><tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1">Produto</th><th scope="col">Vendidos</th><th scope="col">ml em 1 unidade</th><th scope="col">Tipo</th><th scope="col">Litros de caldo (a conta)</th>
            </tr></thead>
            <tbody>
              {s.por_produto.map((p) => (
                <tr key={p.item_cardapio_id} className="border-t">
                  <td className="py-1">{p.nome}</td><td>{p.quantidade.toLocaleString("pt-BR")}</td><td>{p.ml_por_unidade.toLocaleString("pt-BR")} ml</td>
                  <td>{p.frozen ? "frozen" : "caldo"}</td><td>{contaProduto(p, r)}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold"><td className="py-1">Total</td><td /><td /><td /><td>{litros(s.caldo.vendido.litros)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      {fora.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-medium">Não entram na conta:</div>
          <ul>{fora.map((f) => <li key={f.k}>{f.t} <Link className="underline" href={f.href}>{f.l}</Link></li>)}</ul>
        </div>
      )}
    </Panel>
  );
}

/** Aba Semana (UX 3.4): abre na última semana fechada; cada número com a conta por extenso. */
export function CanaSemanaAba() {
  const lista = useQuery({ queryKey: ["cana-semanas"], queryFn: canaSemanas });
  const [escolha, setEscolha] = useState<string | null>(null);
  const semanas = useMemo(() => lista.data?.semanas ?? [], [lista.data]);
  const id = escolha ?? (semanas[0]?.contagem_final.id ?? (lista.data?.contagens ? "atual" : null));
  const q = useQuery({
    queryKey: ["cana-semana", id],
    queryFn: async () => (id === "atual" ? (await canaSemanaAtual()).apuracao : await canaSemana(id!)),
    enabled: !!id,
  });
  const opcoes = useMemo(() => [
    ...(lista.data?.ultima_contagem ? [{ id: "atual", rotulo: `Em andamento: desde a contagem de ${dataCurta(lista.data.ultima_contagem.data)}` }] : []),
    ...semanas.map((s) => ({ id: s.contagem_final.id, rotulo: rotuloSemana(s) })),
  ], [lista.data, semanas]);
  const i = opcoes.findIndex((o) => o.id === id);

  if (lista.isLoading) return <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3, 4, 5].map((k) => <Skeleton key={k} className="h-36 w-full" />)}</div>;
  if (lista.isError)
    return (
      <div className="rounded-lg border p-4 text-sm">
        Não consegui calcular a semana agora. Toque em Tentar de novo.
        <div className="mt-1 text-muted-foreground">{errMsg(lista.error)}</div>
        <Button className="mt-2 h-11" variant="outline" onClick={() => lista.refetch()}>Tentar de novo</Button>
      </div>
    );
  if (!lista.data?.contagens)
    return (
      <Panel title="Para ver a primeira semana:">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Configure os produtos que levam caldo. <Link className="underline" href="/cana?aba=configuracao">Configurar</Link></li>
          <li>Informe o rendimento do frozen (se vende frozen). <Link className="underline" href="/cana?aba=configuracao">Informar</Link></li>
          <li>Faça a primeira contagem: ela é o ponto de partida da primeira semana. <Link className="underline" href="/cana?aba=lancamentos">Lançar a contagem</Link></li>
          <li>Na contagem seguinte, a primeira semana fecha.</li>
        </ol>
      </Panel>
    );

  const s = q.data;
  return (
    <div className="space-y-4">
      {semanas.length === 0 && lista.data.ultima_contagem && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          A primeira semana fecha na próxima contagem. Ponto de partida: contagem de {dataCurta(lista.data.ultima_contagem.data)} ({duzias(lista.data.ultima_contagem.duzias ?? 0)} e{" "}
          {litros(lista.data.ultima_contagem.litros_caldo ?? 0)} de caldo).
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Semana
          <select className="h-11 rounded-md border bg-background px-2" value={id ?? ""} onChange={(e) => setEscolha(e.target.value)}>
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </label>
        <Button variant="outline" className="h-11" disabled={i >= opcoes.length - 1} aria-label={opcoes[i + 1] ? `Semana anterior: ${opcoes[i + 1]!.rotulo}` : "Semana anterior"} onClick={() => setEscolha(opcoes[i + 1]!.id)}>← Anterior</Button>
        <Button variant="outline" className="h-11" disabled={i <= 0} aria-label={opcoes[i - 1] ? `Semana seguinte: ${opcoes[i - 1]!.rotulo}` : "Semana seguinte"} onClick={() => setEscolha(opcoes[i - 1]!.id)}>Seguinte →</Button>
      </div>
      {q.isLoading && <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3, 4, 5].map((k) => <Skeleton key={k} className="h-36 w-full" />)}</div>}
      {q.isError && (
        <div className="rounded-lg border p-4 text-sm">
          Não consegui calcular a semana agora. Toque em Tentar de novo.
          <div className="mt-1 text-muted-foreground">{errMsg(q.error)}</div>
          <Button className="mt-2 h-11" variant="outline" onClick={() => q.refetch()}>Tentar de novo</Button>
        </div>
      )}
      {s && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{s.em_andamento ? `Em andamento: desde a contagem de ${dataCurta(s.contagem_inicial.data)}` : `Semana de ${dataCurta(s.periodo.ini)} a ${dataCurta(s.periodo.fim)}`}</h2>
            <p className="text-sm text-muted-foreground">
              {s.em_andamento
                ? "A perda e o rendimento aparecem quando a loja lançar a próxima contagem."
                : `Da contagem de ${dataCurta(s.contagem_inicial.data)} (fim do dia) até a contagem de ${dataCurta(s.contagem_final!.data)} (fim do dia). Entram os lançamentos e as vendas de ${dataCurta(s.periodo.ini)} a ${dataCurta(s.periodo.fim)}.`}{" "}
              Calculada agora, com a configuração de hoje.
            </p>
          </div>
          <Avisos s={s} />
          <Numeros s={s} />
          <PorProduto s={s} />
          <p className="text-xs text-muted-foreground">Contas com todas as casas; o número arredondado pode diferir 0,1 da soma das parcelas.</p>
        </>
      )}
    </div>
  );
}
