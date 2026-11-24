'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/modules/shared/infrastructure/http';
import { setEmpresaEscolhida, type AuthUser } from '../infrastructure/auth.storage';
import { useAuthStore } from './auth.store';

/** Sessão local (hidrata do storage uma vez). */
export function useSessao() {
  const { user, hydrated, hydrate } = useAuthStore();
  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);
  return { user, carregando: !hydrated };
}

/**
 * `useMe` do protótipo: `{ data: { id, email, nome, perfil } }`. Relê do servidor (o perfil pode ter mudado — um admin
 * rebaixou alguém) e grava de volta na sessão.
 */
/** Empresa da sessão (a escolhida pelo master, ou a do usuário). `principal` = a dos dados originais. */
export interface EmpresaResumo {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ativo: boolean;
  principal: boolean;
}

type MeResposta = { user: AuthUser; empresa: EmpresaResumo | null };

function useMeQuery() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['me'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => (await api.get<MeResposta>('/v1/auth/me')).data,
  });
}

export function useMe() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const q = useMeQuery();
  const doServidor = q.data?.user;
  useEffect(() => {
    if (doServidor && JSON.stringify(doServidor) !== JSON.stringify(user)) setUser(doServidor);
  }, [doServidor, user, setUser]);
  return { ...q, data: doServidor ?? user ?? undefined, isLoading: q.isLoading && !user };
}

/** A empresa em uso (null = instalação sem empresa cadastrada). */
export function useEmpresaAtual() {
  const q = useMeQuery();
  return { ...q, data: q.data?.empresa ?? null };
}

/** Empresas do seletor: o master vê todas; o usuário comum, só a dele. */
export function useMinhasEmpresas() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['minhas-empresas'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => (await api.get<EmpresaResumo[]>('/v1/auth/empresas')).data,
  });
}

/** Troca a empresa do master: limpa o cache (nada da empresa anterior pode aparecer) e recarrega no Início. */
export function useTrocarEmpresa() {
  const qc = useQueryClient();
  return useCallback(
    async (id: string | null) => {
      await qc.cancelQueries();
      qc.clear();
      setEmpresaEscolhida(id);
      window.location.assign('/painel');
    },
    [qc],
  );
}

/** Sair: limpa o cache ANTES (os dados da conta anterior apareciam por um instante na próxima — bug visto no web-v2). */
export function useSair() {
  const qc = useQueryClient();
  const sair = useAuthStore((s) => s.sair);
  return useCallback(async () => {
    await qc.cancelQueries();
    qc.clear();
    sair();
    window.location.replace('/auth');
  }, [qc, sair]);
}
