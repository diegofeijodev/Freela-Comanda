import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type * as https from 'node:https';
// Oráculo: xml-crypto 6.4.0 (devDependency exata), importado SÓ em arquivos de __tests__. Nenhum teste faz rede: o transporte é falso
// (guarda a chamada) ou é o de verdade com um `requisitar` falso (guarda os bytes de `req.end()` e falha antes de qualquer conexão);
// o certificado é o fictício de fixtures/tls e as respostas são as fixtures fictícias de fixtures/nfce.
import { SignedXml } from 'xml-crypto';
import { montarChaveNfce } from '../../../common/fiscal/chave-acesso';
import type { CadeiaIcp } from '../../certificado-digital/cadeia';
import { corpoEnvEventoCancelamento, idCancelamento, montarCancelamento } from '../../cupom-fiscal/evento-cancelamento';
import { corpoEnviNfe, inserirSupl, montarNfe, montarNfeProc, type DadosNfce, type ItemXml } from '../../cupom-fiscal/montagem-xml';
import { qrCodeV2, URL_CHAVE } from '../../cupom-fiscal/qrcode-nfce';
import { calcularTotais, type Totais, type TPag } from '../../cupom-fiscal/totais';
import { assinarXmlEnveloped } from '../assinatura-xml';
import { confiancaSefaz } from '../confianca';
import type { AmbienteSefaz } from '../distribuicao.port';
import {
  ACTION_NFCE,
  corpoAutorizacao,
  corpoConsulta,
  corpoEvento,
  corpoStatus,
  lerRetornoAutorizacao,
  lerRetornoConsulta,
  lerRetornoEvento,
  lerRetornoStatus,
  SefazNfceAdapter,
  TEMPO_LIMITE_NFCE_MS,
  TETO_RESPOSTA_NFCE_BYTES,
  URL_NFCE,
} from '../nfce.adapter';
import { SEFAZ_NFCE } from '../nfce.port';
import { SefazModule } from '../sefaz.module';
import { SefazErro, sefazErro } from '../sefaz-erro';
import { chamarSoap12, envelopeSoap12, envelopeSoap12SemPrefixo, type ChamadaSoap12 } from '../transporte-soap12';
import { CLIENTE } from './certificado-teste';
import { faultSoap12, SENTINELA_FAULT } from './retorno-falso';
import { fixtureNfce as fx, SefazNfceFalso } from './sefaz-nfce.falso';

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const CHAVE = '35261112345678000195650010000000121402133776';
/** Chave com CNPJ alfanumérico (letras nas posições 7–18), DV conferido. */
const CHAVE_ALFA = montarChaveNfce({ aamm: '2611', cnpj: '12ABC34501DE35', serie: 1, numero: 7, tpEmis: 1, cNF: '00000007' });
const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const icp = { ancoras: [] } as unknown as CadeiaIcp;

// --- a NFC-e de verdade (montada, assinada com o certificado fictício e com o QR), com acento: UTF-8 de 2 bytes no corpo ---------------

const PAO: ItemXml = {
  cProd: 'PAO-01',
  xProd: 'Pão de queijo & café',
  ncm: '19059090',
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
const PAGAMENTOS: { tPag: TPag; valor: bigint }[] = [{ tPag: '01', valor: 2400n }];

function totais(): Totais {
  const t = calcularTotais([{ quantidade: PAO.quantidade, precoCentavos: PAO.valorUnitario }], 0n, PAGAMENTOS);
  if ('erro' in t) throw new Error(t.erro);
  return t;
}

const DADOS: DadosNfce = {
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
    complemento: null,
    bairro: 'Centro',
    codMunicipio: '3556206',
    municipio: 'Valinhos',
    uf: 'SP',
    cep: '13270000',
    telefone: null,
  },
  consumidorDoc: null,
  itens: [PAO],
  totais: totais(),
  pagamentos: PAGAMENTOS,
  infCpl: 'Obrigado pela preferência!',
  respTec: null,
};

const NFE = inserirSupl(
  assinarXmlEnveloped(montarNfe(DADOS), 'NFe' + CHAVE, CLIENTE),
  qrCodeV2({ chave: CHAVE, tpAmb: 2, idCsc: 1, csc: CSC_TESTE }),
  URL_CHAVE.homologacao,
);
const ENVI = corpoEnviNfe(1763399100001n, NFE);
const CANCELAMENTO = assinarXmlEnveloped(
  montarCancelamento({
    tpAmb: 2,
    cnpj: '12345678000195',
    chave: CHAVE,
    nProt: '13526000000012345',
    xJust: 'Cliente desistiu da compra após pagar',
    dhEvento: new Date('2026-11-17T17:45:00Z'),
  }),
  idCancelamento(CHAVE),
  CLIENTE,
);
const ENV_EVENTO = corpoEnvEventoCancelamento(7n, CANCELAMENTO);

