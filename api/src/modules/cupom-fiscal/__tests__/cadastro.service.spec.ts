import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { decifrar } from '../../../common/cripto/cripto';
import { toWire } from '../../../common/http/wire';
import {
  CertificadoErro,
  MSG_USO,
  type CertificadoDigitalPort,
  type CertificadoEmUso,
} from '../../certificado-digital/certificado-digital.port';
import { ROTULO_CERTIFICADO } from '../../certificado-digital/certificado-digital.service';
import { CupomCadastroService, type Autor } from '../cadastro.service';
import { cifrarCsc, decifrarCsc } from '../csc';
import type { PerfilFiscalDto, SalvarEmitenteDto, SalvarProdutoDto } from '../cupom-fiscal.dto';
import { FRASE_ERRO, FRASES_VALIDACAO } from '../frases';
import { FRASES_CADASTRO, TEXTO_FALTA } from '../frases-cadastro';
import { linhaCom, montarPrismaCupom, type TabelasCupom } from './prisma-cupom.falso';

const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const SEGREDO = 'segredo-de-teste-do-cupom-fiscal-com-32+';
const CNPJ = '12345678000195';
const EU: Autor = { id: '11111111-1111-4111-8111-111111111111', nome: 'Diego' };
const AGORA = new Date('2026-11-17T17:00:00Z');

type Opcoes = { ambiente?: string; segredo?: string | null; cert?: 'ok' | 'sem' | 'outra_raiz'; cnpjEmpresa?: string };

function montar(o: Opcoes = {}) {
  const { prisma, t, est } = montarPrismaCupom({ cnpjEmpresa: o.cnpjEmpresa });
  const env: Record<string, string | undefined> = {
    NFCE_AMBIENTE: o.ambiente ?? 'homologacao',
    CERTIFICADO_SECRET: o.segredo === undefined ? SEGREDO : (o.segredo ?? undefined),
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const emUso = jest.fn(async (): Promise<CertificadoEmUso> => {
    if ((o.cert ?? 'ok') === 'sem') throw new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO');
    return { cnpj: o.cert === 'outra_raiz' ? '99888777000161' : CNPJ } as CertificadoEmUso;
  });
  const certificados: CertificadoDigitalPort = { emUso };
  const svc = new CupomCadastroService(prisma, config, certificados);
  return { svc, t, est, emUso };
}

async function erro(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as { code: string; message: string }) };
    throw e;
  }
  throw new Error('não lançou');
}

const fio = (x: unknown) => JSON.stringify(toWire(x));

function perfil(t: TabelasCupom, dados: Record<string, unknown> = {}) {
  const p = linhaCom('nfce_perfis_fiscais', { nome: 'Prato da casa', cfop: '5102', csosn: '102', ...dados });
  t.nfce_perfis_fiscais.push(p);
  return p;
}
function item(t: TabelasCupom, dados: Record<string, unknown> = {}) {
  const i = linhaCom('itens_cardapio', { nome: 'Espetinho de carne', preco_venda: '12.00', ...dados });
  t.itens_cardapio.push(i);
  return i;
}
function fiscal(t: TabelasCupom, itemId: string, dados: Record<string, unknown> = {}) {
  const f = linhaCom('nfce_itens', { item_cardapio_id: itemId, ...dados });
  t.nfce_itens.push(f);
  return f;
}
function cupom(t: TabelasCupom, dados: Record<string, unknown>) {
  const c = linhaCom('nfce_cupons', { ambiente: 'homologacao', serie: 2, numero: 1, situacao: 'autorizado', ...dados });
  t.nfce_cupons.push(c);
  return c;
}
/** A empresa toda preenchida, a série e o CSC do ambiente e um produto pronto. */
async function completo(m: ReturnType<typeof montar>, a: 'homologacao' | 'producao' = 'homologacao') {
  Object.assign(m.t.nfce_emitente[0], {
    ie: '123456789012',
    crt: 1,
    logradouro: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    cep: '13270000',
  });
  await m.svc.salvarAmbiente(a, { serie: 2, proximo_numero: 1, id_csc: 1, csc: CSC_TESTE }, EU, AGORA);
  const p = perfil(m.t);
  const i = item(m.t);
  fiscal(m.t, i.id, { ncm: '16025000', perfil_fiscal_id: p.id });
  return { p, i };
}

describe('csc.ts', () => {
  it('cifra com o rótulo nfce-csc: abre com decifrarCsc e não abre com o rótulo do certificado nem com outro segredo', () => {
    const blob = cifrarCsc(CSC_TESTE, SEGREDO);
    expect(blob).not.toContain(CSC_TESTE);
    expect(decifrarCsc(blob, SEGREDO)).toBe(CSC_TESTE);
    expect(decifrar(blob, SEGREDO, 'nfce-csc')).toBe(CSC_TESTE);
    expect(decifrar(blob, SEGREDO, ROTULO_CERTIFICADO)).toBeNull();
    expect(decifrarCsc(blob, `${SEGREDO}x`)).toBeNull();
    expect(decifrarCsc('lixo', SEGREDO)).toBeNull();
  });
});

