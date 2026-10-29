'use client';

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { criarUsuario, excluirUsuario, listarUsuarios, redefinirSenha, trocarPerfil } from "@/lib/erp-api";
import { PageHeader, Panel } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/lib/auth";

import { errMsg } from "@/lib/db";


export default function Usuarios() {
  const { data: me } = useMe();

  const [f, setF] = useState({ nome: "", email: "", senha: "", perfil: "loja" as "admin" | "loja" });
  const { data, refetch } = useQuery({ queryKey: ["usuarios"], queryFn: listarUsuarios });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try { await criarUsuario(f); toast.success("Usuário criado"); setF({ nome: "", email: "", senha: "", perfil: "loja" }); refetch(); }
    catch (err) { toast.error(errMsg(err)); }
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
      <PageHeader title="Usuários" />
      <Panel title="Novo usuário">
        <form onSubmit={salvar} className="grid gap-2 md:grid-cols-5">
          <Input placeholder="Nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
          <Input type="email" placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <Input type="text" placeholder="Senha inicial (mín. 6)" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} required minLength={6} />
          <select className="h-9 rounded-md border bg-background px-2" value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value as "admin" | "loja" })}><option value="loja">Loja</option><option value="admin">Admin</option></select>
          <Button type="submit">Cadastrar</Button>
        </form>
      </Panel>
      <Panel>
        <table className="w-full text-sm"><tbody>{(data ?? []).map((u) => (
          <tr key={u.id} className="border-t">
            <td className="py-2">{u.nome}<div className="text-xs text-muted-foreground">{u.email}</div></td>
            <td className="text-right">
              <select disabled={u.id === me?.id} className="h-8 rounded-md border bg-background px-2" value={u.perfil ?? ""} onChange={(e) => trocar(u.id, e.target.value as "admin" | "loja")}>
                <option value="" disabled>sem perfil</option><option value="loja">Loja</option><option value="admin">Admin</option>
              </select>
            </td>
            <td className="w-28 text-right"><button className="text-xs text-primary hover:underline" onClick={() => novaSenha(u.id, u.nome)}>Redefinir senha</button></td>
            <td className="w-10 text-right">{u.id !== me?.id && <button aria-label="Excluir" onClick={async () => { if (!confirm(`Excluir ${u.nome}?`)) return; try { await excluirUsuario(u.id); refetch(); } catch (e) { toast.error(errMsg(e)); } }}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>}</td>

          </tr>
        ))}</tbody></table>
      </Panel>
    </div>
  );
}
