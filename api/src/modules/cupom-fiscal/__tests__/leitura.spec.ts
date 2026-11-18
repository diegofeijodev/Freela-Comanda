import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { montarChaveNfce } from '../../../common/fiscal/chave-acesso';
import { toWire } from '../../../common/http/wire';
import type { CertificadoDigitalPort } from '../../certificado-digital/certificado-digital.port';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { fixtureNfce, SefazNfceFalso, type RespostaNfce } from '../../sefaz/__tests__/sefaz-nfce.falso';
import { dhSefaz } from '../../sefaz/eventos-xml';
import { lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoEvento } from '../../sefaz/nfce.adapter';
import { sefazErro, type SefazErro } from '../../sefaz/sefaz-erro';
import { elementos, lerXml, primeiro, texto } from '../../sefaz/xml-leitura';
import { CupomCadastroService, type Autor } from '../cadastro.service';
import { CupomCancelamentoService } from '../cancelamento.service';
import { cifrarCsc } from '../csc';
import { danfeDoNfeProc } from '../danfe';
import { CupomEmissaoService, type VendaParaCupom } from '../emissao.service';
import { FRASE_ERRO, FRASES_LEITURA } from '../frases';
import { CupomLeituraService, filtroDaLista, procEventoDoCancelamento } from '../leitura.service';
import { XPROD_HOMOLOGACAO } from '../montagem-xml';
import { URL_CHAVE, URL_QR } from '../qrcode-nfce';
import { zipSemCompressao } from '../zip';
import { linhaCom, montarPrismaCupom, type TabelasCupom } from './prisma-cupom.falso';

// Leitura do cupom fiscal (Tarefa 13): lista, cupom, DANFE (só do nfeProc guardado), XML do cupom e do cancelamento, zip do mês para o
// contador e as vendas do período. Os cupons nascem pela emissão e pelo cancelamento de verdade (Prisma falso, porta falsa da NFC-e:
// nunca rede) ou semeados direto na tabela. Nada aqui fala com a SEFAZ: a leitura não tem a porta.

const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const SEGREDO = 'segredo-de-teste-do-cupom-fiscal-com-32+';
const CNPJ = '12345678000195';
const CPF = '52998224725';
const CNPJ_CLIENTE = '11222333000181';
const EU: Autor = { id: '11111111-1111-4111-8111-111111111111', nome: 'Diego' };
/** 14h05min31s em Brasília. */
const T0 = new Date('2026-11-17T17:05:31Z');
const MIN = 60_000;
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MOTIVO = 'Cliente desistiu da compra';
const NOME_CHOPP = 'Chopp & <Lager> 300 ml';
const NS = 'http://www.portalfiscal.inf.br/nfe';

type Amb = 'homologacao' | 'producao';

function montar(o: { ambiente?: Amb | 'desligado' } = {}) {
  const m = montarPrismaCupom({ cnpjEmpresa: CNPJ });
  const env: Record<string, string | undefined> = { NFCE_AMBIENTE: o.ambiente ?? 'producao', CERTIFICADO_SECRET: SEGREDO };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const certificados: CertificadoDigitalPort = { emUso: jest.fn(async () => CLIENTE) };
  const porta = new SefazNfceFalso();
  const cadastro = new CupomCadastroService(m.prisma, config, certificados);
  const emissao = new CupomEmissaoService(m.prisma, config, certificados, porta, cadastro);
  const cancelamento = new CupomCancelamentoService(m.prisma, porta, emissao);
  const leitura = new CupomLeituraService(m.prisma, cadastro, emissao);
  return { ...m, env, porta, cadastro, emissao, cancelamento, leitura, produtos: { espeto: '', chopp: '' } };
}
type M = ReturnType<typeof montar>;

const cupomDe = (t: TabelasCupom, id: string) => t.nfce_cupons.find((c) => c.id === id)!;
const ambienteDe = (t: TabelasCupom, a: Amb) => t.nfce_ambientes.find((x) => x.ambiente === a)!;

/** Empresa, numeração, CSC, um perfil do Simples, o "Espetinho de carne" (R$ 25,00) e o chopp com `&` e `<` no nome (R$ 9,90). */
async function pronto(m: M, a: Amb) {
  Object.assign(m.t.nfce_emitente[0], {
    ie: '123456789012',
    crt: 1,
    logradouro: 'Rua das Flores',
    numero: '10',
    bairro: 'Centro',
    cep: '13270000',
    inf_cpl: 'Obrigado & volte <sempre>',
    sem_outro_sistema: a === 'producao',
    cupom_lanca_venda: a === 'producao' ? true : null,
  });
  Object.assign(ambienteDe(m.t, a), {
    serie: 2,
    proximo_numero: 1n,
    id_csc: 1,
    csc_cifrado: cifrarCsc(CSC_TESTE, SEGREDO),
    csc_dica: 'CDEF',
  });
  const perfil = linhaCom('nfce_perfis_fiscais', { nome: 'Prato da casa', cfop: '5102', csosn: '102' });
  m.t.nfce_perfis_fiscais.push(perfil);
  const espeto = linhaCom('itens_cardapio', { nome: 'Espetinho de carne', preco_venda: '25.00' });
  const chopp = linhaCom('itens_cardapio', { nome: NOME_CHOPP, preco_venda: '9.90' });
  m.t.itens_cardapio.push(espeto, chopp);
  for (const i of [espeto, chopp])
    m.t.nfce_itens.push(linhaCom('nfce_itens', { item_cardapio_id: i.id, ncm: '16025000', perfil_fiscal_id: perfil.id }));
  if (a === 'producao') {
    // o teste no modo de teste que ligar valendo pede
    for (const [numero, situacao] of [
      [1, 'autorizado'],
      [2, 'cancelado'],
    ] as const)
      semear(m.t, { ambiente: 'homologacao', serie: 9, numero, situacao, criado_em: mais(T0, -24 * 60 * MIN) });
  }
  await m.emissao.ligarEmissao(a, true, a === 'producao', EU, T0);
  m.produtos = { espeto: espeto.id, chopp: chopp.id };
}

/** 2 espetinhos + 1 chopp = R$ 59,90, com R$ 0,90 de desconto = R$ 59,00 no crédito. */
const venda = (m: M, o: Partial<VendaParaCupom> = {}): VendaParaCupom => ({
  chave_idempotencia: randomUUID(),
  itens: [
    { item_cardapio_id: m.produtos.espeto, quantidade: '2' },
    { item_cardapio_id: m.produtos.chopp, quantidade: '1' },
  ],
  desconto_centavos: 90,
  pagamentos: [{ t_pag: '03', valor_centavos: 5900 }],
  consumidor_doc: null,
  total_esperado_centavos: 5900,
  ...o,
});