describe('cadastro: CSC (só cifrado; só a dica volta)', () => {
  it('nenhuma resposta leva o CSC nem o texto cifrado; csc_dica = os 4 últimos; o banco guarda só o cifrado', async () => {
    const m = montar({ ambiente: 'producao' });
    const salvo = await m.svc.salvarAmbiente('producao', { serie: 2, proximo_numero: 1, id_csc: 1, csc: CSC_TESTE }, EU, AGORA);
    const linha = m.t.nfce_ambientes.find((a) => a.ambiente === 'producao')!;
    expect(linha.csc_cifrado).not.toBeNull();
    expect(linha.csc_cifrado).not.toContain(CSC_TESTE);
    expect(decifrarCsc(linha.csc_cifrado!, SEGREDO)).toBe(CSC_TESTE);
    expect(linha.csc_dica).toBe('CDEF');
    expect(salvo.csc_dica).toBe('CDEF');

    const i = item(m.t);
    const respostas = [
      salvo,
      await m.svc.ambiente('producao'),
      await m.svc.ambiente('homologacao'),
      await m.svc.situacao(AGORA),
      await m.svc.emitente(),
      await m.svc.perfis(),
      await m.svc.produtos(),
      await m.svc.salvarProduto(i.id, { ncm: '16025000' }, EU, AGORA),
    ];
    for (const r of respostas) {
      const s = fio(r);
      expect(s).not.toContain(CSC_TESTE);
      expect(s).not.toContain(linha.csc_cifrado!);
      expect(s).not.toContain('csc_cifrado');
    }
    expect(fio(m.t.nfce_ambientes_historico)).not.toContain(CSC_TESTE);
  });

  it('o histórico grava o nome do campo, nunca o valor', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { csc: CSC_TESTE }, EU, AGORA);
    expect(m.t.nfce_ambientes_historico).toHaveLength(1);
    expect(m.t.nfce_ambientes_historico[0]).toMatchObject({
      ambiente: 'homologacao',
      evento: 'configuracao',
      campos: ['csc'],
      feito_por: EU.id,
      feito_por_nome: 'Diego',
    });
    const r = await m.svc.ambiente('homologacao');
    expect(r.historico).toEqual([
      {
        evento: 'configuracao',
        campos: ['csc'],
        mensagem: null,
        feito_por_nome: 'Diego',
        feito_em: m.t.nfce_ambientes_historico[0].feito_em,
      },
    ]);
  });

  it('o histórico do GET traz as 5 últimas, da mais nova para a mais velha', async () => {
    const m = montar();
    for (let n = 1; n <= 7; n++) {
      m.t.nfce_ambientes_historico.push(
        linhaCom('nfce_ambientes_historico', {
          ambiente: 'homologacao',
          evento: 'configuracao',
          campos: [`c${n}`],
          situacao: 'ok',
          feito_em: new Date(AGORA.getTime() + n * 60_000),
        }),
      );
    }
    m.t.nfce_ambientes_historico.push(
      linhaCom('nfce_ambientes_historico', {
        ambiente: 'producao',
        evento: 'ligada',
        situacao: 'ok',
        feito_em: new Date(AGORA.getTime() + 3_600_000),
      }),
    );
    const r = await m.svc.ambiente('homologacao');
    expect(r.historico.map((h) => h.campos[0])).toEqual(['c7', 'c6', 'c5', 'c4', 'c3']);
  });

  it('CSC fora de 16–36 letras e números ou IdCSC fora de 1–999999 → 422 NFCE_CSC_INVALIDO com a frase do campo; nada muda', async () => {
    const m = montar();
    for (const csc of ['CSC0123456789AB', 'A'.repeat(37), 'CSCTESTE-0123456789', 'CSCTESTE 0123456789ABCD']) {
      expect(await erro(m.svc.salvarAmbiente('homologacao', { csc }, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_CSC_INVALIDO',
        message: FRASE_ERRO.NFCE_CSC_INVALIDO('csc'),
      });
    }
    for (const id_csc of [0, 1_000_000, 1.5]) {
      expect(await erro(m.svc.salvarAmbiente('homologacao', { id_csc }, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_CSC_INVALIDO',
        message: FRASE_ERRO.NFCE_CSC_INVALIDO('id_csc'),
      });
    }
    expect(m.t.nfce_ambientes_historico).toHaveLength(0);
    expect(m.t.nfce_ambientes[0].csc_cifrado).toBeNull();
  });

  it('CSC com espaços nas pontas é aparado; 36 caracteres passa', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { csc: `  ${CSC_TESTE}  ` }, EU, AGORA);
    expect(decifrarCsc(m.t.nfce_ambientes[0].csc_cifrado!, SEGREDO)).toBe(CSC_TESTE);
    await m.svc.salvarAmbiente('homologacao', { csc: 'A1'.repeat(18) }, EU, AGORA);
    expect(m.t.nfce_ambientes[0].csc_dica).toBe('A1A1');
  });

  it('sem CERTIFICADO_SECRET a gravação do CSC é recusada com frase (503, não 500) e nada muda', async () => {
    const m = montar({ segredo: null });
    expect(await erro(m.svc.salvarAmbiente('homologacao', { serie: 2, csc: CSC_TESTE }, EU, AGORA))).toEqual({
      status: 503,
      code: 'NFCE_SEM_SEGREDO',
      message: FRASES_CADASTRO.semSegredo,
    });
    expect(m.t.nfce_ambientes[0]).toMatchObject({ serie: null, csc_cifrado: null, csc_dica: null });
    expect(m.t.nfce_ambientes_historico).toHaveLength(0);
    // sem CSC no pedido, o resto grava normalmente
    await m.svc.salvarAmbiente('homologacao', { serie: 2 }, EU, AGORA);
    expect(m.t.nfce_ambientes[0].serie).toBe(2);
  });
});

