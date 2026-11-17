import { Inject, Injectable } from '@nestjs/common';
import { CADEIA_ICP, type CadeiaIcp } from '../certificado-digital/cadeia';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { confiancaSefaz } from './confianca';
import type { AmbienteSefaz } from './distribuicao.port';
import { SEFAZ_EVENTOS, type RespostaLoteEventos, type SefazEventosPort } from './eventos.port';
import { ACTION_EVENTOS, corpoEnvEvento, lerRetornoEventos, URL_EVENTOS } from './eventos-xml';
import { CHAMAR_SOAP12, TEMPO_LIMITE_MS, TETO_RESPOSTA_BYTES, type ChamarSoap12 } from './transporte-soap12';

export { SEFAZ_EVENTOS };

@Injectable()
export class SefazEventosAdapter implements SefazEventosPort {
  constructor(
    @Inject(CADEIA_ICP) private readonly icp: CadeiaIcp,
    @Inject(CHAMAR_SOAP12) private readonly chamar: ChamarSoap12,
  ) {}

  async enviarLote(cert: CertificadoEmUso, ambiente: AmbienteSefaz, idLote: bigint, eventosAssinados: string[]): Promise<RespostaLoteEventos> {
    const corpoHttp = await this.chamar({
      url: URL_EVENTOS[ambiente],
      action: ACTION_EVENTOS,
      corpo: corpoEnvEvento(idLote, eventosAssinados),
      certificado: cert,
      confianca: confiancaSefaz(this.icp),
      tempoLimiteMs: TEMPO_LIMITE_MS,
      tetoRespostaBytes: TETO_RESPOSTA_BYTES,
      // a C14N inclusiva leva ao infEvento e ao SignedInfo os prefixos em escopo: com os do envelope da distribuição
      // (soap12, xsi, xsd), quem confere a assinatura no documento recebido não chegaria ao mesmo digest (eventos.adapter.spec)
      envelope: 'sem_prefixo',
    });
    return lerRetornoEventos(corpoHttp);
  }
}