let cnf = 60_000_000;
/** Um cupom direto na tabela (a semente não passa pelos CHECKs do falso). */
function semear(t: TabelasCupom, o: { ambiente?: Amb; serie?: number; numero: number; situacao: string } & Record<string, unknown>) {
  const { ambiente = 'producao', serie = 2, numero, ...resto } = o;
  const c_nf = String(++cnf);
  const linha = linhaCom('nfce_cupons', {
    ambiente,
    serie,
    numero,
    chave: montarChaveNfce({ aamm: '2611', cnpj: CNPJ, serie, numero, tpEmis: 1, cNF: c_nf }),
    c_nf,
    valor_produtos: '10',
    valor_total: '10',
    ...resto,
  });
  t.nfce_cupons.push(linha);
  return linha;
}

// --- respostas montadas a partir do pedido (chave, DigestValue e hora; nunca rede) ---------------------------------------------------

const CH_FIXTURE = '35261112345678000195650010000000121402133776';
const DIG_FIXTURE = 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=';
const DH_FIXTURE = '2026-11-17T14:30:02-03:00';

function chaveDo(corpo: string): string {
  const c = /Id="NFe([0-9A-Z]{44})"/.exec(corpo)?.[1] ?? /<chNFe>([0-9A-Z]{44})<\/chNFe>/.exec(corpo)?.[1];
  if (!c) throw new Error('pedido sem chave');
  return c;
}
function trocar(x: string, corpo: string, dh: Date, a: Amb): string {
  let y = x.replaceAll(CH_FIXTURE, chaveDo(corpo)).replaceAll(DH_FIXTURE, dhSefaz(dh));
  y = y.replace(/<dhRegEvento>[^<]*<\/dhRegEvento>/g, `<dhRegEvento>${dhSefaz(dh)}</dhRegEvento>`);
  const dig = /<DigestValue>([^<]+)<\/DigestValue>/.exec(corpo)?.[1];
  if (dig) y = y.replaceAll(DIG_FIXTURE, dig);
  return a === 'producao' ? y.replaceAll('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>') : y;
}
type Resposta = (corpo: string) => RespostaNfce | SefazErro;
const aut =
  (dh: Date, a: Amb, nome = 'ret-autorizacao-100.xml'): Resposta =>
  (corpo) =>
    lerRetornoAutorizacao(trocar(fixtureNfce(nome), corpo, dh, a));
const ev =
  (nome: string, dh: Date, a: Amb = 'producao', mexer: (x: string) => string = (x) => x): Resposta =>
  (corpo) =>
    lerRetornoEvento(mexer(trocar(fixtureNfce(nome), corpo, dh, a)));
const cons =
  (m: M, dh: Date, a: Amb = 'producao', mexer: (x: string) => string = (x) => x): Resposta =>
  (corpo) => {
    const chave = chaveDo(corpo);
    const base = m.porta.chamadas.find((c) => c.servico === 'autorizacao' && c.corpo.includes(`Id="NFe${chave}"`))!.corpo;
    return lerRetornoConsulta(mexer(trocar(fixtureNfce('ret-consulta-cancelada.xml'), base, dh, a)));
  };
const semResposta: Resposta = () => sefazErro('SEFAZ_TEMPO', true);
/**
 * O retorno com prefixo de namespace: `<ns2:raiz xmlns:ns2="…/nfe">` e cada marca de dentro com `ns2:` (a `Signature` do evento fica no
 * namespace dela, sem prefixo). O adaptador e o cancelamento aceitam esse formato; a leitura tem de remontar o cancelamento dele também.
 */
const comPrefixo = (raiz: string) => (x: string) =>
  x.replace(new RegExp(`<${raiz} xmlns="${NS}"[\\s\\S]*</${raiz}>`), (bloco) =>
    bloco
      .replace(` xmlns="${NS}"`, ` xmlns:ns2="${NS}"`)
      .split(/(<Signature[\s\S]*?<\/Signature>)/)
      .map((parte, i) => (i % 2 === 1 ? parte : parte.replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s>/])/g, '<$1ns2:$2')))
      .join(''),
  );

function responder(m: M, ...fila: Resposta[]) {
  m.porta.aoChamar = () => {
    const f = fila.shift();
    if (f) m.porta.respostas.push(f(m.porta.chamadas[m.porta.chamadas.length - 1].corpo));
  };
}

/** Um cupom autorizado agora (`agora` = a hora do envio e da autorização). */
async function emitido(m: M, a: Amb, agora: Date, o: Partial<VendaParaCupom> = {}, nome?: string): Promise<string> {
  responder(m, aut(agora, a, nome));
  const r = await m.emissao.emitir(venda(m, o), EU, agora);
  expect(r.cupom.situacao).toBe('autorizado');
  return r.cupom.id;
}

async function falha(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as { code: string; message: string }) };
    throw e;
  }
  throw new Error('não lançou');
}

/**
 * Lê o zip como um leitor de verdade: os cabeçalhos locais em sequência (método 0, crc32 conferido com `zlib.crc32`, tamanhos iguais),
 * depois o diretório central (uma entrada por arquivo, apontando para o cabeçalho local) e o fim (contagem e posições).
 */
function lerZip(zip: Buffer): { nome: string; dados: Buffer }[] {
  const out: { nome: string; dados: Buffer; local: number }[] = [];
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const n = zip.readUInt16LE(p + 26);
    const extra = zip.readUInt16LE(p + 28);
    const tam = zip.readUInt32LE(p + 18);
    const dados = Buffer.from(zip.subarray(p + 30 + n + extra, p + 30 + n + extra + tam));
    expect(zip.readUInt16LE(p + 8)).toBe(0); // sem compressão
    expect(zip.readUInt32LE(p + 22)).toBe(tam);
    expect(zip.readUInt32LE(p + 14)).toBe(crc32(dados));
    out.push({ nome: zip.subarray(p + 30, p + 30 + n).toString('utf8'), dados, local: p });
    p += 30 + n + extra + tam;
  }
  const fim = zip.length - 22;
  expect(zip.readUInt32LE(fim)).toBe(0x06054b50);
  expect(zip.readUInt16LE(fim + 8)).toBe(out.length);
  expect(zip.readUInt16LE(fim + 10)).toBe(out.length);
  const tamCentral = zip.readUInt32LE(fim + 12);
  expect(zip.readUInt32LE(fim + 16)).toBe(p);
  expect(p + tamCentral).toBe(fim);
  let q = p;
  for (const a of out) {
    expect(zip.readUInt32LE(q)).toBe(0x02014b50);
    const n = zip.readUInt16LE(q + 28);
    expect(zip.readUInt16LE(q + 10)).toBe(0);
    expect(zip.readUInt32LE(q + 16)).toBe(crc32(a.dados));
    expect(zip.readUInt32LE(q + 42)).toBe(a.local);
    expect(zip.subarray(q + 46, q + 46 + n).toString('utf8')).toBe(a.nome);
    q += 46 + n + zip.readUInt16LE(q + 30) + zip.readUInt16LE(q + 32);
  }
  expect(q).toBe(fim);
  return out.map(({ nome, dados }) => ({ nome, dados }));
}