describe('cadastro: série e número', () => {
  it('série fora de 0–889 → 422 NFCE_SERIE_INVALIDA', async () => {
    const m = montar();
    for (const serie of [890, -1, 1.5]) {
      expect(await erro(m.svc.salvarAmbiente('homologacao', { serie }, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_SERIE_INVALIDA',
        message: FRASE_ERRO.NFCE_SERIE_INVALIDA,
      });
    }
    await m.svc.salvarAmbiente('homologacao', { serie: 889 }, EU, AGORA);
    await m.svc.salvarAmbiente('producao', { serie: 0 }, EU, AGORA);
    expect(m.t.nfce_ambientes.map((a) => a.serie)).toEqual([889, 0]);
  });

  it('série igual a uma das séries do caixa de hoje → 422 NFCE_SERIE_INVALIDA (nos dois ambientes)', async () => {
    const m = montar();
    m.t.nfce_emitente[0].series_outro_sistema = [1, 3];
    for (const a of ['homologacao', 'producao'] as const) {
      expect((await erro(m.svc.salvarAmbiente(a, { serie: 1 }, EU, AGORA))).code).toBe('NFCE_SERIE_INVALIDA');
    }
    await m.svc.salvarAmbiente('producao', { serie: 2 }, EU, AGORA);
  });

  it('próximo número ≤ o maior já usado na série → 422 NFCE_NUMERO_INVALIDO (autorizado, cancelado, denegado e pendentes contam)', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { serie: 2, proximo_numero: 1 }, EU, AGORA);
    cupom(m.t, { numero: 41, situacao: 'autorizado' });
    cupom(m.t, { numero: 30, situacao: 'cancelado' });
    cupom(m.t, { numero: 39, situacao: 'rejeitado' });
    cupom(m.t, { numero: 90, situacao: 'autorizado', serie: 3 }); // outra série
    cupom(m.t, { numero: 95, situacao: 'autorizado', ambiente: 'producao' }); // outro ambiente
    expect(await erro(m.svc.salvarAmbiente('homologacao', { proximo_numero: 41 }, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_NUMERO_INVALIDO',
      message: 'O próximo número tem de ser maior que 41, o último já usado na série 2.',
    });
    const r = await m.svc.salvarAmbiente('homologacao', { proximo_numero: 42 }, EU, AGORA);
    expect(r).toMatchObject({ serie: 2, proximo_numero: 42, ultimo_numero_usado: 41 });
    expect(typeof r.proximo_numero).toBe('number');
  });

  it('descartado com número livre não conta; descartado no 539 (número usado por outra nota) conta', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { serie: 2 }, EU, AGORA);
    cupom(m.t, { numero: 10, situacao: 'autorizado' });
    cupom(m.t, { numero: 50, situacao: 'descartado', numero_reaproveitavel: true });
    await m.svc.salvarAmbiente('homologacao', { proximo_numero: 11 }, EU, AGORA);
    cupom(m.t, { numero: 60, situacao: 'descartado', numero_reaproveitavel: false });
    expect((await erro(m.svc.salvarAmbiente('homologacao', { proximo_numero: 60 }, EU, AGORA))).message).toBe(
      FRASE_ERRO.NFCE_NUMERO_INVALIDO(60, 2),
    );
    await m.svc.salvarAmbiente('homologacao', { proximo_numero: 61 }, EU, AGORA);
  });

  it('próximo número fora de 1–999999999 → 422 NFCE_NUMERO_INVALIDO com frase própria', async () => {
    const m = montar();
    for (const proximo_numero of [0, 1_000_000_000, 2.5]) {
      expect(await erro(m.svc.salvarAmbiente('homologacao', { proximo_numero }, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_NUMERO_INVALIDO',
        message: FRASES_CADASTRO.numeroForaDaFaixa,
      });
    }
  });

  it('trocar a série confere o próximo número contra a série NOVA', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { serie: 2, proximo_numero: 5 }, EU, AGORA);
    cupom(m.t, { serie: 7, numero: 8, situacao: 'autorizado' });
    expect((await erro(m.svc.salvarAmbiente('homologacao', { serie: 7 }, EU, AGORA))).message).toBe(FRASE_ERRO.NFCE_NUMERO_INVALIDO(8, 7));
    await m.svc.salvarAmbiente('homologacao', { serie: 7, proximo_numero: 9 }, EU, AGORA);
    expect(m.t.nfce_ambientes[0]).toMatchObject({ serie: 7, proximo_numero: 9n });
  });

  it('trocar a série com cupom rejeitado (ou outro pendente) na série atual → 409 NFCE_SERIE_COM_PENDENTES', async () => {
    for (const situacao of ['rejeitado', 'enviando', 'sem_resposta', 'nao_enviado', 'nao_consta']) {
      const m = montar();
      await m.svc.salvarAmbiente('homologacao', { serie: 2, proximo_numero: 10 }, EU, AGORA);
      cupom(m.t, { numero: 5, situacao });
      expect(await erro(m.svc.salvarAmbiente('homologacao', { serie: 3 }, EU, AGORA))).toEqual({
        status: 409,
        code: 'NFCE_SERIE_COM_PENDENTES',
        message: FRASE_ERRO.NFCE_SERIE_COM_PENDENTES,
      });
      expect(m.t.nfce_ambientes[0].serie).toBe(2);
      // o mesmo número na mesma série não é troca de série
      await m.svc.salvarAmbiente('homologacao', { serie: 2, proximo_numero: 11 }, EU, AGORA);
    }
  });

  it('com só autorizados e descartados na série atual, a série troca; pendente noutro ambiente não conta', async () => {
    const m = montar();
    await m.svc.salvarAmbiente('homologacao', { serie: 2, proximo_numero: 10 }, EU, AGORA);
    cupom(m.t, { numero: 5, situacao: 'autorizado' });
    cupom(m.t, { numero: 6, situacao: 'descartado' });
    cupom(m.t, { numero: 7, situacao: 'rejeitado', ambiente: 'producao' });
    await m.svc.salvarAmbiente('homologacao', { serie: 3, proximo_numero: 1 }, EU, AGORA);
    expect(m.t.nfce_ambientes[0]).toMatchObject({ serie: 3, proximo_numero: 1n });
  });

  it('confere e grava numa transação só, com o ambiente travado (FOR UPDATE), e anota os campos mudados', async () => {
    const m = montar();
    const antes = m.est.transacoes;
    await m.svc.salvarAmbiente('producao', { serie: 2, proximo_numero: 7, id_csc: 3 }, EU, AGORA);
    expect(m.est.transacoes - antes).toBe(1);
    expect(m.est.travas).toEqual([['producao']]);
    expect(m.t.nfce_ambientes[1]).toMatchObject({
      serie: 2,
      proximo_numero: 7n,
      id_csc: 3,
      alterada_por: EU.id,
      alterada_por_nome: 'Diego',
      alterada_em: AGORA,
    });
    expect(m.t.nfce_ambientes_historico.map((h) => h.campos)).toEqual([['serie', 'proximo_numero', 'id_csc']]);
    // nada mudou = nenhuma linha no histórico
    await m.svc.salvarAmbiente('producao', { serie: 2, proximo_numero: 7, id_csc: 3 }, EU, AGORA);
    expect(m.t.nfce_ambientes_historico).toHaveLength(1);
  });

  it('trocar a série com a emissão ligada desliga a emissão (o trio ambiente × CNPJ × série mudou) e anota no histórico', async () => {
    const m = montar();
    Object.assign(m.t.nfce_ambientes[0], { serie: 2, emissao_ligada: true, ligada_cnpj: CNPJ, ligada_serie: 2 });
    await m.svc.salvarAmbiente('homologacao', { serie: 4 }, EU, AGORA);
    expect(m.t.nfce_ambientes[0]).toMatchObject({ serie: 4, emissao_ligada: false, mensagem: FRASES_CADASTRO.trioMudou });
    expect(m.t.nfce_ambientes_historico.map((h) => [h.evento, h.campos])).toEqual([
      ['configuracao', ['serie']],
      ['desligada', ['serie']],
    ]);
  });
});

