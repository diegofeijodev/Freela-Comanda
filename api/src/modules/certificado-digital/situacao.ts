import { dateFromString, todaySp } from '../../common/time/dates';

export type Situacao = 'ausente' | 'sem_segredo' | 'ilegivel' | 'vencido' | 'vencendo' | 'valido';

/** Quantos dias civis (de Brasília) faltam entre hoje e o dia de `validoAte`. */
export function diasRestantes(validoAte: Date, agora: Date): number {
  const dia = (d: Date) => dateFromString(todaySp(d)).getTime();
  return Math.round((dia(validoAte) - dia(agora)) / 86_400_000);
}

/** Precedência: sem segredo > sem linha > ilegível > vencido (pelo instante) > vencendo (≤ 30 dias) > válido. */
export function situacaoDe(e: {
  temLinha: boolean;
  temSegredo: boolean;
  legivel: boolean;
  validoAte: Date | null;
  agora: Date;
}): Situacao {
  if (!e.temSegredo) return 'sem_segredo';
  if (!e.temLinha) return 'ausente';
  if (!e.legivel) return 'ilegivel';
  if (!e.validoAte || e.agora.getTime() >= e.validoAte.getTime()) return 'vencido';
  return diasRestantes(e.validoAte, e.agora) <= 30 ? 'vencendo' : 'valido';
}

export interface ItemHistorico {
  evento: 'enviado' | 'substituido' | 'removido';
  feito_por_nome: string;
  feito_em: Date;
  valido_ate: Date;
  cnpj: string;
  titular: string;
}

/** O que a tela recebe: só dados públicos do certificado; nunca arquivo, senha, chave nem PEM. */
export interface CertificadoStatus {
  situacao: Situacao;
  titular: string | null;
  cnpj: string | null;
  cnpj_confere: 'igual' | 'mesma_raiz' | 'diferente' | 'empresa_sem_cnpj' | null;
  tipo: 'A1' | 'SE-S' | 'outro' | null;
  politica_oid: string | null;
  emissor: string | null;
  valido_de: Date | null;
  valido_ate: Date | null;
  dias_restantes: number | null;
  cadeia_conferida: boolean | null;
  enviado_em: Date | null;
  enviado_por_nome: string | null;
  historico: ItemHistorico[];
}
