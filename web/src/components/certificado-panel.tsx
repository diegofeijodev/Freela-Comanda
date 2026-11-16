'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { enviarCertificado, removerCertificado, type CertificadoStatus } from "@/lib/erp-api";
import { Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errCode, errMsg, getConfig } from "@/lib/db";
import { useCertificado, CERTIFICADO_QUERY_KEY } from "@/hooks/use-certificado";
import {
  arquivoParaBase64, dataHoraSp, dataSp, faltamDias, formatarCnpj, linhasDoHistorico, nomeDoTipo, resumoDoCertificado, validarArquivoCertificado,
} from "@/lib/certificado";

type Erro = { code: string | null; msg: string };
const MSG_REDE = "Não consegui falar com o servidor. Confira a internet e toque em Conferir e guardar certificado de novo. Seus dados continuam aqui.";

const tamanho = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Configurações → Certificado digital (A1). O arquivo e a senha só existem em memória até o envio: o arquivo é lido para base64 só
 * na hora de enviar, e os dois são descartados no sucesso. Nada vai para storage, console nem URL.
 */
export function CertificadoPanel() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const cnpjEmpresa = cfg?.cnpj ?? "";
  const { data: cert, isError, isPending, refetch } = useCertificado(true);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<Erro | null>(null);
  const [removerAberto, setRemoverAberto] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const donoRef = useRef<HTMLDivElement>(null);
  const erroRef = useRef<HTMLDivElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const focarEscolher = useRef(false);

  // Foco no erro (ou, quando a senha estava errada, direto no campo da senha, já vazio).
  useEffect(() => {
    if (!erro) return;
    if (erro.code === "CERTIFICADO_SENHA") senhaRef.current?.focus();
    else erroRef.current?.focus();
  }, [erro]);
  useEffect(() => {
    if (focarEscolher.current && cert?.situacao === "ausente") {
      focarEscolher.current = false;
      document.getElementById("certificado-escolher")?.focus();
    }
  }, [cert]);

  const resumo = cert ? resumoDoCertificado(cert, cnpjEmpresa) : null;
  const guardado = !!cert && cert.titular !== null && cert.situacao !== "ausente" && cert.situacao !== "sem_segredo";
  const mostrarForm = !!cert && (cert.situacao === "ausente" || cert.situacao === "sem_segredo" || trocando);
  const semSegredo = cert?.situacao === "sem_segredo";
  const substituindo = guardado;
  const completo = !!arquivo && senha.length > 0;

  function limpar() {
    setArquivo(null);
    setSenha("");
    setVerSenha(false);
    setErro(null);
  }

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    const problema = validarArquivoCertificado(f);
    if (problema) {
      setArquivo(null);
      setErro({ code: "ARQUIVO_LOCAL", msg: problema });
      return;
    }
    setArquivo(f);
    setErro(null);
  }

  async function enviar() {
    if (!arquivo || !senha || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await enviarCertificado(await arquivoParaBase64(arquivo), senha);
      limpar(); // a senha sai do estado ANTES de o formulário sair da tela: o campo nunca é desmontado com valor
      setTrocando(false);
      qc.setQueryData<CertificadoStatus>(CERTIFICADO_QUERY_KEY, resposta);
      toast.success(substituindo ? "Certificado trocado." : "Certificado guardado.");
      donoRef.current?.focus();
    } catch (error) {
      const code = errCode(error);
      let msg = code === "SEM_CONEXAO" ? MSG_REDE : errMsg(error);
      if (substituindo) msg += " O certificado atual não foi alterado.";
      if (code === "CERTIFICADO_SENHA") setSenha("");
      if (code === "CERTIFICADO_SEM_SEGREDO") qc.invalidateQueries({ queryKey: CERTIFICADO_QUERY_KEY });
      setErro({ code, msg });
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    setRemovendo(true);
    try {
      const resposta = await removerCertificado();
      focarEscolher.current = true;
      limpar();
      setTrocando(false);
      qc.setQueryData<CertificadoStatus>(CERTIFICADO_QUERY_KEY, resposta);
      toast.success("Certificado removido.");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setRemovendo(false);
      setRemoverAberto(false);
    }
  }

  const desligado = enviando || semSegredo;
  const tipo = cert?.tipo === "SE-S" ? "Selo eletrônico (SE-S)" : cert?.tipo === "A1" ? "Certificado A1" : `Certificado ${nomeDoTipo(cert?.politica_oid ?? null) ?? "de outro tipo"}`;
  const primario = !!resumo && (resumo.tom === "bad" || resumo.acao === "renovar");
  const rotuloAbrir = resumo?.acao === "renovar" ? "Enviar certificado renovado" : resumo?.acao === "enviar_de_novo" ? "Enviar o certificado de novo" : "Substituir certificado";
  const historico = cert ? linhasDoHistorico(cert.historico) : [];

  return (
    <div id="certificado-digital" tabIndex={-1} ref={donoRef} className="outline-none">
      <Panel title="Certificado digital (A1)">
        <p className="mb-3 text-sm text-muted-foreground">
          É o arquivo digital da empresa que assina notas e fala com a SEFAZ. Ainda não usamos para nada, mas guardar agora deixa tudo pronto para buscar
          notas na SEFAZ e emitir cupom fiscal (recursos que virão; sem data).
        </p>

        {isPending && <div className="space-y-2" aria-busy="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>}
        {isError && !cert && (
          <div className="flex flex-col gap-2 text-sm">
            <p>Não consegui ver o certificado agora. Toque em Tentar de novo.</p>
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => refetch()}>Tentar de novo</Button>
          </div>
        )}

        {cert && resumo && (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={resumo.tom === "neutro" ? "muted" : resumo.tom}>
                {resumo.tom === "ok" && <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />}
                {(resumo.tom === "warn" || resumo.tom === "bad") && <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />}
                {resumo.etiqueta}
              </Tag>
            </div>

            {resumo.problema && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span className="min-w-0 break-words">{resumo.problema}</span>
              </div>
            )}

            {guardado && (
              <div className="min-w-0 space-y-1 break-words text-sm">
                <div className="text-base font-medium">{cert.titular}</div>
                {cert.cnpj && <div>CNPJ {formatarCnpj(cert.cnpj)}</div>}
                {cert.situacao !== "ilegivel" && (
                  <>
                    <div className="text-muted-foreground">{tipo}{cert.emissor ? ` · emitido por ${cert.emissor}` : ""}</div>
                    {cert.valido_ate && (
                      <div>
                        {cert.situacao === "vencido" ? "Venceu em" : "Vale até"} {dataSp(cert.valido_ate)}
                        {cert.situacao !== "vencido" && cert.dias_restantes !== null ? ` (${faltamDias(cert.dias_restantes)})` : ""}
                      </div>
                    )}
                    {cert.cadeia_conferida === true && <div className="text-muted-foreground">Cadeia ICP-Brasil conferida</div>}
                    {cert.enviado_por_nome && cert.enviado_em && <div className="text-muted-foreground">Enviado por {cert.enviado_por_nome} em {dataHoraSp(cert.enviado_em)}</div>}
                  </>
                )}
              </div>
            )}

            {resumo.avisos.length > 0 && (
              <ul className="space-y-2">
                {resumo.avisos.map((a) => (
                  <li key={a} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                    <span className="min-w-0 break-words">{a}</span>
                  </li>
                ))}
              </ul>
            )}

            {guardado && !trocando && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant={primario ? "default" : "outline"} className="h-11 w-full whitespace-normal sm:w-auto" onClick={() => setTrocando(true)}>{rotuloAbrir}</Button>
                <Button variant="outline" className="h-11 w-full whitespace-normal text-destructive hover:text-destructive sm:w-auto" onClick={() => setRemoverAberto(true)}>Remover</Button>
              </div>
            )}

            {mostrarForm && (
              <div className="space-y-3 border-t pt-4" role="group" aria-describedby="certificado-ajuda-cnpj">
                {trocando && (
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">Novo certificado</h3>
                    {(cert.situacao === "valido" || cert.situacao === "vencendo") && (
                      <p className="text-sm text-muted-foreground">
                        O certificado atual ({cert.titular}{cert.valido_ate ? `, vale até ${dataSp(cert.valido_ate)}` : ""}) continua valendo até o novo passar na conferência.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Label htmlFor="certificado-arquivo" className="text-sm">Arquivo do certificado (.pfx ou .p12)</Label>
                  <input id="certificado-arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" className="sr-only" tabIndex={-1} onChange={escolher} disabled={desligado} />
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button id="certificado-escolher" type="button" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto" disabled={desligado}
                      onClick={() => document.getElementById("certificado-arquivo")?.click()}>
                      {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
                    </Button>
                    {arquivo && <span className="min-w-0 break-all text-sm" data-testid="certificado-nome">{arquivo.name} · {tamanho(arquivo.size)}</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Pergunte ao seu contador por &apos;certificado A1 com a senha&apos;.</p>
                </div>

                <div>
                  <Label htmlFor="certificado-senha" className="text-sm">Senha do certificado</Label>
                  <div className="mt-1 flex gap-2">
                    <Input id="certificado-senha" ref={senhaRef} name="cert-segredo" type={verSenha ? "text" : "password"} autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autoCapitalize="none"
                      autoCorrect="off" spellCheck={false} maxLength={128} className="h-11 min-w-0 flex-1 text-base" value={senha} disabled={desligado}
                      onChange={(e) => setSenha(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (completo && !desligado) void enviar(); } }} />
                    <Button type="button" variant="outline" className="h-11 w-11 shrink-0 px-0" aria-pressed={verSenha} aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                      disabled={desligado} onClick={() => setVerSenha((v) => !v)}>
                      {verSenha ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    </Button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">É a senha que veio com o arquivo. Não guardamos a senha.</p>
                </div>

                {erro && (
                  <div ref={erroRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm outline-none">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                    <span className="min-w-0 break-words">{erro.msg}</span>
                  </div>
                )}

                <p id="certificado-ajuda-cnpj" className="text-sm text-muted-foreground">
                  O certificado é conferido com o CNPJ já salvo no quadro Empresa. Mudou o CNPJ? Toque em Salvar no alto da página antes de enviar. Este quadro tem
                  botões próprios: o Salvar não envia o certificado.
                </p>

                <div className="flex flex-col gap-2">
                  <Button type="button" className="h-11 w-full whitespace-normal" disabled={!completo || desligado} onClick={() => void enviar()}>
                    {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Conferindo…</> : trocando ? "Conferir e trocar certificado" : "Conferir e guardar certificado"}
                  </Button>
                  {!completo && !enviando && !semSegredo && <p className="text-sm text-muted-foreground">Escolha o arquivo e digite a senha.</p>}
                  {trocando && !enviando && <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => { limpar(); setTrocando(false); }}>Cancelar</Button>}
                </div>
              </div>
            )}

            <p aria-live="polite" className="text-sm text-muted-foreground">{enviando ? "Conferindo o certificado. Leva alguns segundos." : ""}</p>

            {historico.length > 0 && (
              <details className="text-sm">
                <summary className="flex min-h-11 cursor-pointer items-center text-primary">Ver histórico</summary>
                <ul className="mt-1 space-y-1 break-words">{historico.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </Panel>

      <AlertDialog open={removerAberto} onOpenChange={(o) => !removendo && setRemoverAberto(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o certificado digital?</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos apagar o certificado de {cert?.titular} (CNPJ {formatarCnpj(cert?.cnpj ?? "")}) do sistema. Hoje nada depende dele. Quando existirem
              &apos;buscar notas na SEFAZ&apos; e &apos;emitir cupom fiscal&apos; (ainda não existem, sem data), eles não vão funcionar até você enviar um certificado de
              novo. Para enviar de novo você precisa do arquivo .pfx e da senha; o sistema não devolve o arquivo. A remoção fica registrada com seu nome.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo} className="h-11">Manter certificado</AlertDialogCancel>
            <AlertDialogAction disabled={removendo} className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); remover(); }}>
              {removendo ? "Removendo…" : "Remover certificado"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
