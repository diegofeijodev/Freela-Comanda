'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/modules/auth/application/auth.store';
import { useSessao } from '@/modules/auth/application/use-auth';
import { existeAdmin } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';

export default function AuthPage() {
  const router = useRouter();
  const { user, carregando } = useSessao();
  const entrar = useAuthStore((s) => s.entrar);
  const primeiroAcesso = useAuthStore((s) => s.primeiroAcesso);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci'>('entrar');
  const [semAdmin, setSemAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!carregando && user) router.replace('/painel');
  }, [carregando, user, router]);
  useEffect(() => {
    existeAdmin().then((e) => setSemAdmin(!e)).catch(() => setSemAdmin(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (modo === 'entrar') {
        await entrar(email, senha);
        router.replace('/painel');
      } else if (modo === 'criar') {
        await primeiroAcesso(nome, email, senha);
        router.replace('/painel');
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold font-display text-2xl font-bold text-primary-foreground shadow-gold">F</div>
          <h1 className="text-3xl font-bold">Freela <span className="text-gold">ERP</span></h1>
        </div>
        {modo === 'esqueci' ? (
          // Sem e-mail transacional (spec, decisão 5): quem redefine a senha é o administrador, em Usuários.
          <div className="space-y-4 rounded-2xl border bg-card p-6 text-sm">
            <p>Para trocar a senha, peça ao administrador: ele redefine a sua senha em <strong>Usuários</strong>.</p>
            <p className="text-muted-foreground">Depois de entrar, você pode escolher uma senha nova em “Trocar senha”, no menu.</p>
            <button type="button" className="w-full text-center text-primary" onClick={() => setModo('entrar')}>Voltar para entrar</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6">
            {modo === 'criar' && (
              <div className="space-y-1.5"><Label htmlFor="nome">Nome</Label><Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
            )}
            <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
            <div className="space-y-1.5"><Label htmlFor="senha">Senha</Label><Input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} /></div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {modo === 'entrar' ? 'Entrar' : 'Criar conta de administrador'}
            </Button>
            <div className="flex flex-col gap-1 text-center text-sm">
              {modo !== 'entrar' && <button type="button" className="text-primary" onClick={() => setModo('entrar')}>Voltar para entrar</button>}
              {modo === 'entrar' && <button type="button" className="text-muted-foreground" onClick={() => setModo('esqueci')}>Esqueci minha senha</button>}
              {modo === 'entrar' && semAdmin && <button type="button" className="text-primary" onClick={() => setModo('criar')}>Primeiro acesso? Criar conta de administrador</button>}
            </div>
          </form>
        )}
        {!semAdmin && <p className="mt-4 text-center text-xs text-muted-foreground">Novos usuários são cadastrados pelo administrador.</p>}
      </div>
    </div>
  );
}
