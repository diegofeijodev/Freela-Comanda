'use client';

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileCode2, FileSpreadsheet, FileText, Loader2, Upload } from "lucide-react";
import {
  confirmarImportarVendas, importacoesVendasRecentes, lerRelatorioVendasPdf, listarCardapio, listarOrigensVendas, previaImportarVendas, statusDoErro,
  type CorpoImportarVendas, type DocumentoVendaXml, type FormatoVendas, type PreviaVendas, type RelatorioVendasLido, type ResultadoImportarVendas,
} from "@/lib/erp-api";
import { lerXmlVenda, MOTIVO_XML } from "@/lib/nfe-vendas";
import { lerZip, ZipErro } from "@/lib/zip-leitura";
import { errCode, errMsg } from "@/lib/db";
import { useMe } from "@/lib/auth";
import { lerTabelaDeBuffer, type Celula } from "@/lib/parse";
import {
  acharCabecalho, deduzirSeparador, linhasParaEnvio, numeroDigitado, numeroParaCampo, plural, sha256Hex, sugerirMapeamento,
  type CampoVenda, type LinhaConferencia, type Mapeamento, type Separador,
} from "@/lib/importar-vendas";
import { PageHeader } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PADRAO, Sistemas, sistemaInicial, UltimasImportacoes } from "@/components/importar-vendas/sistemas";
import { Colunas } from "@/components/importar-vendas/colunas";
import { PreviaImportacao, type EscolhasPrevia } from "@/components/importar-vendas/previa";
import { Resultado } from "@/components/importar-vendas/resultado";
import { ConferirPdf } from "@/components/importar-vendas/conferir-pdf";
import { cn } from "@/lib/utils";

type Passo = "arquivo" | "colunas" | "lendo" | "ia" | "conferir" | "previa" | "resultado";
const NOME_PASSO: Record<Passo, string> = {
  arquivo: "Arquivo", colunas: "Colunas", lendo: "Lendo os arquivos", ia: "Conferir a leitura", conferir: "Conferir a leitura", previa: "Conferir e importar",
  resultado: "Conferir e importar",
};
const NUMERO_PASSO: Record<Passo, number> = { arquivo: 1, colunas: 2, lendo: 2, ia: 2, conferir: 2, previa: 3, resultado: 3 };
const TETO_PDF = 10 * 1024 * 1024;
type EnvioXml = {
  arquivos_lidos: number;
  documentos: DocumentoVendaXml[];
  cancelamentos: { arquivo: string; chave: string; dh_evento: string | null }[];
  ignorados: { arquivo: string; motivo: string }[];
};

const TIPOS: { formato: FormatoVendas; titulo: string; texto: string; icone: typeof FileSpreadsheet; botao: string; accept: string; ajuda: string }[] = [
  {
    formato: "planilha", titulo: "Planilha", texto: "CSV ou Excel, de qualquer sistema", icone: FileSpreadsheet, botao: "Escolher a planilha",
    accept: ".csv,.xlsx,.xls,.txt", ajuda: "CSV separado por ponto e vírgula, vírgula ou tabulação, ou Excel.",
  },
  {
    formato: "xml", titulo: "XML", texto: "cupons fiscais: vários arquivos ou o .zip do mês", icone: FileCode2, botao: "Escolher os arquivos XML ou o .zip",
    accept: ".xml,.zip,text/xml,application/zip", ajuda: "Pode escolher vários .xml de uma vez, ou o .zip que o sistema gera para o contador.",
  },
  {
    formato: "pdf", titulo: "PDF", texto: "relatório impresso do sistema, lido pela inteligência artificial (IA)", icone: FileText, botao: "Escolher o PDF",
    accept: ".pdf,application/pdf", ajuda: "Um PDF de até 10 MB. Relatório de um dia lê melhor do que o do mês.",
  },
];

const ESCOLHAS_INICIAIS: EscolhasPrevia = { modo: "acrescentar", sobreposicaoMarcada: false, deParaEscolha: {}, cnpjsIncluidos: [], nfeIncluidas: [] };
const novaChave = () => crypto.randomUUID();