/** O mesmo `envEvento`, sem o `nfeDadosMsg` que o `corpoEnvEventoCancelamento` já põe. */
const ENV_EVENTO_NU = ENV_EVENTO.slice(ENV_EVENTO.indexOf('<envEvento'), ENV_EVENTO.lastIndexOf('</nfeDadosMsg>'));

/** Trecho do texto entre a 1ª marca `<nome` e a 1ª `</nome>` (inclusive). */
function trecho(corpo: string, nome: string): string {
  const i = corpo.indexOf(`<${nome}`);
  const f = corpo.indexOf(`</${nome}>`);
  if (i < 0 || f < 0) throw new Error(`sem ${nome}`);
  return corpo.slice(i, f + nome.length + 3);
}
const contar = (texto: string, parte: string): number => texto.split(parte).length - 1;

/** Adaptador sobre um transporte falso que guarda cada chamada e responde sempre `corpo`. */
function adaptador(corpo: string | (() => Promise<string>)): { adapter: SefazNfceAdapter; chamadas: ChamadaSoap12[] } {
  const chamadas: ChamadaSoap12[] = [];
  const adapter = new SefazNfceAdapter(icp, async (c) => {
    chamadas.push(c);
    return typeof corpo === 'string' ? corpo : corpo();
  });
  return { adapter, chamadas };
}

const COMUM = {
  certificado: CLIENTE,
  confianca: confiancaSefaz(icp),
  tempoLimiteMs: 20_000,
  tetoRespostaBytes: 2 * 1024 * 1024,
  envelope: 'sem_prefixo',
} as const;

describe('URLs, actions e constantes do desenho (pesquisa B.2; NT 2016.002)', () => {
  it('URL_NFCE: os 4 serviços da NFC-e de SP, nos dois ambientes', () => {
    expect(URL_NFCE).toEqual({
      autorizacao: {
        producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
        homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
      },
      consulta: {
        producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
        homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
      },
      evento: {
        producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
        homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
      },
      status: {
        producao: 'https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
        homologacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
      },
    });
  });

  it('ACTION_NFCE: as 4 actions; prazo de 20 s e teto de 2 MB; SEFAZ_NFCE é um símbolo', () => {
    expect(ACTION_NFCE).toEqual({
      autorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      consulta: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
      evento: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      status: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    });
    expect(TEMPO_LIMITE_NFCE_MS).toBe(20_000);
    expect(TETO_RESPOSTA_NFCE_BYTES).toBe(2 * 1024 * 1024);
    expect(typeof SEFAZ_NFCE).toBe('symbol');
  });

  it('o SefazModule fornece SEFAZ_NFCE pelo adaptador e o exporta', () => {
    expect(Reflect.getMetadata('exports', SefazModule)).toContain(SEFAZ_NFCE);
    expect(Reflect.getMetadata('providers', SefazModule)).toContainEqual({ provide: SEFAZ_NFCE, useExisting: SefazNfceAdapter });
  });
});

