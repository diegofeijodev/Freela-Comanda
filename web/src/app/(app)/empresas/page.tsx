'use client';

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  excluirEmpresa, listarEmpresas, salvarEmpresa, type Empresa, type EmpresaForm, type RegimeTributario,
} from "@/lib/erp-api";
import { errMsg } from "@/lib/db";
import { formatarCnpj } from "@/lib/certificado";
import { cnpjValido, cpfValido, normalizarCnpj } from "@/lib/fiscal";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const REGIMES: Record<RegimeTributario, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  simples_excesso: "Simples Nacional — excesso de sublimite",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

const VAZIA: EmpresaForm = {
  razao_social: "", nome_fantasia: "", cnpj: "", inscricao_estadual: "", inscricao_municipal: "", regime_tributario: null, cnae: "", data_abertura: null,
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: null, cod_municipio: "",
  telefone: "", celular: "", email: "", site: "", responsavel_nome: "", responsavel_cpf: "", contador_nome: "", contador_email: "", contador_telefone: "",
  observacoes: "", ativo: true,
};

const cepFmt = (c: string | null) => (c && c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c ?? "");
const cpfFmt = (c: string | null) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c ?? "");

function paraForm(e: Empresa): EmpresaForm {
  const { id: _id, principal: _p, created_at: _c, updated_at: _u, _count, schema_banco: _s, ...resto } = e;
  void _id; void _p; void _c; void _u; void _count; void _s;
  return { ...resto, cnpj: formatarCnpj(e.cnpj), cep: cepFmt(e.cep), responsavel_cpf: cpfFmt(e.responsavel_cpf) };
}

/**
 * Cadastro de empresas (só o master). Cada empresa tem os próprios dados (estoque, vendas, notas…) e os próprios usuários; o master
 * escolhe a empresa em uso no seletor abaixo do logo. A "principal" é a que ficou com os dados de antes do multiempresa.
 */
export default function Empresas() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["empresas"], queryFn: listarEmpresas });
  const [edit, setEdit] = useState<{ id: string | null; f: EmpresaForm } | null>(null);

  const recarregar = () => { refetch(); qc.invalidateQueries({ queryKey: ["config"] }); qc.invalidateQueries({ queryKey: ["minhas-empresas"] }); qc.invalidateQueries({ queryKey: ["me"] }); };

  async function excluir(e: Empresa) {
    if (!confirm(`Excluir "${e.razao_social}"? O cadastro sai da lista; os dados dela ficam guardados no banco.`)) return;
    try { await excluirEmpresa(e.id); toast.success("Empresa excluída"); recarregar(); } catch (error) { toast.error(errMsg(error)); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Empresas" sub="Dados cadastrais: CNPJ, razão social, inscrições, endereço, contatos e contador"
        actions={!edit && <Button onClick={() => setEdit({ id: null, f: { ...VAZIA } })}>Nova empresa</Button>} />

      {edit && (
        <Formulario
          inicial={edit.f}
          novo={!edit.id}
          principal={!!data?.find((x) => x.id === edit.id)?.principal}
          onCancelar={() => setEdit(null)}
          onSalvar={async (f) => {
            await salvarEmpresa(edit.id, f);
            toast.success(edit.id ? "Empresa salva — Configurações dela atualizadas" : "Empresa criada — escolha-a no seletor abaixo do logo para cadastrar os dados e os usuários dela");
            setEdit(null); recarregar();
          }}
        />
      )}

      <Panel title={`Empresas cadastradas · ${data?.length ?? 0}`}>
        <div className="overflow-x-auto"><table className="w-full text-sm [&_td]:pr-3 [&_th]:pr-3">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="py-1">Razão social</th><th>CNPJ</th><th>Cidade</th><th>Regime</th><th>Usuários</th><th>Situação</th><th />
          </tr></thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id} className={cn("border-t", !e.ativo && "text-muted-foreground")}>
                <td className="py-1.5">
                  <div className="font-medium">{e.razao_social}</div>
                  {e.nome_fantasia && <div className="text-xs text-muted-foreground">{e.nome_fantasia}</div>}
                </td>
                <td className="whitespace-nowrap tabular-nums">{formatarCnpj(e.cnpj)}</td>
                <td>{[e.cidade, e.uf].filter(Boolean).join("/") || "—"}</td>
                <td className="text-xs">{e.regime_tributario ? REGIMES[e.regime_tributario] : "—"}</td>
                <td>{e._count?.usuarios ?? 0}</td>
                <td className="whitespace-nowrap space-x-1">
                  {e.principal && <Tag tone="gold">Principal</Tag>}
                  {e.ativo ? <Tag tone="ok">Ativa</Tag> : <Tag>Inativa</Tag>}
                </td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => setEdit({ id: e.id, f: paraForm(e) })}>Editar</Button>
                  {!e.principal && <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => excluir(e)}><Trash2 className="h-4 w-4" /></Button>}
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nenhuma empresa cadastrada. A primeira fica com os dados que já estão no sistema.</td></tr>}
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada empresa tem os próprios dados e usuários: escolha a empresa no seletor abaixo do logo para trabalhar nela e cadastrar o admin da loja em Usuários.
          Razão social, fantasia, CNPJ e endereço vão para as Configurações da própria empresa (telas, busca da SEFAZ e cupom fiscal).
          A <b>principal</b> é a que ficou com os dados de antes do multiempresa.
        </p>
      </Panel>
    </div>
  );
}