const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  const guardar = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  jest.spyOn(Logger.prototype, 'log').mockImplementation(guardar);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(guardar);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(guardar);
});
afterEach(() => jest.restoreAllMocks());

// =========================================================================================================================== DANFE

describe('DANFE (só do nfeProc guardado)', () => {
  it('danfeDoNfeProc traz as divisões I a IX do XML que a emissão gravou, mais o protocolo, o QR e a URL de consulta', async () => {
    const m = montar({ ambiente: 'homologacao' });
    await pronto(m, 'homologacao');
    const id = await emitido(m, 'homologacao', T0, { consumidor_doc: CPF });
    const c = cupomDe(m.t, id);
    const d = danfeDoNfeProc(c.xml_autorizado!);
    expect(d.emit).toEqual({
      CNPJ,
      xNome: 'Chopp e Espeto Valinhos Ltda',
      xFant: 'Chopp & Espeto',
      IE: '123456789012',
      enderEmit: {
        xLgr: 'Rua das Flores',
        nro: '10',
        xCpl: null,
        xBairro: 'Centro',
        xMun: 'Valinhos',
        UF: 'SP',
        CEP: '13270000',
        fone: null,
      },
    });
    // em homologação o 1º item sai com o texto fixo da SEFAZ; o 2º, com o nome do cardápio (& e < legíveis)
    expect(d.det.map((i) => [i.nItem, i.xProd, i.qCom, i.uCom, i.vUnCom, i.vProd])).toEqual([
      [1, XPROD_HOMOLOGACAO, '2.0000', 'UN', '25.00', '50.00'],
      [2, NOME_CHOPP, '1.0000', 'UN', '9.90', '9.90'],
    ]);
    expect(d.det.every((i) => typeof i.cProd === 'string' && i.cProd.length > 0)).toBe(true);
    expect(d.det.map((i) => i.vDesc)).toEqual(['0.76', '0.14']); // rateio: piso + a sobra no maior
    expect(d.total).toEqual({ qItens: 2, vProd: '59.90', vDesc: '0.90', vFrete: '0.00', vSeg: '0.00', vOutro: '0.00', vNF: '59.00' });
    expect(d.pag).toEqual({ detPag: [{ tPag: '03', xPag: null, vPag: '59.00' }], vTroco: null });
    expect(d.chave).toBe(c.chave);
    expect(d.urlChave).toBe(URL_CHAVE.homologacao);
    expect(d.qrCode).toMatch(new RegExp(`^${URL_QR.homologacao.replace(/[.?]/g, '\\$&')}\\?p=${c.chave}\\|2\\|2\\|1\\|[0-9A-F]{40}$`));
    expect(d.dest).toEqual({ CPF, CNPJ: null, idEstrangeiro: null, xNome: null });
    expect(d.ide).toEqual({ nNF: '1', serie: '2', dhEmi: dhSefaz(T0), tpEmis: '1' });
    expect(d.nProt).toBe('13526000000012345');
    expect(d.dhRecbto).toBe(dhSefaz(T0));
    expect(d.homologacao).toBe(true);
    expect(d.infCpl).toBe('Obrigado & volte <sempre>');
    expect(d.cMsg).toBeNull();
    expect(d.xMsg).toBeNull();
    // o CSC nunca: o QR leva só o hash
    expect(JSON.stringify(d)).not.toContain(CSC_TESTE);
  });

  it('valendo, sem consumidor e com o aviso do 120: homologacao false, dest null, cMsg e xMsg do protNFe', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0, {}, 'ret-autorizacao-120.xml');
    const d = danfeDoNfeProc(cupomDe(m.t, id).xml_autorizado!);
    expect(d.homologacao).toBe(false);
    expect(d.det[0].xProd).toBe('Espetinho de carne');
    expect(d.dest).toBeNull();
    expect(d.urlChave).toBe(URL_CHAVE.producao);
    expect(d.qrCode?.startsWith(`${URL_QR.producao}?p=`)).toBe(true);
    expect(d).toMatchObject({ nProt: '13526000000012346', cMsg: '9001', xMsg: 'Destinatário com situação cadastral irregular (fictício)' });
  });

  it('mudar as linhas das tabelas depois não muda o DANFE: ele vem só do xml_autorizado', async () => {
    const m = montar({ ambiente: 'homologacao' });
    await pronto(m, 'homologacao');
    const id = await emitido(m, 'homologacao', T0, { consumidor_doc: CPF });
    const antes = await m.leitura.danfe(id, mais(T0, MIN));
    // as fotografias, o cupom, o cardápio e a empresa mudam (direto na tabela, como se fosse outra versão do sistema)
    for (const i of m.t.nfce_cupom_itens) Object.assign(i, { x_prod: 'Outro nome', nome_cardapio: 'Outro', unidade: 'KG' });
    Object.assign(cupomDe(m.t, id), { consumidor_doc: CNPJ_CLIENTE, n_prot: '99999999999999999', serie: 7 });
    for (const i of m.t.itens_cardapio) i.nome = `${i.nome} (novo)`;
    Object.assign(m.t.configuracoes, { razao_social: 'Outra Razão Ltda', nome_fantasia: 'Outra' });
    Object.assign(m.t.nfce_emitente[0], { logradouro: 'Outra rua', inf_cpl: 'Outro texto' });
    const depois = await m.leitura.danfe(id, mais(T0, MIN));
    expect(depois).toEqual(antes);
    expect(depois.det[1].xProd).toBe(NOME_CHOPP);
    expect(depois.dest?.CPF).toBe(CPF);
  });

  it('só do cupom autorizado: cancelado, cancelando e não saiu = 409 NFCE_SITUACAO ("não dá para imprimir"); id desconhecido = 404', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const cancelado = await emitido(m, 'producao', T0);
    responder(m, ev('ret-evento-135.xml', mais(T0, 5 * MIN)));
    expect((await m.cancelamento.cancelar(cancelado, MOTIVO, EU, mais(T0, 5 * MIN))).situacao).toBe('cancelado');
    expect(await falha(m.leitura.danfe(cancelado, mais(T0, 6 * MIN)))).toEqual({
      status: 409,
      code: 'NFCE_SITUACAO',
      message: 'Este cupom já foi cancelado; não dá para imprimir.',
    });
    const cancelando = await emitido(m, 'producao', mais(T0, 7 * MIN));
    responder(m, semResposta);
    await m.cancelamento.cancelar(cancelando, MOTIVO, EU, mais(T0, 8 * MIN));
    expect(await falha(m.leitura.danfe(cancelando, mais(T0, 9 * MIN)))).toMatchObject({
      status: 409,
      message: FRASE_ERRO.NFCE_SITUACAO('cancelando', 'imprimir'),
    });
    const naoSaiu = semear(m.t, { numero: 90, situacao: 'nao_enviado' });
    expect(await falha(m.leitura.danfe(naoSaiu.id, T0))).toMatchObject({ status: 409, code: 'NFCE_SITUACAO' });
    expect(await falha(m.leitura.danfe(randomUUID(), T0))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('nfeProc fora do formato = erro de frase fixa, sem trecho do XML', () => {
    const quebrado = `<nfeProc xmlns="${NS}"><NFe><infNFe Id="NFe${CH_FIXTURE}"><dest><CPF>${CPF}</CPF></dest></infNFe></NFe></nfeProc>`;
    let msg = '';
    try {
      danfeDoNfeProc(quebrado);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe('');
    expect(msg).not.toContain(CPF);
    expect(() => danfeDoNfeProc('<!DOCTYPE x><x/>')).toThrow();
  });
});

// =========================================================================================================================== lista

describe('lista de cupons (GET cupons)', () => {
  it('o CPF vem ***.982.247-** e o CNPJ inteiro; dinheiro em centavos inteiros; nada de XML nem CPF completo no fio', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const comCpf = await emitido(m, 'producao', T0, { consumidor_doc: CPF });
    const comCnpj = await emitido(m, 'producao', mais(T0, MIN), { consumidor_doc: CNPJ_CLIENTE });
    const semDoc = await emitido(m, 'producao', mais(T0, 2 * MIN));
    const linhas = await m.leitura.listar({}, mais(T0, 3 * MIN));
    expect(linhas.map((l) => [l.id, l.consumidor_doc])).toEqual([
      [semDoc, null],
      [comCnpj, CNPJ_CLIENTE],
      [comCpf, '***.982.247-**'],
    ]);
    expect(linhas[2]).toMatchObject({
      ambiente: 'producao',
      serie: 2,
      numero: 1,
      situacao: 'autorizado',
      valor_total_centavos: 5900,
      pagamentos: [{ t_pag: '03', valor_centavos: 5900 }],
      venda_estoque: 'lancada',
      acoes: ['consultar', 'cancelar', 'imprimir'],
      cancelar_ate: mais(T0, 29 * MIN),
      autorizada_em: T0,
    });
    const fio = JSON.stringify(toWire(linhas));
    expect(fio).not.toContain(CPF);
    expect(fio).not.toContain('<NFe');
    expect(fio).not.toContain('xml_autorizado');
    expect(fio).not.toContain('pedido_hash');
    for (const l of toWire(linhas) as Record<string, unknown>[]) {
      expect(Number.isInteger(l.valor_total_centavos)).toBe(true);
      expect(Object.keys(l).filter((k) => k.startsWith('valor') && !k.endsWith('_centavos'))).toEqual([]);
    }
    // no cupom (rota de admin) o documento vem inteiro (Ruling T11-1)
    expect((await m.leitura.detalhe(comCpf, mais(T0, 3 * MIN))).consumidor_doc).toBe(CPF);
  });

  it('chave_idempotencia desconhecida → [], sem chamada à porta; a conhecida → só aquele cupom', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const v = venda(m);
    responder(m, aut(T0, 'producao'));
    const r = await m.emissao.emitir(v, EU, T0);
    await emitido(m, 'producao', mais(T0, MIN));
    const chamadas = m.porta.chamadas.length;
    expect(await m.leitura.listar({ chave_idempotencia: randomUUID() }, mais(T0, 2 * MIN))).toEqual([]);
    expect((await m.leitura.listar({ chave_idempotencia: v.chave_idempotencia }, mais(T0, 2 * MIN))).map((l) => l.id)).toEqual([
      r.cupom.id,
    ]);
    expect(m.porta.chamadas).toHaveLength(chamadas);
    // e com o servidor desligado também (só lê o nosso banco)
    m.env.NFCE_AMBIENTE = '';
    expect((await m.leitura.listar({ chave_idempotencia: v.chave_idempotencia }, mais(T0, 2 * MIN))).map((l) => l.id)).toEqual([
      r.cupom.id,
    ]);
    expect(m.porta.chamadas).toHaveLength(chamadas);
  });

  it('atencao=true: os pendentes e o autorizado com a venda que não baixou o estoque (venda_erro); não o autorizado em dia', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const emDia = await emitido(m, 'producao', T0);
    m.est.falharVenda = 1;
    const vendaPendente = await emitido(m, 'producao', mais(T0, MIN));
    expect(cupomDe(m.t, vendaPendente).venda_erro).not.toBeNull();
    const naoSaiu = semear(m.t, { numero: 50, situacao: 'nao_enviado', criado_em: mais(T0, 2 * MIN) });
    const descartado = semear(m.t, { numero: 51, situacao: 'descartado', criado_em: mais(T0, 3 * MIN) });
    const lista = await m.leitura.listar({ atencao: true }, mais(T0, 4 * MIN));
    expect(lista.map((l) => l.id)).toEqual([naoSaiu.id, vendaPendente]);
    expect(lista[1]).toMatchObject({ situacao: 'autorizado', venda_estoque: 'pendente' });
    expect(lista.map((l) => l.id)).not.toContain(emDia);
    expect(lista.map((l) => l.id)).not.toContain(descartado.id);
    // o mesmo número que a faixa de pendentes conta
    expect((await m.cadastro.situacao(mais(T0, 4 * MIN))).pendentes.total).toBe(lista.length);
  });

  it('sem ambiente: o do servidor; com o servidor desligado, producao; com ambiente, o pedido', async () => {
    const m = montar({ ambiente: 'desligado' });
    const prod = semear(m.t, { ambiente: 'producao', numero: 1, situacao: 'autorizado', criado_em: T0 });
    const homo = semear(m.t, { ambiente: 'homologacao', numero: 1, situacao: 'autorizado', criado_em: T0 });
    expect((await m.leitura.listar({}, T0)).map((l) => l.id)).toEqual([prod.id]);
    m.env.NFCE_AMBIENTE = 'homologacao';
    expect((await m.leitura.listar({}, T0)).map((l) => l.id)).toEqual([homo.id]);
    expect((await m.leitura.listar({ ambiente: 'producao' }, T0)).map((l) => l.id)).toEqual([prod.id]);
  });

  it('situacao filtra pela situação efetiva: o enviando de 3 min atrás sai como sem_resposta', async () => {
    const m = montar();
    const preso = semear(m.t, { numero: 7, situacao: 'enviando', criado_em: T0 });
    m.t.nfce_envios.push(linhaCom('nfce_envios', { ambiente: 'producao', cupom_id: preso.id, servico: 'autorizacao', iniciada_em: T0 }));
    const novo = semear(m.t, { numero: 8, situacao: 'enviando', criado_em: mais(T0, 2 * MIN) });
    m.t.nfce_envios.push(
      linhaCom('nfce_envios', { ambiente: 'producao', cupom_id: novo.id, servico: 'autorizacao', iniciada_em: mais(T0, 2 * MIN) }),
    );
    const autorizado = semear(m.t, { numero: 9, situacao: 'autorizado', criado_em: mais(T0, -MIN), autorizada_em: mais(T0, -MIN) });
    const agora = mais(T0, 3 * MIN);
    const semResp = await m.leitura.listar({ situacao: ['sem_resposta'] }, agora);
    expect(semResp.map((l) => [l.id, l.situacao, l.acoes, l.consultar_a_partir_de])).toEqual([
      [preso.id, 'sem_resposta', ['consultar'], mais(T0, 2 * MIN)],
    ]);
    expect((await m.leitura.listar({ situacao: ['enviando'] }, agora)).map((l) => l.id)).toEqual([novo.id]);
    expect((await m.leitura.listar({ situacao: ['autorizado', 'enviando'] }, agora)).map((l) => l.id)).toEqual([novo.id, autorizado.id]);
  });

  it('período em dias de Brasília (o cupom das 23h30 do dia 17 é do dia 17) e limite depois do filtro, os mais novos primeiro', async () => {
    const m = montar();
    const noite = semear(m.t, { numero: 1, situacao: 'autorizado', criado_em: new Date('2026-11-18T02:30:00Z') });
    const madrugada = semear(m.t, { numero: 2, situacao: 'autorizado', criado_em: new Date('2026-11-18T03:00:00Z') });
    const cedo = semear(m.t, { numero: 3, situacao: 'autorizado', criado_em: new Date('2026-11-17T03:00:00Z') });
    const antes = semear(m.t, { numero: 4, situacao: 'autorizado', criado_em: new Date('2026-11-17T02:59:59Z') });
    const agora = new Date('2026-11-18T12:00:00Z');
    expect((await m.leitura.listar({ ini: '2026-11-17', fim: '2026-11-17' }, agora)).map((l) => l.id)).toEqual([noite.id, cedo.id]);
    expect((await m.leitura.listar({ ini: '2026-11-18' }, agora)).map((l) => l.id)).toEqual([madrugada.id]);
    expect((await m.leitura.listar({ fim: '2026-11-16' }, agora)).map((l) => l.id)).toEqual([antes.id]);
    expect((await m.leitura.listar({ limite: 2 }, agora)).map((l) => l.id)).toEqual([madrugada.id, noite.id]);
  });

  it('filtroDaLista: textos da URL → filtro; valor estranho = 400 VALIDATION_ERROR; limite entre 1 e 500 (padrão 100)', () => {
    const chave = randomUUID();
    expect(
      filtroDaLista({
        ambiente: 'homologacao',
        ini: '2026-11-01',
        fim: '2026-11-30',
        situacao: 'sem_resposta,rejeitado',
        atencao: 'true',
        chave_idempotencia: chave,
        limite: '20',
      }),
    ).toEqual({
      ambiente: 'homologacao',
      ini: '2026-11-01',
      fim: '2026-11-30',
      situacao: ['sem_resposta', 'rejeitado'],
      atencao: true,
      chave_idempotencia: chave,
      limite: 20,
    });
    expect(filtroDaLista({})).toEqual({ limite: 100 });
    expect(filtroDaLista({ situacao: ['autorizado', 'cancelado'], atencao: 'false', limite: '9999' })).toEqual({
      situacao: ['autorizado', 'cancelado'],
      atencao: false,
      limite: 500,
    });
    expect(filtroDaLista({ limite: '0' }).limite).toBe(1);
    for (const q of [
      { ambiente: 'desligado' },
      { ini: '2026-02-31' },
      { fim: '17/11/2026' },
      { situacao: 'autorizado,inventada' },
      { atencao: 'sim' },
      { chave_idempotencia: 'nao-e-uuid' },
      { limite: 'muitos' },
    ]) {
      let r: unknown = null;
      try {
        filtroDaLista(q);
      } catch (e) {
        r = e instanceof HttpException ? { status: e.getStatus(), code: (e.getResponse() as { code: string }).code } : e;
      }
      expect(r).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    }
  });
});

