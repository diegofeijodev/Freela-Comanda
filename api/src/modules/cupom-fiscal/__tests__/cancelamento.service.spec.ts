import { randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { montarChaveNfce } from '../../../common/fiscal/chave-acesso';
import type { CertificadoDigitalPort } from '../../certificado-digital/certificado-digital.port';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { fixtureNfce, SefazNfceFalso, type RespostaNfce } from '../../sefaz/__tests__/sefaz-nfce.falso';
import { dhSefaz } from '../../sefaz/eventos-xml';
import { lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoEvento } from '../../sefaz/nfce.adapter';
import { sefazErro, type SefazErro } from '../../sefaz/sefaz-erro';
import { CupomCadastroService, type Autor } from '../cadastro.service';
import { CupomCancelamentoService } from '../cancelamento.service';
import { cifrarCsc } from '../csc';
import { CupomEmissaoService, type VendaParaCupom } from '../emissao.service';
import { FRASE_ERRO, FRASE_RETORNO, FRASES_EMISSAO } from '../frases';
import { linhaCom, montarPrismaCupom, type TabelasCupom } from './prisma-cupom.falso';

// Cancelamento do cupom fiscal (Tarefa 12): T1 (cupom `cancelando` + envio aberto com o evento assinado) → porta → T2 (sob a trava do
// ambiente, com o retorno conferido contra a chave e o ambiente) → T3 (`nfce_desfazer_venda`). Prisma falso (gatilho de imutável), porta
// falsa da NFC-e (nunca rede: cada resposta é montada a partir do pedido que chegou) e o certificado fictício dos testes do transporte.

const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const SEGREDO = 'segredo-de-teste-do-cupom-fiscal-com-32+';
const CNPJ = '12345678000195';
const EU: Autor = { id: '11111111-1111-4111-8111-111111111111', nome: 'Diego' };
/** A autorização às 14h05min31s em Brasília. */
const T0 = new Date('2026-11-17T17:05:31Z');
const MIN = 60_000;
const SEG = 1_000;
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MOTIVO = 'Cliente desistiu da compra';

type Amb = 'homologacao' | 'producao';

function montar(o: { ambiente?: Amb | 'desligado' } = {}) {
  const m = montarPrismaCupom({ cnpjEmpresa: CNPJ });
  const env: Record<string, string | undefined> = { NFCE_AMBIENTE: o.ambiente ?? 'producao', CERTIFICADO_SECRET: SEGREDO };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const certificados: CertificadoDigitalPort = { emUso: jest.fn(async () => CLIENTE) };
  const porta = new SefazNfceFalso();
  const cadastro = new CupomCadastroService(m.prisma, config, certificados);
  const emissao = new CupomEmissaoService(m.prisma, config, certificados, porta, cadastro);
  const svc = new CupomCancelamentoService(m.prisma, porta, emissao);
  return { ...m, env, porta, emissao, svc };
}
type M = ReturnType<typeof montar>;

const ambienteDe = (t: TabelasCupom, a: Amb) => t.nfce_ambientes.find((x) => x.ambiente === a)!;
const cupomDe = (t: TabelasCupom, id: string) => t.nfce_cupons.find((c) => c.id === id)!;
const enviosDe = (t: TabelasCupom, id: string, servico = 'cancelamento') =>
  t.nfce_envios.filter((e) => e.cupom_id === id && e.servico === servico);

/** Empresa, numeração e CSC, um perfil do Simples, o "Espetinho de carne" (R$ 25,00) e a emissão ligada (valendo: lança a venda). */
async function pronto(m: M, a: Amb = 'producao') {
  Object.assign(m.t.nfce_emitente[0], {
    ie: '123456789012',
    crt: 1,
    logradouro: 'Rua das Flores',
    numero: '10',
    bairro: 'Centro',
    cep: '13270000',
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
  m.t.itens_cardapio.push(espeto);
  m.t.nfce_itens.push(linhaCom('nfce_itens', { item_cardapio_id: espeto.id, ncm: '16025000', perfil_fiscal_id: perfil.id }));
  if (a === 'producao') {
    // o teste no modo de teste que ligar valendo pede (um autorizado e um cancelado de homologação)
    for (const [numero, situacao] of [
      [1, 'autorizado'],
      [2, 'cancelado'],
    ] as const) {
      const cNF = String(80_000_000 + numero);
      m.t.nfce_cupons.push(
        linhaCom('nfce_cupons', {
          ambiente: 'homologacao',
          serie: 9,
          numero,
          chave: montarChaveNfce({ aamm: '2611', cnpj: CNPJ, serie: 9, numero, tpEmis: 1, cNF }),
          c_nf: cNF,
          situacao,
          valor_produtos: '1',
          valor_total: '1',
        }),
      );
    }
  }
  await m.emissao.ligarEmissao(a, true, a === 'producao', EU, T0);
  return espeto;
}

const venda = (espetoId: string): VendaParaCupom => ({
  chave_idempotencia: randomUUID(),
  itens: [{ item_cardapio_id: espetoId, quantidade: '2' }],
  desconto_centavos: 0,
  pagamentos: [{ t_pag: '17', valor_centavos: 5000 }],
  consumidor_doc: null,
  total_esperado_centavos: 5000,
});

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
  (dh: Date, a: Amb = 'producao'): Resposta =>
  (corpo) =>
    lerRetornoAutorizacao(trocar(fixtureNfce('ret-autorizacao-100.xml'), corpo, dh, a));
/** Evento: o fixture com a chave do pedido, a hora `dh` e o ambiente; `mexer` muda o XML antes da leitura. */
const ev =
  (nome: string, dh: Date, a: Amb = 'producao', mexer: (x: string) => string = (x) => x): Resposta =>
  (corpo) =>
    lerRetornoEvento(mexer(trocar(fixtureNfce(nome), corpo, dh, a)));
/** A consulta pela chave: a nota (100) do 1º pedido de autorização desta chave, e o cancelamento quando a fixture o traz. */
const cons =
  (m: M, nome: string, dh: Date, a: Amb = 'producao', mexer: (x: string) => string = (x) => x): Resposta =>
  (corpo) => {
    const chave = chaveDo(corpo);
    const base = m.porta.chamadas.find((c) => c.servico === 'autorizacao' && c.corpo.includes(`Id="NFe${chave}"`))!.corpo;
    return lerRetornoConsulta(mexer(trocar(fixtureNfce(nome), base, dh, a)));
  };
/** Recusa do evento com outro código (o 573 da fixture com o cStat trocado). */
const recusaEvento = (cStat: number, xMotivo: string, dh: Date, a: Amb = 'producao') =>
  ev('ret-evento-573.xml', dh, a, (x) =>
    x.replace('<cStat>573</cStat>', `<cStat>${cStat}</cStat>`).replace('Rejeição: Duplicidade de evento', xMotivo),
  );
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

/** Um cupom autorizado às 14h05min31s (valendo, com a venda lançada no estoque). */
async function autorizado(m: M, a: Amb = 'producao'): Promise<string> {
  const espeto = await pronto(m, a);
  responder(m, aut(T0, a));
  const r = await m.emissao.emitir(venda(espeto.id), EU, T0);
  expect(r.cupom.situacao).toBe('autorizado');
  expect(cupomDe(m.t, r.cupom.id).autorizada_em).toEqual(T0);
  return r.cupom.id;
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

describe('prazo (autorização às 14h05min31s; o servidor aceita até + 29 min)', () => {
  it('às 14h34min30s envia', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 29 * MIN - SEG);
    responder(m, ev('ret-evento-135.xml', agora));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    expect(r.situacao).toBe('cancelado');
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao', 'evento']);
  });

  it('às 14h34min32s = 409 NFCE_CANCELAMENTO_FORA_DO_PRAZO, sem chamar a porta e sem mexer no cupom', async () => {
    const m = montar();
    const id = await autorizado(m);
    const antes = { ...cupomDe(m.t, id) };
    const f = await falha(m.svc.cancelar(id, MOTIVO, EU, mais(T0, 29 * MIN + SEG)));
    expect(f).toEqual({ status: 409, code: 'NFCE_CANCELAMENTO_FORA_DO_PRAZO', message: FRASE_ERRO.NFCE_CANCELAMENTO_FORA_DO_PRAZO(T0) });
    expect(f.message).toContain('às 14h05');
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao']);
    expect(cupomDe(m.t, id)).toEqual(antes);
    expect(enviosDe(m.t, id)).toHaveLength(0);
  });
});

describe('motivo', () => {
  it('14 caracteres ou emoji = 400 NFCE_MOTIVO, sem chamar a porta', async () => {
    const m = montar();
    const id = await autorizado(m);
    for (const motivo of ['Desistiu agora', '  Desistiu agora  ', 'Cliente desistiu 😀 da compra', '']) {
      expect(await falha(m.svc.cancelar(id, motivo, EU, mais(T0, MIN)))).toEqual({
        status: 400,
        code: 'NFCE_MOTIVO',
        message: FRASE_ERRO.NFCE_MOTIVO('cancelar'),
      });
    }
    expect(await falha(m.svc.cancelar(id, 'x'.repeat(256), EU, mais(T0, MIN)))).toMatchObject({ status: 400, code: 'NFCE_MOTIVO' });
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao']);
    expect(cupomDe(m.t, id).situacao).toBe('autorizado');
  });

  it('o motivo vai normalizado no xJust e no cupom (aspas do celular e espaços repetidos)', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 5 * MIN);
    responder(m, ev('ret-evento-135.xml', agora));
    await m.svc.cancelar(id, '  Cliente   pediu “cancelar”  ', EU, agora);
    expect(m.porta.chamadas[1].corpo).toContain('<xJust>Cliente pediu "cancelar"</xJust>');
    expect(cupomDe(m.t, id).cancelamento_motivo).toBe('Cliente pediu "cancelar"');
  });
});

