// Rascunho da contagem no aparelho (o protótipo guardava em `freela-rascunho-<inventário>`): a contagem sobrevive a uma
// recarga ou queda de sinal até ser enviada. Único arquivo, além da sessão, que toca o localStorage.
const chave = (invId: string) => `freela-rascunho-${invId}`;

export function lerRascunho(invId: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(chave(invId)) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function gravarRascunho(invId: string, valores: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chave(invId), JSON.stringify(valores));
  } catch {
    /* storage cheio ou bloqueado: a contagem segue só na memória */
  }
}
