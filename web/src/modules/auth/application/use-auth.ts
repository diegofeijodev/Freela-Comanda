'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/modules/shared/infrastructure/http';
import type { AuthUser } from '../infrastructure/auth.storage';
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
export function useMe() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const q = useQuery({
    queryKey: ['me'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => (await api.get<{ user: AuthUser }>('/v1/auth/me')).data.user,
  });
  useEffect(() => {
    if (q.data && (q.data.perfil !== user?.perfil || q.data.nome !== user?.nome)) setUser(q.data);
  }, [q.data, user, setUser]);
  return { ...q, data: q.data ?? user ?? undefined, isLoading: q.isLoading && !user };
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
