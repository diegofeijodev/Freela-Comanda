// Oráculo: xml-crypto 6.4.0 (devDependency exata), importado SÓ em arquivos de __tests__. Nenhum teste faz rede; certificado fictício.
import { montarChaveNfce } from '../../../common/fiscal/chave-acesso';
import { SignedXml } from 'xml-crypto';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { assinarXmlEnveloped } from '../../sefaz/assinatura-xml';
import { envelopeSoap12SemPrefixo } from '../../sefaz/transporte-soap12';
import { elementos, lerXml } from '../../sefaz/xml-leitura';
import { corpoEnvEventoCancelamento, idCancelamento, montarCancelamento, type DadosCancelamento } from '../evento-cancelamento';

const CHAVE = montarChaveNfce({ aamm: '2611', cnpj: '12345678000195', serie: 1, numero: 1, tpEmis: 1, cNF: '00000001' });
const CNPJ_ALFA = '12ABC34501DE35';
const CHAVE_ALFA = montarChaveNfce({ aamm: '2611', cnpj: CNPJ_ALFA, serie: 1, numero: 1, tpEmis: 1, cNF: '00000001' });
const NPROT = '135260000012345';
const NPROT_17 = '13526000001234567';
const XJUST = 'Cupom emitido em duplicidade por engano do caixa';

const dados = (extra: Partial<DadosCancelamento> = {}): DadosCancelamento => ({
  tpAmb: 2,
  cnpj: '12345678000195',
  chave: CHAVE,
  nProt: NPROT,
  xJust: XJUST,
  dhEvento: new Date('2026-11-17T17:05:00Z'),
  ...extra,
});

const assinaturas = (xml: string): string[] => xml.match(/<Signature [\s\S]*?<\/Signature>/g) ?? [];
function confere(documento: string, assinatura: string): boolean {
  const v = new SignedXml({ publicCert: CLIENTE.certificado.toString() });
  v.loadSignature(assinatura);
  try {
    return v.checkSignature(documento);
  } catch {
    return false;
  }
}
const assinado = (d = dados()): string => assinarXmlEnveloped(montarCancelamento(d), idCancelamento(d.chave), CLIENTE);

