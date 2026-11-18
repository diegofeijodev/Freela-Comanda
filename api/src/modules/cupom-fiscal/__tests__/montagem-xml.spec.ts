import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Oráculo: xml-crypto 6.4.0 (devDependency exata), importado SÓ em arquivos de __tests__. Nenhum teste faz rede: a chave é a do
// certificado fictício (fixtures/tls) e o "envelope real" é montado com as mesmas funções do transporte, sem enviar nada.
import { SignedXml } from 'xml-crypto';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { assinarXmlEnveloped } from '../../sefaz/assinatura-xml';
import { envelopeSoap12, envelopeSoap12SemPrefixo } from '../../sefaz/transporte-soap12';
import { elementos, lerXml, type NoXml } from '../../sefaz/xml-leitura';
import {
  corpoEnviNfe,
  FRASES_MONTAGEM,
  inserirSupl,
  MontagemNfceErro,
  montarNfe,
  montarNfeProc,
  VER_PROC,
  XPROD_HOMOLOGACAO,
  type DadosNfce,
  type ItemXml,
} from '../montagem-xml';
import { hashQrCode, qrCodeV2, URL_CHAVE, URL_QR } from '../qrcode-nfce';
import { calcularTotais, type Totais, type TPag } from '../totais';

const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const CHAVE = '35261112345678000195650010000000121402133776';
const CPF = '52998224725';
const NS_AUTORIZACAO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';

const PRATO: ItemXml = {
  cProd: 'PRATO-01',
  xProd: 'Prato executivo',
  ncm: '21069090',
  cest: null,
  gtin: null,
  origem: 0,
  cfop: '5102',
  unidade: 'UN',
  quantidade: '2',
  valorUnitario: 1200n,
  csosn: '102',
  cstIcms: null,
  aliqIcms: null,
  pisCst: null,
  cofinsCst: null,
};
const CHOPP: ItemXml = {
  cProd: 'CHOPP-300',
  xProd: 'Chopp & "Lager"\u2028<300> ml',
  ncm: '22030000',
  cest: '0302100',
  gtin: '7891000315507',
  origem: 0,
  cfop: '5405',
  unidade: 'UN',
  quantidade: '1',
  valorUnitario: 990n,
  csosn: '500',
  cstIcms: null,
  aliqIcms: null,
  pisCst: '04',
  cofinsCst: '04',
};
const PAGAMENTOS: { tPag: TPag; valor: bigint }[] = [
  { tPag: '01', valor: 3000n },
  { tPag: '03', valor: 1200n },
];

function totaisDe(itens: ItemXml[], desconto: bigint, pagamentos: { tPag: TPag; valor: bigint }[]): Totais {
  const t = calcularTotais(
    itens.map((i) => ({ quantidade: i.quantidade, precoCentavos: i.valorUnitario })),
    desconto,
    pagamentos,
  );
  if ('erro' in t) throw new Error(t.erro);
  return t;
}

/** O cupom da fixture (homologação, CRT 1, 2 itens, desconto de R$ 1,90, dinheiro com troco + crédito), com ajustes. */
function dados(ajuste: Partial<DadosNfce> = {}, desconto = 190n): DadosNfce {
  const base: DadosNfce = {
    tpAmb: 2,
    chave: CHAVE,
    cNF: '40213377',
    serie: 1,
    numero: 12,
    dhEmi: new Date('2026-11-17T17:30:00Z'),
    natOp: 'VENDA',
    emitente: {
      cnpj: '12345678000195',
      razaoSocial: 'Restaurante Teste Ltda',
      nomeFantasia: 'Comanda Teste',
      ie: '123456789012',
      crt: 1,
      logradouro: 'Rua das Flores',
      numero: '100',
      complemento: 'Loja 2',
      bairro: 'Centro',
      codMunicipio: '3556206',
      municipio: 'Valinhos',
      uf: 'SP',
      cep: '13270000',
      telefone: '1932220000',
    },
    consumidorDoc: CPF,
    itens: [PRATO, CHOPP],
    totais: totaisDe([PRATO, CHOPP], 190n, PAGAMENTOS),
    pagamentos: PAGAMENTOS,
    infCpl: 'Obrigado pela preferência! Volte sempre.',
    respTec: { cnpj: '11222333000181', contato: 'Suporte Comanda', email: 'suporte@exemplo.com.br', fone: '11999990000' },
  };
  const d = { ...base, ...ajuste };
  return { ...d, totais: ajuste.totais ?? totaisDe(d.itens, desconto, d.pagamentos) };
}

const fixture = (nome: string): string =>
  readFileSync(join(__dirname, 'fixtures', nome), 'utf8')
    .replace(/>\s+</g, '><')
    .trim();

