import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type * as https from 'node:https';
import { join } from 'node:path';
// Oráculo: xml-crypto 6.4.0 (devDependency exata), importado SÓ em arquivos de __tests__. Nenhum teste faz rede: o `requisitar` do
// transporte é falso (guarda os bytes que sairiam e falha antes de qualquer conexão) e o certificado é o fictício de fixtures/tls.
import { SignedXml } from 'xml-crypto';
import type { CadeiaIcp } from '../../certificado-digital/cadeia';
import { confiancaSefaz } from '../confianca';
import { SefazEventosAdapter } from '../eventos.adapter';
import { SEFAZ_EVENTOS, type TipoEvento } from '../eventos.port';
import { ACTION_EVENTOS, corpoEnvEvento, dhSefaz, eventoAssinado, lerRetornoEventos, URL_EVENTOS, type DadosEvento } from '../eventos-xml';
import { SefazErro, sefazErro } from '../sefaz-erro';
import {
  chamarSoap12,
  envelopeSoap12,
  envelopeSoap12SemPrefixo,
  TEMPO_LIMITE_MS,
  TETO_RESPOSTA_BYTES,
  type ChamadaSoap12,
} from '../transporte-soap12';
import { CLIENTE } from './certificado-teste';
import { retornoLote, SefazEventosFalso } from './sefaz-eventos.falso';

const fx = (n: string): string => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

const AGORA = new Date('2026-11-17T17:05:00Z');
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const K880 = '35261111222333000181550010000008801000000887';
const ID_LOTE = 1763399100000n;
const icp = { ancoras: [] } as unknown as CadeiaIcp;

const dados = (tpEvento: TipoEvento, chave: string, xJust: string | null = null): DadosEvento => ({
  ambiente: 'producao',
  cnpjAutor: '12345678000195',
  chave,
  tpEvento,
  dhEvento: dhSefaz(AGORA),
  xJust,
});
// dois eventos DIFERENTES (o Id de cada um é único no documento)
const EVENTOS = [
  eventoAssinado(dados('210210', VETOR), CLIENTE),
  eventoAssinado(dados('210240', K880, 'Pedido cancelado pelo fornecedor'), CLIENTE),
];

describe('SefazEventosAdapter', () => {
  it('chama o transporte com os valores do desenho e lê a resposta com lerRetornoEventos', async () => {
    const chamadas: ChamadaSoap12[] = [];
    const adapter = new SefazEventosAdapter(icp, async (c) => {
      chamadas.push(c);
      return fx('ret-evento-128.xml');
    });
    const r = await adapter.enviarLote(CLIENTE, 'homologacao', ID_LOTE, EVENTOS);
    expect(r).toEqual(lerRetornoEventos(fx('ret-evento-128.xml')));
    expect(r.cStat).toBe(128);
    expect(chamadas).toEqual([
      {
        url: URL_EVENTOS.homologacao,
        action: ACTION_EVENTOS,
        corpo: corpoEnvEvento(ID_LOTE, EVENTOS),
        certificado: CLIENTE,
        confianca: confiancaSefaz(icp),
        tempoLimiteMs: TEMPO_LIMITE_MS,
        tetoRespostaBytes: TETO_RESPOSTA_BYTES,
        envelope: 'sem_prefixo',
      },
    ]);
  });

  it('produção vai para o www', async () => {
    const urls: string[] = [];
    const adapter = new SefazEventosAdapter(icp, async (c) => {
      urls.push(c.url);
      return fx('ret-evento-108.xml');
    });
    await expect(adapter.enviarLote(CLIENTE, 'producao', ID_LOTE, EVENTOS)).resolves.toMatchObject({ cStat: 108, retornos: [] });
    expect(urls).toEqual([URL_EVENTOS.producao]);
  });

  it('o SefazErro do transporte sobe sem mudar', async () => {
    const erro = sefazErro('SEFAZ_TEMPO', true);
    const adapter = new SefazEventosAdapter(icp, async () => {
      throw erro;
    });
    await expect(adapter.enviarLote(CLIENTE, 'producao', ID_LOTE, EVENTOS)).rejects.toBe(erro);
  });

  it('resposta ilegível vira SEFAZ_RESPOSTA_INVALIDA (a leitura é a de lerRetornoEventos)', async () => {
    const adapter = new SefazEventosAdapter(icp, async () => fx('ret-137.xml'));
    await expect(adapter.enviarLote(CLIENTE, 'producao', ID_LOTE, EVENTOS)).rejects.toMatchObject({
      code: 'SEFAZ_RESPOSTA_INVALIDA',
      enviado: true,
      passo: 'soap',
    });
  });

  it('endereços e action do desenho', () => {
    expect(URL_EVENTOS).toEqual({
      producao: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
      homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    });
    expect(ACTION_EVENTOS).toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento');
    expect(typeof SEFAZ_EVENTOS).toBe('symbol');
  });
});

/** `requisitar` falso: guarda os bytes e o Content-Length do pedido e falha logo depois (nada sai da máquina). */
function requisitarQueGuarda(): { requisitar: typeof https.request; enviado: () => { bytes: Buffer; contentLength: unknown } } {
  let bytes: Buffer | undefined;
  let contentLength: unknown;
  const requisitar = ((_url: unknown, o: https.RequestOptions) => {
    contentLength = (o.headers as Record<string, unknown>)['Content-Length'];
    const req = Object.assign(new EventEmitter(), {
      end: (b: Buffer) => {
        bytes = b;
        setImmediate(() => req.emit('error', new Error('falso')));
      },
      destroy: () => req,
    });
    return req;
  }) as unknown as typeof https.request;
  return {
    requisitar,
    enviado: () => {
      if (!bytes) throw new Error('nada foi enviado');
      return { bytes, contentLength };
    },
  };
}