describe('135: T1 → porta → T2 → T3', () => {
  it('cancelado, com o protocolo do cancelamento; na rede, o cupom já está cancelando e o envio aberto com o evento assinado', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    const n_prot = cupomDe(m.t, id).n_prot;
    let naRede: Record<string, unknown> | null = null;
    const resposta = ev('ret-evento-135.xml', agora);
    m.porta.aoChamar = () => {
      const c = cupomDe(m.t, id);
      const e = enviosDe(m.t, id)[0];
      naRede = {
        situacao: c.situacao,
        pedido: c.cancelamento_pedido_em,
        motivo: c.cancelamento_motivo,
        aberto: e.resultado === null,
        assinado: !!e.xml_enviado?.includes('<Signature') && !!e.xml_enviado?.includes(`<xJust>${MOTIVO}</xJust>`),
      };
      m.porta.respostas.push(resposta(m.porta.chamadas[1].corpo));
    };

    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);

    expect(naRede).toEqual({ situacao: 'cancelando', pedido: agora, motivo: MOTIVO, aberto: true, assinado: true });
    const corpo = m.porta.chamadas[1].corpo;
    expect(m.porta.chamadas[1]).toMatchObject({ servico: 'evento', ambiente: 'producao' });
    expect(corpo).toContain('<tpEvento>110111</tpEvento>');
    expect(corpo).toContain(`<nProt>${n_prot}</nProt>`);
    expect(corpo).toContain(`<chNFe>${cupomDe(m.t, id).chave}</chNFe>`);
    expect(corpo).toContain('<cOrgao>35</cOrgao><tpAmb>1</tpAmb>');
    expect(r).toMatchObject({
      situacao: 'cancelado',
      cancelamento_n_prot: '13526000000067890',
      cancelamento_motivo: MOTIVO,
      venda_estoque: 'desfeita',
      acoes: [],
      recusa: null,
    });
    const c = cupomDe(m.t, id);
    expect(c).toMatchObject({ situacao: 'cancelado', cancelamento_n_prot: '13526000000067890', n_prot });
    expect(c.cancelado_em).toEqual(agora);
    expect(c.cancelamento_pedido_em).toEqual(agora);
    expect(enviosDe(m.t, id)).toEqual([
      expect.objectContaining({
        servico: 'cancelamento',
        tentativa: 1,
        resultado: 'respondida',
        c_stat_lote: 128,
        c_stat: 135,
        n_prot: '13526000000067890',
        rejeicao: false,
        iniciada_em: agora,
        terminada_em: agora,
      }),
    ]);
    expect(enviosDe(m.t, id)[0].id_lote).not.toBeNull();
    expect(enviosDe(m.t, id)[0].xml_retorno).toContain('<cStat>135</cStat>');
    // a T3 desfaz a venda numa transação própria, depois da T2 que gravou o cancelado
    expect(m.est.vendas.desfazer).toEqual([id]);
    expect(m.est.sql.filter((s) => s.includes('nfce_desfazer_venda'))).toHaveLength(1);
  });

  it('a T3 falha → o cupom fica cancelado com a venda pendente de desfazer; "Tirar a venda do estoque" refaz uma vez', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    m.est.falharVenda = 1;
    responder(m, ev('ret-evento-135.xml', agora));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    expect(r).toMatchObject({ situacao: 'cancelado', venda_estoque: 'desfazer_pendente', venda_erro: FRASES_EMISSAO.vendaErro });
    expect(r.acoes).toEqual(['lancar_venda']);
    const l = await m.emissao.lancarVenda(id, mais(agora, MIN));
    expect(l).toMatchObject({ situacao: 'cancelado', venda_estoque: 'desfeita', venda_erro: null });
    expect(m.est.vendas.desfazer).toEqual([id]);
  });

  it('em homologação não há venda para desfazer (a T3 não roda)', async () => {
    const m = montar({ ambiente: 'homologacao' });
    const id = await autorizado(m, 'homologacao');
    const agora = mais(T0, 3 * MIN);
    responder(m, ev('ret-evento-135.xml', agora, 'homologacao'));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    expect(r).toMatchObject({ situacao: 'cancelado', venda_estoque: 'teste' });
    expect(m.porta.chamadas[1].corpo).toContain('<cOrgao>35</cOrgao><tpAmb>2</tpAmb>');
    expect(m.est.sql.some((s) => s.includes('nfce_desfazer_venda'))).toBe(false);
  });
});

