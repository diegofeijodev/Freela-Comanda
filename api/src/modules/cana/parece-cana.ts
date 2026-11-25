const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Nome que parece de produto de caldo de cana (cana, caldo, garapa, frozen; palavra inteira, sem caixa e sem acento). Mora na Cana: a
 * Configuração e a apuração usam para sugerir e avisar, e a prévia de Importar vendas só importa daqui para marcar o produto sem de-para.
 */
export const pareceCana = (nome: string) => /\b(cana|caldo|garapa|frozen)\b/.test(semAcento(nome));
