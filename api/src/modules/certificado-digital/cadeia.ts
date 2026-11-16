import { createHash, X509Certificate } from 'node:crypto';
import { ANCORAS_ICP_BRASIL, PACOTE_ICP_BRASIL } from './icp-brasil.gerado';

// Cadeia ICP-Brasil só com `node:crypto`: âncoras (raízes fixadas por SHA-256, ver icp-brasil.spec.ts) + pacote de apoio.
// O pacote só ajuda a montar o caminho; um certificado dele só vale se a assinatura o leva até uma âncora.

export const CADEIA_ICP = Symbol('CADEIA_ICP');

export interface CadeiaIcp {
  ancoras: X509Certificate[];
  pacote: X509Certificate[];
}

export type ResultadoCadeia =
  | { situacao: 'conferida'; intermediarias: X509Certificate[] }
  | { situacao: 'adulterada' }
  | { situacao: 'nao_fechou' };

const NIVEIS_MAX = 5;

let cache: CadeiaIcp | undefined;
export function carregarCadeiaIcp(): CadeiaIcp {
  cache ??= {
    ancoras: ANCORAS_ICP_BRASIL.map((p) => new X509Certificate(p)),
    pacote: PACOTE_ICP_BRASIL.map((p) => new X509Certificate(p)),
  };
  return cache;
}

/** SHA-256 do DER, em maiúsculas e sem separador (a forma que vai para log e auditoria). */
export function impressaoDigital(c: X509Certificate): string {
  return createHash('sha256').update(c.raw).digest('hex').toUpperCase();
}

const naoAssina = (c: X509Certificate, agora: Date): boolean => {
  const t = agora.getTime();
  return !(c.ca === true && t >= new Date(c.validFrom).getTime() && t <= new Date(c.validTo).getTime());
};

function assinou(emissor: X509Certificate, filho: X509Certificate): boolean {
  try {
    return filho.verify(emissor.publicKey);
  } catch {
    return false; // chave que o Node não lê
  }
}

/**
 * Procura o emissor pelo NOME (`issuer === subject`) entre o .pfx, o pacote e as âncoras. Um candidato vale com a assinatura
 * confirmada por `verify`, válido em `agora` e `ca === true`. No máximo 5 níveis. Nunca usa `checkIssued` (compara AKI/SKI
 * e manda a fraude para o aviso em vez da recusa).
 * - `conferida`: algum caminho chega a uma âncora (`intermediarias` = o que fica entre a folha e a âncora);
 * - `adulterada`: o .pfx traz um emissor com o nome certo e nenhum candidato, de nenhuma fonte, confirma;
 * - `nao_fechou`: qualquer outro caso (AC mais nova que o pacote, raiz fora das âncoras).
 */
export function montarCadeia(folha: X509Certificate, doPfx: X509Certificate[], icp: CadeiaIcp, agora: Date): ResultadoCadeia {
  const ancoras = new Set(icp.ancoras.map(impressaoDigital));
  const doPfxFp = new Set(doPfx.map(impressaoDigital));
  const vistos = new Map<string, X509Certificate>();
  for (const c of [...doPfx, ...icp.pacote, ...icp.ancoras]) vistos.set(impressaoDigital(c), c);
  const todos = [...vistos.values()];

  const passo = (no: X509Certificate, caminho: X509Certificate[]): ResultadoCadeia => {
    const fpNo = impressaoDigital(no);
    const nomeados = todos.filter((c) => c.subject === no.issuer && impressaoDigital(c) !== fpNo);
    const confirmados = nomeados.filter((c) => assinou(c, no) && !naoAssina(c, agora));
    if (confirmados.length === 0) {
      return nomeados.some((c) => doPfxFp.has(impressaoDigital(c))) ? { situacao: 'adulterada' } : { situacao: 'nao_fechou' };
    }
    let pior: ResultadoCadeia = { situacao: 'nao_fechou' };
    for (const c of confirmados) {
      const fp = impressaoDigital(c);
      if (ancoras.has(fp)) return { situacao: 'conferida', intermediarias: caminho };
      if (caminho.length + 1 >= NIVEIS_MAX || fp === fpNo || caminho.some((x) => impressaoDigital(x) === fp)) continue;
      const r = passo(c, [...caminho, c]);
      if (r.situacao === 'conferida') return r;
      if (r.situacao === 'adulterada') pior = r;
    }
    return pior;
  };
  return passo(folha, []);
}

/** Intermediárias do próprio .pfx na ordem do caminho, sem a folha e sem a raiz autoassinada (para guardar quando não fecha). */
export function caminhoDoPfx(folha: X509Certificate, doPfx: X509Certificate[]): X509Certificate[] {
  const saida: X509Certificate[] = [];
  let atual = folha;
  for (let i = 0; i < NIVEIS_MAX; i++) {
    const prox = doPfx.find((c) => c.subject === atual.issuer && c.subject !== c.issuer && assinou(c, atual));
    if (!prox || saida.includes(prox)) break;
    saida.push(prox);
    atual = prox;
  }
  return saida;
}
