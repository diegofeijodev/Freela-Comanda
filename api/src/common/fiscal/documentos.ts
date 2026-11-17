// CPF e GTIN (código de barras). Cópia em web/src/lib/fiscal.ts: as duas ficam iguais.

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

/** Esconde o 1º e o último trecho: 52998224725 → ***.982.247-**. Fora de 11 dígitos devolve só asteriscos. */
export function mascararCpf(c: string): string {
  const d = c.replace(/[^0-9]/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** GTIN de 8, 12, 13 ou 14 dígitos; DV módulo 10 (pesos 3 e 1 da direita para a esquerda, sem contar o DV). */
export function gtinValido(g: string): boolean {
  if (!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(g)) return false;
  let soma = 0;
  for (let i = g.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(g[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(g[g.length - 1]);
}