describe('573 ou sem resposta → cancelando, e a consulta (Tarefa 11) resolve', () => {
  it('573 → cancelando; a consulta antes de 2 min = 409; aos 2 min com o evento → cancelado e a venda desfeita', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, ev('ret-evento-573.xml', agora));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    expect(r).toMatchObject({ situacao: 'cancelando', acoes: ['consultar'], venda_estoque: 'lancada', recusa: null });
    expect(r.consultar_a_partir_de).toEqual(mais(agora, 2 * MIN));
    expect(cupomDe(m.t, id)).toMatchObject({ situacao: 'cancelando', cancelamento_motivo: MOTIVO, cancelado_em: null });
    expect(enviosDe(m.t, id)[0]).toMatchObject({ resultado: 'respondida', c_stat: 573, rejeicao: true });
    expect(m.est.vendas.desfazer).toEqual([]);

    expect(await falha(m.emissao.consultar(id, EU, mais(agora, MIN)))).toMatchObject({ status: 409, code: 'NFCE_CONSULTA_CEDO' });
    responder(m, cons(m, 'ret-consulta-cancelada.xml', mais(agora, 2 * MIN)));
    const c = await m.emissao.consultar(id, EU, mais(agora, 2 * MIN));
    expect(c).toMatchObject({ situacao: 'cancelado', cancelamento_motivo: MOTIVO, venda_estoque: 'desfeita' });
    expect(m.est.vendas.desfazer).toEqual([id]);
  });

  it('enviado sem resposta → cancelando; a consulta sem evento volta a autorizado; dá para cancelar de novo (2º pedido)', async () => {
    const m = montar();
    const id = await autorizado(m);
    const t1 = mais(T0, 5 * MIN);
    responder(m, erro(true));
    const r = await m.svc.cancelar(id, MOTIVO, EU, t1);
    expect(r).toMatchObject({ situacao: 'cancelando', acoes: ['consultar'] });
    expect(enviosDe(m.t, id)[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_TEMPO', rejeicao: false });

    responder(m, cons(m, 'ret-consulta-100.xml', mais(t1, 2 * MIN)));
    const c = await m.emissao.consultar(id, EU, mais(t1, 2 * MIN));
    expect(c).toMatchObject({ situacao: 'autorizado', venda_estoque: 'lancada' });
    expect(c.acoes).toContain('cancelar');
    // Ruling T12-2: o pedido que não entrou sai do cupom (fica no diário)
    expect(c).toMatchObject({ cancelamento_motivo: null, cancelamento_pedido_em: null });
    expect(cupomDe(m.t, id)).toMatchObject({ cancelamento_motivo: null, cancelamento_pedido_em: null });
    expect(enviosDe(m.t, id)[0].xml_enviado).toContain(`<xJust>${MOTIVO}</xJust>`);

    const t2 = mais(t1, 3 * MIN);
    responder(m, ev('ret-evento-135.xml', t2));
    const r2 = await m.svc.cancelar(id, 'Erro nos itens do cupom', EU, t2);
    expect(r2).toMatchObject({ situacao: 'cancelado', cancelamento_motivo: 'Erro nos itens do cupom', venda_estoque: 'desfeita' });
    expect(enviosDe(m.t, id).map((e) => e.tentativa)).toEqual([1, 2]);
  });

  it('retorno com outra chave ou outro ambiente = resposta inválida: cancelando (a consulta decide), nunca cancelado', async () => {
    const outra = (x: string) => x.replace(/<chNFe>[0-9]{44}<\/chNFe>/, `<chNFe>${CH_FIXTURE}</chNFe>`);
    const outroAmb = (x: string) => x.replace(/(<infEvento[^>]*>\s*<tpAmb>)1</, (_s, abre: string) => `${abre}2<`);
    const semProt = (x: string) => x.replace(/<nProt>[^<]*<\/nProt>/, '');
    for (const mexer of [outra, outroAmb, semProt]) {
      const m = montar();
      const id = await autorizado(m);
      const agora = mais(T0, 10 * MIN);
      responder(m, ev('ret-evento-135.xml', agora, 'producao', mexer));
      const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
      expect(r.situacao).toBe('cancelando');
      expect(cupomDe(m.t, id)).toMatchObject({ cancelado_em: null, cancelamento_n_prot: null });
      expect(enviosDe(m.t, id)[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_RESPOSTA_INVALIDA' });
      expect(enviosDe(m.t, id)[0].xml_retorno).toContain('<cStat>135</cStat>');
      expect(m.est.vendas.desfazer).toEqual([]);
    }
  });

  it('o 135 que chega depois de a consulta ter voltado o cupom a autorizado grava cancelado assim mesmo (a SEFAZ registrou)', async () => {
    const m = montar();
    const id = await autorizado(m);
    const t1 = mais(T0, 5 * MIN);
    let soltar!: () => void;
    const aberto = new Promise<void>((r) => (soltar = r));
    let chegou!: () => void;
    const chegada = new Promise<void>((r) => (chegou = r));
    const original = m.porta.registrarEvento.bind(m.porta);
    m.porta.registrarEvento = async (...a) => {
      const r = original(...a);
      chegou();
      await aberto;
      return r;
    };
    responder(m, ev('ret-evento-135.xml', t1), cons(m, 'ret-consulta-100.xml', mais(t1, 3 * MIN)));
    const p = m.svc.cancelar(id, MOTIVO, EU, t1);
    await Promise.race([chegada, p]); // se o cancelar falhar antes da rede, o teste falha aqui (não espera para sempre)
    expect(cupomDe(m.t, id).situacao).toBe('cancelando');
    const c = await m.emissao.consultar(id, EU, mais(t1, 3 * MIN));
    expect(c.situacao).toBe('autorizado');
    soltar();
    const r = await p;
    expect(r).toMatchObject({ situacao: 'cancelado', cancelamento_n_prot: '13526000000067890', venda_estoque: 'desfeita' });
    expect(m.est.vendas.desfazer).toEqual([id]);
  });
});

describe('relógio só na resposta nova (Ruling T12 I1)', () => {
  it('573 com o dhRegEvento de 5 min atrás: cancelando, e o ambiente continua ok', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, ev('ret-evento-573.xml', mais(agora, -5 * MIN)));
    expect((await m.svc.cancelar(id, MOTIVO, EU, agora)).situacao).toBe('cancelando');
    expect(ambienteDe(m.t, 'producao')).toMatchObject({ situacao: 'ok', mensagem: null, emissao_ligada: true });
  });

  it('o 2º pedido volta 573 com a hora do 1º evento (3 min antes): cancelando, ambiente ok, sem histórico de parada', async () => {
    const m = montar();
    const id = await autorizado(m);
    const t1 = mais(T0, 5 * MIN);
    responder(m, erro(true), cons(m, 'ret-consulta-100.xml', mais(t1, 2 * MIN)), ev('ret-evento-573.xml', t1));
    await m.svc.cancelar(id, MOTIVO, EU, t1);
    expect((await m.emissao.consultar(id, EU, mais(t1, 2 * MIN))).situacao).toBe('autorizado');
    const r = await m.svc.cancelar(id, MOTIVO, EU, mais(t1, 3 * MIN));
    expect(r).toMatchObject({ situacao: 'cancelando', recusa: null });
    expect(ambienteDe(m.t, 'producao')).toMatchObject({ situacao: 'ok', mensagem: null });
    expect(m.t.nfce_ambientes_historico.filter((h) => h.evento === 'parada_automatica')).toHaveLength(0);
  });

  it('135 com o dhRegEvento 3 min fora: o cupom fica cancelado e o ambiente para pelo relógio', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, ev('ret-evento-135.xml', mais(agora, -3 * MIN)));
    expect((await m.svc.cancelar(id, MOTIVO, EU, agora)).situacao).toBe('cancelado');
    expect(ambienteDe(m.t, 'producao')).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RETORNO.relogio });
  });
});

