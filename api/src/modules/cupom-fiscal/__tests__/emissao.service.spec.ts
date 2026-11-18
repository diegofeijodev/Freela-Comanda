import { randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { montarChaveNfce } from '../../../common/fiscal/chave-acesso';
import { toWire } from '../../../common/http/wire';
import type { CertificadoDigitalPort } from '../../certificado-digital/certificado-digital.port';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { fixtureNfce, SefazNfceFalso, type RespostaNfce } from '../../sefaz/__tests__/sefaz-nfce.falso';
import { dhSefaz } from '../../sefaz/eventos-xml';
import { lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoStatus } from '../../sefaz/nfce.adapter';
import type { RespostaAutorizacao } from '../../sefaz/nfce.port';
import { sefazErro, type SefazErro } from '../../sefaz/sefaz-erro';
import { CupomCadastroService, type Autor } from '../cadastro.service';
import { cifrarCsc } from '../csc';
import { CupomEmissaoService, pedidoHash, type VendaParaCupom } from '../emissao.service';
import { FRASE_ERRO, FRASE_RETORNO, FRASES_EMISSAO } from '../frases';
import { FRASES_CADASTRO } from '../frases-cadastro';
import { linhaCom, montarPrismaCupom, type TabelasCupom } from './prisma-cupom.falso';

// Emissão do cupom fiscal (Tarefa 11) com o Prisma falso (CHECKs, índices parciais e gatilho de imutável da migração), a porta falsa da
// NFC-e (nunca rede: cada resposta é montada a partir do pedido que a porta recebeu, com a chave e o DigestValue dele) e o certificado
// fictício dos testes do transporte. CSC de teste do plano.

const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const SEGREDO = 'segredo-de-teste-do-cupom-fiscal-com-32+';
const CNPJ = '12345678000195';
const EU: Autor = { id: '11111111-1111-4111-8111-111111111111', nome: 'Diego' };
/** 14h30 em Brasília. */
const AGORA = new Date('2026-11-17T17:30:00Z');
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;

type Amb = 'homologacao' | 'producao';

function montar(o: { ambiente?: Amb | 'desligado' } = {}) {
  const m = montarPrismaCupom({ cnpjEmpresa: CNPJ });
  const env: Record<string, string | undefined> = { NFCE_AMBIENTE: o.ambiente ?? 'homologacao', CERTIFICADO_SECRET: SEGREDO };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const emUso = jest.fn(async () => CLIENTE);
  const certificados: CertificadoDigitalPort = { emUso };
  const porta = new SefazNfceFalso();
  const cadastro = new CupomCadastroService(m.prisma, config, certificados);
  const svc = new CupomEmissaoService(m.prisma, config, certificados, porta, cadastro);
  return { ...m, env, porta, svc, cadastro, emUso };
}
type M = ReturnType<typeof montar>;

const ambienteDe = (t: TabelasCupom, a: Amb) => t.nfce_ambientes.find((x) => x.ambiente === a)!;
const cupomDe = (t: TabelasCupom, id: string) => t.nfce_cupons.find((c) => c.id === id)!;

let cnfSemente = 70_000_000;
/** Cupom de homologação já resolvido (o teste no modo de teste que ligar valendo pede), com a chave do CNPJ da empresa. */
function cupomDeTeste(t: TabelasCupom, numero: number, situacao: string) {
  const cNF = String(++cnfSemente);
  const chave = montarChaveNfce({ aamm: '2611', cnpj: CNPJ, serie: 9, numero, tpEmis: 1, cNF });
  t.nfce_cupons.push(
    linhaCom('nfce_cupons', {
      ambiente: 'homologacao',
      serie: 9,
      numero,
      chave,
      c_nf: cNF,
      situacao,
      valor_produtos: '1',
      valor_total: '1',
    }),
  );
}

/**
 * Empresa, numeração e CSC do ambiente, um perfil do Simples (CSOSN 102), o "Espetinho de carne" (R$ 25,00) e o "Chopp 300 ml"
 * (R$ 12,345 no cardápio), e a emissão ligada pela rota de ligar. Valendo: a resposta do estoque, "nenhum outro sistema" e o teste feito.
 */
async function pronto(m: M, a: Amb = 'homologacao', o: { lancaVenda?: boolean | null; testeFeito?: boolean; ligar?: boolean } = {}) {
  Object.assign(m.t.nfce_emitente[0], {
    ie: '123456789012',
    crt: 1,
    logradouro: 'Rua das Flores',
    numero: '10',
    bairro: 'Centro',
    cep: '13270000',
    sem_outro_sistema: a === 'producao',
    cupom_lanca_venda: o.lancaVenda === undefined ? (a === 'producao' ? true : null) : o.lancaVenda,
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
  const chopp = linhaCom('itens_cardapio', { nome: 'Chopp 300 ml', preco_venda: '12.345', unidade_venda: 'COPO' });
  m.t.itens_cardapio.push(espeto, chopp);
  for (const i of [espeto, chopp])
    m.t.nfce_itens.push(linhaCom('nfce_itens', { item_cardapio_id: i.id, ncm: '16025000', perfil_fiscal_id: perfil.id }));
  if (a === 'producao' && (o.testeFeito ?? true)) {
    cupomDeTeste(m.t, 1, 'autorizado');
    cupomDeTeste(m.t, 2, 'cancelado');
  }
  if (o.ligar ?? true) await m.svc.ligarEmissao(a, true, a === 'producao', EU, AGORA);
  return { espeto, chopp };
}

const venda = (espetoId: string, o: Partial<VendaParaCupom> = {}): VendaParaCupom => ({
  chave_idempotencia: randomUUID(),
  itens: [{ item_cardapio_id: espetoId, quantidade: '2' }],
  desconto_centavos: 0,
  pagamentos: [{ t_pag: '17', valor_centavos: 5000 }],
  consumidor_doc: null,
  total_esperado_centavos: 5000,
  ...o,
});

// --- respostas montadas a partir do pedido (chave, DigestValue e hora do pedido; nunca rede) -------------------------------------

const CH_FIXTURE = '35261112345678000195650010000000121402133776';
const DIG_FIXTURE = 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=';
const DH_FIXTURE = '2026-11-17T14:30:02-03:00';

function doPedido(corpo: string): { chave: string; dig: string | null } {
  const chave = /Id="NFe([0-9A-Z]{44})"/.exec(corpo)?.[1] ?? /<chNFe>([0-9A-Z]{44})<\/chNFe>/.exec(corpo)?.[1];
  if (!chave) throw new Error('pedido sem chave');
  return { chave, dig: /<DigestValue>([^<]+)<\/DigestValue>/.exec(corpo)?.[1] ?? null };
}
function fixture(nome: string, corpo: string, dh: Date, a: Amb): string {
  const { chave, dig } = doPedido(corpo);
  let x = fixtureNfce(nome).replaceAll(CH_FIXTURE, chave).replaceAll(DH_FIXTURE, dhSefaz(dh));
  if (dig) x = x.replaceAll(DIG_FIXTURE, dig);
  return a === 'producao' ? x.replaceAll('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>') : x;
}
type Resposta = (corpo: string) => RespostaNfce | SefazErro;
const aut =
  (nome: string, dh: Date = AGORA, a: Amb = 'homologacao'): Resposta =>
  (corpo) =>
    lerRetornoAutorizacao(fixture(nome, corpo, dh, a));
const cons =
  (nome: string, dh: Date = AGORA, a: Amb = 'homologacao'): Resposta =>
  (corpo) =>
    lerRetornoConsulta(fixture(nome, corpo, dh, a));
/** Rejeição da nota com outro código (o protNFe do 386 com o cStat trocado). */
const recusaNota =
  (cStat: number, xMotivo: string): Resposta =>
  (corpo) => {
    const r = lerRetornoAutorizacao(fixture('ret-autorizacao-386.xml', corpo, AGORA, 'homologacao'));
    return { ...r, protocolo: { ...r.protocolo!, cStat, xMotivo } };
  };
const lote656: Resposta = (): RespostaAutorizacao => ({
  cStatLote: 656,
  xMotivoLote: 'Rejeição: Consumo Indevido',
  dhRecbto: null,
  protocolo: null,
  xmlRetorno: '<retEnviNFe/>',
});
const erro =
  (enviado: boolean): Resposta =>
  () =>
    sefazErro(enviado ? 'SEFAZ_TEMPO' : 'SEFAZ_REDE', enviado);

/** As próximas chamadas à porta respondem, na ordem, com estas (cada uma montada a partir do pedido que chegou). */
function responder(m: M, ...fila: Resposta[]) {
  m.porta.aoChamar = () => {
    const f = fila.shift();
    if (f) m.porta.respostas.push(f(m.porta.chamadas[m.porta.chamadas.length - 1].corpo));
  };
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

/** O log do serviço (o `nfce.envio` e os avisos), para conferir que nada sensível sai por ele. */
const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  const guardar = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  jest.spyOn(Logger.prototype, 'log').mockImplementation(guardar);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(guardar);
});
afterEach(() => jest.restoreAllMocks());

const nfeDoPedido = (corpo: string) => /<NFe xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe">[\s\S]*<\/NFe>/.exec(corpo)![0];

describe('pedidoHash', () => {
  it('SHA-256 do corpo normalizado: a ordem das chaves do JSON não importa; itens, desconto, pagamento e documento importam', () => {
    const v = venda('e2f1c2a4-1111-4111-8111-000000000001');
    const h = pedidoHash(v);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(pedidoHash({ ...v, chave_idempotencia: randomUUID(), total_esperado_centavos: 1 })).toBe(h);
    expect(pedidoHash({ ...v, consumidor_doc: '' })).toBe(h);
    expect(pedidoHash({ ...v, itens: [{ quantidade: '2', item_cardapio_id: v.itens[0].item_cardapio_id }] } as VendaParaCupom)).toBe(h);
    expect(pedidoHash({ ...v, desconto_centavos: 1 })).not.toBe(h);
    expect(pedidoHash({ ...v, itens: [{ ...v.itens[0], quantidade: '3' }] })).not.toBe(h);
    expect(pedidoHash({ ...v, pagamentos: [{ t_pag: '01', valor_centavos: 5000 }] })).not.toBe(h);
    expect(pedidoHash({ ...v, consumidor_doc: '529.982.247-25' })).toBe(pedidoHash({ ...v, consumidor_doc: '52998224725' }));
  });
});

describe('emitir: T1 → rede → T2 → T3', () => {
  it('fixture 100 → autorizado; a T1 grava enviando com o XML assinado antes da rede; xml_autorizado = nfeProc com a NFe enviada byte a byte', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    let naRede: { situacao: string; envioAberto: boolean; assinado: boolean; numero: bigint } | null = null;
    const resposta = aut('ret-autorizacao-100.xml');
    m.porta.aoChamar = () => {
      const c = m.t.nfce_cupons[0];
      const e = m.t.nfce_envios[0];
      naRede = {
        situacao: c.situacao,
        envioAberto: e.resultado === null,
        assinado: !!e.xml_enviado?.includes('<Signature'),
        numero: c.numero,
      };
      m.porta.respostas.push(resposta(m.porta.chamadas[0].corpo));
    };

    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);

    expect(naRede).toEqual({ situacao: 'enviando', envioAberto: true, assinado: true, numero: 1n });
    expect(r.status).toBe(201);
    expect(r.cupom).toMatchObject({ situacao: 'autorizado', serie: 2, numero: 1, envios: 1, venda_estoque: 'teste', recusa: null });
    expect(r.cupom.acoes).toEqual(['consultar', 'cancelar', 'imprimir']);
    expect(r.cupom.cancelar_ate).toEqual(mais(AGORA, 29 * MIN));
    const c = cupomDe(m.t, r.cupom.id);
    const nfe = nfeDoPedido(m.porta.chamadas[0].corpo);
    expect(c.xml_autorizado!.startsWith('<nfeProc')).toBe(true);
    expect(c.xml_autorizado).toContain(nfe);
    expect(c.xml_autorizado).toBe(
      `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${/<protNFe[\s\S]*<\/protNFe>/.exec(c.xml_autorizado!)![0]}</nfeProc>`,
    );
    expect(c).toMatchObject({ n_prot: '13526000000012345', c_stat: 100, numero_reaproveitavel: false, lanca_venda: false });
    expect(c.autorizada_em).toEqual(AGORA);
    expect(c.chave).toBe(doPedido(m.porta.chamadas[0].corpo).chave);
    expect(m.t.nfce_envios[0]).toMatchObject({
      servico: 'autorizacao',
      tentativa: 1,
      resultado: 'respondida',
      c_stat: 100,
      c_stat_lote: 104,
    });
    expect(ambienteDe(m.t, 'homologacao').proximo_numero).toBe(2n);
    expect(m.est.travas).toContainEqual(['homologacao']);
    expect(m.est.sql.some((s) => s.includes('nfce_lancar_venda'))).toBe(false);
    expect(m.porta.chamadas.map((x) => x.servico)).toEqual(['autorizacao']);
  });

  it('em homologação o 1º item sai com o texto do modo de teste; o número e a chave vão no XML; a resposta não leva XML nem CSC', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml'));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    const corpo = m.porta.chamadas[0].corpo;
    expect(corpo).toContain('<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>');
    expect(corpo).toContain('<serie>2</serie><nNF>1</nNF>');
    expect(corpo).not.toContain(CSC_TESTE);
    const fio = JSON.stringify(toWire(r.cupom));
    expect(fio).not.toContain(CSC_TESTE);
    expect(fio).not.toContain('<NFe');
    expect(JSON.stringify(toWire(m.t.nfce_envios))).not.toContain(CSC_TESTE);
  });

  it('em produção com lanca_venda, a T3 chama nfce_lancar_venda uma vez (depois da T2)', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao');
    responder(m, aut('ret-autorizacao-100.xml', AGORA, 'producao'));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom).toMatchObject({ situacao: 'autorizado', venda_estoque: 'lancada' });
    expect(m.est.vendas.lancar).toEqual([r.cupom.id]);
    expect(m.est.sql.filter((s) => s.includes('nfce_lancar_venda'))).toHaveLength(1);
    expect(cupomDe(m.t, r.cupom.id).lanca_venda).toBe(true);
  });

  it('produção sem lanca_venda (a importação conta): autoriza e não chama a T3', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao', { lancaVenda: false });
    responder(m, aut('ret-autorizacao-100.xml', AGORA, 'producao'));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom).toMatchObject({ situacao: 'autorizado', venda_estoque: 'nao_lanca' });
    expect(m.est.sql.some((s) => s.includes('nfce_lancar_venda'))).toBe(false);
  });

  it('protocolo de outra chave ou de outro ambiente = resposta inválida: não grava autorização (sem_resposta, número preso)', async () => {
    for (const troca of ['chave', 'tpAmb'] as const) {
      const m = montar();
      const { espeto } = await pronto(m);
      responder(m, (corpo) => {
        let x = fixture('ret-autorizacao-100.xml', corpo, AGORA, 'homologacao');
        if (troca === 'chave') x = x.replaceAll(doPedido(corpo).chave, CH_FIXTURE);
        else x = x.replace(/(<infProt[^>]*>\s*<tpAmb>)2</, (_s, abre: string) => `${abre}1<`);
        return lerRetornoAutorizacao(x);
      });
      const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
      expect(r.cupom.situacao).toBe('sem_resposta');
      const c = cupomDe(m.t, r.cupom.id);
      expect(c.n_prot).toBeNull();
      expect(c.xml_autorizado).toBeNull();
      expect(m.t.nfce_envios[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_RESPOSTA_INVALIDA' });
    }
  });
});

