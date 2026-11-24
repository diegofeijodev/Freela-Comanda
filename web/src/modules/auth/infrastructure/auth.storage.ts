// ÚNICO arquivo autorizado a guardar a sessão (convenção do freela-web-v2). Chave `authUser`, como nos outros projetos.
export type Perfil = 'admin' | 'loja';
export interface AuthUser {
  id: string;
  email: string;
  nome: string;
  /** Perfil na empresa: `admin` cadastra tudo; `loja` = colaborador (vê as telas de `modulos`). O master é sempre `admin`. */
  perfil: Perfil;
  /** Vê todas as empresas e escolhe a do momento no seletor da barra lateral. */
  master?: boolean;
  empresa_id?: string | null;
  modulos?: string[];
}
export interface AuthSession {
  access_token: string;
  user: AuthUser;
  /** Empresa escolhida pelo master (vai no cabeçalho `X-Empresa-Id`). Usuário comum: ignorada pela API. */
  empresa_id?: string | null;
}

const STORAGE_KEY = 'authUser';

export function getStoredAuth(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function storeAuth(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuth(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Empresa escolhida no seletor (null = a principal). */
export function getEmpresaEscolhida(): string | null {
  return getStoredAuth()?.empresa_id ?? null;
}

export function setEmpresaEscolhida(id: string | null): void {
  const s = getStoredAuth();
  if (s) storeAuth({ ...s, empresa_id: id });
}
