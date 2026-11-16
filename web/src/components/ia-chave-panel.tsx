'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2 } from "lucide-react";
import { removerChaveIa, salvarChaveIa, statusIa, type ProvedorIa } from "@/lib/erp-api";
import { Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errMsg } from "@/lib/db";
import { dataBR } from "@/lib/format";

/** Onde cada IA entrega a chave e como ela começa (só para o exemplo no campo). */
const IAS: { id: ProvedorIa; nome: string; exemplo: string; onde: string }[] = [
  { id: "openai", nome: "ChatGPT (OpenAI)", exemplo: "sk-...", onde: "https://platform.openai.com/api-keys" },
  { id: "gemini", nome: "Gemini (Google)", exemplo: "AIza...", onde: "https://aistudio.google.com/apikey" },
  { id: "anthropic", nome: "Claude (Anthropic)", exemplo: "sk-ant-...", onde: "https://console.anthropic.com/settings/keys" },
];

/**
 * Configurações → Leitura de notas por IA (PDF e foto): a empresa usa a chave de uma IA que ela já tem (ChatGPT, Gemini ou Claude).
 * Salvar = o servidor lê um PDF de teste com a chave e só grava se der certo. A chave nunca volta para a tela.
 */
export function IaChavePanel() {
  const { data: st, refetch } = useQuery({ queryKey: ["ia-chave"], queryFn: statusIa });
  const [provedor, setProvedor] = useState<ProvedorIa>("openai");
  const [chave, setChave] = useState("");
  const [testando, setTestando] = useState(false);
  const ia = IAS.find((x) => x.id === provedor)!;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!chave.trim()) return;
    setTestando(true);
    try {
      await salvarChaveIa(provedor, chave.trim());
      setChave("");
      toast.success("Chave salva: a IA leu o PDF de teste.");
      refetch();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setTestando(false);
    }
  }

  async function remover() {
    if (!confirm("Remover a chave de IA? A leitura de PDF para de funcionar até cadastrar outra.")) return;
    try {
      await removerChaveIa();
      toast.success("Chave removida");
      refetch();
    } catch (error) {
      toast.error(errMsg(error));
    }
  }

  return (
    <Panel title="Leitura de notas por IA (PDF e foto)">
      <p className="mb-3 text-sm text-muted-foreground">
        Em Entrada de Notas e Contas a Pagar, a IA lê o PDF ou a foto da nota (e o PDF do DDA) e preenche os campos. Use a chave de uma IA que a
        empresa já tenha: cada leitura é cobrada na conta dessa IA (alguns centavos).
      </p>

      {st?.origem === "configuracoes" && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <div className="font-medium">Ligada com {st.nome}</div>
              <div className="text-xs text-muted-foreground">
                Chave {st.dica} · modelo {st.modelo}{st.atualizado_em ? ` · salva em ${dataBR(st.atualizado_em)}` : ""}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={remover}>Remover chave</Button>
        </div>
      )}
      {st?.origem === "servidor" && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div>
            <div className="font-medium">Ligada com a chave do servidor ({st.nome})</div>
            <div className="text-xs text-muted-foreground">Cadastre abaixo a chave da empresa para usar outra IA ou a sua própria conta.</div>
          </div>
        </div>
      )}
      {st && st.origem === null && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <div className="font-medium">Desligada</div>
            <div className="text-xs text-muted-foreground">Sem chave, a leitura de PDF não funciona; dá para lançar as notas à mão.</div>
          </div>
        </div>
      )}

      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <Label htmlFor="ia-provedor" className="text-xs text-muted-foreground">IA</Label>
          <select id="ia-provedor" className="h-9 w-full rounded-md border bg-background px-2" value={provedor} disabled={testando}
            onChange={(e) => setProvedor(e.target.value as ProvedorIa)}>
            {IAS.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="ia-chave" className="text-xs text-muted-foreground">
            {st?.origem === "configuracoes" ? "Nova chave (troca a atual)" : "Chave da API"}
          </Label>
          <Input id="ia-chave" type="password" autoComplete="off" spellCheck={false} placeholder={ia.exemplo} value={chave} disabled={testando}
            onChange={(e) => setChave(e.target.value)} />
        </div>
        <Button type="submit" disabled={testando || !chave.trim()} className="w-full sm:w-auto">
          {testando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testando…</> : "Testar e salvar"}
        </Button>
      </form>
      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{testando ? "A IA está lendo um PDF de teste; pode levar até 1 minuto." : "Antes de salvar, o sistema testa a chave lendo um PDF de exemplo."}</span>
        <a href={ia.onde} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          Onde pego a chave do {ia.nome.split(" ")[0]}? <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </Panel>
  );
}