describe('log nfce.envio', () => {
  it('leva ambiente, serviço, série, número, cStat, resultado, duração e tentativa; nunca CSC, chave, CPF ou XML', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao');
    m.est.falharVenda = 1;
    responder(m, aut('ret-autorizacao-100.xml', AGORA, 'producao'));
    const r = await m.svc.emitir(venda(espeto.id, { consumidor_doc: '529.982.247-25' }), EU, AGORA);
    expect(r.cupom.consumidor_doc).toBe('52998224725');
    const envio = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === 'nfce.envio');
    expect(envio).toEqual({
      evento: 'nfce.envio',
      ambiente: 'producao',
      servico: 'autorizacao',
      serie: 2,
      numero: 1,
      c_stat: 100,
      resultado: 'respondida',
      duracao_ms: expect.any(Number),
      tentativa: 1,
    });
    const tudo = logs.join('\n');
    for (const segredo of [CSC_TESTE, '52998224725', r.cupom.chave, '<', CLIENTE.impressaoDigital]) expect(tudo).not.toContain(segredo);
  });
});

describe('validação antes da T1: a porta não é chamada e nenhum cupom é criado', () => {
  async function nada(m: M) {
    expect(m.porta.chamadas).toHaveLength(0);
    expect(m.t.nfce_cupons.filter((c) => c.ambiente === 'homologacao')).toHaveLength(0);
    expect(m.est.idLote).toBe(0);
    expect(ambienteDe(m.t, 'homologacao').proximo_numero).toBe(1n);
  }

  it('total_esperado 4999 com total 5000 → 409 NFCE_TOTAL_MUDOU', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    const e = await falha(m.svc.emitir(venda(espeto.id, { total_esperado_centavos: 4999 }), EU, AGORA));
    expect(e).toEqual({ status: 409, code: 'NFCE_TOTAL_MUDOU', message: FRASE_ERRO.NFCE_TOTAL_MUDOU(5000n) });
    await nada(m);
  });

  it('preço "12.345" no cardápio + total_esperado 1235 → aceito (arredonda uma vez, metade para cima)', async () => {
    const m = montar();
    const { chopp } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml'));
    const v = venda(chopp.id, {
      itens: [{ item_cardapio_id: chopp.id, quantidade: '1' }],
      pagamentos: [{ t_pag: '01', valor_centavos: 1300 }],
      total_esperado_centavos: 1235,
    });
    const r = await m.svc.emitir(v, EU, AGORA);
    expect(r.status).toBe(201);
    expect(r.cupom).toMatchObject({ valor_total_centavos: 1235, valor_troco_centavos: 65, situacao: 'autorizado' });
    expect(m.porta.chamadas[0].corpo).toContain('<vUnCom>12.35</vUnCom>');
    expect(m.porta.chamadas[0].corpo).toContain('<uCom>COPO</uCom>');
  });

  it('produto desativado entre a tela e o envio → 422 NFCE_ITEM_INDISPONIVEL', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    m.t.itens_cardapio.find((i) => i.id === espeto.id)!.ativo = false;
    const e = await falha(m.svc.emitir(venda(espeto.id), EU, AGORA));
    expect(e).toEqual({ status: 422, code: 'NFCE_ITEM_INDISPONIVEL', message: 'Espetinho de carne não pode entrar no cupom: inativo.' });
    await nada(m);
  });

  it('perfil fora do regime (a empresa virou regime normal) → 422 NFCE_ITEM_INDISPONIVEL', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    m.t.nfce_emitente[0].crt = 3;
    const e = await falha(m.svc.emitir(venda(espeto.id), EU, AGORA));
    expect(e.code).toBe('NFCE_ITEM_INDISPONIVEL');
    expect(e.message).toContain('o perfil fiscal não vale no regime da empresa');
    await nada(m);
  });

  it("quantidade '0,350' → 400 VALIDATION_ERROR", async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    const e = await falha(m.svc.emitir(venda(espeto.id, { itens: [{ item_cardapio_id: espeto.id, quantidade: '0,350' }] }), EU, AGORA));
    expect(e).toEqual({ status: 400, code: 'VALIDATION_ERROR', message: FRASES_CADASTRO.quantidade });
    await nada(m);
  });

  it('montagem recusada (razão social vazia) → 422 NFCE_CUPOM_INVALIDO dentro da T1, desfeita: nada reservado', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    m.t.configuracoes.razao_social = '   ';
    const e = await falha(m.svc.emitir(venda(espeto.id), EU, AGORA));
    expect(e).toEqual({ status: 422, code: 'NFCE_CUPOM_INVALIDO', message: 'Falta a razão social da empresa.' });
    expect(m.est.travas).toContainEqual(['homologacao']); // chegou à T1 (trava pedida) e foi desfeita
    expect(m.t.nfce_envios).toHaveLength(0);
    expect(m.t.nfce_cupom_itens).toHaveLength(0);
    await nada(m);
  });

  it('sem itens → 400 NFCE_SEM_ITENS; descarte sem motivo → 400 NFCE_MOTIVO (o serviço responde com o código do desenho)', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    expect(await falha(m.svc.emitir(venda(espeto.id, { itens: [] }), EU, AGORA))).toEqual({
      status: 400,
      code: 'NFCE_SEM_ITENS',
      message: FRASE_ERRO.NFCE_SEM_ITENS,
    });
    await nada(m);
    expect(await falha(m.svc.descartar(randomUUID(), undefined as unknown as string, EU, AGORA))).toEqual({
      status: 400,
      code: 'NFCE_MOTIVO',
      message: FRASE_ERRO.NFCE_MOTIVO('descartar'),
    });
  });

  it('pagamento menor que o total, CPF que não confere e emissão desligada também param antes', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    expect(await falha(m.svc.emitir(venda(espeto.id, { pagamentos: [{ t_pag: '01', valor_centavos: 4000 }] }), EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PAGAMENTO_INSUFICIENTE',
      message: FRASE_ERRO.NFCE_PAGAMENTO_INSUFICIENTE(4000n, 5000n),
    });
    expect(await falha(m.svc.emitir(venda(espeto.id, { consumidor_doc: '111.111.111-11' }), EU, AGORA))).toEqual({
      status: 400,
      code: 'NFCE_DOC_INVALIDO',
      message: FRASE_ERRO.NFCE_DOC_INVALIDO('cpf'),
    });
    await m.svc.ligarEmissao('homologacao', false, false, EU, AGORA);
    expect(await falha(m.svc.emitir(venda(espeto.id), EU, AGORA))).toEqual({
      status: 409,
      code: 'NFCE_EMISSAO_DESLIGADA',
      message: FRASE_ERRO.NFCE_EMISSAO_DESLIGADA,
    });
    await nada(m);
  });

  it('servidor desligado: 503 NFCE_DESLIGADA em tudo que fala com a SEFAZ ou muda a emissão; lancar-venda não', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao');
    m.est.falharVenda = 1;
    responder(m, aut('ret-autorizacao-100.xml', AGORA, 'producao'));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom.venda_estoque).toBe('pendente');
    m.env.NFCE_AMBIENTE = '';
    const id = r.cupom.id;
    const d = { status: 503, code: 'NFCE_DESLIGADA', message: FRASE_ERRO.NFCE_DESLIGADA };
    expect(await falha(m.svc.emitir(venda(espeto.id), EU, AGORA))).toEqual(d);
    expect(await falha(m.svc.reenviar(id, EU, AGORA))).toEqual(d);
    expect(await falha(m.svc.consultar(id, EU, AGORA))).toEqual(d);
    expect(await falha(m.svc.descartar(id, 'Venda desfeita', EU, AGORA))).toEqual(d);
    expect(await falha(m.svc.testarConexao(EU, AGORA))).toEqual(d);
    expect(await falha(m.svc.ligarEmissao('producao', true, true, EU, AGORA))).toEqual(d);
    expect((await m.svc.lancarVenda(id, AGORA)).venda_estoque).toBe('lancada');
    expect(m.porta.chamadas).toHaveLength(1);
  });
});