// =========================================================================================================================== cupom

describe('o cupom (GET cupons/:id): a frase do cancelando vem do estado', () => {
  const UX = readFileSync(join(__dirname, '../../../../../docs/superpowers/specs/2026-11-17-cupom-fiscal-ux.md'), 'utf8');
  const CONSULTE = 'Consulte a partir das 14h12. Até lá, o cupom continua valendo e a venda continua no estoque.';

  it('pedido sem resposta: "O pedido de cancelamento saiu às 14h10 e a SEFAZ não respondeu." + "Consulte a partir das 14h12…" (UX 3.1)', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    responder(m, semResposta);
    const r = await m.cancelamento.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN));
    const frase = `O pedido de cancelamento saiu às 14h10 e a SEFAZ não respondeu. ${CONSULTE}`;
    expect(r).toMatchObject({ situacao: 'cancelando', mensagem: frase });
    expect(await m.leitura.detalhe(id, mais(T0, 6 * MIN))).toMatchObject({ situacao: 'cancelando', mensagem: frase });
    expect(UX).toContain('"O pedido de cancelamento saiu às 14h20 e a SEFAZ não respondeu."');
    expect(UX).toContain('"Consulte a partir das 14h22. Até lá, o cupom continua valendo e a venda continua no estoque."');
  });

  it('573: "A SEFAZ diz que já recebeu um pedido de cancelamento deste cupom." + o "Consulte…" (o 573 sai do diário)', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    responder(m, ev('ret-evento-573.xml', mais(T0, 5 * MIN)));
    await m.cancelamento.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN));
    const d = await m.leitura.detalhe(id, mais(T0, 6 * MIN));
    expect(d).toMatchObject({ situacao: 'cancelando' });
    expect(d.mensagem).toBe(`A SEFAZ diz que já recebeu um pedido de cancelamento deste cupom. ${CONSULTE}`);
    expect(UX).toContain('"A SEFAZ diz que já recebeu um pedido de cancelamento deste cupom."');
  });

  it('cancelando sem pedido nosso (a SEFAZ disse cancelado sem mandar o evento): a frase do Ruling T12 fix-1', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    const tc = mais(T0, 3 * MIN);
    responder(
      m,
      cons(m, tc, 'producao', (x) => x.replace(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/, '')),
    );
    await m.emissao.consultar(id, EU, tc);
    const d = await m.leitura.detalhe(id, mais(tc, MIN));
    expect(d).toMatchObject({ situacao: 'cancelando', cancelamento_pedido_em: null });
    expect(d.mensagem).toBe('A SEFAZ informa que este cupom foi cancelado, mas não mandou o comprovante. Consulte de novo mais tarde.');
  });
});

