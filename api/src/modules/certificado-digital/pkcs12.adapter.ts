import { createPrivateKey, type KeyObject, X509Certificate } from 'node:crypto';
import * as forge from 'node-forge';
import { CertificadoRecusado, MSG_CERTIFICADO } from './mensagens';

// ÚNICO arquivo do app que importa o node-forge (teste de fitness em __tests__/pkcs12.spec.ts). O forge só abre o .pfx;
// depois disso tudo é `node:crypto`. Nada daqui vaza texto da biblioteca, senha, chave ou bytes do arquivo nas mensagens.

export interface PfxAberto {
  chave: KeyObject;
  certificados: X509Certificate[];
}

const BAG_CHAVE_CIFRADA = '1.2.840.113549.1.12.10.1.2';
const BAG_CHAVE = '1.2.840.113549.1.12.10.1.1';
const BAG_CERTIFICADO = '1.2.840.113549.1.12.10.1.3';

const recusa = (code: ConstructorParameters<typeof CertificadoRecusado>[0], msg: string) => new CertificadoRecusado(code, msg);

type Falha = 'senha' | 'arquivo' | 'decifrar' | 'outro';

function classificar(e: unknown): Falha {
  const m = e instanceof Error ? e.message : '';
  if (/MAC could not be verified/i.test(m)) return 'senha';
  if (/Cannot read PKCS#12 PFX|Invalid PKCS#12|Only PKCS#12 PFX/i.test(m)) return 'arquivo';
  if (/Failed to decrypt|wrong password/i.test(m)) return 'decifrar';
  return 'outro';
}

/** A "outra" leitura de uma senha com acento: os bytes UTF-8 lidos como latin1 (e vice-versa). */
const foraDoAscii = (s: string) => /[^\x00-\x7f]/.test(s);
const comoUtf8Binario = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

type Pfx = ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>;

/**
 * Abre o PKCS#12. O forge usa a MESMA string para o MAC e para a cifra, e um .pfx moderno (PBES2) do OpenSSL 3 usa a senha
 * como BMPString no MAC (string normal) mas como bytes UTF-8 no PBKDF2 (string "binária"). Por isso:
 *  1. senha como veio; 2. só se o MAC falhar E houver caractere fora do ASCII, a outra codificação (UTF-8 lido como latin1);
 *  3. se o MAC passou (senha provada) mas a cifra PBES2 não abriu, abre de novo sem o MAC e com a senha em bytes UTF-8.
 * Senha só-ASCII errada falha uma vez só.
 */
function abrirComSenha(der: string, senha: string): Pfx {
  const tentar = (s: string, semMac = false): Pfx => {
    const raiz = forge.asn1.fromDer(der, false);
    if (semMac && Array.isArray(raiz.value) && raiz.value.length > 2) raiz.value.length = 2; // tira o macData (já provado no passo 1)
    return forge.pkcs12.pkcs12FromAsn1(raiz, false, s);
  };
  const comMac = (s: string): Pfx => {
    try {
      return tentar(s);
    } catch (e) {
      if (classificar(e) === 'decifrar' && foraDoAscii(s)) return tentar(comoUtf8Binario(s), true); // MAC ok: senha certa
      throw e;
    }
  };
  try {
    return comMac(senha);
  } catch (e) {
    if (classificar(e) === 'senha' && foraDoAscii(senha)) return comMac(comoUtf8Binario(senha));
    throw e;
  }
}

function derDoCertificado(bag: forge.pkcs12.Bag): Buffer | null {
  if (bag.cert) return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes(), 'binary');
  if (bag.asn1) return Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), 'binary'); // chave que o forge não conhece (EC)
  return null;
}