describe('idempotência', () => {
  it('mesma chave, mesmo corpo → 200, o mesmo cupom e uma chamada à porta só (também depois de o preço mudar)', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml'));
    const v = venda(espeto.id);
    const r1 = await m.svc.emitir(v, EU, AGORA);
    m.t.itens_cardapio.find((i) => i.id === espeto.id)!.preco_venda = linhaCom('itens_cardapio', { preco_venda: '30.00' }).preco_venda;
    const r2 = await m.svc.emitir({ ...v }, EU, mais(AGORA, 5000));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.cupom.id).toBe(r1.cupom.id);
    expect(m.porta.chamadas).toHaveLength(1);
    expect(m.t.nfce_cupons).toHaveLength(1);
  });

  it('mesma chave, outro corpo → 409 NFCE_CHAVE_REUSADA', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml'));
    const v = venda(espeto.id);
    await m.svc.emitir(v, EU, AGORA);
    const outra = { ...v, itens: [{ item_cardapio_id: espeto.id, quantidade: '3' }], total_esperado_centavos: 7500 };
    expect(await falha(m.svc.emitir(outra, EU, AGORA))).toEqual({
      status: 409,
      code: 'NFCE_CHAVE_REUSADA',
      message: FRASE_ERRO.NFCE_CHAVE_REUSADA,
    });
    expect(m.porta.chamadas).toHaveLength(1);
  });
});