// =========================================================================================================================== XML

describe('XML do cupom e do cancelamento (GET cupons/:id/xml)', () => {
  it('nota = o nfeProc guardado; cancelamento = procEventoNFe com o evento assinado do diário e o retEvento da SEFAZ', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0, { consumidor_doc: CPF });
    responder(m, ev('ret-evento-135.xml', mais(T0, 5 * MIN)));
    await m.cancelamento.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN));
    const c = cupomDe(m.t, id);
    const nota = await m.leitura.xml(id, 'nota', mais(T0, 6 * MIN));
    expect(nota).toEqual({ nome: 'cupom-2-1.xml', xml: c.xml_autorizado });
    const canc = await m.leitura.xml(id, 'cancelamento', mais(T0, 6 * MIN));
    expect(canc.nome).toBe('cancelamento-2-1.xml');
    const evento = m.t.nfce_envios.find((e) => e.cupom_id === id && e.servico === 'cancelamento')!.xml_enviado!;
    expect(canc.xml.startsWith(`<procEventoNFe xmlns="${NS}" versao="1.00">${evento}<retEvento`)).toBe(true);
    const doc = lerXml(canc.xml);
    const ret = primeiro(doc, 'retEvento')!;
    expect([texto(ret, 'cStat'), texto(ret, 'chNFe'), texto(ret, 'nProt'), texto(ret, 'tpAmb')]).toEqual([
      '135',
      c.chave,
      c.cancelamento_n_prot,
      '1',
    ]);
    expect(elementos(doc, 'Signature')).toHaveLength(1);
  });

  it('cupom sem o arquivo pedido = 409 NFCE_SITUACAO com a frase do arquivo; id desconhecido = 404', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    expect(await falha(m.leitura.xml(id, 'cancelamento', T0))).toEqual({
      status: 409,
      code: 'NFCE_SITUACAO',
      message: 'Este cupom está autorizado; não dá para baixar o arquivo do cancelamento (XML).',
    });
    const naoSaiu = semear(m.t, { numero: 90, situacao: 'nao_enviado' });
    expect(await falha(m.leitura.xml(naoSaiu.id, 'nota', T0))).toEqual({
      status: 409,
      code: 'NFCE_SITUACAO',
      message: 'Este cupom não saiu; não dá para baixar o arquivo do cupom (XML).',
    });
    expect(await falha(m.leitura.xml(randomUUID(), 'nota', T0))).toMatchObject({ status: 404 });
  });
});

