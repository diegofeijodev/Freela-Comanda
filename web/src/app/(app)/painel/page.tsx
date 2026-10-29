'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, ShoppingCart, AlertTriangle } from 'lucide-react';
import { useMe } from '@/lib/auth';
import { PageHeader, Stat, Panel, Tag, STATUS_INV, STATUS_LISTA } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { brl, dataBR, isoDate, pct } from '@/lib/format';
import { carregarFichasResumo, carregarVendas, delta, resumo } from '@/lib/vendas';
import { errMsg } from '@/lib/db';
import {
  abrirInventario, inventarioAtual, itensContagem, itensInventarioAdmin, listarInventarios, listarItensEstoque, listarListas, listarSaldos,
} from '@/lib/erp-api';

function proximaSegunda() {
  const d = new Date();
  const diff = (1 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function useInventarioAtual() {
  return useQuery({ queryKey: ['inv-atual'], queryFn: inventarioAtual });
}

export default function Painel() {
  const { data: me } = useMe();
  return me?.perfil === 'admin' ? <PainelAdmin /> : <PainelLoja />;
}

function PainelLoja() {
  const { data: inv } = useInventarioAtual();
  const { data: itens } = useQuery({ queryKey: ['loja-itens', inv?.id], enabled: !!inv, queryFn: () => itensContagem(inv!.id) });
  const { data: lista } = useQuery({ queryKey: ['ultima-lista'], queryFn: async () => (await listarListas())[0] ?? null });
  const recontar = (itens ?? []).filter((i) => i.situacao === 'recontar');
  const pend = (itens ?? []).filter((i) => i.situacao === 'pendente').length;
  return (
    <div className="space-y-5">
      <PageHeader title="Olá!" sub="O que vamos fazer hoje?" />
      {inv ? (
        <Link href={`/inventario/${inv.id}`} className="block rounded-2xl bg-gold p-6 text-primary-foreground shadow-gold">
          <ClipboardCheck className="mb-3 h-10 w-10" />
          <div className="font-display text-3xl font-bold">Contar estoque</div>
          <div className="mt-1 text-sm opacity-80">Inventário de {dataBR(inv.data)} · {pend} itens a contar</div>
        </Link>
      ) : (
        <Panel><p className="text-sm text-muted-foreground">Nenhum inventário aberto no momento.</p></Panel>
      )}
      {recontar.length > 0 && inv && (
        <Link href={`/inventario/${inv.id}`} className="block rounded-2xl border-2 border-destructive bg-destructive/10 p-5">
          <div className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-5 w-5" /> Recontar ({recontar.length})</div>
          <ul className="mt-2 space-y-1 text-sm">{recontar.slice(0, 8).map((r) => <li key={r.id}>• {r.nome}</li>)}</ul>
        </Link>
      )}
      {lista && (
        <Link href={`/compras/${lista.id}`} className="flex items-center gap-4 rounded-2xl border bg-card p-5">
          <ShoppingCart className="h-8 w-8 text-primary" />
          <div><div className="font-semibold">Última lista de compras</div><div className="text-sm text-muted-foreground">{dataBR(lista.data)} · {STATUS_LISTA[lista.status]?.label}</div></div>
        </Link>
      )}
    </div>
  );
}

function PainelAdmin() {
  const router = useRouter();
  const { data: inv, refetch } = useInventarioAtual();
  const { data } = useQuery({
    queryKey: ['painel-admin'],
    queryFn: async () => {
      const hoje = new Date();
      const ini = new Date(hoje); ini.setDate(hoje.getDate() - 6);
      const ant = new Date(ini); ant.setDate(ini.getDate() - 7);
      const antFim = new Date(ini); antFim.setDate(ini.getDate() - 1);
      const [v, va, fichas, saldos, itens, invs] = await Promise.all([
        carregarVendas(isoDate(ini), isoDate(hoje)),
        carregarVendas(isoDate(ant), isoDate(antFim)),
        carregarFichasResumo(),
        listarSaldos(),
        listarItensEstoque(),
        listarInventarios(),
      ]);
      const fm = new Map(fichas.map((f) => [f.id, f]));
      const preco = new Map(itens.map((i) => [i.id, Number(i.preco_unitario ?? 0)]));
      const valorEstoque = saldos.reduce((s, x) => s + Math.max(0, Number(x.saldo)) * (preco.get(x.item_estoque_id) ?? 0), 0);
      const ultInv = invs.filter((i) => i.status === 'fechado' && !i.inicial).sort((a, b) => b.data.localeCompare(a.data))[0] ?? null;
      let perdas = 0;
      if (ultInv) {
        const ii = await itensInventarioAdmin(ultInv.id);
        perdas = ii.reduce((s, x) => {
          const d = (Number(x.final) - Number(x.teorico_snapshot ?? x.final)) * (preco.get(x.item_estoque_id) ?? 0);
          return d < 0 ? s + d : s;
        }, 0);
      }
      return { r: resumo(v, fm), ra: resumo(va, fm), valorEstoque, perdas, ultInv };
    },
  });

  async function abrir() {
    try {
      const { id } = await abrirInventario(proximaSegunda());
      toast.success('Inventário aberto');
      refetch();
      router.push(`/inventario/${id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Painel" sub="Últimos 7 dias" actions={
        inv ? (
          <Button asChild><Link href={`/inventario/${inv.id}`}>Inventário {dataBR(inv.data)} · {STATUS_INV[inv.status].label}</Link></Button>
        ) : <Button onClick={abrir}>Abrir inventário de segunda ({dataBR(proximaSegunda())})</Button>
      } />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Faturamento da semana" value={brl(data?.r.fat)} delta={data ? delta(data.r.fat, data.ra.fat) : null} />
        <Stat label="Ticket médio" value={brl(data?.r.ticket)} delta={data ? delta(data.r.ticket, data.ra.ticket) : null} />
        <Stat label="CMV teórico" value={pct(data?.r.cmvPct)} hint={brl(data?.r.cmv)} />
        <Stat label="Valor do estoque" value={brl(data?.valorEstoque)} />
        <Stat label="Perdas do último inventário" value={brl(data?.perdas)} hint={data?.ultInv ? dataBR(data.ultInv.data) : 'Sem inventário semanal fechado'} />
        <Stat label="Pedidos na semana" value={data?.r.pedidos ?? '—'} delta={data ? delta(data.r.pedidos, data.ra.pedidos) : null} />
      </div>
      {inv && <Panel><div className="flex items-center gap-3 text-sm"><Tag tone={STATUS_INV[inv.status].tone}>{STATUS_INV[inv.status].label}</Tag> Inventário de {dataBR(inv.data)} em andamento.</div></Panel>}
    </div>
  );
}