describe('número livre e reenvio', () => {
  it('SefazErro com enviado = false → nao_enviado (número livre; a frase de "não consegui falar")', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(false));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom).toMatchObject({ situacao: 'nao_enviado', recusa: null, mensagem: FRASE_RETORNO.naoEnviado });
    expect(r.cupom.acoes).toEqual(['enviar_de_novo', 'consultar', 'descartar']);
    expect(m.t.nfce_envios[0]).toMatchObject({ resultado: 'falha_antes_de_enviar', erro_code: 'SEFAZ_REDE', rejeicao: false });
  });

  it('reenviar mantém número e cNF, gera dhEmi novo, conta o envio e relê os dados fiscais', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(false), aut('ret-autorizacao-100.xml', mais(AGORA, 3 * MIN)));
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    const antes = { ...cupomDe(m.t, r1.cupom.id) };
    m.t.nfce_itens.find((f) => f.item_cardapio_id === espeto.id)!.ncm = '21069090';
    const r2 = await m.svc.reenviar(r1.cupom.id, EU, mais(AGORA, 3 * MIN));
    const depois = cupomDe(m.t, r1.cupom.id);
    expect(r2).toMatchObject({ situacao: 'autorizado', numero: 1, envios: 2 });
    expect(depois.numero).toBe(antes.numero);
    expect(depois.c_nf).toBe(antes.c_nf);
    expect(depois.dh_emi).toEqual(mais(AGORA, 3 * MIN));
    expect(antes.dh_emi).toEqual(AGORA);
    expect(m.porta.chamadas[0].corpo).toContain(`<dhEmi>${dhSefaz(AGORA)}</dhEmi>`);
    expect(m.porta.chamadas[1].corpo).toContain(`<dhEmi>${dhSefaz(mais(AGORA, 3 * MIN))}</dhEmi>`);
    expect(m.porta.chamadas[1].corpo).toContain('<NCM>21069090</NCM>');
    expect(m.t.nfce_cupom_itens.find((i) => i.cupom_id === r1.cupom.id)!.ncm).toBe('21069090');
    expect(m.t.nfce_envios.map((e) => e.tentativa)).toEqual([1, 2]);
    expect(ambienteDe(m.t, 'homologacao').proximo_numero).toBe(2n);
  });

  it('virada do mês (31/01 23h58 → 01/02 00h03): mesmo número e cNF, chave com o AAMM novo', async () => {
    const jan = new Date('2027-01-31T23:58:00-03:00');
    const fev = new Date('2027-02-01T00:03:00-03:00');
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(false), aut('ret-autorizacao-100.xml', fev));
    const r1 = await m.svc.emitir(venda(espeto.id), EU, jan);
    const chaveJan = cupomDe(m.t, r1.cupom.id).chave;
    const r2 = await m.svc.reenviar(r1.cupom.id, EU, fev);
    const c = cupomDe(m.t, r1.cupom.id);
    expect(chaveJan.slice(2, 6)).toBe('2701');
    expect(c.chave.slice(2, 6)).toBe('2702');
    expect(c.chave.slice(6, 43)).toBe(chaveJan.slice(6, 43)); // CNPJ, modelo, série, número, tpEmis e cNF iguais
    expect(r2.situacao).toBe('autorizado');
  });
});

