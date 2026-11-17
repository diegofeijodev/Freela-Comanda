import { createHash, generateKeyPairSync, verify, X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// Oráculo: xml-crypto 6.4.0 (devDependency exata), importado SÓ em arquivos de __tests__. Nenhum teste faz rede: a chave e o
// certificado são os fictícios de fixtures/tls.
import { SignedXml } from 'xml-crypto';
import { AssinaturaErro, assinarXmlEnveloped, canonicalizar, XMLDSIG } from '../assinatura-xml';
import { elementos, lerXml } from '../xml-leitura';
import { CLIENTE } from './certificado-teste';

const NFE = 'http://www.portalfiscal.inf.br/nfe';
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const ID = `ID210240${VETOR}01`;
const CAMPOS =
  `<cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>12345678000195</CNPJ><chNFe>${VETOR}</chNFe>` +
  '<dhEvento>2026-11-17T14:05:00-03:00</dhEvento><tpEvento>210240</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>';
const XJUST = 'Devolvido &amp; recusado &lt;na porta&gt; ção';
const DET = `<detEvento versao="1.00"><descEvento>Operacao nao Realizada</descEvento><xJust>${XJUST}</xJust></detEvento>`;
const montar = (inf: string, raiz = `<evento xmlns="${NFE}" versao="1.00">`): string => `${raiz}${inf}</evento>`;
const EVENTO = montar(`<infEvento Id="${ID}">${CAMPOS}${DET}</infEvento>`);

// atributos fora de ordem (maiúscula antes de minúscula), escapes de atributo e de texto, CR por referência, CDATA, espaços entre
// marcas, elemento vazio e um `xmlns` redundante num descendente
const ESPINHOSO = montar(
  `<infEvento z="1" Id="${ID}" a="&quot;&amp;&lt;&gt;&#9;&#10;&#13;'" versao="1.00">\n  <cOrgao xmlns="${NFE}">91</cOrgao>\n` +
    `  <xJust>t &amp; &lt; &gt; &#13; "' ção</xJust><vazio/><![CDATA[<b>&]]>\n</infEvento>`,
);

const FRASE = 'O XML não pôde ser assinado.';
const AC_TESTE = new X509Certificate(readFileSync(join(__dirname, 'fixtures', 'tls', 'ac-teste.pem'), 'utf8'));

const trecho = (xml: string, de: string, ate: string): string => xml.slice(xml.indexOf(de), xml.indexOf(ate) + ate.length);
const valor = (xml: string, marca: string): string | undefined => xml.match(new RegExp(`<${marca}>([^<]*)</${marca}>`))?.[1];

function confere(xml: string): boolean {
  const verificador = new SignedXml({ publicCert: CLIENTE.certificado.toString() });
  verificador.loadSignature(trecho(xml, '<Signature', '</Signature>'));
  return verificador.checkSignature(xml);
}

function assinadoPeloXmlCrypto(xml: string): string {
  const xpath = "//*[local-name(.)='infEvento']";
  const sig = new SignedXml({
    privateKey: CLIENTE.chavePrivada, // o KeyObject, nunca exportado
    signatureAlgorithm: XMLDSIG.rsaSha1,
    canonicalizationAlgorithm: XMLDSIG.c14n,
  });
  sig.addReference({ xpath, transforms: [XMLDSIG.enveloped, XMLDSIG.c14n], digestAlgorithm: XMLDSIG.sha1 });
  sig.computeSignature(xml, { location: { reference: xpath, action: 'after' } });
  return sig.getSignedXml();
}

function recusa(fn: () => unknown): AssinaturaErro {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AssinaturaErro);
    return e as AssinaturaErro;
  }
  throw new Error('não recusou');
}

describe('xml-crypto 6.4.0 (oráculo)', () => {
  it('ainda aceita RSA-SHA1 e SHA-1', () => {
    const xml = assinadoPeloXmlCrypto(EVENTO);
    expect(xml).toContain(`<SignatureMethod Algorithm="${XMLDSIG.rsaSha1}"`);
    expect(xml).toContain(`<DigestMethod Algorithm="${XMLDSIG.sha1}"`);
    expect(confere(xml)).toBe(true);
  });
});

