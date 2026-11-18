// CSC (Código de Segurança do Contribuinte) do cupom fiscal: só fica no banco cifrado (AES-256-GCM com `CERTIFICADO_SECRET`, rótulo
// próprio `nfce-csc`: o que foi cifrado aqui não abre com o rótulo do certificado nem da chave de IA). Nunca vai para log, resposta ou
// erro; a tela só vê os 4 últimos caracteres (`csc_dica`). Quem precisa do valor (o hash do QR Code) decifra no momento da montagem.

import { cifrar, decifrar } from '../../common/cripto/cripto';

/** Rótulo do HKDF do CSC: NÃO mudar (um CSC já gravado deixaria de abrir). */
export const ROTULO_CSC = 'nfce-csc';

/** 16 a 36 letras e números (pesquisa B.1). */
export const FORMATO_CSC = /^[0-9A-Za-z]{16,36}$/;

export function cifrarCsc(csc: string, segredo: string): string {
  return cifrar(csc, segredo, ROTULO_CSC);
}

/** O CSC, ou `null` se o segredo mudou, o conteúdo não confere ou o formato é outro. */
export function decifrarCsc(blob: string, segredo: string): string | null {
  return decifrar(blob, segredo, ROTULO_CSC);
}

/** Os 4 últimos caracteres: o que a tela mostra ("Guardado: ••••CDEF"). */
export function dicaDoCsc(csc: string): string {
  return csc.slice(-4);
}
