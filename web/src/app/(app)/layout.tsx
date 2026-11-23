'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, BookOpen, ClipboardCheck, Boxes, Target, ShoppingCart, Upload, Settings, Users, LayoutDashboard, LogOut, FileInput, Wallet, Calculator, Landmark, KeyRound,
  Receipt, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe, useSair } from '@/lib/auth';
import { CertificadoFaixa } from '@/components/certificado-faixa';
import { ErrorBoundary } from '@/components/error-boundary';
import { useSessao } from '@/modules/auth/application/use-auth';

const MENU = [
  { to: '/painel', label: 'Início', icon: LayoutDashboard, loja: true },
  { to: '/vendas', label: 'Vendas', icon: BarChart3, loja: false },
  { to: '/cupom', label: 'Cupom Fiscal', icon: Receipt, loja: false },
  { to: '/fichas', label: 'Fichas Técnicas', icon: BookOpen, loja: true },
  { to: '/inventario', label: 'Inventário', icon: ClipboardCheck, loja: true },
  { to: '/estoque', label: 'Estoque & Movimentações', icon: Boxes, loja: false },
  { to: '/objetivo', label: 'Estoque Objetivo', icon: Target, loja: false },
  { to: '/compras', label: 'Lista de Compras', icon: ShoppingCart, loja: true },
  { to: '/notas', label: 'Entrada de Notas', icon: FileInput, loja: false },
  { to: '/contas', label: 'Contas a Pagar', icon: Wallet, loja: false },
  { to: '/caixa', label: 'Conciliação de Caixa', icon: Landmark, loja: false },
  { to: '/ponto', label: 'Ponto', icon: Clock, loja: true },
  { to: '/dre', label: 'DRE', icon: Calculator, loja: false },
  { to: '/importar', label: 'Importar Dados', icon: Upload, loja: false },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, loja: false },
  { to: '/usuarios', label: 'Usuários', icon: Users, loja: false },
] as const;

/** Casca do protótipo (_authenticated/route.tsx). O portão da sessão fica aqui, antes de qualquer página consultar a API. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, carregando } = useSessao();
  const { data: me } = useMe();
  const sair = useSair();

  useEffect(() => {
    if (!carregando && !user) router.replace('/auth');
  }, [carregando, user, router]);

  if (carregando || !user || !me) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>;
  if (!me.perfil)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p>Sua conta ainda não tem perfil de acesso. Peça ao administrador.</p>
        <button className="text-primary" onClick={sair}>Sair</button>
      </div>
    );

  const itens = MENU.filter((m) => me.perfil === 'admin' || (me.perfil === 'loja' && m.loja));

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="px-5 py-6">
          <div className="font-display text-2xl font-bold">Freela <span className="text-gold">Comanda</span></div>
          <div className="text-xs text-muted-foreground">Chopp & Espeto Valinhos</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {itens.map((m) => {
            const ativo = pathname.startsWith(m.to);
            return (
              <Link key={m.to} href={m.to} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                ativo ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60')}>
                <m.icon className={cn('h-4 w-4', ativo && 'text-primary')} /> {m.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-4 text-sm">
          <div className="truncate font-medium">{me.nome}</div>
          <div className="mb-2 text-xs uppercase tracking-wide text-primary">{me.perfil === 'admin' ? 'Admin' : 'Loja'}</div>
          <Link href="/trocar-senha" className="mb-1 flex items-center gap-2 text-muted-foreground hover:text-foreground"><KeyRound className="h-4 w-4" /> Trocar senha</Link>
          <button onClick={sair} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b bg-sidebar/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="font-display text-lg font-bold">Freela <span className="text-gold">Comanda</span></div>
            <div className="flex items-center gap-4">
              <Link href="/trocar-senha" aria-label="Trocar senha"><KeyRound className="h-5 w-5 text-muted-foreground" /></Link>
              <button onClick={sair} aria-label="Sair"><LogOut className="h-5 w-5 text-muted-foreground" /></button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
            {itens.map((m) => (
              <Link key={m.to} href={m.to} className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs',
                pathname.startsWith(m.to) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')}>
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          {me.perfil === 'admin' && <ErrorBoundary><CertificadoFaixa /></ErrorBoundary>}
          {children}
        </main>
      </div>
    </div>
  );
}