describe('a consulta só grava cancelado com o evento conferido (Ruling T12 I2)', () => {
  /** Só no `retEvento` do `procEventoNFe` (o `evento` assinado e o `protNFe` ficam como estão). */
  const noRetEvento = (troca: (ret: string) => string) => (x: string) => x.replace(/<retEvento[\s\S]*?<\/retEvento>/, (ret) => troca(ret));
  const casos: [string, (x: string) => string][] = [
    ['evento de outra chave', noRetEvento((ret) => ret.replace(/<chNFe>[0-9]{44}<\/chNFe>/, `<chNFe>${CH_FIXTURE}</chNFe>`))],
    ['evento de outro ambiente', noRetEvento((ret) => ret.replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>'))],
    ['evento sem nProt', noRetEvento((ret) => ret.replace(/<nProt>[^<]*<\/nProt>/, ''))],
    ['101 sem o procEventoNFe', (x) => x.replace(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/, '')],
  ];
  it.each(casos)('%s: o cancelando continua cancelando, sem desfazer a venda, com a frase de consultar mais tarde', async (_n, mexer) => {
    const m = montar();
    const id = await autorizado(m);
    const t1 = mais(T0, 5 * MIN);
    const tc = mais(t1, 2 * MIN);
    responder(m, ev('ret-evento-573.xml', t1), cons(m, 'ret-consulta-cancelada.xml', tc, 'producao', mexer));
    await m.svc.cancelar(id, MOTIVO, EU, t1);
    const c = await m.emissao.consultar(id, EU, tc);
    expect(c).toMatchObject({
      situacao: 'cancelando',
      cancelamento_n_prot: null,
      cancelado_em: null,
      venda_estoque: 'lancada',
      acoes: ['consultar'],
      // a frase do Ruling T12 fix-1, a mesma do `cancelando` sem pedido nosso (fonte única; leva pré-final, item 9)
      mensagem: 'A SEFAZ informa que este cupom foi cancelado, mas não mandou o comprovante. Consulte de novo mais tarde.',
    });
    expect(cupomDe(m.t, id)).toMatchObject({ situacao: 'cancelando', cancelamento_motivo: MOTIVO, numero_reaproveitavel: false });
    expect(m.est.vendas.desfazer).toEqual([]);
    expect(enviosDe(m.t, id, 'consulta')[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_RESPOSTA_INVALIDA' });
    expect(logs.some((l) => l.includes('cancelamento_sem_prova'))).toBe(true);
  });

  it('101 sem evento num cupom autorizado: passa a cancelando (nunca cancelado às cegas)', async () => {
    const m = montar();
    const id = await autorizado(m);
    const tc = mais(T0, 3 * MIN);
    responder(m, cons(m, 'ret-consulta-cancelada.xml', tc, 'producao', casos[3][1]));
    const c = await m.emissao.consultar(id, EU, tc);
    expect(c).toMatchObject({ situacao: 'cancelando', cancelado_em: null, venda_estoque: 'lancada' });
    expect(m.est.vendas.desfazer).toEqual([]);
  });

  it('101 sem evento num cupom sem resposta, com o protNFe autorizado conferido: grava o nfeProc e vai a cancelando (leva item 9)', async () => {
    const m = montar();
    const espeto = await pronto(m);
    responder(m, erro(true), cons(m, 'ret-consulta-cancelada.xml', mais(T0, 2 * MIN), 'producao', casos[3][1]));
    const e = await m.emissao.emitir(venda(espeto.id), EU, T0);
    expect(e.cupom.situacao).toBe('sem_resposta');
    const c = await m.emissao.consultar(e.cupom.id, EU, mais(T0, 2 * MIN));
    expect(c).toMatchObject({
      situacao: 'cancelando',
      n_prot: '13526000000012345',
      cancelado_em: null,
      mensagem: FRASE_RETORNO.cancelandoSemComprovante,
    });
    const nfe = /<NFe[\s\S]*<\/NFe>/.exec(m.porta.chamadas[0].corpo)![0];
    expect(cupomDe(m.t, e.cupom.id)).toMatchObject({ situacao: 'cancelando', numero_reaproveitavel: false, cancelamento_pedido_em: null });
    expect(cupomDe(m.t, e.cupom.id).xml_autorizado).toContain(nfe);
    expect(cupomDe(m.t, e.cupom.id).xml_autorizado).toContain('<nProt>13526000000012345</nProt>');
    // nenhuma venda lançada às cegas (a SEFAZ diz cancelado); a próxima consulta com o evento decide
    expect(m.est.vendas.lancar).toEqual([]);
    expect((await m.emissao.detalhe(e.cupom.id, mais(T0, 3 * MIN))).mensagem).toBe(FRASE_RETORNO.cancelandoSemComprovante);
  });

  it('101 sem evento num cupom sem resposta e SEM protNFe autorizado: sem_resposta com o número preso, sem nfeProc', async () => {
    const m = montar();
    const espeto = await pronto(m);
    const semProt = (x: string) => casos[3][1](x).replace(/<protNFe[\s\S]*?<\/protNFe>/, '');
    responder(m, erro(true), cons(m, 'ret-consulta-cancelada.xml', mais(T0, 2 * MIN), 'producao', semProt));
    const e = await m.emissao.emitir(venda(espeto.id), EU, T0);
    const c = await m.emissao.consultar(e.cupom.id, EU, mais(T0, 2 * MIN));
    expect(c.situacao).toBe('sem_resposta');
    expect(cupomDe(m.t, e.cupom.id)).toMatchObject({ numero_reaproveitavel: false, xml_autorizado: null, cancelado_em: null });
  });
});

describe('recusas e travas', () => {
  it('outro código → continua autorizado, com a frase da UX 4.3; o motivo fica só no diário; conta no teto de recusas', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, recusaEvento(501, 'Rejeição: Prazo de cancelamento superior ao previsto na Legislação', agora));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    const frase = FRASE_RETORNO.cancelamentoRecusado(501, 'Prazo de cancelamento superior ao previsto na Legislação');
    expect(r).toMatchObject({ situacao: 'autorizado', cancelamento_motivo: null, cancelamento_pedido_em: null, mensagem: frase });
    expect(r.recusa).toMatchObject({ codigo: 501, frase });
    expect(cupomDe(m.t, id)).toMatchObject({ situacao: 'autorizado', cancelamento_motivo: null, cancelamento_pedido_em: null });
    const e = enviosDe(m.t, id)[0];
    expect(e).toMatchObject({ resultado: 'respondida', c_stat: 501, rejeicao: true });
    expect(e.xml_enviado).toContain(`<xJust>${MOTIVO}</xJust>`);
    // o GET depois não repete a recusa (ela é a resposta do clique)
    expect((await m.emissao.detalhe(id, agora)).recusa).toBeNull();
  });

  it('falha antes de enviar → autorizado com "Nada foi enviado"; não gasta tentativa nem a espera de 2 min', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, erro(false), erro(false), ev('ret-evento-135.xml', agora));
    for (let k = 0; k < 2; k++) {
      const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
      expect(r).toMatchObject({ situacao: 'autorizado', mensagem: FRASE_RETORNO.naoEnviado, recusa: null, cancelamento_motivo: null });
    }
    expect((await m.svc.cancelar(id, MOTIVO, EU, agora)).situacao).toBe('cancelado');
    expect(enviosDe(m.t, id).map((e) => e.resultado)).toEqual(['falha_antes_de_enviar', 'falha_antes_de_enviar', 'respondida']);
  });

  it('1 pedido a cada 2 min e no máximo 3 por cupom: 409 sem chamar a porta', async () => {
    const m = montar();
    const id = await autorizado(m);
    const t = (k: number) => mais(T0, (5 + 2 * k) * MIN);
    responder(m, recusaEvento(501, 'Rejeição: x', t(0)), recusaEvento(501, 'Rejeição: x', t(1)), recusaEvento(501, 'Rejeição: x', t(2)));
    await m.svc.cancelar(id, MOTIVO, EU, t(0));
    const cedo = await falha(m.svc.cancelar(id, MOTIVO, EU, mais(t(0), 2 * MIN - SEG)));
    expect(cedo).toEqual({ status: 409, code: 'NFCE_CANCELAMENTO_CEDO', message: FRASE_ERRO.NFCE_CANCELAMENTO_CEDO(mais(t(0), 2 * MIN)) });
    expect((await m.svc.cancelar(id, MOTIVO, EU, t(1))).acoes).toContain('cancelar');
    // o 3º pedido que saiu: o cupom continua autorizado, mas a tela não oferece mais "Cancelar" (Ruling T9 fix)
    const terceiro = await m.svc.cancelar(id, MOTIVO, EU, t(2));
    expect(terceiro.situacao).toBe('autorizado');
    expect(terceiro.acoes).not.toContain('cancelar');
    expect((await m.emissao.detalhe(id, t(3))).acoes).not.toContain('cancelar');
    const chamadas = m.porta.chamadas.length;
    expect(await falha(m.svc.cancelar(id, MOTIVO, EU, t(3)))).toEqual({
      status: 409,
      code: 'NFCE_LIMITE_CANCELAMENTOS',
      message: FRASE_ERRO.NFCE_LIMITE_CANCELAMENTOS,
    });
    expect(m.porta.chamadas.length).toBe(chamadas);
    expect(enviosDe(m.t, id)).toHaveLength(3);
  });

  it('parada_656, a janela do 656 e parada_certificado barram; parada_configuracao e o teto de 10 recusas não', async () => {
    const barram: [Record<string, unknown>, string][] = [
      [{ situacao: 'parada_656', mensagem: FRASE_RETORNO.bloqueouDuasVezes }, 'NFCE_PARADA'],
      [{ bloqueado_ate: mais(T0, 30 * MIN) }, 'NFCE_BLOQUEADA'],
      [{ situacao: 'parada_certificado', mensagem: FRASE_RETORNO.certificado(280) }, 'NFCE_PARADA'],
    ];
    for (const [estado, code] of barram) {
      const m = montar();
      const id = await autorizado(m);
      Object.assign(ambienteDe(m.t, 'producao'), estado);
      expect(await falha(m.svc.cancelar(id, MOTIVO, EU, mais(T0, 5 * MIN)))).toMatchObject({ status: 409, code });
      expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao']);
      expect(cupomDe(m.t, id).situacao).toBe('autorizado');
      expect(enviosDe(m.t, id)).toHaveLength(0);
    }

    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 5 * MIN);
    Object.assign(ambienteDe(m.t, 'producao'), { situacao: 'parada_configuracao', mensagem: FRASE_RETORNO.relogio, emissao_ligada: false });
    for (let k = 0; k < 10; k++) {
      m.t.nfce_envios.push(
        linhaCom('nfce_envios', {
          ambiente: 'producao',
          cupom_id: id,
          servico: 'autorizacao',
          iniciada_em: mais(agora, -k * MIN),
          resultado: 'respondida',
          rejeicao: true,
        }),
      );
    }
    responder(m, ev('ret-evento-135.xml', agora));
    expect((await m.svc.cancelar(id, MOTIVO, EU, agora)).situacao).toBe('cancelado');
  });

  it('656 no evento → continua autorizado e bloqueia o ambiente por 65 min', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, recusaEvento(656, 'Rejeição: Consumo Indevido', agora));
    const r = await m.svc.cancelar(id, MOTIVO, EU, agora);
    expect(r).toMatchObject({ situacao: 'autorizado', mensagem: FRASE_RETORNO.bloqueio656(mais(agora, 65 * MIN)) });
    expect(ambienteDe(m.t, 'producao')).toMatchObject({ bloqueado_ate: mais(agora, 65 * MIN), ultimo_656_em: agora });
  });
});

