import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import type { Socket } from 'node:net';
import * as tls from 'node:tls';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { causaDe, sefazErro, type SefazErro } from './sefaz-erro';

// Cliente SOAP 1.2 sobre `node:https` com autenticação mútua (mTLS). Sem regra de negócio: a distribuição de DF-e e,
// depois, a NFC-e o reusam com outra URL e outra action. Não registra nada em log (quem chama registra código, status e
// duração); nunca põe chave, PEM, pedido ou resposta em erro.

export const TEMPO_LIMITE_MS = 30_000;
export const TETO_RESPOSTA_BYTES = 16 * 1024 * 1024;

export interface ChamadaSoap12 {
  url: string;
  action: string; // vai no Content-Type (SOAP 1.2)
  corpo: string; // conteúdo do <soap12:Body>, já serializado
  certificado: CertificadoEmUso;
  confianca: string[]; // PEM das autoridades aceitas para o servidor (confiancaSefaz)
  tempoLimiteMs: number; // prazo TOTAL da chamada
  tetoRespostaBytes: number;
}

export type ChamarSoap12 = (c: ChamadaSoap12) => Promise<string>;
export const CHAMAR_SOAP12 = Symbol('CHAMAR_SOAP12');

export function envelopeSoap12(corpo: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`
  );
}

/**
 * Faz o POST e devolve o corpo da resposta HTTP 200 em UTF-8; qualquer outro desfecho rejeita SÓ com `SefazErro`.
 * Três marcas decidem o erro: `conectou` (TCP), `seguro` (`secureConnect`) e `enviado = seguro`.
 * - erro antes do TCP → SEFAZ_REDE; depois do TCP e antes do handshake → SEFAZ_TLS (os dois sem envio);
 * - erro depois do handshake → SEFAZ_REDE com envio; prazo total estourado → SEFAZ_TEMPO;
 * - status ≠ 200 → SEFAZ_HTTP com o status (o corpo não é lido); corpo acima do teto → SEFAZ_RESPOSTA_INVALIDA.
 */
export function chamarSoap12(c: ChamadaSoap12, requisitar: typeof https.request = https.request): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let conectou = false;
    let seguro = false;
    let acabou = false;
    let req: ClientRequest | undefined;

    const fim = (erro: SefazErro | null, corpo = ''): void => {
      if (acabou) return;
      acabou = true;
      clearTimeout(prazo);
      if (erro) {
        req?.destroy();
        reject(erro);
      } else resolve(corpo);
    };
    // `causa` = só o `code` do erro do Node (cadeia, nome, validade, protocolo), para o log da consulta
    const falhou = (e?: unknown): void => fim(sefazErro(conectou && !seguro ? 'SEFAZ_TLS' : 'SEFAZ_REDE', seguro, undefined, causaDe(e)));
    const prazo = setTimeout(() => fim(sefazErro('SEFAZ_TEMPO', seguro)), c.tempoLimiteMs);

    const receber = (res: IncomingMessage): void => {
      res.on('error', falhou);
      if (res.statusCode !== 200) return fim(sefazErro('SEFAZ_HTTP', true, res.statusCode));
      const partes: Buffer[] = [];
      let total = 0;
      res.on('data', (pedaco: Buffer) => {
        total += pedaco.length;
        if (total > c.tetoRespostaBytes) return fim(sefazErro('SEFAZ_RESPOSTA_INVALIDA', true));
        partes.push(pedaco);
      });
      res.on('end', () => fim(null, Buffer.concat(partes).toString('utf8')));
      res.on('close', () => {
        if (!res.complete) falhou(); // conexão caiu no meio do corpo
      });
    };

    try {
      const envelope = Buffer.from(envelopeSoap12(c.corpo), 'utf8');
      // Chave e certificado só dentro do contexto: com NODE_DEBUG=http/https/tls o Node imprime as opções do pedido (e o nome do
      // pool do agente, que concatena `key`/`cert`). Com `secureContext` o Node ignora `ca`/`minVersion` soltos: vão aqui dentro.
      const secureContext = tls.createSecureContext({
        minVersion: 'TLSv1.2',
        ca: c.confianca,
        key: c.certificado.chavePrivada.export({ type: 'pkcs8', format: 'pem' }), // a chave em PEM só existe aqui
        cert: [c.certificado.certificado, ...c.certificado.cadeia].map(String).join('\n'),
      });
      const opcoes: https.RequestOptions & Pick<tls.ConnectionOptions, 'secureContext'> = {
        method: 'POST',
        rejectUnauthorized: true,
        agent: false,
        secureContext,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${c.action}"`,
          'Content-Length': envelope.length, // bytes
        },
      };
      req = requisitar(c.url, opcoes, receber);
      req.on('socket', (s: Socket) => {
        s.once('connect', () => (conectou = true));
        s.once('secureConnect', () => (seguro = true));
      });
      req.on('error', falhou);
      req.end(envelope);
    } catch (e) {
      falhou(e); // URL, opção ou contexto TLS recusados na hora: nada saiu
    }
  });
}