export function abrirPfx(arquivo: Buffer, senha: string): PfxAberto {
  const der = arquivo.toString('binary');
  try {
    forge.asn1.fromDer(der, false); // não é DER/BER (PDF, PEM, texto): não é um .pfx
  } catch {
    throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
  }
  let pfx: Pfx;
  try {
    pfx = abrirComSenha(der, senha);
  } catch (e) {
    const f = classificar(e);
    if (f === 'senha') throw recusa('CERTIFICADO_SENHA', MSG_CERTIFICADO.senha);
    if (f === 'arquivo') throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
    throw recusa('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato);
  }
  try {
    const bagsChave = [
      ...(pfx.getBags({ bagType: BAG_CHAVE_CIFRADA })[BAG_CHAVE_CIFRADA] ?? []),
      ...(pfx.getBags({ bagType: BAG_CHAVE })[BAG_CHAVE] ?? []),
    ];
    const bagChave = bagsChave[0];
    if (!bagChave) throw recusa('CERTIFICADO_SEM_CHAVE', MSG_CERTIFICADO.semChave);
    const chave = bagChave.key
      ? createPrivateKey({
          key: Buffer.from(forge.asn1.toDer(forge.pki.privateKeyToAsn1(bagChave.key)).getBytes(), 'binary'),
          format: 'der',
          type: 'pkcs1',
        })
      : createPrivateKey({
          key: Buffer.from(forge.asn1.toDer(bagChave.asn1 as forge.asn1.Asn1).getBytes(), 'binary'),
          format: 'der',
          type: 'pkcs8',
        });
    const certificados = (pfx.getBags({ bagType: BAG_CERTIFICADO })[BAG_CERTIFICADO] ?? [])
      .map(derDoCertificado)
      .filter((d): d is Buffer => d !== null)
      .map((d) => new X509Certificate(d));
    return { chave, certificados };
  } catch (e) {
    if (e instanceof CertificadoRecusado) throw e;
    throw recusa('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Campos do X.509 por ASN.1 (o `X509Certificate` do Node não mostra o otherName 2.16.76.1.3.3).

export interface CamposX509 {
  cnSujeito: string | null;
  serialNumberSujeito: string | null;
  cnEmissor: string | null;
  orgEmissor: string | null;
  cnpjSan: string | null;
  politicas: string[];
}

type No = forge.asn1.Asn1;
const filhos = (n: No | undefined): No[] => (n && Array.isArray(n.value) ? n.value : []);
const bytes = (n: No | undefined): string => (n && typeof n.value === 'string' ? n.value : '');
const oidDe = (n: No | undefined): string => (n ? forge.asn1.derToOid(bytes(n)) : '');

function texto(n: No): string {
  const b = Buffer.from(bytes(n), 'binary');
  if (n.type === forge.asn1.Type.BMPSTRING) return Buffer.from(b).swap16().toString('utf16le');
  if (n.type === forge.asn1.Type.UTF8) return b.toString('utf8');
  return b.toString('latin1');
}

function atributo(nome: No | undefined, oid: string): string | null {
  for (const rdn of filhos(nome)) {
    for (const atv of filhos(rdn)) {
      const [o, v] = filhos(atv);
      if (oidDe(o) === oid && v) return texto(v);
    }
  }
  return null;
}

const OID_CN = '2.5.4.3';
const OID_SERIAL = '2.5.4.5';
const OID_ORG = '2.5.4.10';
const OID_SAN = '2.5.29.17';
const OID_POLITICAS = '2.5.29.32';
const OID_CNPJ_PJ = '2.16.76.1.3.3';

export function lerCamposX509(der: Buffer): CamposX509 {
  const cert = forge.asn1.fromDer(der.toString('binary'), false);
  const tbs = filhos(cert)[0];
  let f = filhos(tbs);
  if (f[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f[0].type === 0) f = f.slice(1); // [0] version
  // f: serial, algoritmo, emissor, validade, sujeito, chave pública, ...
  const emissor = f[2];
  const sujeito = f[4];
  const campos: CamposX509 = {
    cnSujeito: atributo(sujeito, OID_CN),
    serialNumberSujeito: atributo(sujeito, OID_SERIAL),
    cnEmissor: atributo(emissor, OID_CN),
    orgEmissor: atributo(emissor, OID_ORG),
    cnpjSan: null,
    politicas: [],
  };
  const ext = f.find((n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 3);
  for (const e of filhos(filhos(ext)[0])) {
    const partes = filhos(e);
    const valor = partes[partes.length - 1];
    if (!valor) continue;
    const oid = oidDe(partes[0]);
    if (oid === OID_SAN) {
      for (const gn of filhos(forge.asn1.fromDer(bytes(valor), false))) {
        if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue; // só otherName
        const [o, explicito] = filhos(gn);
        const v = filhos(explicito)[0];
        if (oidDe(o) === OID_CNPJ_PJ && v && campos.cnpjSan === null) campos.cnpjSan = texto(v).trim();
      }
    } else if (oid === OID_POLITICAS) {
      for (const pi of filhos(forge.asn1.fromDer(bytes(valor), false))) campos.politicas.push(oidDe(filhos(pi)[0]));
    }
  }
  return campos;
}
