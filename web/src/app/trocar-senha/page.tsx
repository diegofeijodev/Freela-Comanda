'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSessao } from '@/modules/auth/application/use-auth';
import { trocarMinhaSenha } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';

/** Substitui o /reset-password do Supabase: a pessoa logada troca a própria senha (pede a atual). */
export default function TrocarSenha() {
  const router = useRouter();
  const { user, carregando } = useSessao();
  const [atual, setAtual] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!carregando && !user) router.replace('/auth');
  }, [carregando, user, router]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          try {
            await trocarMinhaSenha(atual, senha);
            toast.success('Senha alterada');
            router.push('/painel');
          } catch (err) {
            toast.error(errMsg(err));
          } finally {
            setEnviando(false);
          }
        }}
      >
        <h1 className="text-2xl font-bold">Nova senha</h1>
        <Input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} placeholder="Senha atual" autoComplete="current-password" required />
        <Input type="password" minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Nova senha" autoComplete="new-password" required />
        <Button className="w-full" type="submit" disabled={enviando}>Salvar</Button>
        <button type="button" className="w-full text-center text-sm text-muted-foreground" onClick={() => router.push('/painel')}>Voltar</button>
      </form>
    </div>
  );
}
