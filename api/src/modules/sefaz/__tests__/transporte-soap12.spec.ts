import { EventEmitter } from 'node:events';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { inspect } from 'node:util';
// o objeto do próprio módulo (não a cópia do `import * as`), para o jest.spyOn alcançar o que o transporte chama
import tlsDoNode = require('node:tls');
import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import { SefazErro } from '../sefaz-erro';
import { chamarSoap12, envelopeSoap12, type ChamadaSoap12 } from '../transporte-soap12';

// Só servidor HTTPS LOCAL (127.0.0.1, porta aleatória) com certificados fictícios de fixtures/tls
// (api/scripts/gerar-certificados-teste.sh --tls). Nenhum teste fala com a SEFAZ nem com a rede de fora.
const tls = (nome: string): string => readFileSync(join(__dirname, 'fixtures', 'tls', nome), 'utf8');
const AC_TESTE = tls('ac-teste.pem');

const CLIENTE: CertificadoEmUso = {
  chavePrivada: createPrivateKey(tls('cliente.key')),
  certificado: new X509Certificate(tls('cliente.pem')),
  cadeia: [],
  cnpj: '12345678000195',
  validoAte: new Date('2046-01-01T00:00:00Z'),
  impressaoDigital: 'FICTICIO',
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let servidor: https.Server | undefined;

/** `servidor-estranho` = cadeia fora da confiança; `servidor-outro-nome` = cadeia confiável, emitido só para `outro-nome.teste`. */
async function subir(handler: Handler, nome: 'servidor' | 'servidor-estranho' | 'servidor-outro-nome' = 'servidor'): Promise<string> {
  servidor = https.createServer(
    { key: tls(`${nome}.key`), cert: tls(`${nome}.pem`), ca: [AC_TESTE], requestCert: true, rejectUnauthorized: true },
    handler,
  );
  await new Promise<void>((ok) => servidor!.listen(0, '127.0.0.1', ok));
  return `https://127.0.0.1:${(servidor!.address() as AddressInfo).port}/ws`;
}

afterEach(async () => {
  if (!servidor) return;
  const s = servidor;
  servidor = undefined;
  s.closeAllConnections();
  await new Promise<void>((ok) => s.close(() => ok()));
});

const chamada = (url: string, extra: Partial<ChamadaSoap12> = {}): ChamadaSoap12 => ({
  url,
  action: 'urn:acao-teste',
  corpo: '<x/>',
  certificado: CLIENTE,
  confianca: [AC_TESTE],
  tempoLimiteMs: 5_000,
  tetoRespostaBytes: 16 * 1024 * 1024,
  ...extra,
});

async function falha(p: Promise<unknown>): Promise<SefazErro> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SefazErro);
    return e as SefazErro;
  }
  throw new Error('não falhou');
}

const lerCorpo = (req: IncomingMessage): Promise<string> =>
  new Promise((ok) => {
    const partes: Buffer[] = [];
    req.on('data', (b: Buffer) => partes.push(b));
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
  });

describe('envelopeSoap12', () => {
  it('monta o envelope SOAP 1.2 exato em volta do corpo', () => {
    expect(envelopeSoap12('<a/>')).toBe(
      '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
        '<soap12:Body><a/></soap12:Body></soap12:Envelope>',
    );
  });
});