describe('cadastro: perfis fiscais', () => {
  it('apara os códigos e grava vazio como NULL (os CHECKs do banco passam)', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 1;
    const r = await m.svc.criarPerfil(
      { nome: '  Prato da casa ', cfop: ' 5102 ', csosn: ' 102 ', cst_icms: '', pis_cst: ' ', cofins_cst: '49', c_ativ_sn: '' },
      EU,
      AGORA,
    );
    expect(m.t.nfce_perfis_fiscais[0]).toMatchObject({
      nome: 'Prato da casa',
      cfop: '5102',
      csosn: '102',
      cst_icms: null,
      pis_cst: null,
      cofins_cst: '49',
      c_ativ_sn: null,
      ativo: true,
      atualizado_por: EU.id,
      atualizado_por_nome: 'Diego',
    });
    expect(r).toMatchObject({ nome: 'Prato da casa', produtos: 0, vale_no_regime: true });
  });

  it('a regra do regime vem do CRT da empresa: 422 NFCE_PERFIL_INVALIDO com as frases da validação', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 3;
    const casos: [Partial<PerfilFiscalDto>, string][] = [
      [{ cfop: '5102', csosn: '102' }, FRASES_VALIDACAO.normalSemCst],
      [{ cfop: '5102', cst_icms: '20', aliq_icms: '18' }, FRASES_VALIDACAO.cst20],
      [{ cfop: '5102', cst_icms: '00' }, FRASES_VALIDACAO.semAliqIcms],
      [{ cfop: '5102', cst_icms: '00', aliq_icms: '18', pis_cst: '01' }, FRASES_VALIDACAO.pisCofinsBarrado],
      [{ cfop: '5102', cst_icms: '00', aliq_icms: '18', cofins_cst: '02' }, FRASES_VALIDACAO.pisCofinsBarrado],
    ];
    for (const [dados, frase] of casos) {
      expect(await erro(m.svc.criarPerfil({ nome: 'X', cfop: '5102', ...dados }, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_PERFIL_INVALIDO',
        message: frase,
      });
    }
    expect(m.t.nfce_perfis_fiscais).toHaveLength(0);
    await m.svc.criarPerfil({ nome: 'Normal', cfop: '5102', cst_icms: '00', aliq_icms: '18' }, EU, AGORA);
    expect(m.t.nfce_perfis_fiscais[0].aliq_icms).toEqual(new Prisma.Decimal('18'));
  });

  it('nome vazio → 422; nome repetido → 409', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 1;
    expect(await erro(m.svc.criarPerfil({ nome: '   ', cfop: '5102', csosn: '102' }, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PERFIL_INVALIDO',
      message: FRASES_CADASTRO.perfilSemNome,
    });
    await m.svc.criarPerfil({ nome: 'Bebida', cfop: '5405', csosn: '500' }, EU, AGORA);
    expect(await erro(m.svc.criarPerfil({ nome: ' Bebida ', cfop: '5102', csosn: '102' }, EU, AGORA))).toEqual({
      status: 409,
      code: 'NFCE_PERFIL_REPETIDO',
      message: FRASES_CADASTRO.perfilRepetido,
    });
  });

  it('PATCH confere o perfil inteiro quando muda código; só desativar (ou renomear) passa mesmo fora do regime', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 3; // o regime virou normal depois de cadastrar o perfil do Simples
    const p = perfil(m.t);
    expect((await erro(m.svc.atualizarPerfil(p.id, { pis_cst: '49' }, EU, AGORA))).message).toBe(FRASES_VALIDACAO.normalSemCst);
    const r = await m.svc.atualizarPerfil(p.id, { ativo: false, nome: 'Prato (antigo)' }, EU, AGORA);
    expect(r).toMatchObject({ ativo: false, nome: 'Prato (antigo)', vale_no_regime: false });
    // trocar de CSOSN para CST: o merge limpa o CSOSN vazio
    await m.svc.atualizarPerfil(p.id, { csosn: '', cst_icms: '40' }, EU, AGORA);
    expect(m.t.nfce_perfis_fiscais[0]).toMatchObject({ csosn: null, cst_icms: '40' });
    expect((await erro(m.svc.atualizarPerfil('22222222-2222-4222-8222-222222222222', { ativo: true }, EU, AGORA))).status).toBe(404);
    // `null` passa pelo @IsOptional() do DTO: o nome é obrigatório, então é 422 (não um 500 do .trim())
    expect(await erro(m.svc.atualizarPerfil(p.id, { nome: null as unknown as string }, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PERFIL_INVALIDO',
      message: FRASES_CADASTRO.perfilSemNome,
    });
  });

  it('a lista traz quantos produtos usam cada perfil e se ele vale no regime de agora', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 1;
    const a = perfil(m.t, { nome: 'B' });
    perfil(m.t, { nome: 'A', csosn: null, cst_icms: '00', aliq_icms: '18' });
    for (let n = 0; n < 3; n++) fiscal(m.t, item(m.t, { nome: `I${n}` }).id, { perfil_fiscal_id: a.id });
    const r = await m.svc.perfis();
    expect(r.map((p) => [p.nome, p.produtos, p.vale_no_regime])).toEqual([
      ['A', 0, false],
      ['B', 3, true],
    ]);
    expect(JSON.parse(fio(r))[0].aliq_icms).toBe(18); // alíquota segue o wire.ts
  });
});

