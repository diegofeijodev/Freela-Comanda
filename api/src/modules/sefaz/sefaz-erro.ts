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
  /** `enviado`: o pedido pode ter chegado à SEFAZ (o erro veio depois do handshake TLS). */
  constructor(
    message: string,
    readonly code: CodigoSefazErro,
    readonly enviado: boolean,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'SefazErro';
  }
}

export function sefazErro(code: CodigoSefazErro, enviado: boolean, httpStatus?: number): SefazErro {
  return new SefazErro(MSG_SEFAZ_ERRO[code], code, enviado, httpStatus);
}
