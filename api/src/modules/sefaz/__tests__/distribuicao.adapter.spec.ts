import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CadeiaIcp } from '../../certificado-digital/cadeia';
import type { CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import { confiancaSefaz } from '../confianca';
import {
  ACTION_DIST_NSU,
  corpoDistNsu,
  lerRetornoDistribuicao,
  SefazDfeAdapter,
  TETO_DESCOMPACTADO_RESPOSTA_BYTES,
  URL_DISTRIBUICAO,
} from '../distribuicao.adapter';
import { SefazErro } from '../distribuicao.port';
import { sefazErro } from '../sefaz-erro';
import type { ChamadaSoap12 } from '../transporte-soap12';
import { docZip, retornoSoap } from './retorno-falso';

const fx = (n: string): string => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const INVALIDO = { code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true };

describe('corpoDistNsu', () => {
  it('monta o pedido exato (sem prefixo de namespace na área de dados)', () => {
    expect(corpoDistNsu('producao', '12345678000195', 0n)).toBe(
      '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>35</cUFAutor><CNPJ>12345678000195</CNPJ><distNSU><ultNSU>000000000000000</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>',
    );
  });
  it('homologação e NSU preenchido com zeros à esquerda', () => {
    const c = corpoDistNsu('homologacao', '12345678000195', 1234n);
    expect(c).toContain('<tpAmb>2</tpAmb>');
    expect(c).toContain('<ultNSU>000000000001234</ultNSU>');
  });
  it('aceita CNPJ alfanumérico', () => {
    expect(corpoDistNsu('producao', '12ABC34501DE35', 1n)).toContain('<CNPJ>12ABC34501DE35</CNPJ>');
  });
  it('recusa CNPJ ruim e NSU fora de 0..10^15-1', () => {
    expect(() => corpoDistNsu('producao', '123', 0n)).toThrow(Error);
    expect(() => corpoDistNsu('producao', '12345678000195', -1n)).toThrow(Error);
    expect(() => corpoDistNsu('producao', '12345678000195', 10n ** 15n)).toThrow(Error);
  });
});

describe('lerRetornoDistribuicao', () => {
  it('589 sem NSU', () => {
    expect(lerRetornoDistribuicao(fx('ret-589.xml'))).toMatchObject({ cStat: 589, ultNsu: null, maxNsu: null, documentos: [] });
  });
  it('137 com NSUs', () => {
    expect(lerRetornoDistribuicao(fx('ret-137.xml'))).toMatchObject({ cStat: 137, ultNsu: 1234n, maxNsu: 1234n, documentos: [] });
  });
  it('138 com três documentos descompactados', () => {
    const docs = [
      { nsu: 1235n, schema: 'resNFe_v1.01.xsd', conteudo: fx('res-nfe.xml') },
      { nsu: 1236n, schema: 'procNFe_v4.00.xsd', conteudo: fx('proc-nfe.xml') },
      { nsu: 1237n, schema: 'resEvento_v1.01.xsd', conteudo: fx('res-evento-110111.xml') },
    ];
    const r = lerRetornoDistribuicao(retornoSoap({ cStat: 138, ultNsu: 1237n, maxNsu: 1240n, docs }));
    expect(r.ultNsu).toBe(1237n);
    expect(r.maxNsu).toBe(1240n);
    expect(r.documentos.map((d) => d.nsu)).toEqual([1235n, 1236n, 1237n]);
    expect(r.documentos.map((d) => d.xml)).toEqual(docs.map((d) => d.conteudo));
    expect(r.documentos.map((d) => d.schema)).toEqual(docs.map((d) => d.schema));
    expect(r.documentos.every((d) => d.bruto === null)).toBe(true);
  });
  it('BOM e espaço antes de <?xml: a resposta é lida normalmente', () => {
    expect(lerRetornoDistribuicao('\uFEFF \r\n' + fx('ret-137.xml'))).toMatchObject({ cStat: 137, ultNsu: 1234n, maxNsu: 1234n });
  });
  it('teto do total descompactado: o documento que passa do teto e todos os seguintes ficam crus, sem derrubar a resposta', () => {
    const cem = (c: string) => `<a>${c.repeat(93)}</a>`; // 100 bytes descompactados
    const docs = [
      { nsu: 1n, schema: 'resNFe_v1.01.xsd', conteudo: cem('a') },
      { nsu: 2n, schema: 'resNFe_v1.01.xsd', conteudo: cem('b') },
      { nsu: 3n, schema: 'resNFe_v1.01.xsd', conteudo: cem('c') },
      { nsu: 4n, schema: 'resEvento_v1.01.xsd', conteudo: '<a/>' }, // caberia sozinho, mas vem depois do teto
    ];
    const r = lerRetornoDistribuicao(retornoSoap({ cStat: 138, ultNsu: 4n, maxNsu: 4n, docs }), 250);
    expect(r.cStat).toBe(138);
    expect(r.documentos.map((d) => d.nsu)).toEqual([1n, 2n, 3n, 4n]);
    expect(r.documentos.map((d) => d.schema)).toEqual(docs.map((d) => d.schema));
    expect(r.documentos.map((d) => d.xml)).toEqual([cem('a'), cem('b'), null, null]);
    expect(r.documentos.map((d) => d.bruto)).toEqual([null, null, docZip(cem('c')), docZip('<a/>')]);
    // teto padrão (64 MB) com os mesmos documentos: tudo descompactado
    const padrao = lerRetornoDistribuicao(retornoSoap({ cStat: 138, ultNsu: 4n, maxNsu: 4n, docs }));
    expect(padrao.documentos.every((d) => d.xml !== null)).toBe(true);
    expect(TETO_DESCOMPACTADO_RESPOSTA_BYTES).toBe(64 * 1024 * 1024);
  });
  it('documento com byte NUL vira { xml: null, bruto } e os outros seguem', () => {
    const docs = [
      { nsu: 1n, schema: 'resNFe_v1.01.xsd', conteudo: '<a>\u0000</a>' },
      { nsu: 2n, schema: 'resNFe_v1.01.xsd', conteudo: '<a/>' },
    ];
    const r = lerRetornoDistribuicao(retornoSoap({ cStat: 138, ultNsu: 2n, maxNsu: 2n, docs }));
    expect(r.documentos).toEqual([
      { nsu: 1n, schema: 'resNFe_v1.01.xsd', xml: null, bruto: docZip('<a>\u0000</a>') },
      { nsu: 2n, schema: 'resNFe_v1.01.xsd', xml: '<a/>', bruto: null },
    ]);
  });
  it('NUL no envelope (&#0; ou cru) some de todo texto lido, e a resposta vale', () => {
    const lixo = Buffer.from('lixo').toString('base64');
    const corpo = retornoSoap({ cStat: 138, xMotivo: 'Documento&#0;(s) localizado(s)', ultNsu: 2n, maxNsu: 2n })
      .replace('<cStat>138</cStat>', '<cStat>13&#0;8</cStat>')
      .replace('<dhResp>2026', '<dhResp>\u00002026')
      .replace('<ultNSU>', '<ultNSU>&#0;')
      .replace(
        '</retDistDFeInt>',
        `<loteDistDFeInt><docZip NSU="00000000000000&#0;2" schema="resNFe_v1.01&#0;.xsd">${lixo}&#0;</docZip></loteDistDFeInt></retDistDFeInt>`,
      );
    const r = lerRetornoDistribuicao(corpo);
    expect(r).toEqual({
      cStat: 138,
      xMotivo: 'Documento(s) localizado(s)',
      dhResp: '2026-11-17T09:00:00-03:00',
      ultNsu: 2n,
      maxNsu: 2n,
      documentos: [{ nsu: 2n, schema: 'resNFe_v1.01.xsd', xml: null, bruto: lixo }],
    });
  });
  it('docZip que não é gzip vira { xml: null, bruto }', () => {
    const b64 = Buffer.from('lixo').toString('base64');
    const corpo = retornoSoap({ cStat: 138, ultNsu: 1n, maxNsu: 1n }).replace(
      '</retDistDFeInt>',
      `<loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${b64}</docZip></loteDistDFeInt></retDistDFeInt>`,
    );
    expect(lerRetornoDistribuicao(corpo).documentos).toEqual([{ nsu: 1n, schema: 'resNFe_v1.01.xsd', xml: null, bruto: b64 }]);
  });
  it('resposta inválida vira SEFAZ_RESPOSTA_INVALIDA já enviada', () => {
    const docs = Array.from({ length: 51 }, (_, i) => ({ nsu: BigInt(i + 1), schema: 's', conteudo: '<a/>' }));
    const ruins = [
      '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body/></soap12:Envelope>',
      '<!DOCTYPE x [<!ENTITY a "b">]>' + fx('ret-137.xml'),
      retornoSoap({ cStat: 138 }).replace('<cStat>138</cStat>', '<cStat>abc</cStat>'),
      retornoSoap({ cStat: 138, ultNsu: 51n, maxNsu: 51n, docs }),
      'não é xml',
    ];
    for (const corpo of ruins) {
      let erro: unknown;
      try {
        lerRetornoDistribuicao(corpo);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(SefazErro);
      expect(erro).toMatchObject(INVALIDO);
    }
  });
  it('50 docZip passa', () => {
    const docs = Array.from({ length: 50 }, (_, i) => ({ nsu: BigInt(i + 1), schema: 's', conteudo: '<a/>' }));
    expect(lerRetornoDistribuicao(retornoSoap({ cStat: 138, ultNsu: 50n, maxNsu: 50n, docs })).documentos).toHaveLength(50);
  });
  it('docZip montado à mão tem o mesmo conteúdo', () => {
    expect(docZip('<a/>').length).toBeGreaterThan(0);
  });
});

describe('SefazDfeAdapter', () => {
  const icp = { ancoras: [] } as unknown as CadeiaIcp;
  const cert = { cnpj: '12345678000195' } as unknown as CertificadoEmUso;

  it('chama o transporte com os valores do desenho', async () => {
    const chamadas: ChamadaSoap12[] = [];
    const adapter = new SefazDfeAdapter(icp, async (c) => {
      chamadas.push(c);
      return fx('ret-137.xml');
    });
    const r = await adapter.distribuirPorNsu(cert, 'homologacao', '12345678000195', 5n);
    expect(r.cStat).toBe(137);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toEqual({
      url: URL_DISTRIBUICAO.homologacao,
      action: ACTION_DIST_NSU,
      corpo: corpoDistNsu('homologacao', '12345678000195', 5n),
      certificado: cert,
      confianca: confiancaSefaz(icp),
      tempoLimiteMs: 30000,
      tetoRespostaBytes: 16777216,
    });
  });
  it('o SefazErro do transporte passa sem mudar', async () => {
    const erro = sefazErro('SEFAZ_TEMPO', true);
    const adapter = new SefazDfeAdapter(icp, async () => {
      throw erro;
    });
    await expect(adapter.distribuirPorNsu(cert, 'producao', '12345678000195', 0n)).rejects.toBe(erro);
  });
  it('URLs do desenho', () => {
    expect(URL_DISTRIBUICAO.producao).toBe('https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
    expect(URL_DISTRIBUICAO.homologacao).toBe('https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
  });
});
