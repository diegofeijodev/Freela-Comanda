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

const NIVEIS_MAX = 8;

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

/** `true`/`false` = assinatura conferida com chave legível; `null` = o Node não lê a chave do emissor (ex.: raiz v7). */
function assinou(emissor: X509Certificate, filho: X509Certificate): boolean | null {
  try {
    return filho.verify(emissor.publicKey);
  } catch {
    return null;
  }
}

/**
 * Procura o emissor pelo NOME (`issuer === subject`) entre o .pfx, o pacote e as âncoras. Um candidato vale com a assinatura
 * confirmada por `verify`, válido em `agora` e `ca === true`. No máximo 8 níveis e cada certificado é expandido uma única vez
 * (custo O(n²) mesmo com .pfx forjado). Nunca usa `checkIssued` (compara AKI/SKI e manda a fraude para o aviso em vez da recusa).
 * - `conferida`: algum caminho chega a uma âncora (`intermediarias` = o que fica entre a folha e a âncora);
 * - `adulterada`: o .pfx traz um emissor com o nome certo, de chave legível, cuja assinatura FALHA, e nenhum candidato de
 *   nenhuma fonte a confirma. Emissor vencido, sem marca de AC ou de chave ilegível é só descartado;
 * - `nao_fechou`: qualquer outro caso (AC mais nova que o pacote, v7, profundidade esgotada).
 */
export function montarCadeia(folha: X509Certificate, doPfx: X509Certificate[], icp: CadeiaIcp, agora: Date): ResultadoCadeia {
  const fps = new Map<X509Certificate, string>();
  const fp = (c: X509Certificate): string => {
    let v = fps.get(c);
    if (v === undefined) fps.set(c, (v = impressaoDigital(c)));
    return v;
  };
  const ancoras = new Set(icp.ancoras.map(fp));
  const doPfxFp = new Set(doPfx.map(fp));
  const unicos = new Map<string, X509Certificate>();
  for (const c of [...doPfx, ...icp.pacote, ...icp.ancoras]) unicos.set(fp(c), c);
  const todos = [...unicos.values()];
  const expandidos = new Set<string>();

  const passo = (no: X509Certificate, caminho: X509Certificate[]): ResultadoCadeia => {
    const fpNo = fp(no);
    if (expandidos.has(fpNo)) return { situacao: 'nao_fechou' };
    expandidos.add(fpNo);
    const nomeados = todos.filter((c) => c.subject === no.issuer && fp(c) !== fpNo);
    const avaliados = nomeados.map((c) => ({ c, assinatura: assinou(c, no) }));
    const refutado = avaliados.some((a) => a.assinatura === false && doPfxFp.has(fp(a.c)));
    const confirmados = avaliados.filter((a) => a.assinatura === true);
    if (confirmados.length === 0) return refutado ? { situacao: 'adulterada' } : { situacao: 'nao_fechou' };
    let pior: ResultadoCadeia = { situacao: 'nao_fechou' };
    for (const { c } of confirmados.filter((a) => !naoAssina(a.c, agora))) {
      if (ancoras.has(fp(c))) return { situacao: 'conferida', intermediarias: caminho };
      if (caminho.length + 1 >= NIVEIS_MAX) continue;
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
    const prox = doPfx.find((c) => c.subject === atual.issuer && c.subject !== c.issuer && assinou(c, atual) === true);
    if (!prox || saida.includes(prox)) break;
    saida.push(prox);
    atual = prox;
  }
  return saida;
}
