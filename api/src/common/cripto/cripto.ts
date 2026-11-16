import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifra de segredos guardados no banco (chave de IA, certificado digital): AES-256-GCM com chave derivada por HKDF-SHA256
 * de um segredo do servidor. O `rotulo` entra no HKDF e separa as finalidades: o que foi cifrado com um rótulo não abre com outro.
 * Trocar o segredo torna o conteúdo salvo ilegível: o dono cadastra de novo em Configurações.
 * Formato: `v1.<iv>.<tag>.<texto cifrado>` (base64url).
 */

function chaveDe(segredo: string, rotulo: string): Buffer {
  if (!segredo || segredo.length < 16) throw new Error('segredo da cifra ausente ou curto demais');
  return Buffer.from(hkdfSync('sha256', segredo, Buffer.alloc(0), rotulo, 32));
}

export function cifrar(texto: string, segredo: string, rotulo: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveDe(segredo, rotulo), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Devolve o texto, ou `null` se o formato for outro ou o segredo/conteúdo não bater (a tag do GCM não confere). */
export function decifrar(blob: string, segredo: string, rotulo: string): string | null {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', chaveDe(segredo, rotulo), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