describe('assinarXmlEnveloped', () => {
  it('xml-crypto confere a nossa', () => {
    expect(confere(assinarXmlEnveloped(EVENTO, ID, CLIENTE))).toBe(true);
    expect(confere(assinarXmlEnveloped(ESPINHOSO, ID, CLIENTE))).toBe(true);
  });

  it.each([
    ['o evento', EVENTO],
    ['o espinhoso (ordem de atributos, escapes, CDATA, espaços)', ESPINHOSO],
  ])('igual ao xml-crypto byte a byte: %s', (_nome, xml) => {
    const nossa = assinarXmlEnveloped(xml, ID, CLIENTE);
    const deles = assinadoPeloXmlCrypto(xml);
    expect(valor(nossa, 'DigestValue')).toBe(valor(deles, 'DigestValue'));
    expect(valor(nossa, 'SignatureValue')).toBe(valor(deles, 'SignatureValue'));
    expect(valor(nossa, 'SignatureValue')).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('adulterado não confere', () => {
    const assinado = assinarXmlEnveloped(EVENTO, ID, CLIENTE);
    const adulterado = assinado.replace('Devolvido', 'Devolvida');
    expect(adulterado).not.toBe(assinado);
    expect(confere(adulterado)).toBe(false);
  });

  it('posição: a Signature é irmã logo depois do infEvento, dentro do evento', () => {
    const assinado = assinarXmlEnveloped(EVENTO, ID, CLIENTE);
    expect(assinado).toContain(`</infEvento><Signature xmlns="${XMLDSIG.ns}">`);
    expect(assinado.endsWith('</Signature></evento>')).toBe(true);
    expect(assinado.startsWith(EVENTO.slice(0, EVENTO.indexOf('</infEvento>')))).toBe(true);
  });

  it('a Signature tem exatamente a forma fixa (sem espaços entre as marcas)', () => {
    const assinado = assinarXmlEnveloped(EVENTO, ID, CLIENTE);
    const dv = valor(assinado, 'DigestValue');
    const sv = valor(assinado, 'SignatureValue');
    expect(trecho(assinado, '<Signature', '</Signature>')).toBe(
      `<Signature xmlns="${XMLDSIG.ns}"><SignedInfo><CanonicalizationMethod Algorithm="${XMLDSIG.c14n}"></CanonicalizationMethod>` +
        `<SignatureMethod Algorithm="${XMLDSIG.rsaSha1}"></SignatureMethod><Reference URI="#${ID}"><Transforms>` +
        `<Transform Algorithm="${XMLDSIG.enveloped}"></Transform><Transform Algorithm="${XMLDSIG.c14n}"></Transform></Transforms>` +
        `<DigestMethod Algorithm="${XMLDSIG.sha1}"></DigestMethod><DigestValue>${dv}</DigestValue></Reference></SignedInfo>` +
        `<SignatureValue>${sv}</SignatureValue><KeyInfo><X509Data><X509Certificate>${CLIENTE.certificado.raw.toString('base64')}` +
        '</X509Certificate></X509Data></KeyInfo></Signature>',
    );
  });

  it('só a folha: um X509Certificate, o da empresa, mesmo com cadeia; nada de KeyValue nem emissor', () => {
    const assinado = assinarXmlEnveloped(EVENTO, ID, { ...CLIENTE, cadeia: [AC_TESTE] });
    expect(assinado.split('<X509Certificate>')).toHaveLength(2);
    expect(valor(assinado, 'X509Certificate')).toBe(CLIENTE.certificado.raw.toString('base64'));
    for (const proibido of ['KeyValue', 'X509IssuerSerial', 'X509SubjectName']) expect(assinado).not.toContain(proibido);
  });

  it('chave nunca exportada', () => {
    const exportar = jest.spyOn(CLIENTE.chavePrivada, 'export');
    try {
      expect(confere(assinarXmlEnveloped(EVENTO, ID, CLIENTE))).toBe(true);
      expect(exportar).not.toHaveBeenCalled();
    } finally {
      exportar.mockRestore();
    }
  });

  const comInf = (inf: string): string => montar(`<infEvento Id="${ID}">${inf}</infEvento>`);
  it.each<[string, string, string?]>([
    ['Id ausente', EVENTO, 'ID210240OUTRO'],
    ['Id repetido', montar(`<infEvento Id="${ID}">${CAMPOS}</infEvento><outro Id="${ID}"></outro>`)],
    ['elemento com prefixo', montar(`<n:infEvento xmlns:n="${NFE}" Id="${ID}">${CAMPOS}</n:infEvento>`)],
    ['descendente com prefixo', comInf(`<n:cOrgao xmlns:n="${NFE}">91</n:cOrgao>`)],
    ['atributo com prefixo', montar(`<infEvento xmlns:n="${NFE}" n:a="1" Id="${ID}">${CAMPOS}</infEvento>`)],
    ['comentário dentro', comInf(`<!-- nota -->${CAMPOS}`)],
    ['instrução de processamento dentro', comInf(`<?pi x?>${CAMPOS}`)],
    ['descendente com o mesmo nome', comInf(`${CAMPOS}<infEvento>x</infEvento>`)],
    ['xmlns vazio num descendente', comInf(`<cOrgao xmlns="">91</cOrgao>`)],
    ['outro namespace num descendente', comInf(`<cOrgao xmlns="urn:outro">91</cOrgao>`)],
    ['prefixo declarado num ancestral', montar(`<infEvento Id="${ID}">${CAMPOS}</infEvento>`, `<evento xmlns="${NFE}" xmlns:xsi="urn:x">`)],
    ['atributo xml: num ancestral', montar(`<infEvento Id="${ID}">${CAMPOS}</infEvento>`, `<evento xmlns="${NFE}" xml:lang="pt">`)],
    ['fechamento do elemento dentro de CDATA', comInf(`<xJust><![CDATA[</infEvento>]]></xJust>`)],
    ['Id com caractere fora do padrão', montar(`<infEvento Id="ID&quot;1">${CAMPOS}</infEvento>`), 'ID"1'],
    ['Id em aspas simples', montar(`<infEvento Id='${ID}'>${CAMPOS}</infEvento>`)],
    ['XML inválido', `<evento xmlns="${NFE}"><infEvento Id="${ID}"></evento>`],
    ['DOCTYPE', `<!DOCTYPE evento []>${EVENTO}`],
    // literais: o xmldom os troca por \n antes de ler (regra do XML 1.1); o digest cobriria um \n que não está no texto enviado
    ['U+0085 (NEL) literal dentro do elemento', comInf(`<xJust>Devolvido\u0085na porta</xJust>`)],
    ['U+2028 (LS) literal dentro do elemento', comInf(`<xJust>Devolvido\u2028na porta</xJust>`)],
    ['U+2029 (PS) literal dentro do elemento', comInf(`<xJust>Devolvido\u2029na porta</xJust>`)],
    ['CR seguido de U+0085 literal dentro do elemento', comInf(`<xJust>Devolvido\r\u0085na porta</xJust>`)],
  ])('recusa: %s, com a frase fixa', (_caso, xml, id = ID) => {
    const erro = recusa(() => assinarXmlEnveloped(xml, id, CLIENTE));
    expect(erro.message).toBe(FRASE);
    expect(erro.message).not.toContain('infEvento');
    expect(erro.message).not.toContain('<');
  });

  it('C14N escrita à mão: o digest e a assinatura batem com o texto canônico montado sem o xmldom', () => {
    // a referência &#x2028; (não o caractere literal) é XML 1.0 válido: a C14N a escreve como o próprio caractere
    const xml = `<evento xmlns="urn:teste" versao="1.00"><infEvento b="2" Id="ID1" a="x&amp;y"><c>é &lt; z&#x2028;w</c><d/></infEvento></evento>`;
    const c14n = '<infEvento xmlns="urn:teste" Id="ID1" a="x&amp;y" b="2"><c>é &lt; z\u2028w</c><d></d></infEvento>';
    const assinado = assinarXmlEnveloped(xml, 'ID1', CLIENTE);
    const digest = createHash('sha1').update(c14n, 'utf8').digest('base64');
    expect(valor(assinado, 'DigestValue')).toBe(digest);
    const signedInfo =
      `<SignedInfo xmlns="${XMLDSIG.ns}"><CanonicalizationMethod Algorithm="${XMLDSIG.c14n}"></CanonicalizationMethod>` +
      `<SignatureMethod Algorithm="${XMLDSIG.rsaSha1}"></SignatureMethod><Reference URI="#ID1"><Transforms>` +
      `<Transform Algorithm="${XMLDSIG.enveloped}"></Transform><Transform Algorithm="${XMLDSIG.c14n}"></Transform></Transforms>` +
      `<DigestMethod Algorithm="${XMLDSIG.sha1}"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
    const sv = Buffer.from(valor(assinado, 'SignatureValue') ?? '', 'base64');
    expect(verify('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), CLIENTE.certificado.publicKey, sv)).toBe(true);
    expect(assinado).toContain('z&#x2028;w'); // o texto enviado não muda
  });

  it('recusa chave que não é RSA (a assinatura declarada é rsa-sha1)', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); // fictícia, gerada aqui
    expect(recusa(() => assinarXmlEnveloped(EVENTO, ID, { ...CLIENTE, chavePrivada: privateKey })).message).toBe(FRASE);
  });
});

describe('canonicalizar', () => {
  const infEvento = (xml: string) => elementos(lerXml(xml), 'infEvento')[0];

  it('xmlns herdado do evento no elemento de topo, sem <x/>', () => {
    const c14n = canonicalizar(infEvento(EVENTO));
    expect(c14n.startsWith(`<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID210240`)).toBe(true);
    expect(c14n).not.toContain('/>');
    expect(c14n).toContain(`<xJust>${XJUST}</xJust>`);
    expect(c14n.endsWith('</detEvento></infEvento>')).toBe(true);
  });

  it('atributos em ordem de código, escapes de atributo e de texto, CDATA como texto, xmlns redundante omitido', () => {
    expect(canonicalizar(infEvento(ESPINHOSO))).toBe(
      `<infEvento xmlns="${NFE}" Id="${ID}" a="&quot;&amp;&lt;>&#x9;&#xA;&#xD;'" versao="1.00" z="1">\n  <cOrgao>91</cOrgao>\n` +
        `  <xJust>t &amp; &lt; &gt; &#xD; "' ção</xJust><vazio></vazio>&lt;b&gt;&amp;\n</infEvento>`,
    );
  });

  it('elemento sem namespace: sem xmlns', () => {
    expect(canonicalizar(lerXml('<a Id="x"><b>1</b></a>').documentElement!)).toBe('<a Id="x"><b>1</b></a>');
  });

  it('recusa com a frase fixa (comentário dentro)', () => {
    expect(recusa(() => canonicalizar(infEvento(montar(`<infEvento Id="${ID}"><!-- c --></infEvento>`)))).message).toBe(FRASE);
  });
});

describe('fitness: xml-crypto só nos testes', () => {
  it('nenhum arquivo de src fora de __tests__ importa o xml-crypto', () => {
    const src = join(__dirname, '..', '..', '..');
    const achados: string[] = [];
    const varre = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== '__tests__' && n !== 'node_modules') varre(p);
        } else if (n.endsWith('.ts') && /['"]xml-crypto['"]/.test(readFileSync(p, 'utf8'))) {
          achados.push(p.slice(src.length + 1));
        }
      }
    };
    varre(src);
    expect(achados).toEqual([]);
  });
});