function Formulario({ inicial, novo, principal, onCancelar, onSalvar }: {
  inicial: EmpresaForm; novo: boolean; principal: boolean; onCancelar: () => void; onSalvar: (f: EmpresaForm) => Promise<void>;
}) {
  const [f, setF] = useState<EmpresaForm>(inicial);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof EmpresaForm>(k: K, v: EmpresaForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const campo = (k: keyof EmpresaForm, rotulo: string, props: React.ComponentProps<typeof Input> = {}, cls = "") => (
    <div className={cls}><Label>{rotulo}</Label><Input value={(f[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} {...props} /></div>
  );

  const cnpj = normalizarCnpj(f.cnpj);
  const cnpjErrado = cnpj.length > 0 && !cnpjValido(cnpj);
  const cpf = (f.responsavel_cpf ?? "").replace(/\D/g, "");
  const cpfErrado = cpf.length > 0 && !cpfValido(cpf);
  const cnpjMudou = !novo && normalizarCnpj(inicial.cnpj) !== cnpj;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (cnpjErrado) return toast.error("CNPJ inválido. Confira os 14 caracteres (pode ter letras).");
    if (cpfErrado) return toast.error("CPF do responsável inválido");
    if (cnpjMudou && !confirm("Você mudou o CNPJ da empresa. Isso muda o CNPJ usado na busca de notas da SEFAZ e no cupom fiscal dela. Continuar?")) return;
    setSalvando(true);
    try { await onSalvar(f); } catch (error) { toast.error(errMsg(error)); } finally { setSalvando(false); }
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <Panel title={novo ? "Nova empresa" : `Editar empresa${principal ? " (principal)" : ""}`}>
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Identificação</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {campo("razao_social", "Razão social *", { required: true, maxLength: 150 }, "lg:col-span-2")}
              {campo("nome_fantasia", "Nome fantasia", { maxLength: 150 }, "lg:col-span-2")}
              <div>
                <Label>CNPJ *</Label>
                <Input value={f.cnpj} required maxLength={20} placeholder="00.000.000/0000-00" onChange={(e) => set("cnpj", e.target.value)}
                  onBlur={() => cnpjValido(cnpj) && set("cnpj", formatarCnpj(cnpj))} className={cn(cnpjErrado && "border-destructive")} />
                {cnpjErrado && <p className="mt-1 text-xs text-destructive">CNPJ não confere</p>}
              </div>
              {campo("inscricao_estadual", "Inscrição estadual", { maxLength: 20, placeholder: "ou ISENTO" })}
              {campo("inscricao_municipal", "Inscrição municipal", { maxLength: 20 })}
              {campo("cnae", "CNAE principal", { maxLength: 12, placeholder: "5611-2/01" })}
              <div className="lg:col-span-2"><Label>Regime tributário</Label>
                <select className={sel} value={f.regime_tributario ?? ""} onChange={(e) => set("regime_tributario", (e.target.value || null) as RegimeTributario | null)}>
                  <option value="">—</option>
                  {Object.entries(REGIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><Label>Data de abertura</Label><Input type="date" value={f.data_abertura ?? ""} onChange={(e) => set("data_abertura", e.target.value || null)} /></div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Endereço</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {campo("cep", "CEP", { maxLength: 10, placeholder: "00000-000", inputMode: "numeric" })}
              {campo("logradouro", "Logradouro", { maxLength: 150 }, "lg:col-span-3")}
              {campo("numero", "Número", { maxLength: 20 })}
              {campo("complemento", "Complemento", { maxLength: 80 })}
              {campo("bairro", "Bairro", { maxLength: 80 }, "lg:col-span-2")}
              {campo("cidade", "Cidade", { maxLength: 80 }, "lg:col-span-2")}
              <div><Label>UF</Label>
                <select className={sel} value={f.uf ?? ""} onChange={(e) => set("uf", e.target.value || null)}>
                  <option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
              {campo("cod_municipio", "Cód. município (IBGE)", { maxLength: 7, inputMode: "numeric", placeholder: "3556206" })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Contato e responsável</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {campo("telefone", "Telefone", { maxLength: 20 })}
              {campo("celular", "Celular / WhatsApp", { maxLength: 20 })}
              {campo("email", "E-mail", { type: "email", maxLength: 150 })}
              {campo("site", "Site", { maxLength: 150 })}
              {campo("responsavel_nome", "Responsável legal", { maxLength: 120 }, "lg:col-span-2")}
              <div>
                <Label>CPF do responsável</Label>
                <Input value={f.responsavel_cpf ?? ""} maxLength={14} onChange={(e) => set("responsavel_cpf", e.target.value)} className={cn(cpfErrado && "border-destructive")} />
                {cpfErrado && <p className="mt-1 text-xs text-destructive">CPF não confere</p>}
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Contabilidade</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {campo("contador_nome", "Contador / escritório", { maxLength: 120 })}
              {campo("contador_email", "E-mail do contador", { type: "email", maxLength: 150 })}
              {campo("contador_telefone", "Telefone do contador", { maxLength: 20 })}
            </div>
          </section>

          <section>
            <Label>Observações</Label>
            <Textarea rows={3} maxLength={1000} value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} />
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Empresa ativa (inativa: os usuários dela não entram)</label>
          </section>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>Salvar</Button>
        </div>
      </Panel>
    </form>
  );
}
