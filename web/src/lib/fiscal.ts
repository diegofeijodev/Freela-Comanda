// Cópia das regras fiscais da API (api/src/common/fiscal): CNPJ e chave de acesso com letras (formato alfanumérico da Receita).

const FORMATO_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;
const FORMATO_CHAVE = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;

/** Maiúsculas e só [0-9A-Z] (nunca \D: apagaria as letras do CNPJ alfanumérico). */
export function normalizarCnpj(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Mesma normalização, para a chave de acesso. */
export function normalizarChave(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Módulo 11, pesos 2..9 da direita para a esquerda; cada caractere vale o código ASCII − 48 (Receita).
function dv(base: string): number {
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
  if (!FORMATO_CNPJ.test(c) || /^0+$/.test(c)) return false;
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.charCodeAt(12) - 48 === d1 && c.charCodeAt(13) - 48 === d2;
}

export function chaveValida(c: string): boolean {
  return FORMATO_CHAVE.test(c) && c.charCodeAt(43) - 48 === dv(c.slice(0, 43));
}

/** Só dígitos, sem zeros à esquerda; só zeros → "0"; sem dígito → "". */
export function normalizarNumeroSerie(s: string | null | undefined): string {
  const d = (s ?? "").replace(/[^0-9]/g, "");
  if (d === "") return "";
  const t = d.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

export function cpfValido(c: string): boolean {
  if (!/^[0-9]{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

/** Vazio → true; 14 caracteres → CNPJ; 11 → CPF; outro tamanho → false. */
export function documentoConfere(s: string | null | undefined): boolean {
  const d = normalizarCnpj(s ?? "");
  if (d === "") return true;
  if (d.length === 14) return cnpjValido(d);
  if (d.length === 11) return cpfValido(d);
  return false;
}
