'use client';

import { create } from 'zustand';
import { api } from '@/modules/shared/infrastructure/http';
import { clearStoredAuth, getStoredAuth, storeAuth, type AuthSession, type AuthUser } from '../infrastructure/auth.storage';

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  hydrate: () => void;
  entrar: (email: string, senha: string) => Promise<AuthUser>;
  primeiroAcesso: (nome: string, email: string, senha: string) => Promise<AuthUser>;
  setUser: (user: AuthUser) => void;
  sair: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  hydrate: () => set({ user: getStoredAuth()?.user ?? null, hydrated: true }),
  entrar: async (email, senha) => {
    const { data } = await api.post<AuthSession>('/v1/auth/login', { email, senha });
    storeAuth(data);
    set({ user: data.user, hydrated: true });
    return data.user;
  },
  primeiroAcesso: async (nome, email, senha) => {
    const { data } = await api.post<AuthSession>('/v1/auth/primeiro-acesso', { nome, email, senha });
    storeAuth(data);
    set({ user: data.user, hydrated: true });
    return data.user;
  },
  setUser: (user) => {
    const stored = getStoredAuth();
    if (stored) storeAuth({ ...stored, user });
    set({ user });
  },
  sair: () => {
    clearStoredAuth();
    set({ user: null, hydrated: true });
  },
}));