describe('SefazNfceAdapter: cada método chama a URL e a action do ambiente, sem prefixo, 20 s e 2 MB', () => {
  it('autorizar: o enviNFe embrulhado UMA vez no nfeDadosMsg do NFeAutorizacao4', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-autorizacao-100.xml'));
    const r = await adapter.autorizar(CLIENTE, 'homologacao', ENVI);
    expect(r).toEqual(lerRetornoAutorizacao(fx('ret-autorizacao-100.xml')));
    expect(chamadas).toEqual([
      {
        url: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
        corpo: `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${ENVI}</nfeDadosMsg>`,
        ...COMUM,
      },
    ]);
    expect(contar(chamadas[0].corpo, '<nfeDadosMsg')).toBe(1);
  });

  it('consultar: consSitNFe com tpAmb, xServ CONSULTAR e chNFe, no namespace da NF-e', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-consulta-100.xml'));
    const r = await adapter.consultar(CLIENTE, 'homologacao', CHAVE);
    expect(r).toEqual(lerRetornoConsulta(fx('ret-consulta-100.xml')));
    expect(chamadas).toEqual([
      {
        url: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
        corpo:
          '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
          `<consSitNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>2</tpAmb><xServ>CONSULTAR</xServ><chNFe>${CHAVE}</chNFe></consSitNFe>` +
          '</nfeDadosMsg>',
        ...COMUM,
      },
    ]);
    // o trecho do brief, sem o xmlns (o consSitNFe dentro do nfeDadosMsg herdaria o namespace do WSDL)
    expect(chamadas[0].corpo).toContain(`versao="4.00"><tpAmb>2</tpAmb><xServ>CONSULTAR</xServ><chNFe>${CHAVE}</chNFe>`);
  });

  it('consultar aceita a chave com CNPJ alfanumérico (DV conferido, common/fiscal)', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-consulta-217.xml'));
    await adapter.consultar(CLIENTE, 'producao', CHAVE_ALFA);
    expect(CHAVE_ALFA).toMatch(/[A-Z]/);
    expect(chamadas[0].corpo).toContain(`<tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chNFe>${CHAVE_ALFA}</chNFe>`);
  });

  it('registrarEvento: o corpo do corpoEnvEventoCancelamento vai como está (um nfeDadosMsg só)', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-evento-135.xml'));
    const r = await adapter.registrarEvento(CLIENTE, 'homologacao', ENV_EVENTO);
    expect(r).toEqual(lerRetornoEvento(fx('ret-evento-135.xml')));
    expect(chamadas).toEqual([
      {
        url: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
        corpo: ENV_EVENTO,
        ...COMUM,
      },
    ]);
    expect(ENV_EVENTO.startsWith('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento ')).toBe(true);
    expect(contar(chamadas[0].corpo, '<nfeDadosMsg')).toBe(1);
  });

  it('registrarEvento: o envEvento sem o nfeDadosMsg é embrulhado uma vez, no mesmo corpo', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-evento-135.xml'));
    expect(ENV_EVENTO_NU.startsWith(`<envEvento xmlns="${NS_NFE}" versao="1.00">`)).toBe(true);
    await adapter.registrarEvento(CLIENTE, 'homologacao', ENV_EVENTO_NU);
    expect(chamadas[0].corpo).toBe(ENV_EVENTO);
  });

  it('status: consStatServ com tpAmb, cUF 35 e xServ STATUS', async () => {
    const { adapter, chamadas } = adaptador(fx('ret-status-107.xml'));
    const r = await adapter.status(CLIENTE, 'homologacao');
    expect(r).toEqual(lerRetornoStatus(fx('ret-status-107.xml')));
    expect(chamadas).toEqual([
      {
        url: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
        corpo:
          '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">' +
          `<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>` +
          '</nfeDadosMsg>',
        ...COMUM,
      },
    ]);
    expect(chamadas[0].corpo).toContain(
      '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ>',
    );
  });

  it('produção vai para os hosts de produção, com tpAmb 1', async () => {
    const respostas = [fx('ret-autorizacao-100.xml'), fx('ret-consulta-100.xml'), fx('ret-evento-135.xml'), fx('ret-status-107.xml')];
    const { adapter, chamadas } = adaptador(async () => respostas.shift()!);
    await adapter.autorizar(CLIENTE, 'producao', ENVI);
    await adapter.consultar(CLIENTE, 'producao', CHAVE);
    await adapter.registrarEvento(CLIENTE, 'producao', ENV_EVENTO);
    await adapter.status(CLIENTE, 'producao');
    expect(chamadas.map((c) => c.url)).toEqual([
      URL_NFCE.autorizacao.producao,
      URL_NFCE.consulta.producao,
      URL_NFCE.evento.producao,
      URL_NFCE.status.producao,
    ]);
    expect(chamadas.map((c) => c.action)).toEqual([ACTION_NFCE.autorizacao, ACTION_NFCE.consulta, ACTION_NFCE.evento, ACTION_NFCE.status]);
    expect(chamadas[1].corpo).toContain('<tpAmb>1</tpAmb>');
    expect(chamadas[3].corpo).toContain('<tpAmb>1</tpAmb>');
  });

  it.each<[string, (a: SefazNfceAdapter) => Promise<unknown>]>([
    ['enviNFe já embrulhado', (a) => a.autorizar(CLIENTE, 'homologacao', corpoAutorizacao(ENVI))],
    ['NFe sem o enviNFe', (a) => a.autorizar(CLIENTE, 'homologacao', NFE)],
    ['enviNFe vazio', (a) => a.autorizar(CLIENTE, 'homologacao', '')],
    ['chave com DV errado', (a) => a.consultar(CLIENTE, 'homologacao', CHAVE.slice(0, 43) + '0')],
    ['chave minúscula', (a) => a.consultar(CLIENTE, 'homologacao', CHAVE_ALFA.toLowerCase())],
    ['chave curta', (a) => a.consultar(CLIENTE, 'homologacao', CHAVE.slice(0, 43))],
    ['chave com marcação', (a) => a.consultar(CLIENTE, 'homologacao', `${CHAVE}</chNFe>`)],
    ['evento sem envEvento', (a) => a.registrarEvento(CLIENTE, 'homologacao', CANCELAMENTO)],
    [
      'envEvento embrulhado duas vezes',
      (a) =>
        a.registrarEvento(
          CLIENTE,
          'homologacao',
          `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${ENV_EVENTO}</nfeDadosMsg>`,
        ),
    ],
    [
      'envEvento no nfeDadosMsg de outro serviço',
      (a) =>
        a.registrarEvento(
          CLIENTE,
          'homologacao',
          `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${ENV_EVENTO_NU}</nfeDadosMsg>`,
        ),
    ],
    ['ambiente desconhecido na autorização', (a) => a.autorizar(CLIENTE, 'teste' as AmbienteSefaz, ENVI)],
    ['ambiente desconhecido na consulta', (a) => a.consultar(CLIENTE, 'teste' as AmbienteSefaz, CHAVE)],
    ['ambiente desconhecido no evento', (a) => a.registrarEvento(CLIENTE, 'teste' as AmbienteSefaz, ENV_EVENTO)],
    ['ambiente desconhecido no status', (a) => a.status(CLIENTE, 'teste' as AmbienteSefaz)],
  ])('%s: recusa antes do transporte (nada sai), com frase fixa', async (_nome, chamar) => {
    const { adapter, chamadas } = adaptador(fx('ret-status-107.xml'));
    const erro = await chamar(adapter).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(SefazErro);
    // nunca o dado na mensagem (nem chave, nem XML)
    expect((erro as Error).message).not.toMatch(/[0-9A-Z]{14}|</);
    expect(chamadas).toEqual([]);
  });

  it('o SefazErro do transporte sobe sem mudar, nos 4 métodos', async () => {
    const erro = sefazErro('SEFAZ_TEMPO', true);
    const { adapter } = adaptador(async () => {
      throw erro;
    });
    await expect(adapter.autorizar(CLIENTE, 'homologacao', ENVI)).rejects.toBe(erro);
    await expect(adapter.consultar(CLIENTE, 'homologacao', CHAVE)).rejects.toBe(erro);
    await expect(adapter.registrarEvento(CLIENTE, 'homologacao', ENV_EVENTO)).rejects.toBe(erro);
    await expect(adapter.status(CLIENTE, 'homologacao')).rejects.toBe(erro);
  });

  it('resposta sem retEnviNFe vira SEFAZ_RESPOSTA_INVALIDA já enviada, passo soap', async () => {
    const { adapter } = adaptador(fx('ret-status-107.xml'));
    await expect(adapter.autorizar(CLIENTE, 'homologacao', ENVI)).rejects.toMatchObject({
      code: 'SEFAZ_RESPOSTA_INVALIDA',
      enviado: true,
      passo: 'soap',
    });
  });

  it('SOAP Fault no lugar do retorno: passo soap com o código do Fault, nunca o texto dele', async () => {
    const { adapter } = adaptador(faultSoap12('soap:Receiver'));
    const erro = await adapter.consultar(CLIENTE, 'homologacao', CHAVE).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SefazErro);
    expect(erro).toMatchObject({ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true, passo: 'soap', fault: 'Receiver' });
    expect(JSON.stringify(erro) + String((erro as Error).message)).not.toContain(SENTINELA_FAULT);
  });
});