/** Filhos-elemento diretos, pelo nome local. */
const filhos = (el: NoXml): NoXml[] => Array.from(el.childNodes).filter((n): n is NoXml => n.nodeType === 1);
const nomes = (el: NoXml): string[] => filhos(el).map((n) => n.localName as string);
const raiz = (xml: string): NoXml => lerXml(xml).documentElement as unknown as NoXml;
const texto = (xml: string, nome: string): string[] => elementos(lerXml(xml), nome).map((e) => e.textContent ?? '');

function erroDe(f: () => unknown): MontagemNfceErro {
  try {
    f();
  } catch (e) {
    if (e instanceof MontagemNfceErro) return e;
    throw e;
  }
  throw new Error('não lançou');
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
const assinaturaDe = (xml: string): string => {
  const sigs: string[] = xml.match(/<Signature [\s\S]*?<\/Signature>/g) ?? [];
  expect(sigs).toHaveLength(1);
  return sigs[0];
};

/** A NFC-e como sai para o lote: montada, assinada e com o infNFeSupl (QR v2 do CSC de teste). */
function nfeCompleta(d: DadosNfce = dados()): string {
  const assinada = assinarXmlEnveloped(montarNfe(d), 'NFe' + d.chave, CLIENTE);
  const amb = d.tpAmb === 1 ? 'producao' : 'homologacao';
  return inserirSupl(assinada, qrCodeV2({ chave: d.chave, tpAmb: d.tpAmb, idCsc: 1, csc: CSC_TESTE }), URL_CHAVE[amb]);
}

describe('montarNfe', () => {
  it('o cupom de homologação é igual à fixture (modelo sem assinatura)', () => {
    expect(montarNfe(dados())).toBe(fixture('nfe-homologacao-simples.xml'));
  });

  it('documento próprio com o xmlns no NFe, infNFe Id="NFe<chave>" versao 4.00, sem declaração XML', () => {
    const xml = montarNfe(dados());
    expect(xml.startsWith(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide>`)).toBe(true);
    expect(xml.endsWith('</infNFe></NFe>')).toBe(true);
    expect(nomes(filhos(raiz(xml))[0])).toEqual(['ide', 'emit', 'dest', 'det', 'det', 'total', 'transp', 'pag', 'infAdic', 'infRespTec']);
  });

  it('valores e grupos da §5.2', () => {
    const xml = montarNfe(dados());
    expect(texto(xml, 'xProd')[0]).toBe(XPROD_HOMOLOGACAO);
    expect(xml).toContain('<vProd>24.00</vProd>');
    expect(xml).toContain('<qCom>2.0000</qCom>');
    expect(texto(xml, 'dhEmi')[0]).toBe('2026-11-17T14:30:00-03:00');
    expect(texto(xml, 'dhEmi')[0].endsWith('-03:00')).toBe(true);
    expect(texto(xml, 'verProc')).toEqual([VER_PROC]);
    for (const ausente of ['dhSaiEnt', 'IEST', 'IBSCBS', 'vTotTrib', 'indIntermed', 'cobr', 'IPI', 'II>'])
      expect(xml).not.toContain(`<${ausente}`);
    expect(nomes(elementos(lerXml(xml), 'dest')[0])).toEqual(['CPF', 'indIEDest']);
    // vDesc do item só quando há desconto (o tipo TDec_1302Opc do esquema não aceita zero)
    const semDesconto = montarNfe(dados({}, 0n));
    for (const prod of elementos(lerXml(semDesconto), 'prod')) expect(nomes(prod)).not.toContain('vDesc');
    expect(semDesconto).toContain('<vDesc>0.00</vDesc><vII>');
    expect(elementos(lerXml(xml), 'prod').map((p) => elementos(p, 'vDesc')[0]?.textContent)).toEqual(['1.35', '0.55']);
  });

  it('em produção o xProd do item 1 é o nome do produto (o texto fixo é só da homologação)', () => {
    const xml = montarNfe(dados({ tpAmb: 1 }));
    expect(texto(xml, 'xProd')[0]).toBe('Prato executivo');
    expect(texto(xml, 'tpAmb')).toEqual(['1']);
    expect(xml).not.toContain('HOMOLOGACAO');
  });

  it('card só em 03, 04 e 17, com <tpIntegra>2</tpIntegra>; vTroco só com troco', () => {
    const pagamentos: { tPag: TPag; valor: bigint }[] = [
      { tPag: '01', valor: 600n },
      { tPag: '03', valor: 500n },
      { tPag: '04', valor: 500n },
      { tPag: '10', valor: 500n },
      { tPag: '11', valor: 500n },
      { tPag: '17', valor: 600n },
    ];
    const xml = montarNfe(dados({ pagamentos }));
    const detPag = elementos(lerXml(xml), 'detPag');
    expect(detPag).toHaveLength(6);
    for (const d of detPag) {
      const tPag = elementos(d, 'tPag')[0].textContent;
      const card = elementos(d, 'card');
      if (['03', '04', '17'].includes(tPag ?? '')) {
        expect(nomes(d)).toEqual(['tPag', 'vPag', 'card']);
        expect(card).toHaveLength(1);
        expect(nomes(card[0])).toEqual(['tpIntegra']);
        expect(card[0].textContent).toBe('2');
      } else {
        expect(nomes(d)).toEqual(['tPag', 'vPag']);
      }
    }
    expect(xml).not.toContain('<vTroco>');
    expect(montarNfe(dados())).toContain('</detPag><vTroco>10.00</vTroco></pag>');
  });

  it('texto livre: & < > " escapados e U+2028 vira espaço (lido de volta igual)', () => {
    const xml = montarNfe(dados());
    expect(xml).toContain('<xProd>Chopp &amp; &quot;Lager&quot; &lt;300&gt; ml</xProd>');
    expect(texto(xml, 'xProd')[1]).toBe('Chopp & "Lager" <300> ml');
    expect(xml).not.toMatch(/[\u0085\u2028\u2029]/);
  });

  it('texto livre: aspas e travessões do teclado viram ASCII, acento decomposto vira composto, controles somem', () => {
    const item: ItemXml = { ...PRATO, xProd: '“Especial” – Cafe\u0301\u0007 com pão\u2029' };
    const xml = montarNfe(dados({ tpAmb: 1, itens: [item, CHOPP] }));
    expect(texto(xml, 'xProd')[0]).toBe('"Especial" - Café com pão');
  });

  it('texto livre: quebra de linha e tabulação viram espaço (não colam as palavras)', () => {
    const xml = montarNfe(dados({ infCpl: 'Obrigado!\nVolte sempre\tamanhã\r\nfim' }));
    expect(texto(xml, 'infCpl')).toEqual(['Obrigado! Volte sempre amanhã fim']);
  });

  it('texto livre: caractere fora do que a SEFAZ aceita (U+0020–U+00FF) é recusado com frase fixa, sem o texto', () => {
    const item: ItemXml = { ...CHOPP, xProd: 'Chopp gelado 🍺' };
    const e = erroDe(() => montarNfe(dados({ tpAmb: 1, itens: [PRATO, item] })));
    expect(e.message).toBe(FRASES_MONTAGEM.caractere('o nome do produto'));
    expect(e.message).not.toContain('Chopp');
    expect(erroDe(() => montarNfe(dados({ natOp: 'Venda ✓' }))).message).toBe(FRASES_MONTAGEM.caractere('a natureza da operação'));
  });

  it('texto livre: comprido demais é cortado no tamanho do esquema; vazio depois de limpo é recusado (ou omitido, se opcional)', () => {
    const longo = montarNfe(dados({ tpAmb: 1, itens: [{ ...PRATO, xProd: 'x'.repeat(130) }, CHOPP] }));
    expect(texto(longo, 'xProd')[0]).toBe('x'.repeat(120));
    expect(erroDe(() => montarNfe(dados({ natOp: ' \u2028 ' }))).message).toBe(FRASES_MONTAGEM.vazio('a natureza da operação'));
    const semOpcionais = montarNfe(
      dados({ infCpl: '  ', respTec: null, emitente: { ...dados().emitente, nomeFantasia: '\u0007', complemento: null, telefone: null } }),
    );
    for (const ausente of ['xFant', 'xCpl', '<fone', 'infAdic', 'infRespTec']) expect(semOpcionais).not.toContain(ausente);
  });

  it('sem consumidor: sem dest; com CNPJ: CNPJ + indIEDest 9; documento que não confere é recusado sem o número na frase', () => {
    expect(montarNfe(dados({ consumidorDoc: null }))).not.toContain('<dest>');
    expect(montarNfe(dados({ consumidorDoc: '12ABC34501DE35' }))).toContain(
      '<dest><CNPJ>12ABC34501DE35</CNPJ><indIEDest>9</indIEDest></dest>',
    );
    const e = erroDe(() => montarNfe(dados({ consumidorDoc: '52998224724' })));
    expect(e.message).toBe(FRASES_MONTAGEM.consumidor);
    expect(e.message).not.toContain('5299822472');
  });

  it.each([
    [1, '102', null, 'ICMSSN102'],
    [1, '103', null, 'ICMSSN102'],
    [1, '300', null, 'ICMSSN102'],
    [1, '400', null, 'ICMSSN102'],
    [2, '500', null, 'ICMSSN500'],
    [4, '900', null, 'ICMSSN900'],
    [3, null, '40', 'ICMS40'],
    [3, null, '41', 'ICMS40'],
    [3, null, '60', 'ICMS60'],
    [3, null, '90', 'ICMS90'],
  ] as const)('ICMS: CRT %s, CSOSN %s, CST %s → %s só com orig e o código', (crt, csosn, cst, grupo) => {
    const item: ItemXml = { ...PRATO, origem: 2, csosn, cstIcms: cst };
    const xml = montarNfe(dados({ emitente: { ...dados().emitente, crt }, itens: [item] }));
    const icms = elementos(lerXml(xml), 'ICMS')[0];
    expect(nomes(icms)).toEqual([grupo]);
    expect(nomes(filhos(icms)[0])).toEqual(['orig', csosn ? 'CSOSN' : 'CST']);
    expect(filhos(icms)[0].textContent).toBe(`2${csosn ?? cst}`);
    expect(xml).toContain('<ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS>');
  });

  it('ICMS: CST 00 leva modBC 3, vBC = valor do item menos o desconto, pICMS com 2 casas e vICMS arredondado; os totais somam', () => {
    // item 1: 24,00 − 1,35 = 22,65 × 18% = 4,077 → 4,08; item 2: 9,90 − 0,55 = 9,35 × 7% = 0,6545 → 0,65
    const itens: ItemXml[] = [
      { ...PRATO, csosn: null, cstIcms: '00', aliqIcms: '18' },
      { ...CHOPP, csosn: null, cstIcms: '00', aliqIcms: '7.00', pisCst: null, cofinsCst: null },
    ];
    const xml = montarNfe(dados({ emitente: { ...dados().emitente, crt: 3 }, itens }));
    expect(xml).toContain(
      '<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>22.65</vBC><pICMS>18.00</pICMS><vICMS>4.08</vICMS></ICMS00></ICMS>',
    );
    expect(xml).toContain('<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>9.35</vBC><pICMS>7.00</pICMS><vICMS>0.65</vICMS>');
    expect(xml).toContain('<ICMSTot><vBC>32.00</vBC><vICMS>4.73</vICMS>');
  });

  it('ICMS: CST 00 sem alíquota (ou torta) é recusado; CST 20 é sempre recusado (barrado por ora, como na validação)', () => {
    const normal = { ...dados().emitente, crt: 3 as const };
    expect(erroDe(() => montarNfe(dados({ emitente: normal, itens: [{ ...PRATO, csosn: null, cstIcms: '00' }] }))).message).toBe(
      FRASES_MONTAGEM.semAliquota,
    );
    expect(FRASES_MONTAGEM.semAliquota).toBe('Informe a alíquota do ICMS.');
    expect(FRASES_MONTAGEM.cst20).toBe('O CST 20 ainda não pode ser usado no Comanda. Fale com o contador.');
    expect(FRASES_MONTAGEM.pisCofins).toBe('Este CST de PIS/COFINS ainda não pode ser usado no Comanda. Fale com o contador.');
    expect(erroDe(() => montarNfe(dados({ emitente: normal, itens: [{ ...PRATO, csosn: null, cstIcms: '20' }] }))).message).toBe(
      FRASES_MONTAGEM.cst20,
    );
    expect(
      erroDe(() => montarNfe(dados({ emitente: normal, itens: [{ ...PRATO, csosn: null, cstIcms: '00', aliqIcms: '18.123' }] }))).message,
    ).toBe(FRASES_MONTAGEM.aliquota);
    expect(
      erroDe(() => montarNfe(dados({ emitente: normal, itens: [{ ...PRATO, csosn: null, cstIcms: '20', aliqIcms: '18.00' }] }))).message,
    ).toBe(FRASES_MONTAGEM.cst20);
  });

  it('ICMS: código que não confere com o regime, os dois juntos, nenhum ou fora da lista é recusado', () => {
    const e = dados().emitente;
    const casos: [1 | 2 | 3 | 4, string | null, string | null, string][] = [
      [1, null, '00', FRASES_MONTAGEM.regime],
      [3, '102', null, FRASES_MONTAGEM.regime],
      [1, '102', '40', FRASES_MONTAGEM.regime],
      [1, null, null, FRASES_MONTAGEM.regime],
      [1, '101', null, FRASES_MONTAGEM.codigoIcms],
      [3, null, '10', FRASES_MONTAGEM.codigoIcms],
      [3, null, 'constructor', FRASES_MONTAGEM.codigoIcms],
    ];
    for (const [crt, csosn, cst, frase] of casos)
      expect(erroDe(() => montarNfe(dados({ emitente: { ...e, crt }, itens: [{ ...PRATO, csosn, cstIcms: cst }] }))).message).toBe(frase);
  });

  it('PIS/COFINS: vazio = grupo omitido; 04 a 09 = NT; 49 e 99 = Outr com zeros; os que pedem alíquota são recusados', () => {
    const sem = montarNfe(dados({ itens: [{ ...PRATO, pisCst: null, cofinsCst: '' }] }));
    expect(sem).not.toContain('<PIS>');
    expect(sem).not.toContain('<COFINS>');
    const nt = montarNfe(dados({ itens: [{ ...PRATO, pisCst: '07', cofinsCst: '09' }] }));
    expect(nt).toContain('</ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>09</CST></COFINSNT></COFINS></imposto>');
    const outr = montarNfe(dados({ itens: [{ ...PRATO, pisCst: '49', cofinsCst: '99' }] }));
    expect(outr).toContain(
      '</ICMS><PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>' +
        '<COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto>',
    );
    expect(outr).toContain('<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>');
    for (const [pis, cofins] of [
      ['01', null],
      ['50', null],
      [null, '98'],
      ['03', '03'],
      ['10', null],
    ])
      expect(erroDe(() => montarNfe(dados({ itens: [{ ...PRATO, pisCst: pis, cofinsCst: cofins }] }))).message).toBe(
        FRASES_MONTAGEM.pisCofins,
      );
  });

  it('códigos com espaços em volta são aparados (como na validação)', () => {
    const item: ItemXml = {
      ...CHOPP,
      csosn: ' 500 ',
      ncm: ' 22030000',
      cest: '0302100 ',
      gtin: ' 7891000315507 ',
      cfop: ' 5405 ',
      pisCst: ' 49 ',
    };
    expect(montarNfe(dados({ itens: [PRATO, item] }))).toContain(
      '<cEAN>7891000315507</cEAN><xProd>Chopp &amp; &quot;Lager&quot; &lt;300&gt; ml</xProd><NCM>22030000</NCM><CEST>0302100</CEST><CFOP>5405</CFOP>',
    );
    expect(montarNfe(dados({ itens: [PRATO, item] }))).toContain(
      '<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS><PIS><PISOutr><CST>49</CST>',
    );
    const normal = { ...dados().emitente, crt: 3 as const };
    expect(montarNfe(dados({ emitente: normal, itens: [{ ...PRATO, csosn: null, cstIcms: ' 00 ', aliqIcms: ' 18 ' }] }))).toContain(
      '<CST>00</CST><modBC>3</modBC>',
    );
  });

  it('chave que não confere com a nota (CNPJ, série, número, cNF ou mês do dhEmi) é recusada', () => {
    expect(erroDe(() => montarNfe(dados({ numero: 13 }))).message).toBe(FRASES_MONTAGEM.chave);
    expect(erroDe(() => montarNfe(dados({ cNF: '40213378' }))).message).toBe(FRASES_MONTAGEM.chave);
    // 01/12 00:10 em Brasília é 01/12 03:10 UTC: o mês da chave (2611) não confere
    expect(erroDe(() => montarNfe(dados({ dhEmi: new Date('2026-12-01T03:10:00Z') }))).message).toBe(FRASES_MONTAGEM.chave);
    // 30/11 23:50 em Brasília já é 01/12 em UTC, e a chave de novembro confere
    expect(() => montarNfe(dados({ dhEmi: new Date('2026-12-01T02:50:00Z') }))).not.toThrow();
    expect(erroDe(() => montarNfe(dados({ dhEmi: new Date('x') }))).message).toBe(FRASES_MONTAGEM.chave);
  });

  it('totais que não conferem com os itens e os pagamentos são recusados', () => {
    const t = dados().totais;
    const casos: Totais[] = [
      { ...t, produtos: t.produtos + 1n },
      { ...t, desconto: 0n },
      { ...t, troco: 0n },
      { ...t, itens: [t.itens[0]] },
      {
        ...t,
        itens: [
          { ...t.itens[0], desconto: t.itens[0].desconto + 1n },
          { ...t.itens[1], desconto: t.itens[1].desconto - 1n },
        ],
      },
    ];
    for (const totais of casos) expect(erroDe(() => montarNfe(dados({ totais }))).message).toBe(FRASES_MONTAGEM.totais);
    expect(erroDe(() => montarNfe(dados({ itens: [{ ...PRATO, quantidade: '0,5' }, CHOPP], totais: t }))).message).toBe(
      FRASES_MONTAGEM.totais,
    );
    expect(erroDe(() => montarNfe(dados({ itens: [{ ...PRATO, valorUnitario: 0n }, CHOPP], totais: t }))).message).toBe(
      FRASES_MONTAGEM.totais,
    );
  });

  it('dado fora do formato do esquema é recusado com o nome do campo', () => {
    const e = dados().emitente;
    const casos: [Partial<DadosNfce>, string][] = [
      [{ itens: [{ ...PRATO, ncm: '2106909' }] }, 'o NCM do produto'],
      [{ itens: [{ ...PRATO, cest: '030210' }] }, 'o CEST do produto'],
      [{ itens: [{ ...PRATO, gtin: '7891000315508' }] }, 'o GTIN do produto'],
      [{ itens: [{ ...PRATO, cfop: '510' }] }, 'o CFOP do produto'],
      [{ itens: [{ ...PRATO, origem: 9 }] }, 'a origem do produto'],
      [{ emitente: { ...e, ie: '12.345' } }, 'a IE da empresa'],
      [{ emitente: { ...e, cep: '1327000' } }, 'o CEP da empresa'],
      [{ emitente: { ...e, codMunicipio: '355620' } }, 'o município da empresa'],
      [{ emitente: { ...e, uf: 'MG' } }, 'a UF da empresa'],
      [{ emitente: { ...e, telefone: '12345' } }, 'o telefone da empresa'],
      [{ emitente: { ...e, cnpj: '12345678000196' } }, 'o CNPJ da empresa'],
      [{ cNF: '4021337' }, 'o código numérico do cupom'],
      [{ respTec: { ...dados().respTec!, fone: '' } }, 'o telefone do responsável técnico'],
      [{ respTec: { ...dados().respTec!, cnpj: '11222333000180' } }, 'o CNPJ do responsável técnico'],
      [{ pagamentos: [{ tPag: '99' as TPag, valor: 3200n }] }, 'a forma de pagamento'],
    ];
    for (const [ajuste, campo] of casos) expect(erroDe(() => montarNfe(dados(ajuste))).message).toBe(FRASES_MONTAGEM.formato(campo));
  });

  it('o código do município vai aparado também no cMunFG (nenhum dado entra cru)', () => {
    const xml = montarNfe(dados({ emitente: { ...dados().emitente, codMunicipio: ' 3556206 ' } }));
    expect(xml).toContain('<cMunFG>3556206</cMunFG>');
    expect(xml).toContain('<cMun>3556206</cMun>');
  });

  it('quantidade com zero à esquerda ("02") sai no qCom/qTrib sem ele ("2.0000"): a mesma função decimal4 dos totais', () => {
    const d = dados();
    const xml = montarNfe({ ...d, itens: [{ ...d.itens[0], quantidade: '0' + d.itens[0].quantidade }, ...d.itens.slice(1)] });
    expect(xml).not.toMatch(/<qCom>0[0-9]/);
    expect(xml).not.toMatch(/<qTrib>0[0-9]/);
  });

  it('o telefone da empresa aceita máscara (só os dígitos vão para o XML)', () => {
    const xml = montarNfe(dados({ emitente: { ...dados().emitente, telefone: '(19) 3222-0000' } }));
    expect(xml).toContain('<fone>1932220000</fone>');
  });
});

describe('QR Code v2 (on-line)', () => {
  it('vetor OFICIAL do Manual DANFE NFC-e v6.0, §4.3.6.1 (entrada e hash conferidos com sha1sum)', () => {
    const chave = '28170800156225000131650110000151341562040824';
    const qr = qrCodeV2({ chave, tpAmb: 1, idCsc: 1, csc: 'SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES' });
    expect(qr).toBe(`${URL_QR.producao}?p=${chave}|2|1|1|DC6AE2C2B9A992BE59679AC365E29922DE6B7511`);
  });

  it('vetor OFICIAL OFF-LINE do Manual DANFE NFC-e v6.0, §4.3.6.2: a mesma regra do hash (7 campos + CSC colado, sem "|")', () => {
    // a fase 2 (contingência, tpEmis 9) ainda não monta o QR; o vetor prova a regra comum do hash. Fonte: vetor-qrcode.md (sha1sum)
    const digValHex = Buffer.from('yzGYhUx1/XYYzksWB+fPR3Qc50c=', 'utf8').toString('hex'); // o hex dos 28 CARACTERES base64
    expect(digValHex).toBe('797a4759685578312f5859597a6b7357422b6650523351633530633d');
    const p = `28170800156225000131650110000151349562040824|2|1|02|60.90|${digValHex}|1`;
    expect(hashQrCode(p, 'SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES')).toBe('4615A93BB0D7C4E780F8D30EE77EDD5BA55C7D66');
    // com "|" antes do CSC o hash é outro (contraprova do vetor)
    expect(hashQrCode(`${p}|`, 'SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES')).not.toBe('4615A93BB0D7C4E780F8D30EE77EDD5BA55C7D66');
  });

  it('casa com o padrão v2 on-line do esquema e o hash é o SHA-1 maiúsculo de "<chave>|2|<tpAmb>|<IdCSC>" + CSC', () => {
    const qr = qrCodeV2({ chave: CHAVE, tpAmb: 2, idCsc: 1, csc: CSC_TESTE });
    expect(qr).toMatch(/\?p=[0-9]{6}[0-9A-Z]{12}[0-9]{16}[134][0-9]{9}\|2\|[1-2]\|(0|[1-9]([0-9]{1,5})?)\|[A-F0-9]{40}$/);
    const hash = createHash('sha1')
      .update(CHAVE + '|2|2|1' + CSC_TESTE)
      .digest('hex')
      .toUpperCase();
    expect(qr).toBe(`${URL_QR.homologacao}?p=${CHAVE}|2|2|1|${hash}`);
    expect(qr.length).toBeGreaterThanOrEqual(60);
  });

  it('IdCSC 000001 vira 1; a URL é a do ambiente; o CSC nunca aparece (nem na URL, nem no erro)', () => {
    const qr = qrCodeV2({ chave: CHAVE, tpAmb: 2, idCsc: Number('000001'), csc: CSC_TESTE });
    expect(qr).toContain(`|2|2|1|`);
    expect(qr).not.toContain(CSC_TESTE);
    expect(qrCodeV2({ chave: CHAVE, tpAmb: 1, idCsc: 123456, csc: CSC_TESTE })).toContain(`${URL_QR.producao}?p=${CHAVE}|2|1|123456|`);
    for (const p of [
      { chave: CHAVE, tpAmb: 2 as const, idCsc: 0, csc: CSC_TESTE },
      { chave: CHAVE, tpAmb: 2 as const, idCsc: 1_000_000, csc: CSC_TESTE },
      { chave: CHAVE, tpAmb: 2 as const, idCsc: 1.5, csc: CSC_TESTE },
      { chave: CHAVE, tpAmb: 3 as 2, idCsc: 1, csc: CSC_TESTE },
      { chave: CHAVE.slice(0, 34) + '9' + CHAVE.slice(35), tpAmb: 2 as const, idCsc: 1, csc: CSC_TESTE },
      { chave: CHAVE, tpAmb: 2 as const, idCsc: 1, csc: '' },
    ]) {
      let msg = '';
      try {
        qrCodeV2(p);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).not.toBe('');
      expect(msg).not.toContain(CSC_TESTE);
    }
  });

  it('URLs de SP da §5.6 (forma longa do QR; urlChave da consulta pública)', () => {
    expect(URL_QR).toEqual({
      producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
      homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
    });
    expect(URL_CHAVE).toEqual({
      producao: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica',
      homologacao: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica',
    });
  });
});

describe('montagem completa: assinatura, infNFeSupl e lote', () => {
  it('depois de assinar e inserir o QR, os filhos de NFe são infNFe, infNFeSupl e Signature, nesta ordem', () => {
    const xml = nfeCompleta();
    expect(nomes(raiz(xml))).toEqual(['infNFe', 'infNFeSupl', 'Signature']);
    const supl = filhos(raiz(xml))[1];
    expect(nomes(supl)).toEqual(['qrCode', 'urlChave']);
    expect(elementos(supl, 'qrCode')[0].textContent).toBe(qrCodeV2({ chave: CHAVE, tpAmb: 2, idCsc: 1, csc: CSC_TESTE }));
    expect(elementos(supl, 'urlChave')[0].textContent).toBe(URL_CHAVE.homologacao);
    expect(xml).not.toContain(CSC_TESTE);
  });

  it('ORÁCULO: o xml-crypto confere a assinatura do infNFe dentro do envelope SOAP sem prefixo inteiro', () => {
    const nfe = nfeCompleta();
    const enviNfe = corpoEnviNfe(1n, nfe);
    expect(enviNfe).toBe(
      `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`,
    );
    // como o brief escreve: o enviNFe direto no Body
    const documento = envelopeSoap12SemPrefixo(enviNfe);
    expect(documento).not.toMatch(/xmlns:/);
    expect(confereNoDocumento(documento, assinaturaDe(documento))).toBe(true);
    // como o adaptador vai mandar (desenho §8.3: o nfeDadosMsg é dele): Body > nfeDadosMsg > enviNFe > NFe
    const real = envelopeSoap12SemPrefixo(`<nfeDadosMsg xmlns="${NS_AUTORIZACAO}">${enviNfe}</nfeDadosMsg>`);
    expect(confereNoDocumento(real, assinaturaDe(real))).toBe(true);
    // e a NFe sozinha (é ela que vai para o nfeProc guardado)
    expect(confereNoDocumento(nfe, assinaturaDe(nfe))).toBe(true);
  });

  it('controles: um byte do infNFe adulterado derruba; o envelope prefixado (xmlns:soap12/xsi/xsd) derruba; mexer no infNFeSupl não', () => {
    const enviNfe = corpoEnviNfe(1n, nfeCompleta());
    const real = envelopeSoap12SemPrefixo(`<nfeDadosMsg xmlns="${NS_AUTORIZACAO}">${enviNfe}</nfeDadosMsg>`);
    const adulterado = real.replace('<vNF>32.00</vNF>', '<vNF>32.01</vNF>');
    expect(adulterado).not.toBe(real);
    expect(confereNoDocumento(adulterado, assinaturaDe(adulterado))).toBe(false);
    const prefixado = envelopeSoap12(`<nfeDadosMsg xmlns="${NS_AUTORIZACAO}">${enviNfe}</nfeDadosMsg>`);
    expect(confereNoDocumento(prefixado, assinaturaDe(prefixado))).toBe(false);
    const outroQr = real.replace(/<urlChave>[^<]*<\/urlChave>/, `<urlChave>${URL_CHAVE.producao}</urlChave>`);
    expect(outroQr).not.toBe(real);
    expect(confereNoDocumento(outroQr, assinaturaDe(outroQr))).toBe(true);
  });

  it('com nome escapado e acento (UTF-8 de 2 bytes), a assinatura também confere no envelope', () => {
    const nfe = nfeCompleta(dados({ tpAmb: 1, itens: [{ ...PRATO, xProd: 'Pão & "Café" <grande>' }, CHOPP] }));
    const real = envelopeSoap12SemPrefixo(`<nfeDadosMsg xmlns="${NS_AUTORIZACAO}">${corpoEnviNfe(123456789012345n, nfe)}</nfeDadosMsg>`);
    expect(confereNoDocumento(real, assinaturaDe(real))).toBe(true);
  });

  it('inserirSupl recusa NFe sem assinatura, QR repetido, QR de outra chave e QR fora do padrão v2', () => {
    const qr = qrCodeV2({ chave: CHAVE, tpAmb: 2, idCsc: 1, csc: CSC_TESTE });
    const assinada = assinarXmlEnveloped(montarNfe(dados()), 'NFe' + CHAVE, CLIENTE);
    expect(() => inserirSupl(montarNfe(dados()), qr, URL_CHAVE.homologacao)).toThrow();
    const uma = inserirSupl(assinada, qr, URL_CHAVE.homologacao);
    expect(() => inserirSupl(uma, qr, URL_CHAVE.homologacao)).toThrow();
    const outraChave = CHAVE.slice(0, 43) + (CHAVE[43] === '0' ? '1' : '0');
    expect(() => inserirSupl(assinada, qr.replace(CHAVE, outraChave), URL_CHAVE.homologacao)).toThrow();
    expect(() => inserirSupl(assinada, qr.slice(0, -1), URL_CHAVE.homologacao)).toThrow();
    expect(() => inserirSupl(assinada, qr, 'https://x')).toThrow();
  });

  it('corpoEnviNfe: idLote de 1 a 15 dígitos; só NFe assinada e com infNFeSupl; teto de 500 KB (rejeição 214)', () => {
    const nfe = nfeCompleta();
    expect(() => corpoEnviNfe(0n, nfe)).toThrow();
    expect(() => corpoEnviNfe(10n ** 15n, nfe)).toThrow();
    expect(corpoEnviNfe(10n ** 15n - 1n, nfe)).toContain('<idLote>999999999999999</idLote>');
    expect(() => corpoEnviNfe(1n, montarNfe(dados()))).toThrow();
    expect(() => corpoEnviNfe(1n, assinarXmlEnveloped(montarNfe(dados()), 'NFe' + CHAVE, CLIENTE))).toThrow();
    const grande = nfe.replace('</infNFeSupl>', '</infNFeSupl>' + ' '.repeat(500 * 1024));
    expect(erroDe(() => corpoEnviNfe(1n, grande)).message).toBe(FRASES_MONTAGEM.tamanho);
  });

  it('montarNfeProc: NFe byte a byte + protNFe como veio; a assinatura continua conferindo', () => {
    const nfe = nfeCompleta();
    const prot =
      '<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>' +
      CHAVE +
      '</chNFe><dhRecbto>2026-11-17T14:30:02-03:00</dhRecbto><nProt>13526000000000123</nProt><digVal>x</digVal><cStat>100</cStat>' +
      '<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>';
    const proc = montarNfeProc(nfe, prot);
    expect(proc).toBe(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${prot}</nfeProc>`);
    expect(confereNoDocumento(proc, assinaturaDe(proc))).toBe(true);
    expect(() => montarNfeProc(nfe, '<retEnviNFe/>')).toThrow();
    expect(() => montarNfeProc('<NFe/>', prot)).toThrow();
  });

  // Opcional (plano): só roda com o xmllint instalado e o pacote 010h v1.03 em fixtures/xsd (não versionado). Nenhuma rede.
  const XSD = join(__dirname, 'fixtures', 'xsd', 'nfe_v4.00.xsd');
  const temXmllint = (() => {
    try {
      execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  (temXmllint && existsSync(XSD) && existsSync(join(__dirname, 'fixtures', 'xsd', 'leiauteNFe_v4.00.xsd')) ? it : it.skip)(
    'xmllint --schema (010h v1.03) aceita a NFe completa',
    () => {
      expect(() =>
        execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, '-'], { input: nfeCompleta(), stdio: 'pipe' }),
      ).not.toThrow();
    },
  );
});
