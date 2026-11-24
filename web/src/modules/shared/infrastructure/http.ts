import axios from 'axios';
import { clearStoredAuth, getStoredAuth, setEmpresaEscolhida } from '@/modules/auth/infrastructure/auth.storage';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3016';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  // Só anexa o token quando o chamador não definiu um (sobrescrever um Authorization explícito já trocou de conta no app do Freela).
  if (!config.headers.Authorization) {
    const auth = getStoredAuth();
    if (auth?.access_token) config.headers.Authorization = `Bearer ${auth.access_token}`;
  }
  // Multiempresa: a empresa escolhida pelo master no seletor (a API ignora para o usuário comum, que fica sempre na dele).
  const empresa = getStoredAuth()?.empresa_id;
  if (empresa && !config.headers['X-Empresa-Id']) config.headers['X-Empresa-Id'] = empresa;
  return config;
});

/**
 * 401 = a sessão morreu (JWT de 12 h, ou a conta foi excluída). Limpa o storage e recarrega na entrada — uma vez por página
 * (cinco consultas paralelas com 401 mandariam cinco `replace`).
 */
let redirecionando = false;
api.interceptors.response.use(undefined, (error) => {
  // Empresa escolhida que sumiu (excluída) ou ficou fora de alcance: volta para a principal e recarrega uma vez.
  if (error?.response?.status === 403 && error.response.data?.error?.code === 'EMPRESA' && typeof window !== 'undefined') {
    if (getStoredAuth()?.empresa_id && !redirecionando) {
      redirecionando = true;
      setEmpresaEscolhida(null);
      window.location.reload();
    }
  }
  if (error?.response?.status === 401 && typeof window !== 'undefined') {
    const url = String(error.config?.url ?? '');
    if (!url.includes('/auth/login')) {
      clearStoredAuth();
      if (!window.location.pathname.startsWith('/auth') && !redirecionando) {
        redirecionando = true;
        window.location.replace('/auth');
      }
    }
  }
  return Promise.reject(error);
});

/**
 * A mensagem real da API vive em `error.response.data.error.message`. NUNCA achate para `error.message`.
 * Faz o papel do `errMsg` do protótipo.
 */
export function errMsg(error: unknown, fallback = 'Erro inesperado'): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
    if (error.code === 'ERR_NETWORK') return 'Sem conexão com o servidor';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** O `error.code` da API (`{ error: { code, message } }`); `'SEM_CONEXAO'` quando o axios nem recebeu resposta; `null` nos demais casos. */
export function errCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  if (!error.response) return 'SEM_CONEXAO';
  const code = error.response.data?.error?.code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}