describe('sem resposta, consulta e descarte', () => {
  it('enviado sem resposta → sem_resposta; consulta aos 60 s = 409; aos 121 s com 217 = nao_consta; descarte; o número volta', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(true), cons('ret-consulta-217.xml', mais(AGORA, 121_000)), aut('ret-autorizacao-100.xml', mais(AGORA, 5 * MIN)));
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r1.cupom).toMatchObject({ situacao: 'sem_resposta', acoes: ['consultar'], consultar_a_partir_de: mais(AGORA, 2 * MIN) });
    expect(r1.cupom.mensagem).toBe(FRASE_RETORNO.semResposta(mais(AGORA, 2 * MIN)));
    const id = r1.cupom.id;

    expect(await falha(m.svc.consultar(id, EU, mais(AGORA, 60_000)))).toEqual({
      status: 409,
      code: 'NFCE_CONSULTA_CEDO',
      message: FRASE_ERRO.NFCE_CONSULTA_CEDO(mais(AGORA, 2 * MIN)),
    });
    expect(m.porta.chamadas).toHaveLength(1);
    expect(await falha(m.svc.descartar(id, 'Venda desfeita', EU, mais(AGORA, 60_000)))).toMatchObject({
      status: 409,
      code: 'NFCE_SITUACAO',
    });

    const r2 = await m.svc.consultar(id, EU, mais(AGORA, 121_000));
    expect(r2.situacao).toBe('nao_consta');
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao', 'consulta']);
    expect(cupomDe(m.t, id).numero_reaproveitavel).toBe(true);

    expect(await falha(m.svc.descartar(id, 'ab', EU, mais(AGORA, 3 * MIN)))).toEqual({
      status: 400,
      code: 'NFCE_MOTIVO',
      message: FRASE_ERRO.NFCE_MOTIVO('descartar'),
    });
    const r3 = await m.svc.descartar(id, '  Venda desfeita  ', EU, mais(AGORA, 3 * MIN));
    expect(r3).toMatchObject({ situacao: 'descartado', descarte_motivo: 'Venda desfeita', acoes: [] });

    const r4 = await m.svc.emitir(venda(espeto.id), EU, mais(AGORA, 5 * MIN));
    expect(r4.cupom).toMatchObject({ situacao: 'autorizado', numero: 1 });
    expect(r4.cupom.id).not.toBe(id);
    expect(r4.cupom.chave).not.toBe(cupomDe(m.t, id).chave);
    expect(ambienteDe(m.t, 'homologacao').proximo_numero).toBe(2n);
  });

  it('consulta que acha a nota autorizada → autorizado com o nfeProc da tentativa do DigestValue, número preso', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(true), (corpo) => {
      const { chave } = doPedido(corpo);
      const enviado = m.porta.chamadas[0].corpo;
      return lerRetornoConsulta(fixture('ret-consulta-100.xml', enviado, AGORA, 'homologacao').replaceAll(CH_FIXTURE, chave));
    });
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    const r2 = await m.svc.consultar(r1.cupom.id, EU, mais(AGORA, 2 * MIN));
    expect(r2.situacao).toBe('autorizado');
    const c = cupomDe(m.t, r1.cupom.id);
    expect(c.xml_autorizado).toContain(nfeDoPedido(m.porta.chamadas[0].corpo));
    expect(c).toMatchObject({ n_prot: '13526000000012345', numero_reaproveitavel: false });
    expect(c.autorizada_em).toEqual(AGORA);
  });

  it('consulta num cupom já autorizado não mexe nas colunas do documento (gatilho de imutável)', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml'), cons('ret-consulta-100.xml', AGORA));
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    const r2 = await m.svc.consultar(r1.cupom.id, EU, mais(AGORA, 2 * MIN));
    expect(r2.situacao).toBe('autorizado');
    expect(m.t.nfce_envios.map((e) => e.servico)).toEqual(['autorizacao', 'consulta']);
  });

  it('cancelando: a consulta com o evento 135 → cancelado (protocolo do cancelamento) e a T3 desfaz a venda; sem evento → volta a autorizado', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao');
    responder(
      m,
      aut('ret-autorizacao-100.xml', AGORA, 'producao'),
      aut('ret-autorizacao-100.xml', AGORA, 'producao'),
      cons('ret-consulta-cancelada.xml', AGORA, 'producao'),
      cons('ret-consulta-100.xml', AGORA, 'producao'),
    );
    const a = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    const b = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(m.est.vendas.lancar).toEqual([a.cupom.id, b.cupom.id]);
    // o pedido de cancelamento (Tarefa 12) saiu sem resposta: `cancelando`, consulta a partir de 2 min do pedido
    for (const id of [a.cupom.id, b.cupom.id]) {
      Object.assign(cupomDe(m.t, id), {
        situacao: 'cancelando',
        cancelamento_pedido_em: mais(AGORA, 5 * MIN),
        cancelamento_motivo: 'Cliente desistiu da compra',
      });
    }
    expect(await falha(m.svc.consultar(a.cupom.id, EU, mais(AGORA, 6 * MIN)))).toMatchObject({ status: 409, code: 'NFCE_CONSULTA_CEDO' });

    const ra = await m.svc.consultar(a.cupom.id, EU, mais(AGORA, 7 * MIN));
    expect(ra).toMatchObject({ situacao: 'cancelado', cancelamento_n_prot: '13526000000067890', venda_estoque: 'desfeita' });
    expect(cupomDe(m.t, a.cupom.id)).toMatchObject({ n_prot: '13526000000012345', cancelamento_motivo: 'Cliente desistiu da compra' });
    expect(cupomDe(m.t, a.cupom.id).cancelado_em).toEqual(mais(AGORA, 7 * MIN));
    expect(m.est.vendas.desfazer).toEqual([a.cupom.id]);

    const rb = await m.svc.consultar(b.cupom.id, EU, mais(AGORA, 7 * MIN));
    expect(rb).toMatchObject({ situacao: 'autorizado', venda_estoque: 'lancada' });
    expect(m.est.vendas.desfazer).toEqual([a.cupom.id]);
    expect(m.est.vendas.lancar).toEqual([a.cupom.id, b.cupom.id]);
  });
});

