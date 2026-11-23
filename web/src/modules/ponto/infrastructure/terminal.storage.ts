// Token do terminal de ponto: só o computador da loja liberado pelo admin (Ponto → Terminais) guarda este valor.
// A API recusa batida sem ele (cabeçalho X-Ponto-Terminal). Terceiro (e último) arquivo que toca o localStorage.
const CHAVE = 'freela-ponto-terminal';

export interface TerminalLocal {
  id: string;
  nome: string;
  token: string;
}

export function lerTerminal(): TerminalLocal | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as TerminalLocal) : null;
  } catch {
    return null;
  }
}

export function gravarTerminal(t: TerminalLocal): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CHAVE, JSON.stringify(t));
}

export function apagarTerminal(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* storage bloqueado: nada a apagar */
  }
}