describe('situação, ambiente e log', () => {
  it('cancelar em rejeitado (ou em cancelando) = 409 NFCE_SITUACAO, sem chamar a porta', async () => {
    const m = montar();
    const espeto = await pronto(m);
    responder(m, (corpo) => lerRetornoAutorizacao(trocar(fixtureNfce('ret-autorizacao-386.xml'), corpo, T0, 'producao')));
    const rej = await m.emissao.emitir(venda(espeto.id), EU, T0);
    expect(rej.cupom.situacao).toBe('rejeitado');
    expect(await falha(m.svc.cancelar(rej.cupom.id, MOTIVO, EU, mais(T0, MIN)))).toEqual({
      status: 409,
      code: 'NFCE_SITUACAO',
      message: FRASE_ERRO.NFCE_SITUACAO('rejeitado', 'cancelar'),
    });

    responder(m, aut(T0), ev('ret-evento-573.xml', mais(T0, MIN)));
    const ok = await m.emissao.emitir(venda(espeto.id), EU, T0);
    await m.svc.cancelar(ok.cupom.id, MOTIVO, EU, mais(T0, MIN));
    expect(await falha(m.svc.cancelar(ok.cupom.id, MOTIVO, EU, mais(T0, 4 * MIN)))).toMatchObject({
      status: 409,
      code: 'NFCE_SITUACAO',
      message: FRASE_ERRO.NFCE_SITUACAO('cancelando', 'cancelar'),
    });
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao', 'autorizacao', 'evento']);
  });

  it('servidor desligado = 503 NFCE_DESLIGADA; cupom de outro ambiente = 503; id desconhecido = 404', async () => {
    const m = montar();
    const id = await autorizado(m);
    m.env.NFCE_AMBIENTE = '';
    expect(await falha(m.svc.cancelar(id, MOTIVO, EU, mais(T0, MIN)))).toMatchObject({ status: 503, code: 'NFCE_DESLIGADA' });
    m.env.NFCE_AMBIENTE = 'homologacao';
    expect(await falha(m.svc.cancelar(id, MOTIVO, EU, mais(T0, MIN)))).toMatchObject({ status: 503, code: 'NFCE_DESLIGADA' });
    m.env.NFCE_AMBIENTE = 'producao';
    expect(await falha(m.svc.cancelar(randomUUID(), MOTIVO, EU, mais(T0, MIN)))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(m.porta.chamadas.map((c) => c.servico)).toEqual(['autorizacao']);
  });

  it('log nfce.envio do cancelamento: o cStat do evento, nunca o motivo, a chave ou o XML', async () => {
    const m = montar();
    const id = await autorizado(m);
    const agora = mais(T0, 10 * MIN);
    responder(m, ev('ret-evento-135.xml', agora));
    logs.length = 0;
    await m.svc.cancelar(id, MOTIVO, EU, agora);
    const envio = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === 'nfce.envio');
    expect(envio).toMatchObject({
      ambiente: 'producao',
      servico: 'cancelamento',
      serie: 2,
      numero: 1,
      c_stat: 135,
      resultado: 'respondida',
    });
    const tudo = logs.join('\n');
    expect(tudo).not.toContain(MOTIVO);
    expect(tudo).not.toContain(cupomDe(m.t, id).chave);
    expect(tudo).not.toContain('<');
  });
});
