import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from '../distribuicao.port';
import type { RespostaLoteEventos, RetornoEvento, SefazEventosPort } from '../eventos.port';
import type { SefazErro } from '../sefaz-erro';

/** Lote de resposta para os testes: cada retorno parte de um 135 do nSeqEvento 1, sem chave, tipo nem protocolo; o que vier por cima vale. */
export function retornoLote(cStat: number, retornos: Partial<RetornoEvento>[]): RespostaLoteEventos {
  return {
    cStat,
    xMotivo: 'teste',
    retornos: retornos.map((r) => ({
      chave: null,
      tpEvento: null,
      nSeq: 1,
      cStat: 135,
      xMotivo: 'teste',
      nProt: null,
      dhRegEvento: null,
      xml: '<retEvento versao="1.00"></retEvento>',
      ...r,
    })),
  };
}

/**
 * Falso da porta dos eventos: guarda cada chamada e responde com `proximas`, na ordem (resposta ou erro); fila vazia = erro (nunca sai
 * para a rede). `aoChamar` roda depois de guardar a chamada e antes de responder (ex.: conferir o banco no meio do envio, ou lançar
 * para simular a queda entre a T1 e a T2).
 */
export class SefazEventosFalso implements SefazEventosPort {
  readonly chamadas: { ambiente: AmbienteSefaz; idLote: bigint; eventos: string[] }[] = [];
  proximas: (RespostaLoteEventos | SefazErro)[] = [];
  aoChamar?: () => void;

  async enviarLote(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, idLote: bigint, eventosAssinados: string[]): Promise<RespostaLoteEventos> {
    this.chamadas.push({ ambiente, idLote, eventos: [...eventosAssinados] });
    this.aoChamar?.();
    const proxima = this.proximas.shift();
    if (proxima === undefined) throw new Error('chamada inesperada à SEFAZ');
    if (proxima instanceof Error) throw proxima;
    return proxima;
  }
}
