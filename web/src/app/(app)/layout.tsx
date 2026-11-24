'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, BookOpen, ClipboardCheck, Boxes, Target, ShoppingCart, Upload, Settings, Users, LayoutDashboard, LogOut, FileInput, Wallet, Calculator, Landmark, KeyRound,
  Receipt, Clock, Building2, CupSoda,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEmpresaAtual, useMe, useMinhasEmpresas, useSair, useTrocarEmpresa } from '@/lib/auth';
import { nomeEmpresa } from '@/lib/modulos';
import { CertificadoFaixa } from '@/components/certificado-faixa';
import { ErrorBoundary } from '@/components/error-boundary';
import { useSessao } from '@/modules/auth/application/use-auth';

// `modulo` = chave da tela que o admin libera ao colaborador (`@/lib/modulos`); sem `modulo` = só admin (Empresas: só master).
const MENU = [
  { to: '/painel', label: 'Início', icon: LayoutDashboard, modulo: 'painel' },
  { to: '/vendas', label: 'Vendas', icon: BarChart3, modulo: 'vendas' },
  { to: '/cupom', label: 'Cupom Fiscal', icon: Receipt, modulo: 'cupom' },
  { to: '/fichas', label: 'Fichas Técnicas', icon: BookOpen, modulo: 'fichas' },
  { to: '/inventario', label: 'Inventário', icon: ClipboardCheck, modulo: 'inventario' },
  { to: '/cana', label: 'Cana', icon: CupSoda, modulo: 'cana' },
  { to: '/estoque', label: 'Estoque & Movimentações', icon: Boxes, modulo: 'estoque' },
  { to: '/objetivo', label: 'Estoque Objetivo', icon: Target, modulo: 'objetivo' },
  { to: '/compras', label: 'Lista de Compras', icon: ShoppingCart, modulo: 'compras' },
  { to: '/notas', label: 'Entrada de Notas', icon: FileInput, modulo: 'notas' },
  { to: '/contas', label: 'Contas a Pagar', icon: Wallet, modulo: 'contas' },
  { to: '/caixa', label: 'Conciliação de Caixa', icon: Landmark, modulo: 'caixa' },
  { to: '/ponto', label: 'Ponto', icon: Clock, modulo: 'ponto' },
  { to: '/dre', label: 'DRE', icon: Calculator, modulo: 'dre' },
  { to: '/importar', label: 'Importar Dados', icon: Upload, modulo: 'importar' },
  { to: '/empresas', label: 'Empresas', icon: Building2, modulo: null, master: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, modulo: null },
  { to: '/usuarios', label: 'Usuários', icon: Users, modulo: null },
] as const;

/** Logo de baixo: o master escolhe a empresa (todas); o usuário comum vê só o nome da dele. */
function SeletorEmpresa({ master }: { master: boolean }) {
  const { data: atual } = useEmpresaAtual();
  const { data: empresas } = useMinhasEmpresas();
  const trocar = useTrocarEmpresa();
  if (!master || !empresas?.length) {
    return <div className="truncate text-xs text-muted-foreground">{atual ? nomeEmpresa(atual) : 'Nenhuma empresa cadastrada'}</div>;
  }
  return (
    <select
      aria-label="Empresa"
      className="mt-2 h-9 w-full truncate rounded-md border bg-background px-2 text-sm"
      value={atual?.id ?? ''}
      onChange={(e) => void trocar(e.target.value || null)}
    >
      {!atual && <option value="">Escolha a empresa…</option>}
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>{nomeEmpresa(e)}{e.ativo ? '' : ' (inativa)'}</option>
      ))}
    </select>
  );
}

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

  const master = !!me.master;
  const modulos = me.modulos ?? [];
  const itens = MENU.filter((m) =>
    'master' in m && m.master ? master : me.perfil === 'admin' || (m.modulo !== null && (m.modulo === 'painel' || modulos.includes(m.modulo))),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="px-5 py-6">
          <div className="font-display text-2xl font-bold">Freela <span className="text-gold">Comanda</span></div>
          <SeletorEmpresa master={master} />
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
          <div className="mb-2 text-xs uppercase tracking-wide text-primary">{master ? 'Master' : me.perfil === 'admin' ? 'Admin' : 'Colaborador'}</div>
          <Link href="/trocar-senha" className="mb-1 flex items-center gap-2 text-muted-foreground hover:text-foreground"><KeyRound className="h-4 w-4" /> Trocar senha</Link>
          <button onClick={sair} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b bg-sidebar/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <div className="font-display text-lg font-bold">Freela <span className="text-gold">Comanda</span></div>
              <SeletorEmpresa master={master} />
            </div>
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
