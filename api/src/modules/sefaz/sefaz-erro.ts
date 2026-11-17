// Erro do transporte e da leitura da SEFAZ. Não é HttpException: o serviço decide o que fazer (agenda) e a tela usa as frases
// dela. A mensagem é SEMPRE uma frase fixa daqui: nunca corpo de resposta, XML, texto do erro original nem material do certificado.

export type CodigoSefazErro = 'SEFAZ_REDE' | 'SEFAZ_TLS' | 'SEFAZ_TEMPO' | 'SEFAZ_HTTP' | 'SEFAZ_RESPOSTA_INVALIDA';

/** Frases internas (log e testes); a tela usa as da agenda. */
export const MSG_SEFAZ_ERRO: Record<CodigoSefazErro, string> = {
  SEFAZ_REDE: 'Falha de rede na conversa com a SEFAZ.',
  SEFAZ_TLS: 'A conexão segura com a SEFAZ não foi aceita.',
  SEFAZ_TEMPO: 'A SEFAZ não respondeu dentro do tempo limite.',
  SEFAZ_HTTP: 'A SEFAZ respondeu com um erro HTTP.',
  SEFAZ_RESPOSTA_INVALIDA: 'A resposta da SEFAZ não pôde ser lida.',
};

export class SefazErro extends Error {
  /**
   * `enviado`: o pedido pode ter chegado à SEFAZ (o erro veio depois do handshake TLS).
   * `causa`: só o `code` do erro do Node (ex.: `CERT_HAS_EXPIRED`), para o log da consulta; nunca a mensagem, nunca PEM.
   */
  constructor(
    message: string,
    readonly code: CodigoSefazErro,
    readonly enviado: boolean,
    readonly httpStatus?: number,
    readonly causa?: string,
  ) {
    super(message);
    this.name = 'SefazErro';
  }
}

export function sefazErro(code: CodigoSefazErro, enviado: boolean, httpStatus?: number, causa?: string): SefazErro {
  return new SefazErro(MSG_SEFAZ_ERRO[code], code, enviado, httpStatus, causa);
}

/** O `code` de um erro do Node, só se tiver a forma de um código (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); senão `undefined`. */
export function causaDe(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : undefined;
}
