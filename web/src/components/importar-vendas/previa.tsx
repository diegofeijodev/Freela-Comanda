'use client';

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import type { ItemCardapio, PreviaVendas } from "@/lib/erp-api";
import {
  botaoImportar, contaCuponsNovos, contaPeriodo, contaTotal, contaVendasNovas, inteiro, periodoCurto, plural, quandoFoi, reais,
  textoCancelamentosDoComanda, textoCancelamentoSemVendaXml, textoJaExistentes, textoOutraEmpresa, textoSobreposicao,
} from "@/lib/importar-vendas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function Aviso({ tom, titulo, children, acao }: { tom: "ambar" | "vermelho" | "neutro" | "ok"; titulo?: string; children?: ReactNode; acao?: ReactNode }) {
  const Icone = tom === "vermelho" ? CircleAlert : tom === "ok" ? CheckCircle2 : TriangleAlert;
  return (
    <div
      role={tom === "vermelho" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm",
        tom === "ambar" && "border-amber-500/40 bg-amber-500/10",
        tom === "vermelho" && "border-destructive/40 bg-destructive/10",
        (tom === "neutro" || tom === "ok") && "bg-muted/40",
      )}
    >
      <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", tom === "ambar" && "text-amber-500", tom === "vermelho" && "text-destructive", tom === "ok" && "text-success")} aria-hidden />
      <div className="min-w-0 space-y-1">
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children && <div className="break-words">{children}</div>}
        {acao}
      </div>
    </div>
  );
}

/** "Ver as colunas" → "Voltar às colunas"; "Ver a leitura" → "Voltar à leitura". */
const voltarPara = (t: string) => t.replace(/^Ver as /, "Voltar às ").replace(/^Ver a /, "Voltar à ");

function Numero({ titulo, valor, conta }: { titulo: string; valor: string; conta: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      {conta && <p className="mt-1 text-sm">{conta}</p>}
    </div>
  );
}

export type EscolhasPrevia = {
  modo: "acrescentar" | "substituir";
  sobreposicaoMarcada: boolean;
  deParaEscolha: Record<string, string>;
  cnpjsIncluidos: string[];
  nfeIncluidas: string[];
};

