'use client';

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMe } from "@/lib/auth";
import { PageHeader } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/error-boundary";
import { CanaLoja } from "@/components/cana/loja";
import { CanaSemanaAba } from "@/components/cana/semana";
import { CanaLancamentosAba } from "@/components/cana/lancamentos";
import { CanaConfiguracaoAba } from "@/components/cana/configuracao";

const ABAS = ["semana", "lancamentos", "configuracao"] as const;

export default function Page() {
  return <Suspense fallback={null}><Cana /></Suspense>;
}

/**
 * Controle da cana (desenho 2026-11-24, Parte B). A loja (colaborador com a tela `cana`) só lança, às cegas: nenhuma conta, nenhuma
 * rota de admin. O admin vê a semana (as contas por extenso), os lançamentos (anular, corrigir) e a configuração. `?aba=` escolhe a aba.
 */
function Cana() {
  const { data: me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!me) return null;
  if (me.perfil !== "admin") return <ErrorBoundary><CanaLoja /></ErrorBoundary>;
  const aba = ABAS.includes(params.get("aba") as (typeof ABAS)[number]) ? params.get("aba")! : "semana";
  return (
    <div>
      <PageHeader title="Cana" sub="Rendimento e perda de caldo, de uma contagem até a seguinte." />
      <Tabs value={aba} onValueChange={(v) => router.replace(`${pathname}?aba=${v}`)}>
        <TabsList className="mb-4 grid h-auto w-full grid-cols-3 md:inline-grid md:w-auto">
          <TabsTrigger value="semana" className="min-h-11 whitespace-normal">Semana</TabsTrigger>
          <TabsTrigger value="lancamentos" className="min-h-11 whitespace-normal">Lançamentos</TabsTrigger>
          <TabsTrigger value="configuracao" className="min-h-11 whitespace-normal">Configuração</TabsTrigger>
        </TabsList>
        <TabsContent value="semana"><ErrorBoundary><CanaSemanaAba /></ErrorBoundary></TabsContent>
        <TabsContent value="lancamentos"><ErrorBoundary><CanaLancamentosAba /></ErrorBoundary></TabsContent>
        <TabsContent value="configuracao"><ErrorBoundary><CanaConfiguracaoAba /></ErrorBoundary></TabsContent>
      </Tabs>
    </div>
  );
}
