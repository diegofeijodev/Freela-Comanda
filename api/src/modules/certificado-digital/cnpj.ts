// CNPJ (numérico e alfanumérico, RFB): normalização, dígito verificador e leitura do titular do certificado.

const FORMATO = /^[0-9A-Z]{12}[0-9]{2}$/;
const CNPJ_NO_FIM_DO_CN = /:([0-9A-Z]{12}[0-9]{2})$/;

/** Maiúsculas, só `[0-9A-Z]` (nunca `\D`: apagaria as letras do CNPJ alfanumérico). */
export function normalizarCnpj(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function dv(base: string): number {
  // pesos 2..9 da direita para a esquerda; cada caractere vale o código ASCII − 48 (RFB)
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function cnpjValido(c: string): boolean {
  if (!FORMATO.test(c) || /^0+$/.test(c)) return false;
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.charCodeAt(12) - 48 === d1 && c.charCodeAt(13) - 48 === d2;
}

/** CNPJ no final do CN do perfil A1 ("Nome Empresarial:CNPJ"); não confere o DV (quem escolhe é `escolherCnpj`). */
export function cnpjDoCn(cn: string): string | null {
  const m = CNPJ_NO_FIM_DO_CN.exec(cn.trim().toUpperCase());
  return m ? m[1] : null;
}

/** CN sem o sufixo `:CNPJ` (A1) ou o CN inteiro (selo eletrônico). */
export function titularDoCn(cn: string): string {
  const t = cn.trim();
  const m = /^(.*):[0-9A-Za-z]{12}[0-9]{2}$/.exec(t);
  return m ? m[1].trim() : t;
}

/** Ordem: SAN (2.16.76.1.3.3) → serialNumber do titular → fim do CN; cada um normalizado e validado. */
export function escolherCnpj(c: { san: string | null; serialNumber: string | null; cn: string | null }): string | null {
  const candidatos = [c.san, c.serialNumber, c.cn === null ? null : cnpjDoCn(c.cn)];
  for (const cand of candidatos) {
    if (cand === null) continue;
    const n = normalizarCnpj(cand);
    if (cnpjValido(n)) return n;
  }
  return null;
}

export function compararCnpj(
  doCertificado: string,
  daEmpresa: string,
): 'igual' | 'mesma_raiz' | 'diferente' | 'empresa_sem_cnpj' {
  const e = normalizarCnpj(daEmpresa);
  if (!cnpjValido(e)) return 'empresa_sem_cnpj';
  const c = normalizarCnpj(doCertificado);
  if (c === e) return 'igual';
  return c.slice(0, 8) === e.slice(0, 8) ? 'mesma_raiz' : 'diferente';
}

/** `XX.XXX.XXX/XXXX-XX`; texto que não tem 14 caracteres volta como veio. */
export function formatarCnpj(c: string): string {
  if (!FORMATO.test(c)) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