/** Passo 3 (UX 2.6/2.7): "Confira antes de importar". */
export function PreviaImportacao({
  previa, carregando, erro, acaoErro, onTentar, sistema, formato, arquivo, cardapio, escolhas, onEscolhas, importando, erroImportar, avisoTopo,
  onImportar, onVoltar, textoVoltar, onSubstituirDialogo, dialogoAberto, onFecharDialogo,
}: {
  previa: PreviaVendas | null;
  carregando: boolean;
  erro: string | null;
  /** Botão que resolve o erro (ex.: "Ir para Empresas" no LOJA_SEM_CNPJ). */
  acaoErro?: ReactNode;
  onTentar(): void;
  sistema: string;
  formato: "planilha" | "xml" | "pdf";
  arquivo: string;
  cardapio: ItemCardapio[];
  escolhas: EscolhasPrevia;
  onEscolhas(e: EscolhasPrevia): void;
  importando: boolean;
  erroImportar: { tipo: "rede" | "erro"; msg: string } | null;
  avisoTopo: string | null;
  onImportar(): void;
  onVoltar(): void;
  textoVoltar: string | null;
  onSubstituirDialogo(): void;
  dialogoAberto: boolean;
  onFecharDialogo(): void;
}) {
  const caixaRef = useRef<HTMLButtonElement>(null);
  const tipoTexto = { planilha: "planilha", xml: "XML", pdf: "PDF" }[formato];
  const cabecalho = (
    <div>
      <h2 id="titulo-previa" tabIndex={-1} className="text-lg font-semibold">Confira antes de importar</h2>
      <p className="text-sm text-muted-foreground">{sistema} · {tipoTexto} · {arquivo} · <strong>nada foi gravado ainda</strong></p>
      {textoVoltar && <Button variant="link" className="h-11 px-0" onClick={onVoltar}>{textoVoltar}</Button>}
    </div>
  );
  if (!previa) {
    return (
      <section aria-labelledby="titulo-previa" className="space-y-3">
        {cabecalho}
        {erro ? (
          <Aviso tom="vermelho" titulo={erro} acao={acaoErro ?? <Button variant="outline" className="h-11" onClick={onTentar}>Tentar de novo</Button>} />
        ) : (
          <div aria-live="polite" className="space-y-2">
            <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Conferindo com as vendas que já estão no Comanda…</p>
            <div className="grid gap-2 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          </div>
        )}
      </section>
    );
  }
  const p = previa;
  const d = p.documentos;
  const set = (x: Partial<EscolhasPrevia>) => onEscolhas({ ...escolhas, ...x });
  const botao = botaoImportar(p, { modo: escolhas.modo, sobreposicaoMarcada: escolhas.sobreposicaoMarcada, atualizando: carregando });
  const nada = p.linhas.novas === 0 && !(d && d.arquivos_cancelamento > 0);
  const semValidas = p.linhas.validas === 0 && !(d && (d.arquivos_cancelamento > 0 || d.ja_importados > 0 || d.vendas_novas > 0 || d.com_problema.length > 0));
  const canc = d?.cancelamentos_de_importados;
  const ja = p.linhas.ja_existentes > 0 ? textoJaExistentes(p, sistema) : null;

  return (
    <section aria-labelledby="titulo-previa" className="space-y-4 pb-28 md:pb-0">
      {cabecalho}
      {avisoTopo && <Aviso tom="ambar">{avisoTopo}</Aviso>}
      {erro && <Aviso tom="vermelho" titulo={erro} acao={<Button variant="outline" className="h-11" onClick={onTentar}>Tentar de novo</Button>} />}
      <p className="sr-only" aria-live="polite">{carregando ? "Atualizando a prévia…" : "Prévia atualizada."}</p>
      <div className={cn("grid gap-4 md:grid-cols-2", carregando && "opacity-60")}>
        <div className="space-y-3">
          {d ? (
            <Numero titulo="Cupons de venda novos" valor={plural(d.vendas_novas, "cupom", "cupons")} conta={contaCuponsNovos(d)} />
          ) : (
            <Numero titulo="Vendas novas" valor={plural(p.linhas.novas, "linha", "linhas")} conta={contaVendasNovas(p.linhas)} />
          )}
          {canc && canc.documentos > 0 && (
            <Numero titulo="Cancelamentos de cupons já importados" valor={plural(canc.documentos, "cupom", "cupons")}
              conta={`Cancelados depois de importados: saem das vendas ${plural(canc.linhas, "linha", "linhas")} (${reais(canc.valor_centavos)}).`} />
          )}
          <Numero titulo="Total das vendas novas" valor={reais(p.valor_centavos)} conta={contaTotal(p)} />
          <Numero titulo="Período" valor={periodoCurto(p.periodo)} conta={contaPeriodo(p)} />
          <Numero
            titulo="Pedidos e itens"
            valor={`${plural(p.pedidos, "pedido", "pedidos")} · ${plural(p.itens, "item", "itens")}`}
            conta={p.amostra.length && p.amostra.every((a) => /DIA \d{4}-\d{2}-\d{2}$/.test(a.pedido))
              ? "1 pedido por dia (o arquivo não tem número de pedido)."
              : "Pedidos = números de pedido diferentes; itens = soma das quantidades."}
          />
        </div>

        <div className="space-y-3">
          {p.sobreposicao.length > 0 && (
            <Aviso tom="ambar" titulo="Pode contar em dobro.">
              <p>{textoSobreposicao(p)}</p>
              <div className="mt-2 flex items-start gap-2">
                <Checkbox id="sobreposicao" ref={caixaRef} checked={escolhas.sobreposicaoMarcada} onCheckedChange={(v) => set({ sobreposicaoMarcada: v === true })} className="mt-1" />
                <Label htmlFor="sobreposicao">São vendas diferentes (outro caixa ou canal, como iFood); importar mesmo assim</Label>
              </div>
              {p.periodo && (
                <Link href={`/vendas?ini=${p.periodo.ini}&fim=${p.periodo.fim}`} target="_blank" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
                  Ver as vendas do período
                </Link>
              )}
            </Aviso>
          )}
          {escolhas.modo === "substituir" && p.substituir?.bloqueado && (
            <Aviso tom="ambar" titulo="Substituir não roda com linhas com problema."
              acao={<Button variant="outline" className="h-11" onClick={() => set({ modo: "acrescentar" })}>Só acrescentar as novas</Button>}>
              O arquivo tem {plural(p.linhas.com_problema, "linha", "linhas")} com problema. Com Substituir, as {inteiro(p.substituir.vendas)} vendas de {sistema} entre {periodoCurto({ ini: p.substituir.ini, fim: p.substituir.fim })} sairiam, e as vendas dessas linhas não voltariam. Corrija o arquivo (ou as colunas) e escolha de novo, ou só acrescente as novas. Nada foi apagado.
            </Aviso>
          )}
          {escolhas.modo === "substituir" && p.substituir && p.substituir.vendas > 0 && !p.substituir.bloqueado && (
            <Aviso tom="vermelho" titulo="Vai apagar vendas.">
              Vai apagar {plural(p.substituir.vendas, "venda", "vendas")} ({reais(p.substituir.valor_centavos)}) de {sistema} entre {periodoCurto({ ini: p.substituir.ini, fim: p.substituir.fim })} e pôr as do arquivo no lugar. As vendas de outros sistemas, de XML e dos cupons do Comanda não são tocadas.
            </Aviso>
          )}
          {p.arquivo_ja_importado && (
            <Aviso tom="ambar" titulo="Este arquivo já foi importado.">
              Em {quandoFoi(p.arquivo_ja_importado.em).dia}{p.arquivo_ja_importado.por ? ` por ${p.arquivo_ja_importado.por}` : ""}
              {p.arquivo_ja_importado.vendas != null ? ` (${plural(p.arquivo_ja_importado.vendas, "venda", "vendas")})` : ""}. As vendas repetidas não entram de novo: só as novas.
            </Aviso>
          )}
          {ja && (p.ja_existentes_de_outra_fonte.length > 0 ? (
            <Aviso tom="ambar" titulo={ja.titulo}>{ja.texto}</Aviso>
          ) : (
            <Aviso tom="neutro">{inteiro(p.linhas.ja_existentes)} linhas já estão no Comanda (importadas antes deste mesmo sistema) e não entram de novo.</Aviso>
          ))}
          {p.ja_existentes_pedido_dia > 0 && (
            <Aviso tom="ambar" titulo="Parte do dia já foi importada."
              acao={formato !== "xml" ? <Button variant="outline" className="h-11" onClick={() => set({ modo: "substituir" })}>Trocar as vendas deste sistema no período</Button> : undefined}>
              Sem número de pedido, cada dia vira um pedido só, e um 2º relatório do mesmo dia (ex.: almoço e jantar) aparece como já existente. Importe um relatório do dia inteiro, ou escolha Substituir para trocar o dia.
            </Aviso>
          )}
          {d && d.cancelados_no_envio > 0 && <Aviso tom="neutro">{plural(d.cancelados_no_envio, "cupom foi cancelado", "cupons foram cancelados")} (a venda e o cancelamento vieram juntos): não entram.</Aviso>}
          {canc && canc.documentos > 0 && (
            <Aviso tom="ambar" titulo={p.linhas.novas === 0 ? "Nenhum cupom novo, só cancelamentos." : "Cupons cancelados depois de importados."}>
              {plural(canc.documentos, "cupom importado antes foi cancelado", "cupons importados antes foram cancelados")}: ao {p.linhas.novas === 0 ? "confirmar" : "importar"}, saem das vendas {plural(canc.linhas, "linha", "linhas")} ({reais(canc.valor_centavos)}){canc.ini && canc.fim ? `, de ${periodoCurto({ ini: canc.ini, fim: canc.fim })}` : ""}, e a baixa delas no estoque é desfeita.
            </Aviso>
          )}
          {d && d.ja_importados > 0 && <Aviso tom="neutro">{plural(d.ja_importados, "cupom já foi importado", "cupons já foram importados")} antes: {d.ja_importados === 1 ? "fica" : "ficam"} como {d.ja_importados === 1 ? "está" : "estão"}.</Aviso>}
          {d && d.do_proprio_comanda > 0 && <Aviso tom="neutro">{plural(d.do_proprio_comanda, "cupom foi emitido", "cupons foram emitidos")} aqui no Comanda: já {d.do_proprio_comanda === 1 ? "está" : "estão"} nas vendas e não {d.do_proprio_comanda === 1 ? "entra" : "entram"} de novo.</Aviso>}
          {d && d.cancelamentos_do_comanda.arquivos > 0 && (
            <Aviso tom={d.cancelamentos_do_comanda.ainda_autorizados > 0 ? "ambar" : "neutro"} titulo="Cancelamento de cupom do Comanda não aplicado."
              acao={d.cancelamentos_do_comanda.ainda_autorizados > 0 ? <Link href="/cupom" target="_blank" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Abrir Cupom fiscal</Link> : undefined}>
              {textoCancelamentosDoComanda(d.cancelamentos_do_comanda)}
            </Aviso>
          )}
          {d && textoCancelamentoSemVendaXml(d.cancelamentos_sem_venda_xml) && (
            <Aviso tom="ambar" titulo="A planilha não é corrigida pelo cancelamento.">
              {textoCancelamentoSemVendaXml(d.cancelamentos_sem_venda_xml)}
            </Aviso>
          )}
          {d && d.outros_cnpjs.map((o) => {
            const t = textoOutraEmpresa(o);
            return (
              <Aviso key={o.cnpj} tom="ambar" titulo={o.documentos ? "Cupons de outra empresa sua." : "Cancelamentos de outra empresa sua."}>
                <p>{t.texto}</p>
                <div className="mt-2 flex items-start gap-2">
                  <Checkbox id={`cnpj-${o.cnpj}`} checked={escolhas.cnpjsIncluidos.includes(o.cnpj)} className="mt-1"
                    onCheckedChange={(v) => set({ cnpjsIncluidos: v === true ? [...escolhas.cnpjsIncluidos, o.cnpj] : escolhas.cnpjsIncluidos.filter((c) => c !== o.cnpj) })} />
                  <Label htmlFor={`cnpj-${o.cnpj}`}>{t.rotulo}</Label>
                </div>
              </Aviso>
            );
          })}
          {d && d.com_problema.length > 0 && (
            <details className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <summary className="min-h-11 cursor-pointer font-medium">{plural(d.com_problema.length, "cupom com problema fica", "cupons com problema ficam")} de fora</summary>
              <ul className="mt-2 space-y-1">
                {d.com_problema.slice(0, 200).map((x) => <li key={x.arquivo} className="break-words">{x.arquivo}: {x.motivo}</li>)}
              </ul>
              {d.com_problema.length > 200 && <p>e mais {inteiro(d.com_problema.length - 200)}</p>}
              <p className="mt-1">Exporte esses XML de novo no sistema de origem; se continuar, mande um deles para o suporte.</p>
            </details>
          )}
          {d && d.nfe_fora.length + escolhas.nfeIncluidas.length > 0 && (
            <Aviso tom="ambar" titulo={`${plural(d.nfe_fora.length, "nota fiscal (NF-e) ficou", "notas fiscais (NF-e) ficaram")} de fora.`}>
              <p>Nota fiscal de saída pode ser venda, mas também remessa, transferência ou bonificação, que não são venda. Marque só as que são venda.</p>
              <p className="text-xs text-muted-foreground">CFOP é o código do tipo de operação. Pergunte ao contador quais códigos da sua loja são venda.</p>
              <ul className="mt-2 space-y-1">
                {d.nfe_fora.map((n) => (
                  <li key={n.chave} className="flex items-start gap-2">
                    <Checkbox id={`nfe-${n.chave}`} className="mt-1" checked={false} onCheckedChange={(v) => v === true && set({ nfeIncluidas: [...escolhas.nfeIncluidas, n.chave] })} />
                    <Label htmlFor={`nfe-${n.chave}`}>NF-e {n.serie}-{n.numero} · {quandoFoi(n.dh_emi).dia} · {reais(n.valor_centavos)} · tipo de operação (CFOP): {n.cfops.join(", ") || "—"}</Label>
                  </li>
                ))}
                {escolhas.nfeIncluidas.length > 0 && (
                  <li><Button variant="link" className="h-11 px-0" onClick={() => set({ nfeIncluidas: [] })}>Tirar as {inteiro(escolhas.nfeIncluidas.length)} NF-e marcadas</Button></li>
                )}
              </ul>
            </Aviso>
          )}
          {d && d.ignorados.length > 0 && (
            <details className="rounded-lg border bg-muted/40 p-3 text-sm">
              <summary className="min-h-11 cursor-pointer font-medium">{plural(d.ignorados.reduce((s, g) => s + g.arquivos.length, 0), "arquivo ignorado", "arquivos ignorados")}</summary>
              <ul className="mt-2 space-y-2">
                {d.ignorados.map((g) => (
                  <li key={g.motivo}>
                    <details>
                      <summary className="cursor-pointer">{inteiro(g.arquivos.length)} · {g.motivo}</summary>
                      <p className="break-all text-xs text-muted-foreground">{g.arquivos.slice(0, 100).join(" · ")}{g.arquivos.length > 100 ? ` e mais ${g.arquivos.length - 100}` : ""}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {p.linhas.com_problema > 0 && !semValidas && (
            <details className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <summary className="min-h-11 cursor-pointer font-medium">{plural(p.linhas.com_problema, "linha com problema fica", "linhas com problema ficam")} de fora</summary>
              <ul className="mt-2 space-y-1">{p.problemas.map((x) => <li key={x.linha}>Linha {x.linha}: {x.motivo}</li>)}</ul>
              {p.linhas.com_problema > p.problemas.length && <p>e mais {inteiro(p.linhas.com_problema - p.problemas.length)} linhas</p>}
              {textoVoltar && <Button variant="outline" className="mt-2 h-11" onClick={onVoltar}>{voltarPara(textoVoltar)}</Button>}
            </details>
          )}
          {semValidas && (
            <Aviso tom="vermelho" titulo="Nenhuma venda válida no arquivo."
              acao={textoVoltar ? <Button className="h-11" onClick={onVoltar}>{voltarPara(textoVoltar)}</Button> : undefined}>
              <ul>{p.motivos.slice(0, 5).map((m) => <li key={m.motivo}>{inteiro(m.linhas)} · {m.motivo}</li>)}</ul>
              <p>Quase sempre é a coluna errada: confira Data e Quantidade.</p>
            </Aviso>
          )}
          {!semValidas && nada && (
            <Aviso tom="ok" titulo="Nada novo para importar."
              acao={p.periodo ? <Link href={`/vendas?ini=${p.periodo.ini}&fim=${p.periodo.fim}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ver vendas do período</Link> : undefined}>
              {d ? "Todos os cupons deste envio já estão no Comanda (ou ficaram de fora pelos motivos acima)." : `As ${inteiro(p.linhas.ja_existentes)} vendas deste arquivo já estão no Comanda.`}
            </Aviso>
          )}

          {p.produtos_sem_de_para.length > 0 && (
            <section aria-labelledby="titulo-produtos" className="space-y-2 rounded-lg border p-3">
              <h3 id="titulo-produtos" className="font-semibold">{plural(p.produtos_sem_de_para.length, "produto novo", "produtos novos")}, ainda não {p.produtos_sem_de_para.length === 1 ? "ligado" : "ligados"} ao cardápio</h3>
              <p className="text-sm text-muted-foreground">Ligar ao cardápio faz a venda baixar o estoque pela ficha técnica e entrar na conta da Cana (se o item levar caldo). Dá para ligar depois em Importar Dados.</p>
              <ul className="space-y-3">
                {p.produtos_sem_de_para.map((x) => {
                  const escolha = escolhas.deParaEscolha[x.produto_relatorio] ?? "";
                  const id = `depara-${x.produto_relatorio}`;
                  return (
                    <li key={x.produto_relatorio} className="space-y-1 border-t pt-2 first:border-0 first:pt-0">
                      <p className="break-words font-medium">{x.produto_relatorio}</p>
                      <p className="text-xs text-muted-foreground">{plural(x.linhas, "linha", "linhas")} · {reais(x.valor_centavos)} no arquivo</p>
                      <Label htmlFor={id} className="sr-only">Item do cardápio para {x.produto_relatorio}</Label>
                      <select id={id} className="h-11 w-full rounded-md border bg-background px-2 text-sm" value={escolha}
                        onChange={(e) => set({ deParaEscolha: { ...escolhas.deParaEscolha, [x.produto_relatorio]: e.target.value } })}>
                        <option value="">Não ligar agora (não baixa estoque)</option>
                        {cardapio.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.id === x.sugestao_item_cardapio_id ? " (sugestão, confira)" : ""}</option>)}
                      </select>
                      {x.parece_cana && !escolha && <p className="text-sm text-warning">Parece produto de caldo: sem ligar ao cardápio, não entra na conta da Cana.</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {formato !== "xml" ? (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 font-semibold">Vendas deste sistema que já estão no período</legend>
              <div role="radiogroup" className="space-y-2">
                {(["acrescentar", "substituir"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={escolhas.modo === m} onClick={() => set({ modo: m })}
                    className={cn("flex min-h-11 w-full items-start gap-2 rounded-md border p-2 text-left", escolhas.modo === m && "border-primary bg-primary/5")}>
                    {escolhas.modo === m ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border" aria-hidden />}
                    <span>
                      <span className="block font-medium">{m === "acrescentar" ? "Só acrescentar as novas" : "Trocar as vendas deste sistema no período (Substituir)"}</span>
                      <span className="block text-sm text-muted-foreground">
                        {m === "acrescentar"
                          ? "As que já existem ficam como estão. É o mais seguro."
                          : sistema === "Planilha padrão do Comanda"
                            ? "Apaga as vendas da planilha padrão entre a primeira e a última data do arquivo e importa as do arquivo."
                            : `Apaga as vendas de ${sistema} entre a primeira e a última data do arquivo e importa as do arquivo. Use quando corrigiu o relatório no sistema.`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">Com XML, cupom repetido nunca entra duas vezes e cupom cancelado sai sozinho: não há Substituir.</p>
          )}

          {p.amostra.length > 0 && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="min-h-11 cursor-pointer font-medium">Amostra das vendas novas</summary>
              <ul className="mt-2 space-y-1">
                {p.amostra.map((a, i) => <li key={i} className="break-words">{a.pedido} · {a.data.split("-").reverse().join("/")}{a.hora ? ` ${a.hora.slice(0, 5)}` : ""} · {a.produto_relatorio} · {a.quantidade.toLocaleString("pt-BR")} · {reais(a.valor_centavos)}</li>)}
              </ul>
            </details>
          )}

          {erroImportar && (
            <Aviso tom={erroImportar.tipo === "rede" ? "ambar" : "vermelho"} titulo={erroImportar.msg}
              acao={erroImportar.tipo === "rede" ? (
                <div className="flex flex-wrap gap-2">
                  <Button className="h-11" onClick={onImportar}>Tentar de novo</Button>
                  {p.periodo && <Link href={`/vendas?ini=${p.periodo.ini}&fim=${p.periodo.fim}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">Ver vendas do período</Link>}
                </div>
              ) : undefined} />
          )}

          {botao.acao !== "nada" || botao.rotulo ? (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:border-0 md:p-0">
              {botao.falta && !carregando && <p className="mb-1 text-sm text-warning">{botao.falta}</p>}
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground md:hidden">{plural(p.linhas.novas, "venda", "vendas")} · {reais(p.valor_centavos)}</span>
                <Button
                  className="h-11 flex-1 md:flex-none"
                  variant={botao.destrutivo ? "destructive" : "default"}
                  aria-disabled={botao.acao === "nada" || importando}
                  aria-busy={importando}
                  onClick={() => {
                    if (importando) return;
                    if (botao.acao === "nada") {
                      if (p.sobreposicao.length && !escolhas.sobreposicaoMarcada) caixaRef.current?.focus();
                      return;
                    }
                    if (botao.acao === "dialogo") return onSubstituirDialogo();
                    onImportar();
                  }}
                >
                  {importando ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Importando…</> : botao.rotulo}
                </Button>
              </div>
              {importando ? <p className="mt-1 text-xs text-muted-foreground">Pode levar até 1 minuto. Não feche a tela.</p>
                : <p className="mt-1 text-xs text-muted-foreground">Nada foi gravado ainda. Se sair, o arquivo e as escolhas se perdem.</p>}
            </div>
          ) : null}
        </div>
      </div>

      <AlertDialog open={dialogoAberto} onOpenChange={(v) => !v && onFecharDialogo()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {inteiro(p.substituir?.vendas ?? 0)} vendas de {sistema}?</AlertDialogTitle>
            <AlertDialogDescription>
              As vendas de {sistema} de {periodoCurto(p.substituir ? { ini: p.substituir.ini, fim: p.substituir.fim } : null)} ({reais(p.substituir?.valor_centavos ?? 0)}) saem, com as baixas de estoque delas, e entram as {inteiro(p.linhas.novas)} do arquivo ({reais(p.valor_centavos)}). Vendas de outros sistemas, de XML e dos cupons do Comanda ficam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus className="h-11">Voltar sem apagar</AlertDialogCancel>
            <Button variant="destructive" className="h-11" onClick={() => { onFecharDialogo(); onImportar(); }}>Apagar e importar</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