/** Confere UMA assinatura (a do trecho dado) no documento inteiro, como o receptor vê: a C14N inclusiva usa os ancestrais dele. */
function confereNoDocumento(documento: string, assinatura: string): boolean {
  const verificador = new SignedXml({ publicCert: CLIENTE.certificado.toString() });
  verificador.loadSignature(assinatura);
  try {
    return verificador.checkSignature(documento);
  } catch {
    return false; // SignatureValue que não confere: o xml-crypto lança em vez de devolver false
  }
}
const assinaturas = (xml: string): string[] => xml.match(/<Signature [\s\S]*?<\/Signature>/g) ?? [];

describe('o corpo REAL que vai para a SEFAZ (envelope SOAP 1.2 inteiro, com o envEvento e 2 eventos assinados)', () => {
  /** Os bytes que o transporte de verdade mandaria para esta chamada do adaptador. */
  async function corpoEnviado(ajuste: Partial<ChamadaSoap12> = {}): Promise<{ documento: string; chamada: ChamadaSoap12 }> {
    const guarda = requisitarQueGuarda();
    let chamada: ChamadaSoap12 | undefined;
    const adapter = new SefazEventosAdapter(icp, (c) => {
      chamada = { ...c, ...ajuste };
      return chamarSoap12(chamada, guarda.requisitar);
    });
    await expect(adapter.enviarLote(CLIENTE, 'homologacao', ID_LOTE, EVENTOS)).rejects.toMatchObject({
      code: 'SEFAZ_REDE',
      enviado: false,
    });
    const { bytes, contentLength } = guarda.enviado();
    expect(contentLength).toBe(bytes.length);
    return { documento: bytes.toString('utf8'), chamada: chamada! };
  }

  it('o xml-crypto confere cada uma das 2 assinaturas nesse documento', async () => {
    const { documento, chamada } = await corpoEnviado();
    expect(documento).toBe(envelopeSoap12SemPrefixo(corpoEnvEvento(ID_LOTE, EVENTOS)));
    expect(documento).toBe(
      '<?xml version="1.0" encoding="utf-8"?><Envelope xmlns="http://www.w3.org/2003/05/soap-envelope"><Body>' +
        `${chamada.corpo}</Body></Envelope>`,
    );
    // nenhum prefixo declarado em lugar nenhum do pedido
    expect(documento).not.toMatch(/xmlns:/);
    const sigs = assinaturas(documento);
    expect(sigs).toHaveLength(2);
    for (const sig of sigs) expect(confereNoDocumento(documento, sig)).toBe(true);
    // e cada evento, sozinho, também confere (é o que fica gravado no banco)
    for (const evento of EVENTOS) expect(confereNoDocumento(evento, assinaturas(evento)[0])).toBe(true);
  });

  it('adulterar um evento dentro do envelope derruba só a assinatura dele', async () => {
    const { documento } = await corpoEnviado();
    const adulterado = documento.replace('Pedido cancelado', 'Pedido cancelada');
    const [s1, s2] = assinaturas(adulterado);
    expect(confereNoDocumento(adulterado, s1)).toBe(true);
    expect(confereNoDocumento(adulterado, s2)).toBe(false);
  });

  it('por que o envelope é outro: com o da distribuição (xmlns:soap12, xsi e xsd em escopo) a C14N inclusiva leva os prefixos e nenhuma confere', async () => {
    const { documento } = await corpoEnviado({ envelope: 'prefixado' });
    expect(documento).toBe(envelopeSoap12(corpoEnvEvento(ID_LOTE, EVENTOS)));
    const sigs = assinaturas(documento);
    expect(sigs).toHaveLength(2);
    for (const sig of sigs) expect(confereNoDocumento(documento, sig)).toBe(false);
  });

  it('o transporte sem a opção manda exatamente o envelope da distribuição (bytes da entrega 2)', async () => {
    const { documento } = await corpoEnviado({ envelope: undefined });
    expect(documento).toBe(envelopeSoap12(corpoEnvEvento(ID_LOTE, EVENTOS)));
  });
});

describe('SefazEventosFalso', () => {
  it('guarda as chamadas, responde na ordem e nunca cai para a rede com a fila vazia', async () => {
    const falso = new SefazEventosFalso();
    const erro = sefazErro('SEFAZ_REDE', false);
    let chamou = 0;
    falso.aoChamar = () => void chamou++;
    falso.proximas.push(retornoLote(128, [{ chave: VETOR, tpEvento: '210210', cStat: 135 }]), erro);
    const r = await falso.enviarLote(CLIENTE, 'homologacao', 1n, ['<evento/>']);
    expect(r.cStat).toBe(128);
    expect(r.retornos[0]).toMatchObject({ chave: VETOR, tpEvento: '210210', nSeq: 1, cStat: 135 });
    await expect(falso.enviarLote(CLIENTE, 'producao', 2n, ['<evento/>'])).rejects.toBe(erro);
    await expect(falso.enviarLote(CLIENTE, 'producao', 3n, [])).rejects.toThrow('chamada inesperada à SEFAZ');
    expect(falso.chamadas).toEqual([
      { ambiente: 'homologacao', idLote: 1n, eventos: ['<evento/>'] },
      { ambiente: 'producao', idLote: 2n, eventos: ['<evento/>'] },
      { ambiente: 'producao', idLote: 3n, eventos: [] },
    ]);
    expect(chamou).toBe(3);
    expect(erro).toBeInstanceOf(SefazErro);
  });
});
