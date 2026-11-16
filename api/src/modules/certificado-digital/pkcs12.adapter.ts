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

/**
 * ÚNICO lugar que depende de texto de erro do node-forge. Vale para a versão FIXADA (1.4.3, ver package.json): ao trocar a
 * versão, rever esta lista contra `lib/pkcs12.js` (testes em pkcs12.spec.ts cobrem uma entrada de cada classe).
 *  - senha:    a conferência do MAC falhou (o forge compara o HMAC logo depois de ler o macData).
 *  - antesDoMac: erros de estrutura/algoritmo levantados ANTES da conferência do MAC (não dizem nada sobre a senha).
 *  - estrutura:  subconjunto de antesDoMac que significa "isto não é um PFX".
 * Todo outro erro do `pkcs12FromAsn1` acontece DEPOIS do MAC (decifrar/ler o conteúdo), logo com a senha já provada.
 */
const TEXTOS_FORGE = {
  senha: /MAC could not be verified/i,
  antesDoMac:
    /^(Cannot read PKCS#12 PFX|PKCS#12 PFX of version|Only PKCS#12 PFX|PKCS#12 authSafe|PKCS#12 uses unsupported MAC|PKCS#12 MAC iteration|Invalid PKCS#12)/i,
  estrutura: /^Cannot read PKCS#12 PFX/i,
};

export type FalhaForge = 'senha' | 'arquivo' | 'formato' | 'depoisDoMac';

export function classificarErroForge(e: unknown): FalhaForge {
  const m = e instanceof Error ? e.message : '';
  if (TEXTOS_FORGE.senha.test(m)) return 'senha';
  if (TEXTOS_FORGE.estrutura.test(m)) return 'arquivo';
  if (TEXTOS_FORGE.antesDoMac.test(m)) return 'formato';
  return 'depoisDoMac';
}

/** A "outra" leitura de uma senha com acento: os bytes UTF-8 lidos como latin1. */
const foraDoAscii = (s: string) => /[^\x00-\x7f]/.test(s);
const comoUtf8Binario = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

type Pfx = ReturnType<typeof forge.pkcs12.pkcs12FromAsn1>;

/** O PFX tem de ser SEQUENCE { INTEGER, authSafe, macData }. Sem macData não há prova de senha nem de integridade. */
function conferirEstrutura(raiz: forge.asn1.Asn1): void {
  const f = Array.isArray(raiz.value) ? raiz.value : [];
  if (raiz.type !== forge.asn1.Type.SEQUENCE || !raiz.constructed || f.length < 2 || f[0].type !== forge.asn1.Type.INTEGER) {
    throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
  }
  if (f.length === 2) throw recusa('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato); // .pfx sem MAC: recusado antes de qualquer senha
  if (f.length > 3) throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
}

/**
 * Abre o PKCS#12. O forge usa a MESMA string para o MAC e para a cifra, e um .pfx moderno (PBES2) do OpenSSL 3 usa a senha
 * como BMPString no MAC (string normal) mas como bytes UTF-8 no PBKDF2 (string "binária"). Por isso:
 *  1. senha como veio (MAC verificado);
 *  2. se o MAC falhar E houver caractere fora do ASCII: a outra codificação (UTF-8 lido como latin1), mesma regra;
 *  3. se o MAC passou (senha provada) e QUALQUER erro depois dele ocorrer com senha não-ASCII (a decifragem pode falhar de
 *     formas diferentes, inclusive com um padding falso que passa): reabre o mesmo arquivo SEM o macData e com a senha em bytes UTF-8.
 * Senha só-ASCII errada falha uma vez só. Se a decifragem falhar com o MAC conferido, o arquivo é inválido (FORMATO).
 */
function abrirComSenha(der: string, senha: string): Pfx {
  const abrir = (macSenha: string, bytesSenha: string | null): Pfx => {
    const raiz = forge.asn1.fromDer(der, false);
    if (bytesSenha !== null && Array.isArray(raiz.value)) raiz.value.length = 2; // tira o macData: já conferido no passo anterior
    return forge.pkcs12.pkcs12FromAsn1(raiz, false, bytesSenha ?? macSenha);
  };
  const comMac = (s: string, bytes: string): Pfx => {
    try {
      return abrir(s, null);
    } catch (e) {
      if (classificarErroForge(e) === 'depoisDoMac' && foraDoAscii(s)) return abrir(s, bytes); // MAC ok: senha certa
      throw e;
    }
  };
  try {
    return comMac(senha, comoUtf8Binario(senha));
  } catch (e) {
    if (classificarErroForge(e) === 'senha' && foraDoAscii(senha)) {
      const alt = comoUtf8Binario(senha);
      return comMac(alt, alt); // `alt` já são os bytes UTF-8, um por caractere
    }
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
    conferirEstrutura(forge.asn1.fromDer(der, false));
  } catch (e) {
    if (e instanceof CertificadoRecusado) throw e;
    throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo); // não é DER/BER (PDF, PEM, texto)
  }
  let pfx: Pfx;
  try {
    pfx = abrirComSenha(der, senha);
  } catch (e) {
    const f = classificarErroForge(e);
    if (f === 'senha') throw recusa('CERTIFICADO_SENHA', MSG_CERTIFICADO.senha);
    if (f === 'arquivo') throw recusa('CERTIFICADO_ARQUIVO', MSG_CERTIFICADO.arquivo);
    throw recusa('CERTIFICADO_FORMATO', MSG_CERTIFICADO.formato); // inclui a decifragem que falha com o MAC conferido
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
