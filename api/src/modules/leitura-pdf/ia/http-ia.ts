import { LeituraPdfErro, MSG } from '../leitor-pdf.port';

/** `fetch` injetável: em produção é o global; nos testes, um falso (nenhum teste faz rede). */
export type HttpIa = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
export const HTTP_IA = Symbol('HTTP_IA');

/** Tempo máximo de uma leitura: PDF de várias páginas com tabela de itens demora. */
export const TEMPO_LEITURA_MS = 120_000;

/**
 * Status HTTP + corpo de erro do provedor → mensagem de tela. Igual para OpenAI e Gemini:
 * 401/403 (e o 400 "API key not valid" do Google) = chave recusada; 429 com quota/billing = sem créditos, sem isso = muitas;
 * 404 = modelo indisponível; o resto = indisponível.
 */
export function erroDoProvedor(status: number, corpo: string): LeituraPdfErro {
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(corpo)))
    return new LeituraPdfErro(MSG.chaveRecusada, 503, 'PDF_CHAVE_RECUSADA');
  if (status === 402 || /insufficient_quota|\bbilling\b|\bcredits?\b|exceeded your current quota/i.test(corpo))
    return new LeituraPdfErro(MSG.semCredito, 503, 'PDF_SEM_CREDITO');
  if (status === 429) return new LeituraPdfErro(MSG.muitas, 429, 'PDF_LIMITE');
  if (status === 404 || /model[_ ]not[_ ]found|does not exist|is not found/i.test(corpo)) return new LeituraPdfErro(MSG.modelo, 503, 'PDF_MODELO');
  return new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
}
