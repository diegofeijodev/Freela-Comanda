import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import type { Socket } from 'node:net';
import * as tls from 'node:tls';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { causaDe, codigoFault, sefazErro, type CodigoFault, type SefazErro } from './sefaz-erro';
import { elementos, lerXml, primeiro, type NoXml } from './xml-leitura';

// Cliente SOAP 1.2 sobre `node:https` com autenticação mútua (mTLS). Sem regra de negócio: a distribuição de DF-e e,
// depois, a NFC-e o reusam com outra URL e outra action. Não registra nada em log (quem chama registra código, status e
// duração); nunca põe chave, PEM, pedido ou resposta em erro.

export const TEMPO_LIMITE_MS = 30_000;
export const TETO_RESPOSTA_BYTES = 16 * 1024 * 1024;
/** Do corpo de uma resposta com status ≠ 200 só se lê até aqui, e só para achar o código do SOAP Fault. */
export const TETO_CORPO_ERRO_BYTES = 8 * 1024;

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

// `Document` do xmldom (o global do TS é outro tipo); só `xml-leitura.ts` importa o pacote.
type Raiz = ReturnType<typeof lerXml>;
const filho = (pai: NoXml, nomeLocal: string): NoXml | null => elementos(pai, nomeLocal).find((e) => e.parentNode === pai) ?? null;

/**
 * Código do SOAP Fault do documento, reduzido à lista fechada (`codigoFault`); `null` se não houver Fault.
 * SOAP 1.2: `Fault/Code/Value` (o `Value` do `Subcode` fica de fora); SOAP 1.1: `Fault/faultcode`. Nunca o `Reason`/`faultstring`.
 */
export function faultDe(doc: Raiz): CodigoFault | null {
  const fault = primeiro(doc, 'Fault');
  if (!fault) return null;
  const code = filho(fault, 'Code');
  return codigoFault((code ? filho(code, 'Value') : filho(fault, 'faultcode'))?.textContent);
}

/** `faultDe` de um corpo em texto (até `TETO_CORPO_ERRO_BYTES`); corpo que não é XML legível = `null`. Nunca lança. */
export function faultDoCorpo(corpo: string): CodigoFault | null {
  try {
    return faultDe(lerXml(corpo, TETO_CORPO_ERRO_BYTES));
  } catch {
    return null;
  }
}

/**
 * Faz o POST e devolve o corpo da resposta HTTP 200 em UTF-8; qualquer outro desfecho rejeita SÓ com `SefazErro`.
 * Três marcas decidem o erro: `conectou` (TCP), `seguro` (`secureConnect`) e `enviado = seguro`.
 * - erro antes do TCP → SEFAZ_REDE; depois do TCP e antes do handshake → SEFAZ_TLS (os dois sem envio);
 * - erro depois do handshake → SEFAZ_REDE com envio; prazo total estourado → SEFAZ_TEMPO;
 * - status ≠ 200 → SEFAZ_HTTP com o status e `passo: 'http'`, SEMPRE (queda, prazo ou corpo grande no meio também): do corpo só se
 *   lê até `TETO_CORPO_ERRO_BYTES`, para o código do SOAP Fault (`fault`); corpo acima do teto → SEFAZ_RESPOSTA_INVALIDA (`tamanho`).
 */
export function chamarSoap12(c: ChamadaSoap12, requisitar: typeof https.request = https.request): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let conectou = false;
    let seguro = false;
    let acabou = false;
    let req: ClientRequest | undefined;
    // status ≠ 200 já recebido: daqui em diante todo desfecho é SEFAZ_HTTP com ele (a agenda decide pelo status, não pelo corpo)
    let erroHttp: { status: number | undefined } | null = null;

    const fim = (erro: SefazErro | null, corpo = ''): void => {
      if (acabou) return;
      acabou = true;
      clearTimeout(prazo);
      if (erro) {
        req?.destroy();
        reject(erro);
      } else resolve(corpo);
    };
    const fimHttp = (fault: CodigoFault | null = null): void =>
      fim(sefazErro('SEFAZ_HTTP', true, erroHttp?.status, undefined, { passo: 'http', ...(fault ? { fault } : {}) }));
    // `causa` = só o `code` do erro do Node (cadeia, nome, validade, protocolo), para o log da consulta
    const falhou = (e?: unknown): void => {
      if (erroHttp) return fimHttp();
      fim(sefazErro(conectou && !seguro ? 'SEFAZ_TLS' : 'SEFAZ_REDE', seguro, undefined, causaDe(e)));
    };
    const prazo = setTimeout(() => (erroHttp ? fimHttp() : fim(sefazErro('SEFAZ_TEMPO', seguro))), c.tempoLimiteMs);

    const receber = (res: IncomingMessage): void => {
      res.on('error', falhou);
      if (res.statusCode !== 200) erroHttp = { status: res.statusCode };
      const teto = erroHttp ? TETO_CORPO_ERRO_BYTES : c.tetoRespostaBytes;
      const partes: Buffer[] = [];
      let total = 0;
      res.on('data', (pedaco: Buffer) => {
        total += pedaco.length;
        if (total > teto)
          return erroHttp ? fimHttp() : fim(sefazErro('SEFAZ_RESPOSTA_INVALIDA', true, undefined, undefined, { passo: 'tamanho' }));
        partes.push(pedaco);
      });
      res.on('end', () => {
        const corpo = Buffer.concat(partes).toString('utf8');
        if (erroHttp) fimHttp(faultDoCorpo(corpo));
        else fim(null, corpo);
      });
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
