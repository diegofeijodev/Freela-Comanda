import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLDSIG } from '../assinatura-xml';
import type { TipoEvento } from '../eventos.port';
import {
  C_ORGAO_AN,
  corpoEnvEvento,
  DESC_EVENTO,
  dhSefaz,
  eventoAssinado,
  idDoEvento,
  lerRetornoEventos,
  montarEvento,
  normalizarJustificativa,
  type DadosEvento,
} from '../eventos-xml';
import { SefazErro } from '../sefaz-erro';
import { elementos, lerXml, type NoXml } from '../xml-leitura';
import { CLIENTE } from './certificado-teste';
import { faultSoap12, SENTINELA_FAULT } from './retorno-falso';

// Nenhum teste faz rede: só montagem, assinatura com o certificado fictício e leitura de fixtures fictícias.
const fx = (n: string): string => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const NFE = 'http://www.portalfiscal.inf.br/nfe';
const VETOR = '35261112ABC34501DE35550010000044111000044116'; // chave com letras (CNPJ alfanumérico do emitente)
const K880 = '35261111222333000181550010000008801000000887';
const K77 = '35261111222333000181550010000000771000000071';
const TIPOS: TipoEvento[] = ['210200', '210210', '210220', '210240'];
const XJUST = 'Pedido cancelado pelo fornecedor';

const dados = (tpEvento: TipoEvento, p: Partial<DadosEvento> = {}): DadosEvento => ({
  ambiente: 'producao',
  cnpjAutor: '12345678000195',
  chave: VETOR,
  tpEvento,
  dhEvento: dhSefaz(AGORA),
  xJust: tpEvento === '210240' ? XJUST : null,
  ...p,
});

// Padrões copiados dos esquemas (sem validador de XSD: Decisão 7 do plano da entrega 3):
// - `leiauteEvento_v1.00.xsd` do pacote 010d v1.03 (TEvento/infEvento: Id, cOrgao, tpAmb, CNPJ, chNFe, dhEvento = TDateTimeUTC,
//   tpEvento, nSeqEvento, verEvento; TEnvEvento: idLote e de 1 a 20 `evento`);
// - `e210200_v1.00.xsd`, `e210210_v1.00.xsd`, `e210220_v1.00.xsd` e `e210240_v1.00.xsd` do pacote de 2014 (detEvento: versao 1.00,
//   descEvento fixo de cada tipo e, só no 210240, xJust de 15 a 255 caracteres, TString sem espaço nas pontas).
const PADRAO = {
  Id: /^ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}$/,
  chNFe: /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/,
  CNPJ: /^[0-9A-Z]{12}[0-9]{2}$/,
  dhEvento: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+](0\d|1[0-2]):00$/,
  tpEvento: /^[0-9]{6}$/,
  nSeqEvento: /^[1-9][0-9]?$/,
  xJust: /^[!-ÿ][ -ÿ]*[!-ÿ]$/,
  idLote: /^[0-9]{1,15}$/,
};
const ORDEM_INF_EVENTO = ['cOrgao', 'tpAmb', 'CNPJ', 'chNFe', 'dhEvento', 'tpEvento', 'nSeqEvento', 'verEvento', 'detEvento'];

const filhos = (el: NoXml): NoXml[] => Array.from(el.childNodes).filter((n) => n.nodeType === 1) as NoXml[];
const filho = (el: NoXml, nome: string): NoXml => {
  const achados = filhos(el).filter((f) => f.localName === nome);
  expect(achados).toHaveLength(1);
  return achados[0];
};
const valorDe = (el: NoXml, nome: string): string => filho(el, nome).textContent ?? '';
const nomesDosAtributos = (el: NoXml): string[] => Array.from(el.attributes, (a) => a.name).sort();

describe('DESC_EVENTO, C_ORGAO_AN e idDoEvento', () => {
  it('descEvento exato de cada tipo (sem acento, como no esquema)', () => {
    expect(DESC_EVENTO).toEqual({
      '210200': 'Confirmacao da Operacao',
      '210210': 'Ciencia da Operacao',
      '210220': 'Desconhecimento da Operacao',
      '210240': 'Operacao nao Realizada',
    });
    expect(C_ORGAO_AN).toBe('91');
  });
  it('"ID" + tpEvento + chave + "01" (54 caracteres)', () => {
    expect(idDoEvento('210210', VETOR)).toBe(`ID210210${VETOR}01`);
    expect(idDoEvento('210210', VETOR)).toHaveLength(54);
    for (const tp of TIPOS) expect(idDoEvento(tp, VETOR)).toMatch(PADRAO.Id);
  });
});

