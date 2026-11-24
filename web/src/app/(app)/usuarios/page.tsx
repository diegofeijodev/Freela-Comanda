'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { criarUsuario, excluirUsuario, listarUsuarios, redefinirSenha, trocarModulos, trocarPerfil, type Usuario } from "@/lib/erp-api";
import { PageHeader, Panel, Tag } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEmpresaAtual, useMe } from "@/lib/auth";
import { MODULOS, MODULOS_PADRAO, nomeEmpresa } from "@/lib/modulos";

import { errMsg } from "@/lib/db";

type PerfilForm = "admin" | "loja" | "master";

/** Usuários da empresa em uso. Admin cadastra tudo; Colaborador vê só as telas marcadas pelo admin. */
export default function Usuarios() {
  const { data: me } = useMe();
  const { data: empresa } = useEmpresaAtual();

  const vazio = { nome: "", email: "", senha: "", perfil: "loja" as PerfilForm, modulos: [...MODULOS_PADRAO] as string[] };
  const [f, setF] = useState(vazio);
  const { data, refetch } = useQuery({ queryKey: ["usuarios"], queryFn: listarUsuarios });
  const [telasDe, setTelasDe] = useState<Usuario | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const master = f.perfil === "master";
      await criarUsuario({ nome: f.nome, email: f.email, senha: f.senha, perfil: f.perfil === "loja" ? "loja" : "admin", ...(master ? { master: true } : {}), ...(f.perfil === "loja" ? { modulos: f.modulos } : {}) });
      toast.success("Usuário criado"); setF(vazio); refetch();
    } catch (err) { toast.error(errMsg(err)); }
  }
  async function trocar(id: string, perfil: "admin" | "loja") {
    try {
      await trocarPerfil(id, perfil);
      toast.success("Perfil atualizado");
      refetch();
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  // Substitui o "esqueci minha senha" por e-mail do Supabase (spec, decisão 5).
  async function novaSenha(id: string, nome: string) {
    const senha = prompt(`Nova senha para ${nome} (mín. 6):`);
    if (!senha) return;
    try {
      await redefinirSenha(id, senha);
      toast.success("Senha redefinida");
    } catch (error) {
      toast.error(errMsg(error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Usuários" sub={empresa ? `Acesso à empresa ${nomeEmpresa(empresa)}` : undefined} />
      <Panel title="Novo usuário">
        <form onSubmit={salvar} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            <Input placeholder="Nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
            <Input type="email" placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
            <Input type="text" placeholder="Senha inicial (mín. 6)" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} required minLength={6} />
            <select aria-label="Perfil" className="h-9 rounded-md border bg-background px-2" value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value as PerfilForm })}>
              <option value="loja">Colaborador</option>
              <option value="admin">Admin da empresa</option>
              {me?.master && <option value="master">Master (todas as empresas)</option>}
            </select>
            <Button type="submit">Cadastrar</Button>
          </div>
          {f.perfil === "loja" && (
            <Telas valor={f.modulos} onChange={(modulos) => setF({ ...f, modulos })} />
          )}
          <p className="text-xs text-muted-foreground">
            {f.perfil === "master" ? "O master vê todas as empresas e escolhe a do momento abaixo do logo."
              : f.perfil === "admin" ? "O admin vê e cadastra tudo desta empresa, inclusive os usuários dela."
              : "O colaborador vê só as telas marcadas."}
          </p>
        </form>
      </Panel>
      <Panel>
        <table className="w-full text-sm"><tbody>{(data ?? []).map((u) => (
          <tr key={u.id} className="border-t align-top">
            <td className="py-2">
              {u.nome} {u.master && <Tag tone="gold">Master</Tag>}
              <div className="text-xs text-muted-foreground">{u.email}</div>
              {!u.master && u.perfil === "loja" && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Telas: {u.modulos.length ? MODULOS.filter((m) => u.modulos.includes(m.chave)).map((m) => m.label).join(", ") : "nenhuma"}
                </div>
              )}
            </td>
            <td className="py-2 text-right">
              {u.master ? <span className="text-xs text-muted-foreground">todas as empresas</span> : (
                <select aria-label={`Perfil de ${u.nome}`} disabled={u.id === me?.id} className="h-8 rounded-md border bg-background px-2" value={u.perfil ?? ""} onChange={(e) => trocar(u.id, e.target.value as "admin" | "loja")}>
                  <option value="" disabled>sem perfil</option><option value="loja">Colaborador</option><option value="admin">Admin</option>
                </select>
              )}
            </td>
            <td className="w-24 py-2 text-right">{!u.master && u.perfil === "loja" && <button className="text-xs text-primary hover:underline" onClick={() => setTelasDe(u)}>Liberar telas</button>}</td>
            <td className="w-28 py-2 text-right"><button className="text-xs text-primary hover:underline" onClick={() => novaSenha(u.id, u.nome)}>Redefinir senha</button></td>
            <td className="w-10 py-2 text-right">{u.id !== me?.id && <button aria-label="Excluir" onClick={async () => { if (!confirm(`Excluir ${u.nome}?`)) return; try { await excluirUsuario(u.id); refetch(); } catch (e) { toast.error(errMsg(e)); } }}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>}</td>
          </tr>
        ))}</tbody></table>
      </Panel>
      {telasDe && <EditarTelas u={telasDe} onFechar={() => setTelasDe(null)} onSalvo={() => { setTelasDe(null); refetch(); }} />}
    </div>
  );
}

function Telas({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="rounded-md border p-3">
      <legend className="px-1 text-xs text-muted-foreground">Telas liberadas ao colaborador</legend>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {MODULOS.map((m) => (
          <label key={m.chave} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={valor.includes(m.chave)}
              onChange={(e) => onChange(e.target.checked ? [...valor, m.chave] : valor.filter((x) => x !== m.chave))} />
            {m.label}{!m.loja && <span className="text-warning" title="Mostra custos, preços ou financeiro">*</span>}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Sem <span className="text-warning">*</span>: visão da loja (sem custos nem preços). Com <span className="text-warning">*</span>: a tela inteira, com custos, preços e financeiro.
      </p>
    </fieldset>
  );
}

function EditarTelas({ u, onFechar, onSalvo }: { u: Usuario; onFechar: () => void; onSalvo: () => void }) {
  const [modulos, setModulos] = useState<string[]>(u.modulos);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    try { await trocarModulos(u.id, modulos); toast.success("Telas atualizadas"); onSalvo(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setSalvando(false); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={`Telas de ${u.nome}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-2xl space-y-3 rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium">Telas de {u.nome}</div>
        <Telas valor={modulos} onChange={setModulos} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>Salvar</Button>
        </div>
      </div>
    </div>
  );
}