describe('série em uso (539)', () => {
  it('539 → rejeitado com o número bloqueado e a emissão parada; o próximo emitir = 409 NFCE_PARADA; descartar não libera o número', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, recusaNota(539, 'Rejeição: Duplicidade de NF-e com diferença na Chave de Acesso'), aut('ret-autorizacao-100.xml'));
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r1.cupom).toMatchObject({ situacao: 'rejeitado', numero_reaproveitavel: false, acoes: ['descartar'] });
    expect(r1.cupom.recusa).toMatchObject({ codigo: 539, frase: FRASE_RETORNO.serieEmUso(2, 1) });
    const amb = ambienteDe(m.t, 'homologacao');
    expect(amb).toMatchObject({ situacao: 'parada_serie_em_uso', mensagem: FRASE_RETORNO.serieEmUso(2, 1) });
    expect(m.t.nfce_ambientes_historico.at(-1)).toMatchObject({
      evento: 'parada_automatica',
      situacao: 'parada_serie_em_uso',
      c_stat: 539,
    });

    expect(await falha(m.svc.emitir(venda(espeto.id), EU, mais(AGORA, MIN)))).toEqual({
      status: 409,
      code: 'NFCE_PARADA',
      message: FRASE_RETORNO.serieEmUso(2, 1),
    });
    expect(m.porta.chamadas).toHaveLength(1);
    expect(m.t.nfce_cupons).toHaveLength(1);

    const d = await m.svc.descartar(r1.cupom.id, 'Série do caixa de hoje', EU, mais(AGORA, 2 * MIN));
    expect(d).toMatchObject({ situacao: 'descartado', numero_reaproveitavel: false });

    await m.svc.ligarEmissao('homologacao', true, false, EU, mais(AGORA, 3 * MIN));
    expect(ambienteDe(m.t, 'homologacao')).toMatchObject({ situacao: 'ok', mensagem: null, emissao_ligada: true });
    const r2 = await m.svc.emitir(venda(espeto.id), EU, mais(AGORA, 4 * MIN));
    expect(r2.cupom.numero).toBe(2);
  });

  it('número reaproveitado que volta 539 não volta a ser escolhido (nem pelo descarte antigo dele)', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, erro(false), recusaNota(539, 'Duplicidade'), aut('ret-autorizacao-100.xml'));
    const a = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    await m.svc.descartar(a.cupom.id, 'Venda desfeita', EU, AGORA);
    const b = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(b.cupom).toMatchObject({ numero: 1, situacao: 'rejeitado', numero_reaproveitavel: false });
    await m.svc.descartar(b.cupom.id, 'Série do caixa de hoje', EU, AGORA);
    await m.svc.ligarEmissao('homologacao', true, false, EU, AGORA);
    const c = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(c.cupom.numero).toBe(2);
  });
});

