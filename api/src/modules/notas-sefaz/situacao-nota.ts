// Situação de cada nota da caixa (derivada na leitura, nunca gravada) e cruzamento com as notas lançadas na Entrada de Notas.
import { normalizarChave } from '../../common/fiscal/chave-acesso';
import { pareceRepetida, type NotaParecida } from '../../common/fiscal/nota-repetida';
import type { NotaLancada } from '../notas/notas.service';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import type { SituacaoSefaz } from './classificacao';

export type SituacaoNota =
  | 'cancelada_depois_de_lancada'
  | 'ignorada'
  | 'cancelada'
  | 'denegada'
  | 'ja_lancada'
  | 'parece_lancada'
  | 'falta_lancar';

export type MotivoIgnorar = 'lancada_de_outro_jeito' | 'nao_e_compra' | 'nao_reconheco' | 'cancelamento_conferido' | 'outro';
export const MOTIVOS_IGNORAR: readonly MotivoIgnorar[] = [
  'lancada_de_outro_jeito',
  'nao_e_compra',
  'nao_reconheco',
  'cancelamento_conferido',
  'outro',
];

/** "A conferir": as situações 1, 6 e 7. */
export const A_CONFERIR: ReadonlySet<SituacaoNota> = new Set<SituacaoNota>(['cancelada_depois_de_lancada', 'parece_lancada', 'falta_lancar']);

/** `lancada` = chave igual; `parecida` = mesmo emitente, número e série (regra A). Precedência da mais forte para a mais fraca. */
export function situacaoDaNota(
  n: { situacao_sefaz: SituacaoSefaz; motivo_ignorar: MotivoIgnorar | null },
  l: { lancada: boolean; parecida: boolean },
): SituacaoNota {
  const cancelada = n.situacao_sefaz === 'cancelada';
  if (cancelada && (l.lancada || l.parecida) && n.motivo_ignorar !== 'cancelamento_conferido') return 'cancelada_depois_de_lancada';
  if (n.motivo_ignorar !== null) return 'ignorada';
  if (cancelada) return 'cancelada';
  if (n.situacao_sefaz === 'denegada') return 'denegada';
  if (l.lancada) return 'ja_lancada';
  if (l.parecida) return 'parece_lancada';
  return 'falta_lancar';
}

/** Produção + XML completo + "parece lançada" ou "falta lançar". Homologação nunca chega ao "Dar entrada". */
export function podeConferir(ambiente: AmbienteSefaz, temXml: boolean, s: SituacaoNota): boolean {
  return ambiente === 'producao' && temXml && (s === 'parece_lancada' || s === 'falta_lancar');
}

/** Só uma etiqueta: nota de saída (tpNF 0) ou de devolução (finNFe 4). */
export function naoPareceCompra(tpNf: number | null, finNfe: number | null): boolean {
  return tpNf === 0 || finNfe === 4;
}

/** A lançada pela chave e as parecidas (as demais do mesmo emitente com mesmo número e série), a mais nova primeiro. */
export function lancamentosDaNota(
  n: { chave: string; emitente_cnpj: string; numero: string; serie: string },
  lancadas: NotaLancada[],
): { lancada: NotaParecida | null; parecidas: NotaParecida[] } {
  const chave = normalizarChave(n.chave);
  const lancada = lancadas.find((l) => l.chave !== null && normalizarChave(l.chave) === chave) ?? null;
  const parecidas = lancadas
    .filter(
      (l) =>
        l !== lancada &&
        pareceRepetida({ cnpj: n.emitente_cnpj, numero: n.numero, serie: n.serie }, { cnpj: l.fornecedor_cnpj, numero: l.numero, serie: l.serie }),
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { lancada, parecidas };
}
