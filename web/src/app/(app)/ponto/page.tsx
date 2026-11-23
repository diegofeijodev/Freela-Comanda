'use client';

import { useMe } from "@/lib/auth";
import { PageHeader } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/error-boundary";
import { TerminalPonto } from "@/components/ponto/terminal";
import { EspelhoPonto } from "@/components/ponto/espelho";
import { ColaboradoresPonto, EscalasPonto, FolgasPonto } from "@/components/ponto/cadastros";
import { JustificativasPonto } from "@/components/ponto/justificativas";
import { TerminaisPonto } from "@/components/ponto/terminais";

/** Ponto: a loja só bate (no computador liberado); o admin também cadastra, ajusta, calcula e exporta. */
export default function Ponto() {
  const { data: me } = useMe();
  const admin = me?.perfil === "admin";

  if (!admin)
    return (
      <div>
        <PageHeader title="Ponto" sub="Registre entrada, intervalo e saída com o seu PIN" />
        <ErrorBoundary><TerminalPonto admin={false} /></ErrorBoundary>
      </div>
    );

  return (
    <div>
      <PageHeader title="Ponto" sub="Marcações, escalas, folgas, justificativas, horas extras e exportação" />
      <Tabs defaultValue="espelho">
        <TabsList className="no-print mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="bater">Bater ponto</TabsTrigger>
          <TabsTrigger value="espelho">Espelho e cálculo</TabsTrigger>
          <TabsTrigger value="justificativas">Justificativas</TabsTrigger>
          <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger>
          <TabsTrigger value="escalas">Escalas</TabsTrigger>
          <TabsTrigger value="folgas">Folgas e feriados</TabsTrigger>
          <TabsTrigger value="terminais">Terminais</TabsTrigger>
        </TabsList>
        <TabsContent value="bater"><ErrorBoundary><TerminalPonto admin /></ErrorBoundary></TabsContent>
        <TabsContent value="espelho"><ErrorBoundary><EspelhoPonto /></ErrorBoundary></TabsContent>
        <TabsContent value="justificativas"><ErrorBoundary><JustificativasPonto /></ErrorBoundary></TabsContent>
        <TabsContent value="colaboradores"><ErrorBoundary><ColaboradoresPonto /></ErrorBoundary></TabsContent>
        <TabsContent value="escalas"><ErrorBoundary><EscalasPonto /></ErrorBoundary></TabsContent>
        <TabsContent value="folgas"><ErrorBoundary><FolgasPonto /></ErrorBoundary></TabsContent>
        <TabsContent value="terminais"><ErrorBoundary><TerminaisPonto /></ErrorBoundary></TabsContent>
      </Tabs>
    </div>
  );
}