describe('656', () => {
  it('nenhuma chamada à porta por 65 min (64 min = 409 NFCE_BLOQUEADA); o 2º em 24 h vira parada_656 e desliga a emissão', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, lote656, lote656);
    const r1 = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r1.cupom.situacao).toBe('nao_enviado');
    expect(r1.cupom.recusa).toMatchObject({ codigo: 656, frase: FRASE_RETORNO.bloqueio656(mais(AGORA, 65 * MIN)) });
    expect(ambienteDe(m.t, 'homologacao')).toMatchObject({ situacao: 'ok', bloqueado_ate: mais(AGORA, 65 * MIN), ultimo_656_em: AGORA });

    for (const quando of [mais(AGORA, MIN), mais(AGORA, 64 * MIN)]) {
      expect(await falha(m.svc.emitir(venda(espeto.id), EU, quando))).toEqual({
        status: 409,
        code: 'NFCE_BLOQUEADA',
        message: FRASE_ERRO.NFCE_BLOQUEADA(mais(AGORA, 65 * MIN)),
      });
    }
    expect(await falha(m.svc.reenviar(r1.cupom.id, EU, mais(AGORA, 30 * MIN)))).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(await falha(m.svc.testarConexao(EU, mais(AGORA, 30 * MIN)))).toMatchObject({ code: 'NFCE_BLOQUEADA' });
    expect(m.porta.chamadas).toHaveLength(1);

    // ligar de novo não apaga o bloqueio
    await m.svc.ligarEmissao('homologacao', true, false, EU, mais(AGORA, 10 * MIN));
    expect(ambienteDe(m.t, 'homologacao').bloqueado_ate).toEqual(mais(AGORA, 65 * MIN));

    const r2 = await m.svc.emitir(venda(espeto.id), EU, mais(AGORA, 66 * MIN));
    expect(r2.cupom.situacao).toBe('nao_enviado');
    expect(ambienteDe(m.t, 'homologacao')).toMatchObject({
      situacao: 'parada_656',
      emissao_ligada: false,
      mensagem: FRASE_RETORNO.bloqueouDuasVezes,
    });
    expect(m.porta.chamadas).toHaveLength(2);
  });
});

describe('travas do envio', () => {
  it('depois de 10 recusas (386) na hora, o 11º emitir = 409 NFCE_MUITAS_RECUSAS, sem chamar a porta', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, ...Array.from({ length: 10 }, () => aut('ret-autorizacao-386.xml')));
    for (let i = 0; i < 10; i++) {
      const r = await m.svc.emitir(venda(espeto.id), EU, mais(AGORA, i * 1000));
      expect(r.cupom).toMatchObject({ situacao: 'rejeitado', numero: i + 1 });
      expect(r.cupom.recusa).toMatchObject({ codigo: 386, familia: 'produto', frase: FRASE_RETORNO.recusaProduto });
    }
    const e = await falha(m.svc.emitir(venda(espeto.id), EU, mais(AGORA, 11_000)));
    expect(e).toEqual({ status: 409, code: 'NFCE_MUITAS_RECUSAS', message: FRASE_ERRO.NFCE_MUITAS_RECUSAS(mais(AGORA, 60 * MIN)) });
    expect(m.porta.chamadas).toHaveLength(10);
    expect(m.t.nfce_cupons).toHaveLength(10);
  });

  it('o 4º envio do mesmo cupom = 409 NFCE_LIMITE_ENVIOS', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    const r386 = (n: number) => aut('ret-autorizacao-386.xml', mais(AGORA, n * MIN));
    responder(m, r386(0), r386(1), r386(2));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    await m.svc.reenviar(r.cupom.id, EU, mais(AGORA, MIN));
    const r3 = await m.svc.reenviar(r.cupom.id, EU, mais(AGORA, 2 * MIN));
    expect(r3).toMatchObject({ envios: 3, situacao: 'rejeitado', acoes: ['consultar', 'descartar'] });
    expect(await falha(m.svc.reenviar(r.cupom.id, EU, mais(AGORA, 3 * MIN)))).toEqual({
      status: 409,
      code: 'NFCE_LIMITE_ENVIOS',
      message: FRASE_ERRO.NFCE_LIMITE_ENVIOS,
    });
    expect(m.porta.chamadas).toHaveLength(3);
  });

  it('dhRecbto 3 min longe de agora → parada_configuracao (o cupom autorizado continua autorizado)', async () => {
    const m = montar();
    const { espeto } = await pronto(m);
    responder(m, aut('ret-autorizacao-100.xml', mais(AGORA, 3 * MIN)));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom.situacao).toBe('autorizado');
    expect(ambienteDe(m.t, 'homologacao')).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RETORNO.relogio });
    expect(await falha(m.svc.emitir(venda(espeto.id), EU, mais(AGORA, MIN)))).toEqual({
      status: 409,
      code: 'NFCE_PARADA',
      message: FRASE_RETORNO.relogio,
    });
  });
});