// =========================================================================================================================== zip e mês

describe('zipSemCompressao', () => {
  it('método 0 com crc32 do zlib: os cabeçalhos locais, o diretório central e o fim conferem; nomes e bytes intactos', () => {
    const arquivos = [
      { nome: `NFCe-${CH_FIXTURE}.xml`, dados: Buffer.from('<nfeProc>á & ç</nfeProc>', 'utf8') },
      { nome: `NFCe-${CH_FIXTURE}-cancelamento.xml`, dados: Buffer.from('<procEventoNFe/>', 'utf8') },
      { nome: 'numeros-nao-usados.csv', dados: Buffer.alloc(0) },
    ];
    const zip = zipSemCompressao(arquivos, new Date('2026-11-17T17:05:31Z'));
    expect(lerZip(zip)).toEqual(arquivos);
    // data e hora do DOS em Brasília: 17/11/2026 14h05min30s (segundos de 2 em 2)
    expect(zip.readUInt16LE(10)).toBe((14 << 11) | (5 << 5) | 15);
    expect(zip.readUInt16LE(12)).toBe(((2026 - 1980) << 9) | (11 << 5) | 17);
    expect(lerZip(zipSemCompressao([]))).toEqual([]);
  });

  it('nome repetido, vazio ou com barra = erro', () => {
    const d = Buffer.from('x');
    expect(() =>
      zipSemCompressao([
        { nome: 'a.xml', dados: d },
        { nome: 'a.xml', dados: d },
      ]),
    ).toThrow();
    expect(() => zipSemCompressao([{ nome: '', dados: d }])).toThrow();
    expect(() => zipSemCompressao([{ nome: '../a.xml', dados: d }])).toThrow();
  });
});