describe('cadastro: produtos', () => {
  it('preço "12.345" → preco_venda_centavos 1235 (number, arredondado uma vez), nunca Decimal', async () => {
    const m = montar();
    item(m.t, { nome: 'Chopp', preco_venda: '12.345' });
    const [l] = await m.svc.produtos();
    expect(l.preco_venda_centavos).toBe(1235);
    expect(Object.values(l).some((v) => v instanceof Prisma.Decimal)).toBe(false);
    expect(JSON.parse(fio([l]))[0]).toMatchObject({ preco_venda_centavos: 1235 });
    expect(JSON.parse(fio([l]))[0]).not.toHaveProperty('preco_venda');
  });

  it('preço nulo, zero ou negativo → null/sem_preco, sem derrubar a lista', async () => {
    const m = montar();
    item(m.t, { nome: 'A', preco_venda: null });
    item(m.t, { nome: 'B', preco_venda: '-5' });
    item(m.t, { nome: 'C', preco_venda: '0.004' });
    const r = await m.svc.produtos();
    expect(r.map((l) => [l.nome, l.preco_venda_centavos, l.motivos.includes('sem_preco')])).toEqual([
      ['A', null, true],
      ['B', null, true],
      ['C', 0, true],
    ]);
  });

  it('motivos e "pronto" (com o regime da empresa); prontos=true só os prontos e prontos=false só os que faltam', async () => {
    const m = montar();
    m.t.nfce_emitente[0].crt = 1;
    const p = perfil(m.t);
    const normal = perfil(m.t, { nome: 'Normal', csosn: null, cst_icms: '00', aliq_icms: '18' });
    const inativo = perfil(m.t, { nome: 'Velho', ativo: false });
    const pronto = item(m.t, { nome: 'A pronto', categoria: 'Espetos' });
    fiscal(m.t, pronto.id, { ncm: '16025000', perfil_fiscal_id: p.id, descricao_cupom: 'Espeto' });
    item(m.t, { nome: 'B sem dados' });
    fiscal(m.t, item(m.t, { nome: 'C fora do regime' }).id, { ncm: '16025000', perfil_fiscal_id: normal.id });
    fiscal(m.t, item(m.t, { nome: 'D perfil velho', ativo: false }).id, { ncm: '16025000', perfil_fiscal_id: inativo.id });
    fiscal(m.t, item(m.t, { nome: 'E 🍺' }).id, { ncm: '16025000', perfil_fiscal_id: p.id });

    const todos = await m.svc.produtos();
    expect(todos.map((l) => [l.nome, l.pronto, l.motivos])).toEqual([
      ['A pronto', true, []],
      ['B sem dados', false, ['falta_ncm', 'falta_perfil']],
      ['C fora do regime', false, ['perfil_fora_do_regime']],
      ['D perfil velho', false, ['inativo', 'perfil_inativo']],
      ['E 🍺', false, ['nome_fora_do_padrao']],
    ]);
    expect(todos[0]).toEqual({
      item_cardapio_id: pronto.id,
      nome: 'A pronto',
      categoria: 'Espetos',
      unidade_venda: 'UN',
      preco_venda_centavos: 1200,
      ativo: true,
      ncm: '16025000',
      cest: null,
      gtin: null,
      origem: 0,
      descricao_cupom: 'Espeto',
      unidade: null,
      perfil_fiscal_id: p.id,
      perfil_nome: 'Prato da casa',
      pronto: true,
      motivos: [],
    });
    expect((await m.svc.produtos(true)).map((l) => l.nome)).toEqual(['A pronto']);
    expect((await m.svc.produtos(false)).map((l) => l.nome)).toEqual(['B sem dados', 'C fora do regime', 'D perfil velho', 'E 🍺']);
  });

  it('salvar: limpa máscara e espaços de NCM, CEST e GTIN; vazio vira NULL; cria a linha que não existia', async () => {
    const m = montar();
    const i = item(m.t);
    const p = perfil(m.t);
    const r = await m.svc.salvarProduto(
      i.id,
      {
        ncm: ' 1602.50.00 ',
        cest: '17.049.00',
        gtin: ' 7891234567895 ',
        descricao_cupom: '  ',
        unidade: ' KG ',
        perfil_fiscal_id: p.id,
        origem: 2,
      },
      EU,
      AGORA,
    );
    expect(m.t.nfce_itens[0]).toMatchObject({
      item_cardapio_id: i.id,
      ncm: '16025000',
      cest: '1704900',
      gtin: '7891234567895',
      descricao_cupom: null,
      unidade: 'KG',
      perfil_fiscal_id: p.id,
      origem: 2,
      atualizado_por: EU.id,
      atualizado_por_nome: 'Diego',
      atualizado_em: AGORA,
    });
    expect(r).toMatchObject({ item_cardapio_id: i.id, ncm: '16025000', perfil_nome: 'Prato da casa' });
    // vazio e só espaços apagam; o que não veio fica
    await m.svc.salvarProduto(i.id, { cest: '', gtin: '   ' }, EU, AGORA);
    expect(m.t.nfce_itens[0]).toMatchObject({ ncm: '16025000', cest: null, gtin: null, unidade: 'KG', origem: 2 });
    await m.svc.salvarProduto(i.id, { perfil_fiscal_id: null }, EU, AGORA);
    expect(m.t.nfce_itens[0].perfil_fiscal_id).toBeNull();
  });

  it('salvar: formatos inválidos → 422 NFCE_PRODUTO_INVALIDO com a frase do campo; nada muda', async () => {
    const m = montar();
    const i = item(m.t);
    const casos: [SalvarProdutoDto, string][] = [
      [{ ncm: '1602.50' }, FRASES_VALIDACAO.ncm],
      [{ ncm: 'abc' }, FRASES_VALIDACAO.ncm],
      [{ cest: '123' }, FRASES_VALIDACAO.cest],
      [{ gtin: '7891234567890' }, FRASES_VALIDACAO.gtin],
      [{ origem: 9 }, FRASES_VALIDACAO.origem],
      [{ descricao_cupom: 'x'.repeat(121) }, FRASES_VALIDACAO.descricao],
      [{ descricao_cupom: 'Chopp 🍺' }, FRASES_VALIDACAO.nomeCaractere],
      [{ unidade: 'LITROS!' }, FRASES_VALIDACAO.unidade],
    ];
    for (const [dto, frase] of casos) {
      expect(await erro(m.svc.salvarProduto(i.id, dto, EU, AGORA))).toEqual({
        status: 422,
        code: 'NFCE_PRODUTO_INVALIDO',
        message: frase,
      });
    }
    expect(m.t.nfce_itens).toHaveLength(0);
  });

  it('salvar: perfil que não existe ou desativado → 422; produto que não existe → 404', async () => {
    const m = montar();
    const i = item(m.t);
    const velho = perfil(m.t, { ativo: false });
    expect(await erro(m.svc.salvarProduto(i.id, { perfil_fiscal_id: '33333333-3333-4333-8333-333333333333' }, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PRODUTO_INVALIDO',
      message: FRASES_CADASTRO.semPerfil,
    });
    expect(await erro(m.svc.salvarProduto(i.id, { perfil_fiscal_id: velho.id }, EU, AGORA))).toEqual({
      status: 422,
      code: 'NFCE_PRODUTO_INVALIDO',
      message: FRASES_CADASTRO.perfilDesativado,
    });
    expect((await erro(m.svc.salvarProduto('44444444-4444-4444-8444-444444444444', { ncm: '16025000' }, EU, AGORA))).status).toBe(404);
    expect(m.t.nfce_itens).toHaveLength(0);
  });
});

describe('cadastro: perfil em lote', () => {
  it('3 itens → 1 transação e 3 linhas (cria as que faltam, atualiza as que existem)', async () => {
    const m = montar();
    const p = perfil(m.t);
    const outro = perfil(m.t, { nome: 'Outro' });
    const [a, b, c] = [item(m.t, { nome: 'A' }), item(m.t, { nome: 'B' }), item(m.t, { nome: 'C' })];
    fiscal(m.t, a.id, { ncm: '16025000', perfil_fiscal_id: outro.id });
    const antes = m.est.transacoes;
    const r = await m.svc.perfilEmLote({ itens: [a.id, b.id, c.id, b.id], perfil_fiscal_id: p.id }, EU, AGORA);
    expect(m.est.transacoes - antes).toBe(1);
    expect(r).toEqual({ atualizados: 3, perfil_fiscal_id: p.id, perfil_nome: 'Prato da casa' });
    expect(m.t.nfce_itens).toHaveLength(3);
    expect(m.t.nfce_itens.every((l) => l.perfil_fiscal_id === p.id && l.atualizado_por === EU.id)).toBe(true);
    expect(m.t.nfce_itens.find((l) => l.item_cardapio_id === a.id)?.ncm).toBe('16025000'); // o resto da linha fica
  });

  it('501 itens → 400; 0 itens → 400 (a guarda também está no serviço, além do DTO)', async () => {
    const m = montar();
    const p = perfil(m.t);
    const ids = Array.from({ length: 501 }, (_, n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`);
    expect(await erro(m.svc.perfilEmLote({ itens: ids, perfil_fiscal_id: p.id }, EU, AGORA))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: FRASES_CADASTRO.loteTamanho,
    });
    expect((await erro(m.svc.perfilEmLote({ itens: [], perfil_fiscal_id: p.id }, EU, AGORA))).status).toBe(400);
  });

  it('perfil desativado → 422; produto que sumiu → 404; nada é gravado', async () => {
    const m = montar();
    const p = perfil(m.t);
    const velho = perfil(m.t, { nome: 'Velho', ativo: false });
    const a = item(m.t);
    expect((await erro(m.svc.perfilEmLote({ itens: [a.id], perfil_fiscal_id: velho.id }, EU, AGORA))).message).toBe(
      FRASES_CADASTRO.perfilDesativado,
    );
    expect(
      await erro(m.svc.perfilEmLote({ itens: [a.id, '66666666-6666-4666-8666-666666666666'], perfil_fiscal_id: p.id }, EU, AGORA)),
    ).toEqual({ status: 404, code: 'NOT_FOUND', message: FRASES_CADASTRO.produtoSumiu });
    expect(m.t.nfce_itens).toHaveLength(0);
  });
});

describe('cadastro: empresa no cupom', () => {
  it('limpa máscaras; vazio vira NULL; o que não veio fica (cada quadro salva só os seus campos)', async () => {
    const m = montar();
    await m.svc.salvarEmitente(
      {
        ie: '123.456.789.012',
        crt: 1,
        logradouro: ' Rua A ',
        numero: '10',
        complemento: '',
        bairro: 'Centro',
        cep: '13270-000',
        telefone: '(19) 3871-0000',
      },
      EU,
      AGORA,
    );
    expect(m.t.nfce_emitente[0]).toMatchObject({
      ie: '123456789012',
      crt: 1,
      logradouro: 'Rua A',
      complemento: null,
      cep: '13270000',
      telefone: '1938710000',
      atualizado_por: EU.id,
      atualizado_por_nome: 'Diego',
    });
    await m.svc.salvarEmitente({ series_outro_sistema: [3, 1, 1], sem_outro_sistema: false }, EU, AGORA);
    expect(m.t.nfce_emitente[0]).toMatchObject({ ie: '123456789012', series_outro_sistema: [1, 3] });
    const r = await m.svc.emitente();
    expect(r).toMatchObject({ cnpj: CNPJ, ie: '123456789012', crt: 1, series_outro_sistema: [1, 3], cod_municipio: '3556206', uf: 'SP' });
  });

  it('frases de cada campo (UX 5.2, 5.4 e 5.5) → 422 NFCE_EMITENTE_INVALIDO; nada muda', async () => {
    const m = montar();
    const casos: [SalvarEmitenteDto, string][] = [
      [{ ie: '1234' }, FRASES_CADASTRO.ie],
      [{ cep: '1327' }, FRASES_CADASTRO.cep],
      [{ cod_municipio: '355620' }, FRASES_CADASTRO.codMunicipio],
      [{ cod_municipio: '3106200' }, FRASES_CADASTRO.municipioDeSp],
      [{ telefone: '12' }, FRASES_CADASTRO.telefone],
      [{ nat_op: 'x'.repeat(61) }, FRASES_CADASTRO.natOpLonga],
      [{ nat_op: '  ' }, FRASES_CADASTRO.semNatOp],
      [{ inf_cpl: 'x'.repeat(501) }, FRASES_CADASTRO.infCplLongo],
      [{ logradouro: 'Rua 🍺' }, FRASES_CADASTRO.caractere('A rua')],
      [{ bairro: 'x'.repeat(61) }, FRASES_CADASTRO.campoLongo('O bairro', 60)],
      [{ resp_tec_cnpj: '11222333000181' }, FRASES_CADASTRO.respTecTudoOuNada],
      [
        { resp_tec_cnpj: '11222333000182', resp_tec_contato: 'Ana', resp_tec_email: 'a@b.com', resp_tec_fone: '1932320000' },
        FRASES_CADASTRO.respTecCnpj,
      ],
      [
        { resp_tec_cnpj: '11222333000181', resp_tec_contato: 'Ana', resp_tec_email: 'ana', resp_tec_fone: '1932320000' },
        FRASES_CADASTRO.email,
      ],
      [{ series_outro_sistema: [890] }, FRASES_CADASTRO.serieOutroSistema],
      [{ series_outro_sistema: [1], sem_outro_sistema: true }, FRASES_CADASTRO.semOutroComSeries],
      [{ tp_regime_ibscbs: 10 }, FRASES_CADASTRO.tpRegimeIbscbs],
    ];
    for (const [dto, frase] of casos) {
      expect(await erro(m.svc.salvarEmitente(dto, EU, AGORA))).toEqual({ status: 422, code: 'NFCE_EMITENTE_INVALIDO', message: frase });
    }
    expect(m.t.nfce_emitente[0]).toMatchObject({ ie: null, atualizado_por: null });
  });

  it('responsável técnico: os quatro juntos gravam (CNPJ normalizado); os quatro vazios apagam', async () => {
    const m = montar();
    await m.svc.salvarEmitente(
      {
        resp_tec_cnpj: '11.222.333/0001-81',
        resp_tec_contato: 'Ana',
        resp_tec_email: 'ana@sistema.com.br',
        resp_tec_fone: '(19) 3232-0000',
      },
      EU,
      AGORA,
    );
    expect(m.t.nfce_emitente[0]).toMatchObject({ resp_tec_cnpj: '11222333000181', resp_tec_fone: '1932320000' });
    await m.svc.salvarEmitente({ resp_tec_cnpj: '', resp_tec_contato: '', resp_tec_email: '', resp_tec_fone: '' }, EU, AGORA);
    expect(m.t.nfce_emitente[0]).toMatchObject({ resp_tec_cnpj: null, resp_tec_contato: null, resp_tec_email: null, resp_tec_fone: null });
  });

  it('"quem conta no estoque": grava quem respondeu e quando; repetir a mesma resposta não troca o autor', async () => {
    const m = montar();
    await m.svc.salvarEmitente({ cupom_lanca_venda: true }, EU, AGORA);
    expect(m.t.nfce_emitente[0]).toMatchObject({
      cupom_lanca_venda: true,
      cupom_lanca_venda_por: EU.id,
      cupom_lanca_venda_por_nome: 'Diego',
      cupom_lanca_venda_em: AGORA,
    });
    const outro: Autor = { id: '77777777-7777-4777-8777-777777777777', nome: 'Rebeca' };
    await m.svc.salvarEmitente({ cupom_lanca_venda: true }, outro, new Date(AGORA.getTime() + 60_000));
    expect(m.t.nfce_emitente[0]).toMatchObject({ cupom_lanca_venda_por_nome: 'Diego', cupom_lanca_venda_em: AGORA });
    await m.svc.salvarEmitente({ cupom_lanca_venda: false }, outro, new Date(AGORA.getTime() + 60_000));
    expect(m.t.nfce_emitente[0]).toMatchObject({ cupom_lanca_venda: false, cupom_lanca_venda_por_nome: 'Rebeca' });
  });
});

describe('cadastro: situação', () => {
  it('sem nada cadastrado, `falta` traz ie, crt, endereco, serie, csc, certificado, cnpj e produto_pronto (modo de teste)', async () => {
    const m = montar({ cert: 'sem', cnpjEmpresa: '' });
    const r = await m.svc.situacao(AGORA);
    expect(r.falta.map((f) => f.codigo)).toEqual(['certificado', 'cnpj', 'ie', 'crt', 'endereco', 'serie', 'csc', 'produto_pronto']);
    expect(r.falta).toContainEqual({ codigo: 'serie', texto: 'Série e próximo número do modo de teste' });
    expect(r.falta).toContainEqual({ codigo: 'csc', texto: TEXTO_FALTA.csc('homologacao') });
    expect(r).toMatchObject({
      ambiente: 'homologacao',
      agora: AGORA,
      emissao_ligada: false,
      situacao: 'ok',
      serie: null,
      proximo_numero: 1,
      certificado: { ok: false, mensagem: MSG_USO.naoCadastrado },
      pendentes: { total: 0, primeiro: null },
    });
  });

  it('servidor valendo: entram também teste_homologacao, lanca_venda e series_outro_sistema (com os textos "valendo")', async () => {
    const m = montar({ ambiente: 'producao', cert: 'sem', cnpjEmpresa: '' });
    const r = await m.svc.situacao(AGORA);
    expect(r.falta.map((f) => f.codigo)).toEqual([
      'certificado',
      'cnpj',
      'ie',
      'crt',
      'endereco',
      'serie',
      'csc',
      'produto_pronto',
      'teste_homologacao',
      'lanca_venda',
      'series_outro_sistema',
    ]);
    expect(r.falta).toContainEqual({ codigo: 'serie', texto: 'Série e próximo número valendo' });
  });

  it('tudo cadastrado no modo de teste: falta vazia; o CSC que não abre com o segredo de agora volta a faltar', async () => {
    const m = montar();
    await completo(m);
    const r = await m.svc.situacao(AGORA);
    expect(r.falta).toEqual([]);
    expect(r.certificado).toEqual({ ok: true, mensagem: null });
    m.t.nfce_ambientes[0].csc_cifrado = cifrarCsc(CSC_TESTE, `${SEGREDO}-antigo`);
    expect((await m.svc.situacao(AGORA)).falta.map((f) => f.codigo)).toEqual(['csc']);
  });

  it('valendo: o teste no modo de teste conta só com este CNPJ; série igual à do caixa de hoje falta', async () => {
    const m = montar({ ambiente: 'producao' });
    await completo(m, 'producao');
    m.t.nfce_emitente[0].cupom_lanca_venda = true;
    m.t.nfce_emitente[0].series_outro_sistema = [2];
    // 35 + AAMM + CNPJ (posições 7 a 20) + 65 + série + número + tpEmis + cNF + DV = 44
    const chave = (cnpj: string, n: number) => `352611${cnpj}65002${String(n).padStart(9, '0')}1${'00000001'}0`;
    cupom(m.t, { ambiente: 'homologacao', numero: 1, situacao: 'cancelado', chave: chave('99888777000161', 1) }); // outro CNPJ
    let r = await m.svc.situacao(AGORA);
    expect(r.falta.map((f) => f.codigo)).toEqual(['teste_homologacao', 'series_outro_sistema']);
    cupom(m.t, { ambiente: 'homologacao', numero: 2, situacao: 'autorizado', chave: chave(CNPJ, 2) });
    expect((await m.svc.situacao(AGORA)).falta.map((f) => f.codigo)).toEqual(['teste_homologacao', 'series_outro_sistema']);
    cupom(m.t, { ambiente: 'homologacao', numero: 3, situacao: 'cancelado', chave: chave(CNPJ, 3) });
    m.t.nfce_emitente[0].series_outro_sistema = [1];
    r = await m.svc.situacao(AGORA);
    expect(r.falta).toEqual([]);
  });

  it('certificado de outra raiz de CNPJ não vale; servidor desligado devolve ambiente "desligado" e lê o valendo', async () => {
    const m = montar({ ambiente: '', cert: 'outra_raiz' });
    const r = await m.svc.situacao(AGORA);
    expect(r.ambiente).toBe('desligado');
    expect(r.emissao_ligada).toBe(false);
    expect(r.certificado.ok).toBe(false);
    expect(r.falta.map((f) => f.codigo)).toContain('certificado');
    expect(r.falta).toContainEqual({ codigo: 'serie', texto: 'Série e próximo número valendo' });
    expect(r.falta.map((f) => f.codigo)).not.toContain('teste_homologacao');
  });

  it('emissão ligada com outro CNPJ (a empresa trocou de CNPJ) = desligada, com o aviso da UX 5.1', async () => {
    const m = montar();
    Object.assign(m.t.nfce_ambientes[0], { serie: 2, emissao_ligada: true, ligada_cnpj: '11222333000181', ligada_serie: 2 });
    let r = await m.svc.situacao(AGORA);
    expect(r).toMatchObject({ emissao_ligada: false, mensagem: FRASES_CADASTRO.trioMudou });
    m.t.nfce_ambientes[0].ligada_cnpj = CNPJ;
    r = await m.svc.situacao(AGORA);
    expect(r).toMatchObject({ emissao_ligada: true, mensagem: null });
  });

  it('pendentes do ambiente: sem resposta, não saiu, recusado e venda pendente; o mais velho é o primeiro', async () => {
    const m = montar({ ambiente: 'producao' });
    const em = (min: number) => new Date(AGORA.getTime() - min * 60_000);
    const velho = cupom(m.t, { ambiente: 'producao', numero: 3, situacao: 'rejeitado', criado_em: em(50) });
    cupom(m.t, { ambiente: 'producao', numero: 4, situacao: 'sem_resposta', criado_em: em(40) });
    cupom(m.t, { ambiente: 'producao', numero: 5, situacao: 'autorizado', lanca_venda: true, criado_em: em(30) }); // venda pendente
    cupom(m.t, { ambiente: 'producao', numero: 6, situacao: 'autorizado', lanca_venda: true, venda_lancada_em: em(29), criado_em: em(30) });
    cupom(m.t, { ambiente: 'producao', numero: 7, situacao: 'cancelado', lanca_venda: true, venda_lancada_em: em(20), criado_em: em(25) });
    const enviando = cupom(m.t, { ambiente: 'producao', numero: 8, situacao: 'enviando', criado_em: em(1) });
    m.t.nfce_envios.push(
      linhaCom('nfce_envios', { ambiente: 'producao', cupom_id: enviando.id, servico: 'autorizacao', iniciada_em: em(0.5) }),
    );
    cupom(m.t, { ambiente: 'homologacao', numero: 1, situacao: 'rejeitado', criado_em: em(90) }); // outro ambiente
    const r = await m.svc.situacao(AGORA);
    expect(r.pendentes).toEqual({ total: 4, primeiro: { id: velho.id, serie: 2, numero: 3, tipo: 'recusado' } });
    // o "enviando" passa a sem resposta 2 min depois do envio
    expect((await m.svc.situacao(new Date(AGORA.getTime() + 2 * 60_000))).pendentes.total).toBe(5);
  });
});
