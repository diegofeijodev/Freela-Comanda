/** Para comparar nomes: minúsculas, sem acento, espaços colapsados e sem sobra nas pontas. */
export const normalizaNome = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