describe('XML do mês para o contador (GET xml-do-mes)', () => {
  it('nfeProc dos autorizados, denegados e cancelados do mês, procEventoNFe dos cancelados (pelo pedido ou pela consulta) e o csv', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const autorizado = await emitido(m, 'producao', T0, { consumidor_doc: CPF });
    const cancelado = await emitido(m, 'producao', mais(T0, MIN));
    responder(m, ev('ret-evento-135.xml', mais(T0, 5 * MIN)));
    await m.cancelamento.cancelar(cancelado, MOTIVO, EU, mais(T0, 5 * MIN));
    // cancelado pela consulta: o pedido ficou sem resposta e a consulta trouxe o procEventoNFe
    const pelaConsulta = await emitido(m, 'producao', mais(T0, 6 * MIN));
    responder(m, semResposta, cons(m, mais(T0, 10 * MIN)));
    await m.cancelamento.cancelar(pelaConsulta, MOTIVO, EU, mais(T0, 7 * MIN));
    expect((await m.emissao.consultar(pelaConsulta, EU, mais(T0, 10 * MIN))).situacao).toBe('cancelado');
    // semeados: denegado (com nfeProc), descartado reaproveitado por um autorizado, 539, preso sem resposta, descartado livre
    const denegado = semear(m.t, { numero: 40, situacao: 'denegado', dh_emi: T0, xml_autorizado: '<nfeProc>denegado</nfeProc>' });
    semear(m.t, { numero: 50, situacao: 'descartado', dh_emi: T0, descarte_motivo: 'Vou corrigir' });
    const reaproveitou = semear(m.t, { numero: 50, situacao: 'autorizado', dh_emi: T0, xml_autorizado: '<nfeProc>50</nfeProc>' });
    semear(m.t, { numero: 51, situacao: 'descartado', numero_reaproveitavel: false, c_stat: 539, dh_emi: T0 });
    semear(m.t, { numero: 52, situacao: 'sem_resposta', dh_emi: T0 });
    semear(m.t, { numero: 53, situacao: 'descartado', dh_emi: T0 });
    // bloqueado pelo 539 que só ficou no diário (uma consulta depois gravou o 217 no cupom)
    const consultado = semear(m.t, { numero: 54, situacao: 'descartado', numero_reaproveitavel: false, c_stat: 217, dh_emi: T0 });
    m.t.nfce_envios.push(
      linhaCom('nfce_envios', { ambiente: 'producao', cupom_id: consultado.id, servico: 'autorizacao', iniciada_em: T0, c_stat: 539 }),
    );
    // bloqueado porque a consulta mostrou uma nota desta chave sem a tentativa conferida (não é 539)
    semear(m.t, { numero: 55, situacao: 'descartado', numero_reaproveitavel: false, dh_emi: T0 });
    // fora do mês (31/10 às 23h30 em Brasília) e de homologação: não entram
    semear(m.t, {
      numero: 60,
      situacao: 'autorizado',
      dh_emi: new Date('2026-11-01T02:30:00Z'),
      xml_autorizado: '<nfeProc>outubro</nfeProc>',
    });
    semear(m.t, { numero: 61, situacao: 'sem_resposta', dh_emi: new Date('2026-11-01T02:30:00Z') });
    const ids = [autorizado, cancelado, pelaConsulta].map((id) => cupomDe(m.t, id));

    const r = await m.leitura.xmlDoMes('2026-11', undefined, mais(T0, 11 * MIN));
    expect(r.nome).toBe('cupons-2026-11.zip');
    const arquivos = lerZip(r.zip);
    const nomes = arquivos.map((a) => a.nome);
    expect(nomes.sort()).toEqual(
      [
        `NFCe-${ids[0].chave}.xml`,
        `NFCe-${ids[1].chave}.xml`,
        `NFCe-${ids[1].chave}-cancelamento.xml`,
        `NFCe-${ids[2].chave}.xml`,
        `NFCe-${ids[2].chave}-cancelamento.xml`,
        `NFCe-${denegado.chave}.xml`,
        `NFCe-${reaproveitou.chave}.xml`,
        'numeros-nao-usados.csv',
      ].sort(),
    );
    const de = (nome: string) => arquivos.find((a) => a.nome === nome)!.dados.toString('utf8');
    // o nfeProc vai como está guardado (é o documento fiscal: o CPF do consumidor fica dentro dele)
    expect(de(`NFCe-${ids[0].chave}.xml`)).toBe(ids[0].xml_autorizado);
    for (const c of ids.slice(1)) {
      const doc = lerXml(de(`NFCe-${c.chave}-cancelamento.xml`));
      expect([doc.documentElement?.localName, doc.documentElement?.namespaceURI]).toEqual(['procEventoNFe', NS]);
      const ret = primeiro(doc, 'retEvento')!;
      expect([texto(ret, 'chNFe'), texto(ret, 'nProt'), texto(ret, 'cStat')]).toEqual([c.chave, c.cancelamento_n_prot, '135']);
    }
    // o csv: série, número e motivo dos números que não viraram cupom (o 50 foi reaproveitado; outubro não entra)
    const csv = de('numeros-nao-usados.csv');
    expect(csv.startsWith('\ufeffserie;numero;motivo\n')).toBe(true);
    const linhas = csv.replace('\ufeff', '').trim().split('\n').slice(1);
    const M = FRASES_LEITURA.naoUsado;
    expect(linhas).toEqual([
      `2;51;${M.outraNota}`,
      `2;52;${M.semResposta}`,
      `2;53;${M.descartado}`,
      `2;54;${M.outraNota}`,
      `2;55;${M.notaSemArquivo}`,
    ]);
    expect(csv).not.toContain(CPF);
  });

  it('retorno do pedido com prefixo de namespace (ns2:retEnvEvento): o procEventoNFe se remonta pelo nome local, sem aviso', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    responder(m, ev('ret-evento-135.xml', mais(T0, 5 * MIN), 'producao', comPrefixo('retEnvEvento')));
    expect((await m.cancelamento.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN))).situacao).toBe('cancelado');
    const pedido = m.t.nfce_envios.find((e) => e.cupom_id === id && e.servico === 'cancelamento')!;
    expect(pedido.xml_retorno).toContain('<ns2:retEvento ');
    const c = cupomDe(m.t, id);
    const { xml } = await m.leitura.xml(id, 'cancelamento', mais(T0, 6 * MIN));
    expect(xml.startsWith(`<procEventoNFe xmlns="${NS}" versao="1.00">${pedido.xml_enviado}<ns2:retEvento `)).toBe(true);
    const doc = lerXml(xml);
    const ret = primeiro(doc, 'retEvento')!;
    expect(ret.namespaceURI).toBe(NS);
    expect([texto(ret, 'chNFe'), texto(ret, 'tpAmb'), texto(ret, 'nProt'), texto(ret, 'cStat')]).toEqual([
      c.chave,
      '1',
      c.cancelamento_n_prot,
      '135',
    ]);
    const nomes = lerZip((await m.leitura.xmlDoMes('2026-11', undefined, mais(T0, 6 * MIN))).zip).map((a) => a.nome);
    expect(nomes.sort()).toEqual([`NFCe-${c.chave}-cancelamento.xml`, `NFCe-${c.chave}.xml`, 'numeros-nao-usados.csv'].sort());
  });

  it('procEventoNFe da consulta com prefixo de namespace (ns2:retConsSitNFe): remonta com o namespace declarado na raiz', () => {
    // a consulta com prefixo hoje não chega a gravar `cancelado` (o adaptador recusa o protNFe com prefixo); a leitura aceita assim mesmo
    const x = comPrefixo('retConsSitNFe')(fixtureNfce('ret-consulta-cancelada.xml'));
    const retorno = x.slice(x.indexOf('<ns2:retConsSitNFe'), x.indexOf('</ns2:retConsSitNFe>') + '</ns2:retConsSitNFe>'.length);
    const c = { chave: CH_FIXTURE, ambiente: 'homologacao', cancelamento_n_prot: '13526000000067890' };
    const envio = { servico: 'consulta', c_stat: 100, n_prot: '13526000000012345', xml_enviado: null, xml_retorno: retorno };
    const proc = procEventoDoCancelamento(c, [envio])!;
    expect(proc).not.toBeNull();
    const doc = lerXml(proc);
    expect([doc.documentElement?.localName, doc.documentElement?.namespaceURI]).toEqual(['procEventoNFe', NS]);
    expect(texto(primeiro(doc, 'retEvento')!, 'nProt')).toBe('13526000000067890');
    expect(elementos(doc, 'Signature')).toHaveLength(1);
    // outro protocolo, outra chave ou outro ambiente: nada
    expect(procEventoDoCancelamento({ ...c, cancelamento_n_prot: '13526000000099999' }, [envio])).toBeNull();
    expect(procEventoDoCancelamento({ ...c, ambiente: 'producao' }, [envio])).toBeNull();
    expect(
      procEventoDoCancelamento(c, [{ ...envio, xml_retorno: retorno.replaceAll(CH_FIXTURE, CH_FIXTURE.replace(/.$/, '7')) }]),
    ).toBeNull();
  });

  it('cancelado com o retorno ilegível e documento sem o arquivo: nunca somem calados (linha no csv e AVISOS.txt)', async () => {
    const m = montar();
    await pronto(m, 'producao');
    const id = await emitido(m, 'producao', T0);
    responder(m, ev('ret-evento-135.xml', mais(T0, 5 * MIN)));
    await m.cancelamento.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN));
    m.t.nfce_envios.find((e) => e.cupom_id === id && e.servico === 'cancelamento')!.xml_retorno = '<retEnvEvento><retEvento>cortado';
    // documento sem o nfeProc (não deve acontecer: o arquivo é gravado junto com o protocolo)
    semear(m.t, { numero: 40, situacao: 'autorizado', dh_emi: T0 });
    const c = cupomDe(m.t, id);
    const arquivos = lerZip((await m.leitura.xmlDoMes('2026-11', undefined, mais(T0, 6 * MIN))).zip);
    expect(arquivos.map((a) => a.nome).sort()).toEqual(['AVISOS.txt', `NFCe-${c.chave}.xml`, 'numeros-nao-usados.csv'].sort());
    const de = (nome: string) => arquivos.find((a) => a.nome === nome)!.dados.toString('utf8');
    expect(de('numeros-nao-usados.csv').replace('\ufeff', '').trim().split('\n').slice(1)).toEqual([
      '2;1;cancelado — comprovante do cancelamento indisponível, peça ao suporte',
      '2;40;autorizado — arquivo do cupom indisponível, peça ao suporte',
    ]);
    const avisos = de('AVISOS.txt');
    expect(avisos).toContain('11/2026');
    expect(avisos).toContain('Série 2, nº 1: cancelado — comprovante do cancelamento indisponível, peça ao suporte.');
    expect(avisos).toContain('Série 2, nº 40: autorizado — arquivo do cupom indisponível, peça ao suporte.');
    // a rota do arquivo diz o mesmo (404 com frase), e o log tem o alerta sem a chave
    expect(await falha(m.leitura.xml(id, 'cancelamento', mais(T0, 6 * MIN)))).toMatchObject({ status: 404 });
    expect(logs.filter((l) => l.includes('sem_arquivo')).length).toBeGreaterThanOrEqual(2);
    expect(logs.join('\n')).not.toContain(c.chave);
  });

  it('mês sem cupom = zip só com o csv (cabeçalho); homologação tem nome próprio; com o servidor desligado vale producao', async () => {
    const m = montar({ ambiente: 'desligado' });
    semear(m.t, { ambiente: 'homologacao', numero: 1, situacao: 'autorizado', dh_emi: T0, xml_autorizado: '<nfeProc>teste</nfeProc>' });
    const r = await m.leitura.xmlDoMes('2026-11', undefined, T0);
    expect(r.nome).toBe('cupons-2026-11.zip');
    expect(lerZip(r.zip).map((a) => [a.nome, a.dados.toString('utf8')])).toEqual([
      ['numeros-nao-usados.csv', '\ufeffserie;numero;motivo\n'],
    ]);
    const h = await m.leitura.xmlDoMes('2026-11', 'homologacao', T0);
    expect(h.nome).toBe('cupons-de-teste-2026-11.zip');
    expect(lerZip(h.zip).map((a) => a.nome)).toHaveLength(2);
  });

  it('mes fora de AAAA-MM = 400 VALIDATION_ERROR', async () => {
    const m = montar();
    for (const mes of ['2026-13', '2026-1', '11/2026', '']) {
      expect(await falha(m.leitura.xmlDoMes(mes, undefined, T0))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
  });
});

