import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifra da chave de IA guardada no banco: AES-256-GCM com chave derivada por HKDF-SHA256 de um segredo do servidor
 * (`IA_CHAVES_SECRET`, ou o `JWT_SECRET` quando ela não existe — o rótulo do HKDF separa as duas finalidades).
 * Trocar o segredo torna a chave salva ilegível: o dono cadastra de novo em Configurações.
 * Formato: `v1.<iv>.<tag>.<texto cifrado>` (base64url).
 */
const ROTULO = 'erp-freela/ia-chave/v1';

function chaveDe(segredo: string): Buffer {
  if (!segredo || segredo.length < 16) throw new Error('segredo da cifra ausente ou curto demais');
  return Buffer.from(hkdfSync('sha256', segredo, Buffer.alloc(0), ROTULO, 32));
}

export function cifrar(texto: string, segredo: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveDe(segredo), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Devolve o texto, ou `null` se o formato for outro ou o segredo/conteúdo não bater (a tag do GCM não confere). */
export function decifrar(blob: string, segredo: string): string | null {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', chaveDe(segredo), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** `••••` + 4 últimos caracteres: a única parte da chave que sai do servidor. */
export const dicaDa = (chave: string) => `••••${chave.slice(-4)}`;