describe('dhSefaz (Brasília, -03:00 fixo)', () => {
  it('vetores do plano', () => {
    expect(dhSefaz(AGORA)).toBe('2026-11-17T14:05:00-03:00');
    expect(dhSefaz(new Date('2026-11-17T02:30:00Z'))).toBe('2026-11-16T23:30:00-03:00');
  });
  it('sem milissegundos e casando o padrão do esquema', () => {
    expect(dhSefaz(new Date('2026-11-17T17:05:00.999Z'))).toBe('2026-11-17T14:05:00-03:00');
    expect(dhSefaz(new Date('2027-01-01T02:59:59Z'))).toBe('2026-12-31T23:59:59-03:00');
    expect(dhSefaz(AGORA)).toMatch(PADRAO.dhEvento);
  });
});

describe('normalizarJustificativa', () => {
  it.each<[string, string]>([
    ['Mercadoria devolvida — “recusada” na porta’', 'Mercadoria devolvida - "recusada" na porta\''],
    ['  pedido\ncancelado pelo fornecedor  ', 'pedido cancelado pelo fornecedor'],
    ['Pedido cancelad', 'Pedido cancelad'], // 15
    ['‘Devolvido’ – \t\r\n inteiro', "'Devolvido' - inteiro"],
    ['a'.repeat(255), 'a'.repeat(255)],
  ])('ok: %j', (entrada, texto) => {
    expect(normalizarJustificativa(entrada)).toEqual({ ok: true, texto });
  });
  it.each<[string, 'curta' | 'longa' | 'caractere']>([
    ['Pedido cancela', 'curta'], // 14
    ['   Pedido   cancela   ', 'curta'], // 14 depois de juntar os espaços
    ['', 'curta'],
    ['a'.repeat(256), 'longa'],
    ['Devolvido 🍅 inteiro', 'caractere'],
    ['Devolvido \u0001 inteiro', 'caractere'],
    ['Devolvido Ā inteiro', 'caractere'],
  ])('recusa %j: %s', (entrada, erro) => {
    expect(normalizarJustificativa(entrada)).toEqual({ ok: false, erro });
  });
  it('o texto normalizado casa o padrão do esquema e é idempotente', () => {
    const r = normalizarJustificativa(' Mercadoria devolvida — “recusada” na porta’ ');
    expect(r.ok && r.texto).toMatch(PADRAO.xJust);
    if (r.ok) expect(normalizarJustificativa(r.texto)).toEqual(r);
  });
});

