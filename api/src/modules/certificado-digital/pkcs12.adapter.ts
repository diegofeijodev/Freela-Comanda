import { createHmac, createPrivateKey, type KeyObject, timingSafeEqual, X509Certificate } from 'node:crypto';
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

/** A "outra" leitura de uma senha com acento: os bytes UTF-8 lidos como latin1. */
const foraDoAscii = (s: string) => /[^\x00-\x7f]/.test(s);
const comoUtf8Binario = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

type Pfx = ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>;

const formatoInvalido = () => recusa('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato);

/** O PFX tem de ser SEQUENCE { INTEGER, authSafe, macData }. Sem macData não há prova de senha nem de integridade. */
function conferirEstrutura(raiz: forge.asn1.Asn1): void {
  const f = Array.isArray(raiz.value) ? raiz.value : [];
  if (raiz.type !== forge.asn1.Type.SEQUENCE || !raiz.constructed || f.length < 2 || f[0].type !== forge.asn1.Type.INTEGER) {
    throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
  }
  if (f.length === 2) throw formatoInvalido(); // .pfx sem MAC: recusado antes de qualquer senha
  if (f.length > 3) throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
}

// ---------------------------------------------------------------------------------------------------------------------
// Conferência PRÓPRIA do MAC (RFC 7292 §4): a decisão "a senha está certa" nunca depende de texto de erro do forge.

const TETO_ITERACOES_MAC = 1_000_000;
/** Mais certificados que isso num .pfx = arquivo forjado (um A1 real traz a folha e 2-4 ACs). */
const MAX_CERTIFICADOS = 20;
const HASHES_MAC: Record<string, { md: () => forge.md.MessageDigest; node: string; bytes: number }> = {
  '1.3.14.3.2.26': { md: () => forge.md.sha1.create(), node: 'sha1', bytes: 20 },
  '2.16.840.1.101.3.4.2.1': { md: () => forge.md.sha256.create(), node: 'sha256', bytes: 32 },
  '2.16.840.1.101.3.4.2.2': { md: () => forge.md.sha384.create(), node: 'sha384', bytes: 48 },
  '2.16.840.1.101.3.4.2.3': { md: () => forge.md.sha512.create(), node: 'sha512', bytes: 64 },
  '1.2.840.113549.2.5': { md: () => forge.md.md5.create(), node: 'md5', bytes: 16 },
};

/** Bytes de um OCTET STRING (DER ou BER em pedaços). */
function bytesDeOctet(n: forge.asn1.Asn1 | undefined): string {
  if (!n || n.type !== forge.asn1.Type.OCTETSTRING) throw new Error('octet');
  if (typeof n.value === 'string') return n.value;
  return n.value.map(bytesDeOctet).join('');
}

/**
 * `true` se o HMAC do conteúdo do authSafe confere com a senha; `false` se não confere. Qualquer defeito do arquivo
 * (algoritmo desconhecido/mal formado, campo ausente, iterações fora de 1..1.000.000) lança `CERTIFICADO_FORMATO`:
 * nunca vira "senha incorreta" nem "MAC conferido".
 */
export function macConfere(pfx: forge.asn1.Asn1, senha: string): boolean {
  try {
    const [, authSafe, macData] = pfx.value as forge.asn1.Asn1[];
    const contexto = (authSafe.value as forge.asn1.Asn1[])[1]; // [0] EXPLICIT { OCTET STRING }
    const conteudo = bytesDeOctet((contexto.value as forge.asn1.Asn1[])[0]);
    const [digestInfo, salt, iteracoes] = macData.value as forge.asn1.Asn1[];
    const [algoritmo, digest] = digestInfo.value as forge.asn1.Asn1[];
    const hash = HASHES_MAC[forge.asn1.derToOid(((algoritmo.value as forge.asn1.Asn1[])[0]).value as string)];
    if (!hash) throw new Error('algoritmo');
    let n = 1;
    if (iteracoes !== undefined) {
      if (iteracoes.type !== forge.asn1.Type.INTEGER || typeof iteracoes.value !== 'string') throw new Error('iteracoes');
      const b = Buffer.from(iteracoes.value, 'binary');
      if (b.length < 1 || b.length > 4) throw new Error('iteracoes');
      n = b.readUIntBE(0, b.length);
    }
    if (!(n >= 1 && n <= TETO_ITERACOES_MAC)) throw new Error('iteracoes');
    const esperado = Buffer.from(bytesDeOctet(digest), 'binary');
    const saltBytes = bytesDeOctet(salt);
    const chave = forge.pkcs12.generateKey(senha, forge.util.createBuffer(saltBytes), 3, n, hash.bytes, hash.md()).getBytes();
    const obtido = createHmac(hash.node, Buffer.from(chave, 'binary')).update(Buffer.from(conteudo, 'binary')).digest();
    return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
  } catch {
    throw formatoInvalido();
  }
}

/**
 * Abre o PKCS#12. O forge usa a MESMA string para o MAC e para a cifra, e um .pfx moderno (PBES2) do OpenSSL 3 usa a senha
 * como BMPString no MAC (string normal) mas como bytes UTF-8 no PBKDF2 (string "binária"). Fluxo:
 *  1. `macConfere` com a senha como veio; se não conferir E houver caractere fora do ASCII, com a outra codificação
 *     (UTF-8 lido como latin1). Nenhuma conferir = SENHA.
 *  2. SÓ com o MAC provado o conteúdo é decifrado: com a string que provou; se falhar e a senha for não-ASCII, reabre
 *     sem o macData (já provado) com a senha em bytes UTF-8. Qualquer falha depois da prova = FORMATO.
 * Senha só-ASCII errada falha uma vez só.
 */
function abrirComSenha(der: string, senha: string): Pfx {
  const raiz = forge.asn1.fromDer(der, false);
  const candidatas = foraDoAscii(senha) ? [senha, comoUtf8Binario(senha)] : [senha];
  const provada = candidatas.find((c) => macConfere(raiz, c));
  if (provada === undefined) throw recusa('CERTIFICADO_SENHA', MSG_CERTIFICADO.senha);
  const abrir = (macSenha: string, semMac: boolean): Pfx => {
    const r = forge.asn1.fromDer(der, false);
    if (semMac && Array.isArray(r.value)) r.value.length = 2; // tira o macData: já provado por `macConfere`
    return forge.pkcs12.pkcs12FromAsn1(r, false, macSenha);
  };
  try {
    return abrir(provada, false);
  } catch {
    if (!foraDoAscii(provada)) throw formatoInvalido();
  }
  try {
    return abrir(provada === senha ? comoUtf8Binario(senha) : provada, true); // `alt` já são os bytes UTF-8
  } catch {
    throw formatoInvalido();
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
    conferirEstrutura(forge.asn1.fromDer(der, false));
  } catch (e) {
    if (e instanceof CertificadoRecusado) throw e;
    throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo); // não é DER/BER (PDF, PEM, texto)
  }
  let pfx: Pfx;
  try {
    pfx = abrirComSenha(der, senha);
  } catch (e) {
    if (e instanceof CertificadoRecusado) throw e;
    throw formatoInvalido();
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
    const ders = (pfx.getBags({ bagType: BAG_CERTIFICADO })[BAG_CERTIFICADO] ?? [])
      .map(derDoCertificado)
      .filter((d): d is Buffer => d !== null);
    if (ders.length > MAX_CERTIFICADOS) throw formatoInvalido(); // .pfx forjado para pesar a busca da cadeia
    const certificados = ders.map((d) => new X509Certificate(d));
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
  // O forge já entrega o BMPString decodificado (cada caractere = 1 unidade UTF-16): não converter de novo.
  if (n.type === forge.asn1.Type.BMPSTRING) return typeof n.value === 'string' ? n.value : '';
  const b = Buffer.from(bytes(n), 'binary');
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
  try {
    return lerCampos(der);
  } catch {
    throw formatoInvalido(); // qualquer defeito do certificado vira FORMATO, nunca erro cru da biblioteca
  }
}

function lerCampos(der: Buffer): CamposX509 {
  new X509Certificate(der); // parser estrito do Node: o forge em modo tolerante aceita até texto solto
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