describe('chamarSoap12 (servidor HTTPS local)', () => {
  it('mTLS: manda o certificado do cliente e a action no Content-Type', async () => {
    const visto: { cn?: string | string[]; contentType?: string; corpo?: string } = {};
    const url = await subir((req, res) => {
      visto.cn = (req.socket as TLSSocket).getPeerCertificate().subject.CN;
      visto.contentType = req.headers['content-type'];
      void lerCorpo(req).then((corpo) => {
        visto.corpo = corpo;
        res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' }).end('<ok/>');
      });
    });

    await expect(chamarSoap12(chamada(url))).resolves.toBe('<ok/>');
    expect(visto.cn).toBe('cliente-teste');
    expect(visto.contentType).toBe('application/soap+xml; charset=utf-8; action="urn:acao-teste"');
    expect(visto.corpo).toBe(envelopeSoap12('<x/>'));
  });

  it('200 com a cadeia junto da folha: devolve o corpo em UTF-8 mesmo com um caractere partido entre dois pedaços', async () => {
    const texto = Buffer.from('<r>São Paulo — açaí</r>', 'utf8');
    const corte = texto.indexOf(Buffer.from('ã', 'utf8')) + 1; // no meio dos 2 bytes do "ã"
    const url = await subir((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200);
        res.write(texto.subarray(0, corte));
        setTimeout(() => res.end(texto.subarray(corte)), 20);
      });
    });

    const comCadeia = { ...CLIENTE, cadeia: [new X509Certificate(AC_TESTE)] }; // folha + cadeia unidas por "\n" no `cert`
    await expect(chamarSoap12(chamada(url, { certificado: comCadeia }))).resolves.toBe('<r>São Paulo — açaí</r>');
  });

  it('servidor fora da confiança: SEFAZ_TLS sem envio, e o handler não é chamado', async () => {
    const handler = jest.fn((_req: IncomingMessage, res: ServerResponse) => res.end('<ok/>'));
    const url = await subir(handler, 'servidor-estranho');

    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_TLS', enviado: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('servidor fora da confiança: a causa técnica guarda só o code do Node (para o log)', async () => {
    const url = await subir(() => undefined, 'servidor-estranho');

    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_TLS', enviado: false, causa: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    expect(e.message).toBe('A conexão segura com a SEFAZ não foi aceita.');
    expect(inspect(e)).not.toContain('unable to verify'); // a mensagem do Node não vem junto, só o code
    expect(inspect(e)).not.toContain('BEGIN');
  });

  it('certificado confiável emitido para OUTRO nome: SEFAZ_TLS sem envio (ERR_TLS_CERT_ALTNAME_INVALID), e o handler não é chamado', async () => {
    const handler = jest.fn((_req: IncomingMessage, res: ServerResponse) => res.end('<ok/>'));
    const url = await subir(handler, 'servidor-outro-nome'); // a cadeia passa (ac-teste); o nome (outro-nome.teste) não é 127.0.0.1

    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_TLS', enviado: false, causa: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(handler).not.toHaveBeenCalled();
    expect(inspect(e)).not.toContain('BEGIN');
  });

  it('porta fechada: SEFAZ_REDE sem envio', async () => {
    const url = await subir(() => undefined);
    const s = servidor!;
    servidor = undefined;
    await new Promise<void>((ok) => s.close(() => ok()));

    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_REDE', enviado: false });
  });

  it('tempo esgotado depois do handshake: SEFAZ_TEMPO com envio', async () => {
    const url = await subir((req) => req.resume()); // nunca responde

    const inicio = Date.now();
    const e = await falha(chamarSoap12(chamada(url, { tempoLimiteMs: 300 })));
    expect(e).toMatchObject({ code: 'SEFAZ_TEMPO', enviado: true });
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });

  it('conexão cai no meio do corpo: SEFAZ_REDE com envio, sem esperar o prazo', async () => {
    const url = await subir((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Length': '100' }).write('<parcial>');
        setTimeout(() => res.socket?.destroy(), 20);
      });
    });

    const inicio = Date.now();
    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_REDE', enviado: true });
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });

  it('HTTP 500: SEFAZ_HTTP com envio e o status, sem o corpo da resposta na mensagem', async () => {
    const url = await subir((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(500).end('<soap12:Fault>SEGREDO-DO-CORPO</soap12:Fault>'));
    });

    const e = await falha(chamarSoap12(chamada(url)));
    expect(e).toMatchObject({ code: 'SEFAZ_HTTP', enviado: true, httpStatus: 500 });
    expect(e.message).not.toContain('SEGREDO-DO-CORPO');
    expect(inspect(e)).not.toContain('SEGREDO-DO-CORPO');
  });

  it('teto: resposta maior que o teto vira SEFAZ_RESPOSTA_INVALIDA com envio', async () => {
    const url = await subir((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end('a'.repeat(2048)));
    });

    const e = await falha(chamarSoap12(chamada(url, { tetoRespostaBytes: 1024 })));
    expect(e).toMatchObject({ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true });
  });
});

describe('chamarSoap12 (opções do https.request)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('TLS 1.2+, confiança fechada, sem agente; chave PKCS#8 e certificado com a cadeia só dentro do secureContext', async () => {
    let opcoes: (https.RequestOptions & tlsDoNode.ConnectionOptions) | undefined;
    let urlPedida: unknown;
    const requisitar = ((url: unknown, o: https.RequestOptions & tlsDoNode.ConnectionOptions) => {
      urlPedida = url;
      opcoes = o;
      const req = Object.assign(new EventEmitter(), {
        end: () => setImmediate(() => req.emit('error', new Error('falso'))),
        destroy: () => req,
      });
      return req;
    }) as unknown as typeof https.request;
    const contexto = jest.spyOn(tlsDoNode, 'createSecureContext');
    const confianca = [AC_TESTE];
    const certificado = { ...CLIENTE, cadeia: [new X509Certificate(AC_TESTE)] };

    const e = await falha(chamarSoap12(chamada('https://127.0.0.1:1/ws', { confianca, certificado }), requisitar));
    expect(e).toMatchObject({ code: 'SEFAZ_REDE', enviado: false });

    expect(urlPedida).toBe('https://127.0.0.1:1/ws');
    expect(opcoes).toMatchObject({ method: 'POST', rejectUnauthorized: true, agent: false });
    // NODE_DEBUG=http/https/tls imprime as opções do pedido: nada de PEM nelas, só o contexto já montado
    for (const solta of ['key', 'cert', 'ca', 'minVersion', 'pfx', 'passphrase']) expect(opcoes).not.toHaveProperty(solta);
    expect(inspect(opcoes, { depth: 5 })).not.toContain('PRIVATE KEY');
    expect(contexto).toHaveBeenCalledTimes(1);
    expect(opcoes!.secureContext).toBe(contexto.mock.results[0]!.value);
    const pedido = contexto.mock.calls[0]![0]!;
    expect(pedido.minVersion).toBe('TLSv1.2');
    expect(pedido.ca).toBe(confianca);
    expect(String(pedido.key)).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(String(pedido.cert).match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(2);
    expect(opcoes!.headers).toMatchObject({
      'Content-Type': 'application/soap+xml; charset=utf-8; action="urn:acao-teste"',
      'Content-Length': Buffer.byteLength(envelopeSoap12('<x/>')),
    });
  });

  it('erro síncrono do requisitar (URL ruim) vira SEFAZ_REDE sem envio, sem o texto original', async () => {
    const requisitar = (() => {
      throw new Error('TEXTO-ORIGINAL');
    }) as unknown as typeof https.request;

    const e = await falha(chamarSoap12(chamada('https://127.0.0.1:1/ws'), requisitar));
    expect(e).toMatchObject({ code: 'SEFAZ_REDE', enviado: false });
    expect(inspect(e)).not.toContain('TEXTO-ORIGINAL');
  });
});