describe('montarEvento: padrões dos esquemas, para os 4 tipos e a chave VETOR (com letras)', () => {
  describe.each(TIPOS)('%s', (tp) => {
    it.each(['producao', 'homologacao'] as const)('%s', (ambiente) => {
      const xml = montarEvento(dados(tp, { ambiente }));
      expect(xml.startsWith(`<evento xmlns="${NFE}" versao="1.00"><infEvento Id="`)).toBe(true);
      expect(xml).not.toContain('<?xml');
      expect(xml).not.toContain('Signature');
      expect(xml.endsWith('</detEvento></infEvento></evento>')).toBe(true);

      const evento = lerXml(xml).documentElement!;
      // nenhum prefixo, um só namespace (o da NF-e) em todo o documento
      for (const el of [evento, ...elementos(evento, '*')]) {
        expect(el.prefix).toBeNull();
        expect(el.namespaceURI).toBe(NFE);
      }
      expect(evento.localName).toBe('evento');
      expect(nomesDosAtributos(evento)).toEqual(['versao', 'xmlns']);
      expect(evento.getAttribute('versao')).toBe('1.00');
      expect(filhos(evento).map((f) => f.localName)).toEqual(['infEvento']);

      const inf = filho(evento, 'infEvento');
      expect(nomesDosAtributos(inf)).toEqual(['Id']);
      expect(inf.getAttribute('Id')).toBe(idDoEvento(tp, VETOR));
      expect(inf.getAttribute('Id')).toMatch(PADRAO.Id);
      expect(filhos(inf).map((f) => f.localName)).toEqual(ORDEM_INF_EVENTO);
      expect(valorDe(inf, 'cOrgao')).toBe('91');
      expect(valorDe(inf, 'tpAmb')).toBe(ambiente === 'producao' ? '1' : '2');
      expect(valorDe(inf, 'CNPJ')).toBe('12345678000195');
      expect(valorDe(inf, 'CNPJ')).toMatch(PADRAO.CNPJ);
      expect(valorDe(inf, 'chNFe')).toBe(VETOR);
      expect(valorDe(inf, 'chNFe')).toMatch(PADRAO.chNFe);
      expect(valorDe(inf, 'dhEvento')).toBe('2026-11-17T14:05:00-03:00');
      expect(valorDe(inf, 'dhEvento')).toMatch(PADRAO.dhEvento);
      expect(valorDe(inf, 'tpEvento')).toBe(tp);
      expect(valorDe(inf, 'tpEvento')).toMatch(PADRAO.tpEvento);
      expect(valorDe(inf, 'nSeqEvento')).toBe('1');
      expect(valorDe(inf, 'nSeqEvento')).toMatch(PADRAO.nSeqEvento);
      expect(valorDe(inf, 'verEvento')).toBe('1.00');

      const det = filho(inf, 'detEvento');
      expect(nomesDosAtributos(det)).toEqual(['versao']);
      expect(det.getAttribute('versao')).toBe('1.00');
      expect(filhos(det).map((f) => f.localName)).toEqual(tp === '210240' ? ['descEvento', 'xJust'] : ['descEvento']);
      expect(valorDe(det, 'descEvento')).toBe(DESC_EVENTO[tp]);
      if (tp === '210240') {
        const xJust = valorDe(det, 'xJust');
        expect(xJust).toBe(XJUST);
        expect(xJust).toMatch(PADRAO.xJust);
        expect(xJust.length).toBeGreaterThanOrEqual(15);
        expect(xJust.length).toBeLessThanOrEqual(255);
      }
      // nenhum texto solto (espaço, quebra) entre as marcas
      for (const el of [evento, ...elementos(evento, '*')]) {
        if (filhos(el).length > 0) expect(Array.from(el.childNodes).every((n) => n.nodeType === 1)).toBe(true);
      }
    });
  });

  it('xJust com &, < e > sai escapado, e a leitura devolve o texto original', () => {
    const texto = 'Devolvido & <recusado> na porta';
    const xml = montarEvento(dados('210240', { xJust: texto }));
    expect(xml).toContain('<xJust>Devolvido &amp; &lt;recusado&gt; na porta</xJust>');
    expect(elementos(lerXml(xml), 'xJust')[0].textContent).toBe(texto);
  });

  it('chave sem letras e CNPJ com letras também passam', () => {
    expect(montarEvento(dados('210200', { chave: K880 }))).toContain(`<infEvento Id="ID210200${K880}01">`);
    expect(montarEvento(dados('210200', { cnpjAutor: '12ABC34501DE35' }))).toContain('<CNPJ>12ABC34501DE35</CNPJ>');
  });

  it.each<[string, DadosEvento]>([
    ['xJust fora do 210240', dados('210220', { xJust: XJUST })],
    ['210240 sem xJust', dados('210240', { xJust: null })],
    ['xJust não normalizado', dados('210240', { xJust: `  ${XJUST}\n` })],
    ['xJust curto', dados('210240', { xJust: 'Pedido cancela' })],
    ['xJust com caractere fora da faixa', dados('210240', { xJust: 'Devolvido 🍅 inteiro' })],
    ['chave curta', dados('210210', { chave: VETOR.slice(1) })],
    ['chave com minúscula', dados('210210', { chave: VETOR.toLowerCase() })],
    ['chave com letra fora do lugar', dados('210210', { chave: `A${VETOR.slice(1)}` })],
    ['CNPJ inválido', dados('210210', { cnpjAutor: '1234567800019' })],
    ['CNPJ com letra no dígito', dados('210210', { cnpjAutor: '1234567800019A' })],
    ['dhEvento em UTC (Z)', dados('210210', { dhEvento: '2026-11-17T17:05:00Z' })],
    ['dhEvento com milissegundos', dados('210210', { dhEvento: '2026-11-17T14:05:00.000-03:00' })],
    ['dhEvento sem fuso', dados('210210', { dhEvento: '2026-11-17T14:05:00' })],
    ['tipo desconhecido', dados('110111' as TipoEvento)],
    ['ambiente desconhecido', dados('210210', { ambiente: 'desligado' as DadosEvento['ambiente'] })],
  ])('recusa: %s, com frase fixa (sem o dado)', (_caso, d) => {
    let erro: unknown;
    try {
      montarEvento(d);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(Error);
    const msg = (erro as Error).message;
    expect(msg.length).toBeGreaterThan(0);
    for (const dado of [d.chave, d.cnpjAutor, d.dhEvento, d.xJust ?? 'xJust-nulo', d.tpEvento]) expect(msg).not.toContain(dado);
    expect(msg).not.toContain('<');
  });
});

describe('eventoAssinado', () => {
  it('montarEvento + a Signature logo depois do </infEvento>, com o Id do evento na referência', () => {
    const d = dados('210210');
    const montado = montarEvento(d);
    const assinado = eventoAssinado(d, CLIENTE);
    expect(assinado.startsWith(montado.slice(0, montado.indexOf('</infEvento>')) + `</infEvento><Signature xmlns="${XMLDSIG.ns}">`)).toBe(
      true,
    );
    expect(assinado.endsWith('</Signature></evento>')).toBe(true);
    expect(assinado).toContain(`<Reference URI="#${idDoEvento('210210', VETOR)}">`);
    expect(assinado).not.toContain('<?xml');
  });
});

describe('corpoEnvEvento', () => {
  const a = eventoAssinado(dados('210210'), CLIENTE);
  const b = eventoAssinado(dados('210200', { chave: K880 }), CLIENTE);
  const INICIO =
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" ' +
    'versao="1.00"><idLote>1763399100000</idLote>';

  it('nfeDadosMsg direto (sem o elemento da operação), envEvento com o idLote e os eventos como estão', () => {
    const c = corpoEnvEvento(1763399100000n, [a, b]);
    expect(c.startsWith(INICIO)).toBe(true);
    expect(c).toBe(`${INICIO}${a}${b}</envEvento></nfeDadosMsg>`);
    expect(c).not.toContain('<?xml');
    expect(c).not.toContain('nfeRecepcaoEvento>');
    const doc = lerXml(c);
    const env = elementos(doc, 'envEvento')[0];
    expect(env.namespaceURI).toBe(NFE);
    expect(filhos(env).map((f) => f.localName)).toEqual(['idLote', 'evento', 'evento']);
    expect(valorDe(env, 'idLote')).toMatch(PADRAO.idLote);
  });

  it('20 eventos passa; idLote de 15 dígitos passa', () => {
    expect(() =>
      corpoEnvEvento(
        10n ** 15n - 1n,
        Array.from({ length: 20 }, () => a),
      ),
    ).not.toThrow();
  });

  it.each<[string, bigint, string[]]>([
    ['0 eventos', 1763399100000n, []],
    ['21 eventos', 1763399100000n, Array.from({ length: 21 }, () => a)],
    ['idLote 10^15', 10n ** 15n, [a]],
    ['idLote 0', 0n, [a]],
    ['idLote negativo', -1n, [a]],
    ['evento com declaração XML', 1763399100000n, [`<?xml version="1.0"?>${a}`]],
    ['evento que não é <evento>', 1763399100000n, ['<outro/>']],
  ])('recusa: %s', (_caso, idLote, eventos) => {
    expect(() => corpoEnvEvento(idLote, eventos)).toThrow(Error);
  });
});

// Lote de resposta montado à mão (retEnvEvento_v1.00.xsd), para os casos que as fixtures não cobrem.
const loteSoap = (cStat: string, retEventos: string[] = [], antes = ''): string =>
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" ' +
  `versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>AN_1.0.0</verAplic><cOrgao>91</cOrgao>${antes}` +
  (cStat === '' ? '' : `<cStat>${cStat}</cStat>`) +
  `<xMotivo>teste</xMotivo>${retEventos.join('')}</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`;
const retEvento = (p: { cStat?: string; chave?: string; tp?: string; nSeq?: string; nProt?: string; extra?: string } = {}): string =>
  '<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>AN_1.0.0</verAplic><cOrgao>91</cOrgao>' +
  `<cStat>${p.cStat ?? '135'}</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${p.chave ?? VETOR}</chNFe>` +
  `<tpEvento>${p.tp ?? '210210'}</tpEvento><nSeqEvento>${p.nSeq ?? '1'}</nSeqEvento>${p.extra ?? ''}` +
  `<dhRegEvento>2026-11-17T14:05:02-03:00</dhRegEvento>${p.nProt === undefined ? '' : `<nProt>${p.nProt}</nProt>`}</infEvento></retEvento>`;

const trechosRetEvento = (xml: string): string[] => xml.match(/<retEvento [\s\S]*?<\/retEvento>/g) ?? [];

describe('lerRetornoEventos', () => {
  it('128 com 135 (protocolo de 15 dígitos) e 573 (sem protocolo); xml = o retEvento como veio', () => {
    const corpo = fx('ret-evento-128.xml');
    const [x1, x2] = trechosRetEvento(corpo);
    expect(lerRetornoEventos(corpo)).toEqual({
      cStat: 128,
      xMotivo: 'Lote de Evento Processado',
      retornos: [
        {
          chave: VETOR,
          tpEvento: '210210',
          nSeq: 1,
          cStat: 135,
          xMotivo: 'Evento registrado e vinculado a NF-e',
          nProt: '891261100000001',
          dhRegEvento: '2026-11-17T14:05:02-03:00',
          xml: x1,
        },
        {
          chave: K880,
          tpEvento: '210210',
          nSeq: 1,
          cStat: 573,
          xMotivo: 'Rejeicao: Duplicidade de evento',
          nProt: null,
          dhRegEvento: '2026-11-17T14:05:02-03:00',
          xml: x2,
        },
      ],
    });
    expect(x1.startsWith('<retEvento versao="1.00"><infEvento Id="ID891261100000001">')).toBe(true);
  });

  it('128 com protocolo de 17 dígitos e um cStat de 4 dígitos (1234) lido como número', () => {
    const r = lerRetornoEventos(fx('ret-evento-128-17.xml'));
    expect(r.cStat).toBe(128);
    expect(r.retornos).toHaveLength(2);
    expect(r.retornos[0]).toMatchObject({ chave: VETOR, tpEvento: '210200', nSeq: 1, cStat: 135, nProt: '89126110000000123' });
    expect(r.retornos[1]).toMatchObject({ chave: K77, tpEvento: '210200', nSeq: 1, cStat: 1234, nProt: null });
    expect(typeof r.retornos[1].cStat).toBe('number');
  });

  it('108 sem retEvento', () => {
    expect(lerRetornoEventos(fx('ret-evento-108.xml'))).toEqual({
      cStat: 108,
      xMotivo: 'Servico Paralisado Momentaneamente (curto prazo)',
      retornos: [],
    });
  });

  it('lote com cStat de 4 dígitos (1234) é lido sem erro', () => {
    expect(lerRetornoEventos(loteSoap('1234'))).toEqual({ cStat: 1234, xMotivo: 'teste', retornos: [] });
  });

  it('nProt fora de 15 ou 17 dígitos = null; nSeqEvento ilegível = null; campos ausentes = null', () => {
    const corpo = loteSoap('128', [
      retEvento({ nProt: '1234567890123456' }), // 16
      retEvento({ nProt: '89126110000000A' }),
      retEvento({ nProt: '' }),
      retEvento({ nSeq: 'x' }),
      '<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cStat>999</cStat></infEvento></retEvento>',
    ]);
    const r = lerRetornoEventos(corpo);
    expect(r.retornos.map((x) => x.nProt)).toEqual([null, null, null, null, null]);
    expect(r.retornos[3].nSeq).toBeNull();
    expect(r.retornos[4]).toEqual({
      chave: null,
      tpEvento: null,
      nSeq: null,
      cStat: 999,
      xMotivo: '',
      nProt: null,
      dhRegEvento: null,
      xml: '<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cStat>999</cStat></infEvento></retEvento>',
    });
  });

  it('os campos do lote são os filhos do retEnvEvento, nunca os de um retEvento', () => {
    const corpo = loteSoap('128', [retEvento({ cStat: '135' })]);
    expect(lerRetornoEventos(corpo).cStat).toBe(128);
  });

  it('NUL (cru ou &#0;) some dos textos e do xml do retEvento', () => {
    const corpo = loteSoap('128', [retEvento({ nProt: '891261100000001' })])
      .replace('<xMotivo>teste</xMotivo>', '<xMotivo>tes&#0;te</xMotivo>')
      .replace('<xMotivo>Evento registrado</xMotivo>', '<xMotivo>Evento\u0000 registrado</xMotivo>');
    const r = lerRetornoEventos(corpo);
    expect(r.xMotivo).toBe('teste');
    expect(r.retornos[0].xMotivo).toBe('Evento registrado');
    expect(r.retornos[0].xml).not.toContain('\u0000');
    expect(r.retornos[0].xml).toContain('<xMotivo>Evento registrado</xMotivo>');
  });

  it('comentário com marca de retEvento não confunde o xml de cada um', () => {
    const corpo = loteSoap('128', ['<!-- <retEvento versao="x"> -->', retEvento({ chave: K880 }), '<!-- </retEvento> -->']);
    const r = lerRetornoEventos(corpo);
    expect(r.retornos).toHaveLength(1);
    expect(r.retornos[0].xml).toBe(retEvento({ chave: K880 }));
  });

  it('20 retEvento passa', () => {
    expect(
      lerRetornoEventos(
        loteSoap(
          '128',
          Array.from({ length: 20 }, () => retEvento()),
        ),
      ).retornos,
    ).toHaveLength(20);
  });

  it('resposta inválida vira SEFAZ_RESPOSTA_INVALIDA já enviada, com o passo em que a leitura parou', () => {
    const ruins: [string, string][] = [
      ['soap', '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body/></soap12:Envelope>'],
      ['soap', fx('ret-137.xml')], // resposta de outro serviço
      ['xml', '<!DOCTYPE x [<!ENTITY a "b">]>' + fx('ret-evento-128.xml')],
      ['xml', 'não é xml'],
      ['cStat', loteSoap('12345')],
      ['cStat', loteSoap('12')],
      ['cStat', loteSoap('abc')],
      ['cStat', loteSoap('', [retEvento()])], // lote sem cStat: nunca o do retEvento
      [
        'retEvento',
        loteSoap(
          '128',
          Array.from({ length: 21 }, () => retEvento()),
        ),
      ],
      ['retEvento', loteSoap('128', [retEvento({ cStat: '12345' })])],
      ['retEvento', loteSoap('128', [retEvento({ cStat: '' })])],
      ['retEvento', loteSoap('128', ['<retEvento versao="1.00"><cStat>135</cStat></retEvento>'])], // sem infEvento
      ['retEvento', loteSoap('128', ['<retEvento versao="1.00"/>'])],
      ['retEvento', loteSoap('128', [`<retEvento versao="1.00"><infEvento><cStat>135</cStat>${retEvento()}</infEvento></retEvento>`])],
    ];
    for (const [passo, corpo] of ruins) {
      let erro: unknown;
      try {
        lerRetornoEventos(corpo);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(SefazErro);
      expect(erro).toMatchObject({ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true, passo });
      expect((erro as SefazErro).fault).toBeUndefined();
      expect((erro as Error).message).toBe('A resposta da SEFAZ não pôde ser lida.');
    }
  });

  it('HTTP 200 com SOAP Fault no lugar do retorno: passo soap e o código do Fault, sem o texto dele', () => {
    let erro: unknown;
    try {
      lerRetornoEventos(faultSoap12('soap:Sender'));
    } catch (e) {
      erro = e;
    }
    expect(erro).toMatchObject({ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true, passo: 'soap', fault: 'Sender' });
    expect(JSON.stringify(erro)).not.toContain(SENTINELA_FAULT);
  });
});