describe('evento de cancelamento da NFC-e (110111)', () => {
  it('o Id é ID110111 + chave + 01', () => {
    expect(idCancelamento(CHAVE)).toBe(`ID110111${CHAVE}01`);
  });

  it('infEvento com os filhos na ordem do esquema e cOrgao 35', () => {
    const doc = lerXml(montarCancelamento(dados()));
    const inf = elementos(doc, 'infEvento')[0];
    const filhos = Array.from(inf.childNodes as ArrayLike<{ nodeType: number; localName: string; textContent: string | null }>).filter(
      (n) => n.nodeType === 1,
    );
    expect(filhos.map((n) => n.localName)).toEqual([
      'cOrgao',
      'tpAmb',
      'CNPJ',
      'chNFe',
      'dhEvento',
      'tpEvento',
      'nSeqEvento',
      'verEvento',
      'detEvento',
    ]);
    expect(filhos.slice(0, 8).map((n) => n.textContent)).toEqual([
      '35',
      '2',
      '12345678000195',
      CHAVE,
      '2026-11-17T14:05:00-03:00',
      '110111',
      '1',
      '1.00',
    ]);
    expect(inf.getAttribute('Id')).toBe(idCancelamento(CHAVE));
  });

  it('detEvento: descEvento Cancelamento, nProt de 17 dígitos intacto, depois xJust', () => {
    const xml = montarCancelamento(dados({ nProt: NPROT_17 }));
    expect(xml).toContain(
      `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${NPROT_17}</nProt><xJust>${XJUST}</xJust></detEvento>`,
    );
    expect(xml.startsWith('<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">')).toBe(true);
    expect(xml).not.toContain('<Signature');
  });

  it('escapa & < > na justificativa', () => {
    expect(montarCancelamento(dados({ xJust: 'Troca A&B <errada> do cupom' }))).toContain('<xJust>Troca A&amp;B &lt;errada&gt; do cupom</xJust>');
  });

  it('xJust com 14 caracteres lança erro; com 15 passa', () => {
    expect(() => montarCancelamento(dados({ xJust: '12345678901234' }))).toThrow('Justificativa fora do padrão da SEFAZ.');
    expect(() => montarCancelamento(dados({ xJust: '123456789012345' }))).not.toThrow();
  });

  it('justificativa longa, não normalizada ou com caractere fora do Latin-1 lança erro (sem o texto na mensagem)', () => {
    for (const xJust of ['x'.repeat(256), `  ${XJUST}`, 'Cupom em duplicidade – caixa', 'Cupom cancelado 😀 por engano']) {
      expect(() => montarCancelamento(dados({ xJust }))).toThrow('Justificativa fora do padrão da SEFAZ.');
    }
  });

  it('dado fora do padrão lança erro com frase fixa', () => {
    expect(() => montarCancelamento(dados({ tpAmb: 3 as 1 }))).toThrow('Ambiente inválido');
    expect(() => montarCancelamento(dados({ cnpj: '123' }))).toThrow('CNPJ inválido');
    expect(() => montarCancelamento(dados({ chave: CHAVE.slice(1) }))).toThrow('Chave de acesso inválida');
    expect(() => montarCancelamento(dados({ chave: CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10) }))).toThrow('Chave de acesso inválida');
    expect(() => montarCancelamento(dados({ nProt: '1234' }))).toThrow('Protocolo de autorização inválido');
    expect(() => montarCancelamento(dados({ dhEvento: new Date('x') }))).toThrow('Data e hora');
  });

  it('chave com CNPJ alfanumérico (DV válido) é aceita, assinada e conferida', () => {
    expect(CHAVE_ALFA.slice(6, 20)).toBe(CNPJ_ALFA);
    const d = dados({ cnpj: CNPJ_ALFA, chave: CHAVE_ALFA });
    expect(montarCancelamento(d)).toContain(`<CNPJ>${CNPJ_ALFA}</CNPJ><chNFe>${CHAVE_ALFA}</chNFe>`);
    const ev = assinado(d);
    expect(confere(ev, assinaturas(ev)[0])).toBe(true);
  });

  it('o CNPJ tem de ser o que está dentro da chave (frase fixa)', () => {
    expect(() => montarCancelamento(dados({ cnpj: '11222333000181' }))).toThrow('O CNPJ não é o da chave de acesso do cancelamento.');
    expect(() => montarCancelamento(dados({ cnpj: CNPJ_ALFA }))).toThrow('O CNPJ não é o da chave de acesso do cancelamento.');
  });

  it('o xml-crypto confere a assinatura do infEvento, sozinho e dentro do envelope SOAP sem prefixo inteiro', () => {
    const ev = assinado();
    expect(assinaturas(ev)).toHaveLength(1);
    expect(confere(ev, assinaturas(ev)[0])).toBe(true);
    const corpo = corpoEnvEventoCancelamento(1763399100000n, ev);
    const documento = envelopeSoap12SemPrefixo(corpo);
    expect(documento).not.toMatch(/xmlns:/);
    const sigs = assinaturas(documento);
    expect(sigs).toHaveLength(1);
    expect(confere(documento, sigs[0])).toBe(true);
    expect(confere(documento.replace(XJUST, `${XJUST}!`), sigs[0])).toBe(false);
  });

  it('o corpo do lote leva o envEvento com o idLote e o evento assinado; evento sem assinatura ou fora do formato é recusado', () => {
    const ev = assinado();
    const corpo = corpoEnvEventoCancelamento(7n, ev);
    expect(corpo).toBe(
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" ' +
        `versao="1.00"><idLote>7</idLote>${ev}</envEvento></nfeDadosMsg>`,
    );
    expect(() => corpoEnvEventoCancelamento(0n, ev)).toThrow();
    expect(() => corpoEnvEventoCancelamento(7n, '<x/>')).toThrow('Evento fora do formato do lote.');
  });
});