// =========================================================================================================================== vendas

describe('vendas no período (o aviso da importação)', () => {
  it('conta os cupons valendo com a venda no estoque, pelo dia de Brasília; fora: teste, venda desfeita, não lança e outro dia', async () => {
    const m = montar();
    const lancado = { lanca_venda: true, venda_lancada_em: T0 };
    semear(m.t, { numero: 1, situacao: 'autorizado', dh_emi: T0, valor_produtos: '59', valor_total: '59', ...lancado });
    // 23h30 do dia 17 em Brasília (já é 18 em UTC)
    semear(m.t, {
      numero: 2,
      situacao: 'autorizado',
      dh_emi: new Date('2026-11-18T02:30:00Z'),
      valor_produtos: '10.5',
      valor_total: '10.5',
      ...lancado,
    });
    // cancelado com a venda ainda no estoque (desfazer pendente) conta; cancelado com a venda desfeita não
    semear(m.t, { numero: 3, situacao: 'cancelado', dh_emi: T0, valor_produtos: '1', valor_total: '1', ...lancado });
    semear(m.t, { numero: 4, situacao: 'cancelado', dh_emi: T0, ...lancado, venda_desfeita_em: T0 });
    semear(m.t, { numero: 5, situacao: 'autorizado', dh_emi: T0, lanca_venda: false });
    semear(m.t, { numero: 6, situacao: 'autorizado', dh_emi: T0, lanca_venda: true });
    semear(m.t, { ambiente: 'homologacao', numero: 7, situacao: 'autorizado', dh_emi: T0, venda_lancada_em: T0 });
    semear(m.t, { numero: 8, situacao: 'autorizado', dh_emi: new Date('2026-11-18T03:00:00Z'), ...lancado });
    expect(await m.leitura.vendasNoPeriodo('2026-11-17', '2026-11-17')).toEqual({ quantidade: 3, valor_centavos: 7050 });
    expect(await m.leitura.vendasNoPeriodo('2026-11-01', '2026-11-30')).toEqual({ quantidade: 4, valor_centavos: 8050 });
    expect(await falha(m.leitura.vendasNoPeriodo('2026-11-18', '2026-11-17'))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(await falha(m.leitura.vendasNoPeriodo('ontem', '2026-11-17'))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
