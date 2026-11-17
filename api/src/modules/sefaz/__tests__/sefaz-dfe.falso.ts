import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz, RespostaDistribuicao, SefazDfePort } from '../distribuicao.port';
import type { SefazErro } from '../sefaz-erro';

export function resposta(cStat: number, p: Partial<RespostaDistribuicao> = {}): RespostaDistribuicao {
  return { cStat, xMotivo: 'teste', dhResp: '2026-11-17T09:00:00-03:00', ultNsu: null, maxNsu: null, documentos: [], ...p };
}

/** Falso da SEFAZ para os testes: fila de respostas/erros; fila vazia = erro (nunca sai para a rede). */
export class SefazDfeFalso implements SefazDfePort {
  readonly chamadas: { ambiente: AmbienteSefaz; cnpj: string; ultNsu: bigint }[] = [];
  antesDeResponder?: () => Promise<void>;
  private fila: (RespostaDistribuicao | SefazErro)[] = [];

  responder(...r: (RespostaDistribuicao | SefazErro)[]): this {
    this.fila.push(...r);
    return this;
  }

  async distribuirPorNsu(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, cnpj: string, ultNsu: bigint): Promise<RespostaDistribuicao> {
    this.chamadas.push({ ambiente, cnpj, ultNsu });
    if (this.antesDeResponder) await this.antesDeResponder();
    const proxima = this.fila.shift();
    if (proxima === undefined) throw new Error('chamada inesperada à SEFAZ');
    if (proxima instanceof Error) throw proxima;
    return proxima;
  }
}