describe('venda no estoque (T3)', () => {
  it('a T3 lança erro → o cupom continua autorizado com venda_erro; lancarVenda refaz', async () => {
    const m = montar({ ambiente: 'producao' });
    const { espeto } = await pronto(m, 'producao');
    m.est.falharVenda = 1;
    responder(m, aut('ret-autorizacao-100.xml', AGORA, 'producao'));
    const r = await m.svc.emitir(venda(espeto.id), EU, AGORA);
    expect(r.cupom).toMatchObject({ situacao: 'autorizado', venda_estoque: 'pendente', venda_erro: FRASES_EMISSAO.vendaErro });
    expect(r.cupom.acoes).toContain('lancar_venda');
    expect(cupomDe(m.t, r.cupom.id).n_prot).toBe('13526000000012345');

    const l = await m.svc.lancarVenda(r.cupom.id, mais(AGORA, MIN));
    expect(l).toMatchObject({ situacao: 'autorizado', venda_estoque: 'lancada', venda_erro: null });
    expect(m.est.vendas.lancar).toEqual([r.cupom.id]);
    expect(await falha(m.svc.lancarVenda(r.cupom.id, mais(AGORA, 2 * MIN)))).toMatchObject({ status: 409, code: 'NFCE_SITUACAO' });
  });
});

describe('ligar a emissão', () => {
  it('em produção, sem um cupom autorizado e um cancelado no modo de teste → 422 NFCE_PRODUCAO_SEM_TESTE', async () => {
    const m = montar({ ambiente: 'producao' });
    await pronto(m, 'producao', { testeFeito: false, ligar: false });
    expect(await falha(m.svc.ligarEmissao('producao', true, true, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PRODUCAO_SEM_TESTE',
      message: FRASE_ERRO.NFCE_PRODUCAO_SEM_TESTE,
    });
    expect(ambienteDe(m.t, 'producao').emissao_ligada).toBe(false);
  });

  it('com cupom_lanca_venda nulo → 422 NFCE_LANCA_VENDA_PENDENTE', async () => {
    const m = montar({ ambiente: 'producao' });
    await pronto(m, 'producao', { lancaVenda: null, ligar: false });
    expect(await falha(m.svc.ligarEmissao('producao', true, true, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_LANCA_VENDA_PENDENTE',
      message: FRASE_ERRO.NFCE_LANCA_VENDA_PENDENTE,
    });
  });

  it('valendo sem as três confirmações → 400; cadastro incompleto → 422 NFCE_CONFIG_INCOMPLETA com os itens da 5.1', async () => {
    const m = montar({ ambiente: 'producao' });
    await pronto(m, 'producao', { ligar: false });
    expect(await falha(m.svc.ligarEmissao('producao', true, false, EU, AGORA))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: FRASES_EMISSAO.confirmacoes,
    });
    m.t.nfce_emitente[0].ie = null;
    expect(await falha(m.svc.ligarEmissao('producao', true, true, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_CONFIG_INCOMPLETA',
      message: FRASE_ERRO.NFCE_CONFIG_INCOMPLETA(['inscrição estadual']),
    });
  });

  it('ligar grava o trio, limpa a mensagem e a parada e deixa o histórico; desligar desliga', async () => {
    const m = montar();
    await pronto(m, 'homologacao', { ligar: false });
    Object.assign(ambienteDe(m.t, 'homologacao'), { situacao: 'parada_certificado', mensagem: 'parou' });
    const s = await m.svc.ligarEmissao('homologacao', true, false, EU, AGORA);
    expect(s.emissao_ligada).toBe(true);
    expect(ambienteDe(m.t, 'homologacao')).toMatchObject({
      emissao_ligada: true,
      ligada_cnpj: CNPJ,
      ligada_serie: 2,
      situacao: 'ok',
      mensagem: null,
      alterada_por_nome: 'Diego',
    });
    expect(m.t.nfce_ambientes_historico.at(-1)).toMatchObject({ evento: 'ligada', situacao: 'ok', feito_por_nome: 'Diego' });
    const d = await m.svc.ligarEmissao('homologacao', false, false, EU, AGORA);
    expect(d.emissao_ligada).toBe(false);
    expect(m.t.nfce_ambientes_historico.at(-1)).toMatchObject({ evento: 'desligada' });
  });

  it('só o ambiente do servidor', async () => {
    const m = montar();
    await pronto(m, 'homologacao', { ligar: false });
    expect(await falha(m.svc.ligarEmissao('producao', true, true, EU, AGORA))).toMatchObject({ status: 404 });
  });
});

describe('testar a conexão', () => {
  it('107 → funcionando; antes de 5 min = 409 NFCE_TESTE_CEDO (sem chamar a porta)', async () => {
    const m = montar();
    await pronto(m);
    responder(m, () => lerRetornoStatus(fixtureNfce('ret-status-107.xml').replace('2026-11-17T14:29:58-03:00', dhSefaz(AGORA))));
    const r = await m.svc.testarConexao(EU, AGORA);
    expect(r).toMatchObject({ em_operacao: true, codigo: 107, frase: FRASE_RETORNO.statusOk(AGORA) });
    expect(m.t.nfce_envios[0]).toMatchObject({ servico: 'status', cupom_id: null, resultado: 'respondida', c_stat_lote: 107 });
    expect(ambienteDe(m.t, 'homologacao').ultimo_status_em).toEqual(AGORA);
    expect(await falha(m.svc.testarConexao(EU, mais(AGORA, 4 * MIN)))).toEqual({
      status: 409,
      code: 'NFCE_TESTE_CEDO',
      message: FRASE_ERRO.NFCE_TESTE_CEDO(mais(AGORA, 5 * MIN)),
    });
    expect(m.porta.chamadas).toHaveLength(1);
  });
});