describe('leitura dos retornos (fixtures fictícias, nProt de 17 dígitos)', () => {
  it('autorização 100: lote 104, protocolo com nProt de 17 dígitos em texto, digVal e sem alerta', () => {
    const corpo = fx('ret-autorizacao-100.xml');
    const r = lerRetornoAutorizacao(corpo);
    expect(r).toEqual({
      cStatLote: 104,
      xMotivoLote: 'Lote processado',
      dhRecbto: '2026-11-17T14:30:02-03:00',
      protocolo: {
        cStat: 100,
        xMotivo: 'Autorizado o uso da NF-e',
        chave: CHAVE,
        dhRecbto: '2026-11-17T14:30:02-03:00',
        nProt: '13526000000012345',
        digVal: 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=',
        cMsg: null,
        xMsg: null,
        xml: trecho(corpo, 'protNFe'),
      },
      xmlRetorno: trecho(corpo, 'retEnviNFe'),
    });
    expect(typeof r.protocolo!.nProt).toBe('string');
    expect(r.protocolo!.nProt).toHaveLength(17);
  });

  it('protocolo.xml começa em <protNFe, é o trecho do retorno como veio e fecha o nfeProc de guarda', () => {
    const corpo = fx('ret-autorizacao-100.xml');
    const xml = lerRetornoAutorizacao(corpo).protocolo!.xml;
    expect(xml.startsWith('<protNFe versao="4.00">')).toBe(true);
    expect(xml.endsWith('</protNFe>')).toBe(true);
    expect(corpo).toContain(xml);
    expect(montarNfeProc(NFE, xml)).toBe(`<nfeProc xmlns="${NS_NFE}" versao="4.00">${NFE}${xml}</nfeProc>`);
  });

  it('autorização 120: autorizada com alerta, com cMsg e xMsg', () => {
    const p = lerRetornoAutorizacao(fx('ret-autorizacao-120.xml')).protocolo!;
    expect(p).toMatchObject({ cStat: 120, nProt: '13526000000012346', cMsg: '9001' });
    expect(p.xMsg).toBe('Destinatário com situação cadastral irregular (fictício)');
  });

  it('autorização 386: rejeição da nota, sem nProt nem digVal', () => {
    const r = lerRetornoAutorizacao(fx('ret-autorizacao-386.xml'));
    expect(r.cStatLote).toBe(104);
    expect(r.protocolo).toMatchObject({ cStat: 386, nProt: null, digVal: null, chave: CHAVE });
    expect(r.protocolo!.xMotivo).toBe('Rejeição: CFOP não permitido para o CSOSN informado');
  });

  it('lote 225: recusado inteiro, sem protocolo', () => {
    const corpo = fx('ret-lote-225.xml');
    expect(lerRetornoAutorizacao(corpo)).toEqual({
      cStatLote: 225,
      xMotivoLote: 'Rejeição: Falha no Schema XML do lote de NFe',
      dhRecbto: '2026-11-17T14:30:02-03:00',
      protocolo: null,
      xmlRetorno: trecho(corpo, 'retEnviNFe'),
    });
  });

  it('cStat de 4 dígitos é aceito (lote e protocolo)', () => {
    const r = lerRetornoAutorizacao(
      fx('ret-autorizacao-386.xml')
        .replace('<cStat>104</cStat>', '<cStat>1104</cStat>')
        .replace('<cStat>386</cStat>', '<cStat>1386</cStat>'),
    );
    expect(r.cStatLote).toBe(1104);
    expect(r.protocolo!.cStat).toBe(1386);
    expect(lerRetornoStatus(fx('ret-status-107.xml').replace('<cStat>107</cStat>', '<cStat>9999</cStat>')).cStat).toBe(9999);
    expect(lerRetornoEvento(fx('ret-evento-573.xml').replace('<cStat>573</cStat>', '<cStat>1573</cStat>')).cStat).toBe(1573);
  });

  it('nProt só com 15 ou 17 dígitos (o CHECK do banco); outro formato = null', () => {
    const com = (nProt: string) =>
      lerRetornoAutorizacao(fx('ret-autorizacao-100.xml').replace('<nProt>13526000000012345</nProt>', `<nProt>${nProt}</nProt>`)).protocolo!
        .nProt;
    expect(com('135260000012345')).toBe('135260000012345');
    expect(com('1352600000001234')).toBeNull();
    expect(com('135260000000123456')).toBeNull();
    expect(com('1352600000001234A')).toBeNull();
    expect(com(' 13526000000012345 ')).toBe('13526000000012345');
  });

  it('consulta 100: protocolo autorizado, sem cancelamento; chave alfanumérica também é lida', () => {
    const corpo = fx('ret-consulta-100.xml');
    const r = lerRetornoConsulta(corpo);
    expect(r).toMatchObject({ cStat: 100, xMotivo: 'Autorizado o uso da NF-e', cancelamento: null });
    expect(r.protocolo).toMatchObject({ cStat: 100, chave: CHAVE, nProt: '13526000000012345', digVal: 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=' });
    expect(r.protocolo!.xml).toBe(trecho(corpo, 'protNFe'));
    expect(r.xmlRetorno).toBe(trecho(corpo, 'retConsSitNFe'));
    expect(lerRetornoConsulta(corpo.replaceAll(CHAVE, CHAVE_ALFA)).protocolo!.chave).toBe(CHAVE_ALFA);
  });

  it('consulta 217: não consta, sem protocolo e sem cancelamento', () => {
    const r = lerRetornoConsulta(fx('ret-consulta-217.xml'));
    expect(r).toMatchObject({ cStat: 217, protocolo: null, cancelamento: null });
    expect(r.xMotivo).toBe('Rejeição: NF-e não consta na base de dados da SEFAZ');
  });

  it('consulta cancelada: protocolo 100 e o procEventoNFe do 110111 (135, nProt de 17), como veio', () => {
    const corpo = fx('ret-consulta-cancelada.xml');
    const r = lerRetornoConsulta(corpo);
    expect(r.cStat).toBe(101);
    expect(r.protocolo).toMatchObject({ cStat: 100, nProt: '13526000000012345' });
    expect(r.cancelamento).toEqual({
      cStat: 135,
      nProt: '13526000000067890',
      chave: '35261112345678000195650010000000121402133776',
      tpAmb: '2',
      xml: trecho(corpo, 'procEventoNFe'),
    });
    expect(r.cancelamento!.xml.startsWith('<procEventoNFe versao="1.00">')).toBe(true);
  });

  it('consulta: entre vários procEventoNFe, o cancelamento é o do 110111', () => {
    const corpo = fx('ret-consulta-cancelada.xml');
    const proc = trecho(corpo, 'procEventoNFe');
    const outro = proc.replaceAll('110111', '110130').replace('<nProt>13526000000067890</nProt>', '<nProt>13526000000099999</nProt>');
    const r = lerRetornoConsulta(corpo.replace(proc, outro + proc));
    // estrito (leva pré-final, item 9): a chave e o tpAmb do evento escolhido também (são eles que a consulta confere contra o cupom)
    expect(r.cancelamento).toEqual({
      cStat: 135,
      nProt: '13526000000067890',
      chave: '35261112345678000195650010000000121402133776',
      tpAmb: '2',
      xml: proc,
    });
    expect(lerRetornoConsulta(corpo.replace(proc, outro)).cancelamento).toBeNull();
  });

  it('evento 135: lote 128 e o retEvento com nProt de 17 dígitos', () => {
    const corpo = fx('ret-evento-135.xml');
    expect(lerRetornoEvento(corpo)).toEqual({
      cStatLote: 128,
      xMotivoLote: 'Lote de Evento Processado',
      cStat: 135,
      xMotivo: 'Evento registrado e vinculado a NF-e',
      nProt: '13526000000067890',
      dhRegEvento: '2026-11-17T14:45:03-03:00',
      xmlRetorno: trecho(corpo, 'retEnvEvento'),
    });
  });

  it('evento 573: duplicidade, sem nProt', () => {
    expect(lerRetornoEvento(fx('ret-evento-573.xml'))).toMatchObject({
      cStatLote: 128,
      cStat: 573,
      xMotivo: 'Rejeição: Duplicidade de evento',
      nProt: null,
      dhRegEvento: '2026-11-17T14:46:10-03:00',
    });
  });

  it('evento: lote recusado sem retEvento = cStat, xMotivo, nProt e dhRegEvento nulos', () => {
    const corpo = fx('ret-evento-573.xml');
    const semRet = corpo
      .replace(trecho(corpo, 'retEvento'), '')
      .replace('<cStat>128</cStat>', '<cStat>656</cStat>')
      .replace('<xMotivo>Lote de Evento Processado</xMotivo>', '<xMotivo>Rejeição: Consumo Indevido</xMotivo>');
    expect(lerRetornoEvento(semRet)).toMatchObject({
      cStatLote: 656,
      xMotivoLote: 'Rejeição: Consumo Indevido',
      cStat: null,
      xMotivo: null,
      nProt: null,
      dhRegEvento: null,
    });
  });

  it('status 107: em operação, com dhRecbto e tMed', () => {
    expect(lerRetornoStatus(fx('ret-status-107.xml'))).toEqual({
      cStat: 107,
      xMotivo: 'Serviço em Operação',
      dhRecbto: '2026-11-17T14:29:58-03:00',
      tMed: 1,
    });
    const semTMed = fx('ret-status-107.xml')
      .replace('<tMed>1</tMed>', '<tMed>um</tMed>')
      .replace(/<dhRecbto>[^<]*<\/dhRecbto>/, '');
    expect(lerRetornoStatus(semTMed)).toMatchObject({ cStat: 107, dhRecbto: null, tMed: null });
  });

  it('NUL (cru ou &#0;) some dos textos e dos trechos guardados', () => {
    const corpo = fx('ret-autorizacao-120.xml')
      .replace('<xMotivo>Lote processado</xMotivo>', '<xMotivo>Lote&#0; processado</xMotivo>')
      .replace('(fictício)', '(fic\u0000tício)');
    const r = lerRetornoAutorizacao(corpo);
    expect(r.xMotivoLote).toBe('Lote processado');
    expect(r.protocolo!.xMsg).toBe('Destinatário com situação cadastral irregular (fictício)');
    expect(r.protocolo!.xml).not.toContain('\u0000');
    expect(r.xmlRetorno).not.toContain('\u0000');
  });

  const aut = fx('ret-autorizacao-100.xml');
  const prot = trecho(aut, 'protNFe');
  const ev = fx('ret-evento-135.xml');
  const canc = fx('ret-consulta-cancelada.xml');
  const retCanc = trecho(canc, 'retEvento');
  it.each<[string, (c: string) => unknown, string, string]>([
    ['XML ilegível', lerRetornoAutorizacao, 'não é XML', 'xml'],
    ['DOCTYPE', lerRetornoAutorizacao, aut.replace('<soap:Envelope', '<!DOCTYPE x><soap:Envelope'), 'xml'],
    ['outro retorno no lugar do retEnviNFe', lerRetornoAutorizacao, fx('ret-consulta-100.xml'), 'soap'],
    ['dois retEnviNFe', lerRetornoAutorizacao, aut.replace('</nfeResultMsg>', `${trecho(aut, 'retEnviNFe')}</nfeResultMsg>`), 'soap'],
    ['sem retConsSitNFe', lerRetornoConsulta, aut, 'soap'],
    ['sem retEnvEvento', lerRetornoEvento, aut, 'soap'],
    ['sem retConsStatServ', lerRetornoStatus, aut, 'soap'],
    ['cStat do lote 099', lerRetornoAutorizacao, aut.replace('<cStat>104</cStat>', '<cStat>099</cStat>'), 'cStat'],
    ['cStat do lote com 5 dígitos', lerRetornoAutorizacao, aut.replace('<cStat>104</cStat>', '<cStat>10400</cStat>'), 'cStat'],
    ['lote sem cStat próprio (só o do protNFe)', lerRetornoAutorizacao, aut.replace('<cStat>104</cStat>', ''), 'cStat'],
    ['cStat do protocolo vazio', lerRetornoAutorizacao, aut.replace('<cStat>100</cStat>', '<cStat></cStat>'), 'cStat'],
    ['protocolo sem chave', lerRetornoAutorizacao, aut.replace(`<chNFe>${CHAVE}</chNFe>`, ''), 'cStat'],
    ['protocolo com chave de DV errado', lerRetornoAutorizacao, aut.replace(CHAVE, CHAVE.slice(0, 43) + '0'), 'cStat'],
    ['protocolo sem dhRecbto', lerRetornoAutorizacao, aut.replace(prot, prot.replace(/<dhRecbto>[^<]*<\/dhRecbto>/, '')), 'cStat'],
    ['protocolo sem infProt', lerRetornoAutorizacao, aut.replace(prot, '<protNFe versao="4.00"></protNFe>'), 'cStat'],
    ['dois protNFe', lerRetornoAutorizacao, aut.replace(prot, prot + prot), 'cStat'],
    [
      'protNFe com prefixo (não fecharia o nfeProc)',
      lerRetornoAutorizacao,
      aut.replace('<protNFe versao="4.00">', `<n:protNFe xmlns:n="${NS_NFE}" versao="4.00">`).replace('</protNFe>', '</n:protNFe>'),
      'cStat',
    ],
    ['cStat do retEvento inválido', lerRetornoEvento, ev.replace('<cStat>135</cStat>', '<cStat>13</cStat>'), 'retEvento'],
    ['dois retEvento', lerRetornoEvento, ev.replace(trecho(ev, 'retEvento'), trecho(ev, 'retEvento').repeat(2)), 'retEvento'],
    [
      'retEvento sem infEvento',
      lerRetornoEvento,
      ev.replace(trecho(ev, 'retEvento'), '<retEvento versao="1.00"></retEvento>'),
      'retEvento',
    ],
    ['cancelamento sem retEvento', lerRetornoConsulta, canc.replace(retCanc, ''), 'retEvento'],
    [
      'cancelamento com cStat inválido',
      lerRetornoConsulta,
      canc.replace(retCanc, retCanc.replace('<cStat>135</cStat>', '<cStat>x</cStat>')),
      'retEvento',
    ],
    ['cStat do status ausente', lerRetornoStatus, fx('ret-status-107.xml').replace('<cStat>107</cStat>', ''), 'cStat'],
  ])('%s: SEFAZ_RESPOSTA_INVALIDA já enviada, com o passo', (_nome, ler, corpo, passo) => {
    let erro: unknown;
    try {
      ler(corpo);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(SefazErro);
    expect(erro).toMatchObject({ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true, passo });
  });
});

/** `requisitar` falso: guarda os bytes de `req.end()` e o Content-Length do pedido e falha logo depois (nada sai da máquina). */
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

describe('os BYTES que o transporte de verdade entrega a req.end() (envelope SOAP 1.2 inteiro)', () => {
  async function bytesEnviados(
    chamar: (a: SefazNfceAdapter) => Promise<unknown>,
    ajuste: Partial<ChamadaSoap12> = {},
  ): Promise<{ documento: string; bytes: Buffer; chamada: ChamadaSoap12 }> {
    const guarda = requisitarQueGuarda();
    let chamada: ChamadaSoap12 | undefined;
    const adapter = new SefazNfceAdapter(icp, (c) => {
      chamada = { ...c, ...ajuste };
      return chamarSoap12(chamada, guarda.requisitar);
    });
    await expect(chamar(adapter)).rejects.toMatchObject({ code: 'SEFAZ_REDE', enviado: false });
    const { bytes, contentLength } = guarda.enviado();
    expect(contentLength).toBe(bytes.length);
    return { documento: bytes.toString('utf8'), bytes, chamada: chamada! };
  }

  it('autorização: o xml-crypto confere a assinatura do infNFe nesses bytes (um nfeDadosMsg, nenhum prefixo, acento em UTF-8)', async () => {
    const { documento, bytes } = await bytesEnviados((a) => a.autorizar(CLIENTE, 'homologacao', ENVI));
    expect(documento).toBe(
      '<?xml version="1.0" encoding="utf-8"?><Envelope xmlns="http://www.w3.org/2003/05/soap-envelope"><Body>' +
        `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${ENVI}</nfeDadosMsg></Body></Envelope>`,
    );
    expect(documento).not.toMatch(/xmlns:/);
    expect(contar(documento, '<nfeDadosMsg')).toBe(1);
    expect(contar(documento, '<enviNFe')).toBe(1);
    expect(bytes.length).toBeGreaterThan(documento.length); // "preferência" (infCpl; em homologação o xProd do item 1 é o texto fixo): 2 bytes em UTF-8
    const sigs = assinaturas(documento);
    expect(sigs).toHaveLength(1);
    expect(confereNoDocumento(documento, sigs[0])).toBe(true);
    // controle: um caractere do infNFe adulterado (o acento do infCpl) derruba
    expect(documento).toContain('Obrigado pela preferência!');
    const adulterado = documento.replace('preferência', 'preferencia');
    expect(confereNoDocumento(adulterado, assinaturas(adulterado)[0])).toBe(false);
  });

  it('autorização com o envelope da distribuição (xmlns:soap12/xsi/xsd em escopo): a mesma assinatura não confere', async () => {
    const { documento } = await bytesEnviados((a) => a.autorizar(CLIENTE, 'homologacao', ENVI), { envelope: 'prefixado' });
    expect(documento).toBe(envelopeSoap12(corpoAutorizacao(ENVI)));
    expect(confereNoDocumento(documento, assinaturas(documento)[0])).toBe(false);
  });

  it('cancelamento: o xml-crypto confere a assinatura do infEvento nesses bytes; o prefixado não', async () => {
    const { documento } = await bytesEnviados((a) => a.registrarEvento(CLIENTE, 'homologacao', ENV_EVENTO));
    expect(documento).toBe(envelopeSoap12SemPrefixo(ENV_EVENTO));
    expect(documento).not.toMatch(/xmlns:/);
    expect(contar(documento, '<nfeDadosMsg')).toBe(1);
    const sigs = assinaturas(documento);
    expect(sigs).toHaveLength(1);
    expect(confereNoDocumento(documento, sigs[0])).toBe(true);
    const prefixado = (await bytesEnviados((a) => a.registrarEvento(CLIENTE, 'homologacao', ENV_EVENTO_NU), { envelope: 'prefixado' }))
      .documento;
    expect(prefixado).toBe(envelopeSoap12(ENV_EVENTO));
    expect(confereNoDocumento(prefixado, assinaturas(prefixado)[0])).toBe(false);
  });

  it('consulta e status saem no mesmo envelope sem prefixo, com o corpo do adaptador', async () => {
    expect((await bytesEnviados((a) => a.consultar(CLIENTE, 'homologacao', CHAVE))).documento).toBe(
      envelopeSoap12SemPrefixo(corpoConsulta('homologacao', CHAVE)),
    );
    expect((await bytesEnviados((a) => a.status(CLIENTE, 'producao'))).documento).toBe(envelopeSoap12SemPrefixo(corpoStatus('producao')));
  });
});

describe('SefazNfceFalso', () => {
  it('responde na ordem da fila, guarda servico, ambiente e o corpo que o adaptador mandaria, e nunca cai para a rede', async () => {
    const falso = new SefazNfceFalso();
    const erro = sefazErro('SEFAZ_REDE', false);
    let chamou = 0;
    falso.aoChamar = () => void chamou++;
    falso.respostas.push(
      lerRetornoAutorizacao(fx('ret-autorizacao-100.xml')),
      erro,
      lerRetornoEvento(fx('ret-evento-573.xml')),
      lerRetornoStatus(fx('ret-status-107.xml')),
    );
    await expect(falso.autorizar(CLIENTE, 'homologacao', ENVI)).resolves.toMatchObject({ cStatLote: 104, protocolo: { cStat: 100 } });
    await expect(falso.consultar(CLIENTE, 'homologacao', CHAVE_ALFA)).rejects.toBe(erro);
    await expect(falso.registrarEvento(CLIENTE, 'producao', ENV_EVENTO)).resolves.toMatchObject({ cStat: 573 });
    await expect(falso.status(CLIENTE, 'producao')).resolves.toMatchObject({ cStat: 107 });
    await expect(falso.status(CLIENTE, 'producao')).rejects.toThrow('chamada inesperada à SEFAZ');
    expect(falso.chamadas).toEqual([
      { servico: 'autorizacao', ambiente: 'homologacao', corpo: corpoAutorizacao(ENVI) },
      { servico: 'consulta', ambiente: 'homologacao', corpo: corpoConsulta('homologacao', CHAVE_ALFA) },
      { servico: 'evento', ambiente: 'producao', corpo: corpoEvento(ENV_EVENTO) },
      { servico: 'status', ambiente: 'producao', corpo: corpoStatus('producao') },
      { servico: 'status', ambiente: 'producao', corpo: corpoStatus('producao') },
    ]);
    expect(chamou).toBe(5);
  });

  it('resposta de outro serviço na fila é erro; entrada fora do formato é recusada antes (como no adaptador), sem chamada', async () => {
    const falso = new SefazNfceFalso();
    falso.respostas.push(lerRetornoStatus(fx('ret-status-107.xml')));
    await expect(falso.autorizar(CLIENTE, 'homologacao', ENVI)).rejects.toThrow('resposta falsa de outro serviço');
    falso.respostas.push(lerRetornoConsulta(fx('ret-consulta-217.xml')));
    await expect(falso.consultar(CLIENTE, 'homologacao', 'x')).rejects.toThrow(Error);
    await expect(falso.registrarEvento(CLIENTE, 'homologacao', CANCELAMENTO)).rejects.toThrow(Error);
    await expect(falso.autorizar(CLIENTE, 'homologacao', corpoAutorizacao(ENVI))).rejects.toThrow(Error);
    await expect(falso.status(CLIENTE, 'teste' as AmbienteSefaz)).rejects.toThrow(Error);
    expect(falso.chamadas).toHaveLength(1);
    expect(falso.respostas).toHaveLength(1); // a do 217 continua na fila
  });
});
