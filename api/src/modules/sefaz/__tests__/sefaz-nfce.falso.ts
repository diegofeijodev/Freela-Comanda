import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from '../distribuicao.port';
import { corpoAutorizacao, corpoConsulta, corpoEvento, corpoStatus, urlNfce } from '../nfce.adapter';
import type { RespostaAutorizacao, RespostaConsulta, RespostaEvento, RespostaStatus, SefazNfcePort, ServicoNfce } from '../nfce.port';
import type { SefazErro } from '../sefaz-erro';

/** Corpo HTTP de uma resposta fictícia de `fixtures/nfce` (ex.: `lerRetornoAutorizacao(fixtureNfce('ret-autorizacao-100.xml'))`). */
export function fixtureNfce(nome: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'nfce', nome), 'utf8');
}

export type RespostaNfce = RespostaAutorizacao | RespostaConsulta | RespostaEvento | RespostaStatus;

const eAutorizacao = (r: RespostaNfce): r is RespostaAutorizacao => 'cStatLote' in r && 'protocolo' in r;
const eConsulta = (r: RespostaNfce): r is RespostaConsulta => 'cancelamento' in r;
const eEvento = (r: RespostaNfce): r is RespostaEvento => 'cStatLote' in r && 'dhRegEvento' in r;
const eStatus = (r: RespostaNfce): r is RespostaStatus => 'tMed' in r;

/**
 * Falso da porta da NFC-e: monta o corpo com as MESMAS funções do adaptador (entrada fora do formato lança antes, sem guardar a chamada,
 * como no adaptador), guarda `{ servico, ambiente, corpo }` e responde com `respostas`, na ordem (resposta ou erro). Fila vazia ou
 * resposta de outro serviço = erro (nunca sai para a rede). `aoChamar` roda depois de guardar a chamada e antes de responder (ex.:
 * conferir o banco no meio do envio, ou lançar para simular a queda entre a T1 e a T2).
 */
export class SefazNfceFalso implements SefazNfcePort {
  readonly chamadas: { servico: ServicoNfce; ambiente: AmbienteSefaz; corpo: string }[] = [];
  respostas: (RespostaNfce | SefazErro)[] = [];
  aoChamar?: () => void;

  private responder<T extends RespostaNfce>(
    servico: ServicoNfce,
    ambiente: AmbienteSefaz,
    corpo: () => string,
    doTipo: (r: RespostaNfce) => r is T,
  ): T {
    urlNfce(servico, ambiente);
    this.chamadas.push({ servico, ambiente, corpo: corpo() });
    this.aoChamar?.();
    const proxima = this.respostas.shift();
    if (proxima === undefined) throw new Error('chamada inesperada à SEFAZ');
    if (proxima instanceof Error) throw proxima;
    if (!doTipo(proxima)) throw new Error('resposta falsa de outro serviço');
    return proxima;
  }

  async autorizar(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, enviNFe: string): Promise<RespostaAutorizacao> {
    return this.responder('autorizacao', ambiente, () => corpoAutorizacao(enviNFe), eAutorizacao);
  }

  async consultar(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, chave: string): Promise<RespostaConsulta> {
    return this.responder('consulta', ambiente, () => corpoConsulta(ambiente, chave), eConsulta);
  }

  async registrarEvento(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, envEvento: string): Promise<RespostaEvento> {
    return this.responder('evento', ambiente, () => corpoEvento(envEvento), eEvento);
  }

  async status(_cert: CertificadoEmUso, ambiente: AmbienteSefaz): Promise<RespostaStatus> {
    return this.responder('status', ambiente, () => corpoStatus(ambiente), eStatus);
  }
}