export default function ImportarVendasPage() {
  const { data: me } = useMe();
  const admin = me?.perfil === "admin";
  const qc = useQueryClient();
  const origensQ = useQuery({ queryKey: ["vendas-origens"], queryFn: listarOrigensVendas, enabled: admin });
  const recentesQ = useQuery({ queryKey: ["vendas-importacoes"], queryFn: importacoesVendasRecentes, enabled: admin });
  const cardapioQ = useQuery({ queryKey: ["cardapio-nomes"], queryFn: listarCardapio, enabled: admin });

  const [passo, setPasso] = useState<Passo>("arquivo");
  const [sistema, setSistema] = useState<string | null>(null);
  const [formato, setFormato] = useState<FormatoVendas>("planilha");
  const [arquivo, setArquivo] = useState<{ nome: string; sha256: string } | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  // planilha
  const [tabela, setTabela] = useState<Celula[][] | null>(null);
  const [iCab, setICab] = useState(0);
  const [mapa, setMapa] = useState<Mapeamento>({});
  const [sugeridos, setSugeridos] = useState<Set<CampoVenda>>(new Set());
  const [sumiram, setSumiram] = useState<Partial<Record<CampoVenda, string>>>({});
  const [sep, setSep] = useState<Separador>("virgula");
  const [lembrar, setLembrar] = useState(true);
  // xml
  const [xml, setXml] = useState<EnvioXml | null>(null);
  const [leitura, setLeitura] = useState<{ lidos: number; total: number } | null>(null);
  const pararLeitura = useRef(false);
  // pdf
  const [lido, setLido] = useState<RelatorioVendasLido | null>(null);
  const [linhasPdf, setLinhasPdf] = useState<LinhaConferencia[]>([]);
  const [dataPadrao, setDataPadrao] = useState("");
  const [erroIa, setErroIa] = useState<{ msg: string; codigo: string | null } | null>(null);
  const pdfAtual = useRef<File | null>(null);
  // prévia e importar
  const [escolhas, setEscolhas] = useState<EscolhasPrevia>(ESCOLHAS_INICIAIS);
  const [previa, setPrevia] = useState<PreviaVendas | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [erroPreviaCodigo, setErroPreviaCodigo] = useState<string | null>(null);
  const [erroColunas, setErroColunas] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [importando, setImportando] = useState(false);
  const [erroImportar, setErroImportar] = useState<{ tipo: "rede" | "erro"; msg: string } | null>(null);
  const [avisoTopo, setAvisoTopo] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportarVendas | null>(null);
  const [tentarPrevia, setTentarPrevia] = useState(0);
  const trava = useRef(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const tituloPasso = useRef<HTMLHeadingElement>(null);

  const origem = origensQ.data?.origens.find((o) => o.id === sistema) ?? null;
  const nomeSistema = sistema === PADRAO ? "Planilha padrão do Comanda" : (origem?.nome ?? "");
  const tipo = TIPOS.find((t) => t.formato === formato) ?? TIPOS[0]!;

  // o último sistema usado já vem marcado
  useEffect(() => {
    if (sistema === null && origensQ.data) {
      const s = sistemaInicial(origensQ.data);
      setSistema(s);
      const o = origensQ.data.origens.find((x) => x.id === s);
      setFormato(TIPOS.some((t) => t.formato === o?.formato_padrao) ? o!.formato_padrao : "planilha");
    }
  }, [origensQ.data, sistema]);

  // saída sem importar pede confirmação do navegador (UX 2.1)
  useEffect(() => {
    if (!arquivo || resultado) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [arquivo, resultado]);

  useEffect(() => { tituloPasso.current?.focus(); }, [passo]);

  const planilha = useMemo(() => (tabela ? linhasParaEnvio(tabela, iCab, sep, sistema === PADRAO) : null), [tabela, iCab, sep, sistema]);

  /** O corpo da prévia (o confirmar manda o mesmo + chave, caixa e de-para). */
  const corpo = useMemo<CorpoImportarVendas | null>(() => {
    if (!arquivo || !sistema) return null;
    const base = { origem_id: sistema === PADRAO ? null : sistema, arquivo: arquivo.nome, ...(arquivo.sha256 ? { arquivo_sha256: arquivo.sha256 } : {}) };
    if (formato === "planilha" && planilha) {
      return {
        ...base, formato, modo: escolhas.modo, linhas_brutas: planilha.linhas, primeira_linha: planilha.primeiraLinha,
        ...(sistema === PADRAO ? {} : { mapeamento: mapa, separador_decimal: sep }),
      };
    }
    if (formato === "pdf" && lido) {
      return {
        ...base, formato, modo: escolhas.modo,
        linhas: linhasPdf.map((l) => ({
          pedido: l.pedido, data: l.data, hora: l.hora, produto_relatorio: l.produto.trim(),
          quantidade: numeroDigitado(l.quantidade) ?? "", valor_total: numeroDigitado(l.valor) ?? "",
        })),
        ...(dataPadrao ? { data_padrao: dataPadrao } : {}),
      };
    }
    if (formato === "xml" && xml) {
      return { ...base, formato, modo: "acrescentar", ...xml, cnpjs_incluidos: escolhas.cnpjsIncluidos, nfe_incluidas: escolhas.nfeIncluidas };
    }
    return null;
  }, [arquivo, sistema, formato, planilha, xml, lido, linhasPdf, dataPadrao, escolhas.modo, escolhas.cnpjsIncluidos, escolhas.nfeIncluidas, mapa, sep]);

  // a prévia se refaz sozinha (500 ms depois da última mudança; o pedido anterior é cancelado: UX 7.25)
  useEffect(() => {
    if (passo !== "previa" || !corpo) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setCarregandoPrevia(true);
      setErroPrevia(null);
      setErroPreviaCodigo(null);
      try {
        const p = await previaImportarVendas(corpo, ctl.signal);
        if (ctl.signal.aborted) return;
        setPrevia(p);
        setChave(novaChave());
        setEscolhas((e) => {
          const dp = { ...e.deParaEscolha };
          for (const x of p.produtos_sem_de_para) if (!(x.produto_relatorio in dp)) dp[x.produto_relatorio] = x.sugestao_item_cardapio_id ?? "";
          return { ...e, deParaEscolha: dp };
        });
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (errCode(e) === "MAPEAMENTO_INCOMPLETO" && formato === "planilha") {
          setErroColunas(errMsg(e));
          setPasso("colunas");
        } else {
          setErroPrevia(errMsg(e));
          setErroPreviaCodigo(errCode(e));
        }
      } finally {
        if (!ctl.signal.aborted) setCarregandoPrevia(false);
      }
    }, 500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [passo, corpo, formato, tentarPrevia]);

  function recomecar(manterSistema = true) {
    setPasso("arquivo");
    setArquivo(null); setTabela(null); setMapa({}); setSugeridos(new Set()); setSumiram({}); setXml(null); setLeitura(null);
    setLido(null); setLinhasPdf([]); setDataPadrao(""); setErroIa(null);
    setPrevia(null); setErroPrevia(null); setErroColunas(null); setResultado(null); setErroImportar(null); setAvisoTopo(null);
    setEscolhas(ESCOLHAS_INICIAIS); setErroArquivo(null);
    if (!manterSistema) setSistema(null);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  /** XML (UX 2.4): lê no aparelho, um por um, com o andamento; o .zip é aberto aqui mesmo. Nada some calado. */
  async function lerXmls(files: File[]) {
    pararLeitura.current = false;
    const textos: { nome: string; texto: string }[] = [];
    const ignorados: EnvioXml["ignorados"] = [];
    const dec = new TextDecoder("utf-8");
    let sha: string | undefined;
    try {
      for (const f of files) {
        const buf = await f.arrayBuffer();
        if (/\.zip$/i.test(f.name)) {
          if (files.length === 1) sha = await sha256Hex(buf);
          const z = await lerZip(buf);
          for (const a of z.arquivos) {
            if (/\.xml$/i.test(a.nome)) textos.push({ nome: a.nome, texto: dec.decode(a.dados) });
            else ignorados.push({ arquivo: a.nome, motivo: MOTIVO_XML.naoXml });
          }
          for (const g of z.grandes) ignorados.push({ arquivo: g, motivo: "arquivo grande demais (mais de 1 MB)" });
        } else if (/\.xml$/i.test(f.name) || f.type.includes("xml")) {
          textos.push({ nome: f.name, texto: dec.decode(buf) });
        } else ignorados.push({ arquivo: f.name, motivo: MOTIVO_XML.naoXml });
      }
    } catch (e) {
      setErroArquivo(e instanceof ZipErro ? e.message : "Não consigo abrir este .zip. Exporte os XML sem senha, ou descompacte e escolha os .xml soltos.");
      return;
    }
    if (!textos.length && !ignorados.length) {
      setErroArquivo("Este arquivo não é XML. Escolha os XML dos cupons ou o .zip do mês, ou troque o tipo acima.");
      return;
    }
    setPasso("lendo");
    setLeitura({ lidos: 0, total: textos.length });
    const env: EnvioXml = { arquivos_lidos: 0, documentos: [], cancelamentos: [], ignorados };
    for (let i = 0; i < textos.length; i++) {
      if (pararLeitura.current) { recomecar(); return; }
      const r = lerXmlVenda(textos[i]!.nome, textos[i]!.texto);
      if (r.tipo === "documento") env.documentos.push(r.documento);
      else if (r.tipo === "cancelamento") env.cancelamentos.push(r.cancelamento);
      else env.ignorados.push(r.ignorado);
      if (i % 50 === 49) { setLeitura({ lidos: i + 1, total: textos.length }); await new Promise((ok) => setTimeout(ok, 0)); }
    }
    env.arquivos_lidos = env.documentos.length + env.cancelamentos.length + env.ignorados.length;
    setXml(env);
    setArquivo({ nome: files.length === 1 ? files[0]!.name : `${files.length} arquivos XML`, sha256: sha ?? "" });
    setEscolhas(ESCOLHAS_INICIAIS);
    setPrevia(null);
    setPasso("previa");
  }

  /** PDF (UX 2.5): a IA lê (até 1 minuto) e a pessoa confere linha a linha; a leitura não grava nada. */
  async function lerPdf(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setErroArquivo("Este arquivo não é um PDF. Escolha o relatório em PDF.");
      return;
    }
    if (file.size > TETO_PDF) {
      setErroArquivo(`O PDF tem ${Math.ceil(file.size / 1024 / 1024)} MB, e o limite é 10 MB. Exporte um período menor.`);
      return;
    }
    pdfAtual.current = file;
    setErroIa(null);
    setPasso("ia");
    try {
      const r = await lerRelatorioVendasPdf(file);
      setLido(r);
      setLinhasPdf(r.linhas.map((l) => ({
        id: crypto.randomUUID(), pedido: l.pedido, data: l.data, hora: l.hora, produto: l.produto,
        quantidade: numeroParaCampo(l.quantidade), valor: numeroParaCampo(l.valor_total),
      })));
      setDataPadrao("");
      setArquivo({ nome: file.name, sha256: await sha256Hex(await file.arrayBuffer()) });
      setEscolhas(ESCOLHAS_INICIAIS);
      setPrevia(null);
      setPasso("conferir");
    } catch (e) {
      setErroIa({ msg: errMsg(e), codigo: errCode(e) });
    }
  }

  async function escolherArquivo(file: File) {
    setErroArquivo(null);
    if (formato === "pdf") return lerPdf(file);
    if (formato === "planilha") {
      if (!/\.(csv|txt|xlsx|xls)$/i.test(file.name)) {
        setErroArquivo("Este arquivo não é uma planilha (CSV ou Excel). Escolha outro arquivo ou troque o tipo acima.");
        return;
      }
      let t: Celula[][];
      let buf: ArrayBuffer;
      try {
        buf = await file.arrayBuffer();
        t = await lerTabelaDeBuffer(file.name, buf);
      } catch {
        setErroArquivo("Este arquivo não é uma planilha (CSV ou Excel). Escolha outro arquivo ou troque o tipo acima.");
        return;
      }
      const padrao = sistema === PADRAO;
      const i = padrao ? 0 : acharCabecalho(t);
      const { colunas, linhas } = linhasParaEnvio(t, i, "virgula", padrao);
      if (!linhas.length) {
        setErroArquivo("Esta planilha não tem linhas de venda. Confira se exportou o período certo.");
        return;
      }
      setArquivo({ nome: file.name, sha256: await sha256Hex(buf) });
      setTabela(t);
      setICab(i);
      setEscolhas(ESCOLHAS_INICIAIS);
      setPrevia(null);
      if (padrao) {
        setPasso("previa");
        return;
      }
      const salvo = origem?.mapeamento ?? null;
      const sug = sugerirMapeamento(colunas);
      const presentes = salvo ? (Object.entries(salvo) as [CampoVenda, string][]).filter(([, c]) => colunas.includes(c)) : [];
      const faltando = salvo ? (Object.entries(salvo) as [CampoVenda, string][]).filter(([, c]) => !colunas.includes(c)) : [];
      const m: Mapeamento = salvo ? Object.fromEntries(presentes) : sug;
      setMapa(m);
      setSugeridos(new Set(salvo ? [] : (Object.keys(sug) as CampoVenda[])));
      setSumiram(Object.fromEntries(faltando));
      setSep(salvo ? (origem?.separador_decimal ?? "virgula") : deduzirSeparador(m.valor_total ? linhas.map((l) => l[m.valor_total!] ?? "").slice(0, 50) : []));
      // colunas lembradas e todas presentes: pula direto para a prévia (o passo 2 fica no link "Ver as colunas")
      setPasso(salvo && faltando.length === 0 ? "previa" : "colunas");
    }
  }

  async function importar() {
    if (!corpo || trava.current) return;
    trava.current = true;
    setImportando(true);
    setErroImportar(null);
    setAvisoTopo(null);
    try {
      const de_para_novos = (previa?.produtos_sem_de_para ?? []).map((x) => ({
        produto_relatorio: x.produto_relatorio, item_cardapio_id: escolhas.deParaEscolha[x.produto_relatorio] || null,
      }));
      const r = await confirmarImportarVendas({
        ...corpo,
        ...(formato === "planilha" && sistema !== PADRAO ? { salvar_mapeamento: lembrar } : {}),
        chave_idempotencia: chave,
        confirmar_sobreposicao: escolhas.sobreposicaoMarcada,
        de_para_novos,
      });
      setResultado(r);
      setPasso("resultado");
      toast.success(`${plural(r.inseridas, "venda importada", "vendas importadas")}.`);
      void qc.invalidateQueries({ queryKey: ["vendas-origens"] });
      void qc.invalidateQueries({ queryKey: ["vendas-importacoes"] });
      void qc.invalidateQueries({ queryKey: ["vendas"] });
      void qc.invalidateQueries({ queryKey: ["depara"] });
    } catch (e) {
      const st = statusDoErro(e);
      if (st === null || st === 502 || st === 503 || st === 504) {
        setErroImportar({ tipo: "rede", msg: "Não consegui falar com o servidor. As vendas podem ter sido importadas ou não. Tentar de novo não importa em dobro." });
      } else if (errCode(e) === "IMPORTACAO_SOBREPOSICAO") {
        setAvisoTopo("Entraram vendas de outro lugar neste período desde a prévia. Confira o aviso e marque a caixa.");
        setEscolhas((x) => ({ ...x, sobreposicaoMarcada: false }));
        setTentarPrevia((n) => n + 1);
      } else setErroImportar({ tipo: "erro", msg: errMsg(e) });
    } finally {
      trava.current = false;
      setImportando(false);
    }
  }

  if (me && !admin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Importar vendas" />
        <p className="rounded-lg border p-4 text-sm">Esta tela é só do administrador.</p>
      </div>
    );
  }

  const n = NUMERO_PASSO[passo];
  return (
    <div className={cn("space-y-5", passo === "previa" && "pb-28 md:pb-0")} style={{ scrollPaddingBottom: "7rem" }}>
      <Link href="/vendas" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">← Vendas</Link>
      <PageHeader title="Importar vendas" sub="Traga as vendas de outro sistema. Nada é gravado antes de você conferir." />
      <div className="space-y-1">
        <h2 ref={tituloPasso} tabIndex={-1} className="text-sm font-medium outline-none">Passo {n} de 3 · {NOME_PASSO[passo]}</h2>
        <Progress value={(n / 3) * 100} aria-label={`Passo ${n} de 3`} />
      </div>

      {passo === "arquivo" && (
        <div className="space-y-5">
          <Sistemas
            dados={origensQ.data}
            carregando={origensQ.isLoading}
            erro={origensQ.isError}
            onTentar={() => origensQ.refetch()}
            valor={sistema}
            onEscolher={(id, f) => { setSistema(id); setFormato(TIPOS.some((t) => t.formato === f) ? f : "planilha"); setErroArquivo(null); }}
            onMudou={() => void origensQ.refetch()}
          />
          <section aria-labelledby="titulo-tipo" className="space-y-2">
            <h2 id="titulo-tipo" className="font-semibold">Que tipo de arquivo?</h2>
            <div role="radiogroup" aria-labelledby="titulo-tipo" className="grid gap-2 md:grid-cols-3">
              {TIPOS.map((t) => {
                const bloqueado = sistema === PADRAO && t.formato !== "planilha";
                const marcado = formato === t.formato;
                return (
                  <button key={t.formato} type="button" role="radio" aria-checked={marcado} aria-disabled={bloqueado}
                    onClick={() => !bloqueado && setFormato(t.formato)}
                    className={cn("flex min-h-14 items-start gap-3 rounded-lg border p-3 text-left", marcado && "border-primary bg-primary/5", bloqueado && "opacity-50")}>
                    {marcado ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden /> : <t.icone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
                    <span><span className="block font-medium">{t.titulo}</span><span className="block text-sm text-muted-foreground">{t.texto}</span></span>
                  </button>
                );
              })}
            </div>
            {sistema === PADRAO && TIPOS.length > 1 && <p className="text-sm text-muted-foreground">A planilha padrão só aceita planilha.</p>}
            <p className="text-sm text-muted-foreground">
              Prefira o XML: é exato e o Comanda reconhece cupom repetido ou cancelado. A planilha vem em seguida. O PDF é lido pela IA e você confere linha a linha.
            </p>
          </section>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:border-0 md:p-0">
            <input ref={inputArquivo} id="arquivo-vendas" type="file" accept={tipo.accept} className="sr-only" disabled={!sistema}
              multiple={formato === "xml"}
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (!fs.length) return;
                if (formato === "xml") void lerXmls(fs);
                else void escolherArquivo(fs[0]!);
              }} />
            <Button className="h-11 w-full md:w-auto" disabled={!sistema} onClick={() => inputArquivo.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden /> {tipo.botao}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{tipo.ajuda} Ao escolher, o Comanda já lê o arquivo e mostra o próximo passo.</p>
          </div>
          {erroArquivo && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /> {erroArquivo}
            </div>
          )}
          <div className="pb-28 md:pb-0"><UltimasImportacoes dados={recentesQ.data} /></div>
        </div>
      )}

      {passo === "lendo" && leitura && (
        <section aria-labelledby="titulo-lendo" className="space-y-3">
          <h2 id="titulo-lendo" className="text-lg font-semibold">Lendo os arquivos</h2>
          <p>Lendo {leitura.lidos.toLocaleString("pt-BR")} de {leitura.total.toLocaleString("pt-BR")} arquivos…</p>
          <Progress value={leitura.total ? (leitura.lidos / leitura.total) * 100 : 100} aria-label="Andamento da leitura" />
          <p className="sr-only" aria-live="polite">{leitura.total && leitura.lidos >= leitura.total / 2 ? "Metade dos arquivos lida." : ""}</p>
          <p className="text-sm text-muted-foreground">A leitura acontece neste aparelho. Não feche a tela.</p>
          <Button variant="outline" className="h-11" onClick={() => { pararLeitura.current = true; }}>Parar a leitura</Button>
        </section>
      )}

      {passo === "ia" && (
        <section aria-labelledby="titulo-ia" className="space-y-3">
          <h2 id="titulo-ia" className="text-lg font-semibold">Conferir a leitura</h2>
          {!erroIa ? (
            <div aria-live="polite" className="space-y-1">
              <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> A IA está lendo o relatório (pode levar até 1 minuto)…</p>
              <p className="text-sm text-muted-foreground">Você confere tudo antes de importar.</p>
              <Button variant="ghost" className="h-11" aria-disabled>Aguarde a leitura</Button>
            </div>
          ) : (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold">{erroIa.msg}</p>
              {erroIa.codigo === "PDF_NAO_CONFIGURADO" && <p>Use a planilha ou o XML do sistema.</p>}
              {erroIa.codigo === "PDF_ILEGIVEL" && <p>Relatório grande? Exporte um dia por vez, ou exporte em planilha.</p>}
              <div className="flex flex-wrap gap-2">
                {erroIa.codigo === "PDF_ILEGIVEL" ? (
                  <Button variant="outline" className="h-11" onClick={() => recomecar()}>Escolher outro PDF</Button>
                ) : erroIa.codigo !== "PDF_NAO_CONFIGURADO" && erroIa.codigo !== "ARQUIVO_INVALIDO" ? (
                  <Button variant="outline" className="h-11" onClick={() => pdfAtual.current && void lerPdf(pdfAtual.current)}>Tentar de novo</Button>
                ) : null}
                <Button variant="outline" className="h-11" onClick={() => { recomecar(); setFormato("planilha"); }}>Trocar para planilha</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {passo === "conferir" && lido && (
        <ConferirPdf lido={lido} linhas={linhasPdf} onLinhas={setLinhasPdf} dataPadrao={dataPadrao} onDataPadrao={setDataPadrao}
          onPrevia={() => { setPrevia(null); setPasso("previa"); }} />
      )}

      {passo !== "arquivo" && passo !== "resultado" && passo !== "lendo" && passo !== "ia" && (
        <Button variant="ghost" className="h-11" onClick={() => {
          if (passo === "previa" && formato === "planilha" && sistema !== PADRAO) return setPasso("colunas");
          if (passo === "previa" && formato === "pdf") return setPasso("conferir");
          recomecar();
        }}>
          ← Voltar
        </Button>
      )}

      {passo === "colunas" && planilha && arquivo && (
        <Colunas
          arquivo={arquivo.nome}
          colunas={planilha.colunas}
          linhas={planilha.linhas}
          mapa={mapa}
          sugeridos={sugeridos}
          sumiram={sumiram}
          sep={sep}
          lembrar={lembrar}
          sistema={nomeSistema}
          erro={erroColunas}
          onMapa={(m) => { setMapa(m); setSugeridos((s) => new Set([...s].filter((c) => m[c] === mapa[c]))); setErroColunas(null); }}
          onSep={setSep}
          onLembrar={setLembrar}
          onPrevia={() => { setPrevia(null); setPasso("previa"); }}
        />
      )}

      {passo === "previa" && arquivo && (
        <PreviaImportacao
          previa={previa}
          carregando={carregandoPrevia}
          erro={erroPrevia}
          acaoErro={erroPreviaCodigo === "LOJA_SEM_CNPJ" ? <Button asChild className="h-11"><Link href="/empresas">Ir para Empresas</Link></Button> : undefined}
          onTentar={() => setTentarPrevia((x) => x + 1)}
          sistema={nomeSistema}
          formato={formato}
          arquivo={arquivo.nome}
          cardapio={cardapioQ.data ?? []}
          escolhas={escolhas}
          onEscolhas={setEscolhas}
          importando={importando}
          erroImportar={erroImportar}
          avisoTopo={avisoTopo}
          onImportar={importar}
          onVoltar={() => setPasso(formato === "pdf" ? "conferir" : "colunas")}
          textoVoltar={formato === "planilha" && sistema !== PADRAO ? "Ver as colunas" : formato === "pdf" ? "Ver a leitura" : null}
          onSubstituirDialogo={() => setDialogo(true)}
          dialogoAberto={dialogo}
          onFecharDialogo={() => setDialogo(false)}
        />
      )}

      {passo === "resultado" && resultado && (
        <Resultado r={resultado} previa={previa} sistema={nomeSistema} onOutro={() => recomecar(true)} />
      )}
    </div>
  );
}
