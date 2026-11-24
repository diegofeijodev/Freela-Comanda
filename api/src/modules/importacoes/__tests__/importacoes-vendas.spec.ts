import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../../common/auth/auth-user';
import type { PrismaService } from '../../../common/database/prisma.service';
import { dayToDb } from '../../../common/time/dates';
import type { VendasConfirmarDto, VendasImportacaoDto } from '../dto/vendas-importacao.dto';
import { ImportacoesVendasService } from '../importacoes-vendas.service';
import { NOME_CUPOM, NOME_PADRAO } from '../previa';

// Importar vendas (desenho 24/11, A.8): a prévia nunca grava; o confirmar roda numa transação, na ordem do desenho, depois da trava;
// a mesma chave com o mesmo corpo devolve o resultado guardado; o Substituir só apaga a fonte própria.

const ADMIN: AuthUser = { id: 'u-1', email: 'a@x', nome: 'Diego', perfil: 'admin' };
const ORIGEM = {
  id: '11111111-1111-4111-8111-111111111111',
  nome: 'PDV Valinhos',
  formato_padrao: 'planilha',
  mapeamento: { pedido: 'Nº', data: 'Data', produto: 'Descrição', quantidade: 'Qtde', valor_total: 'Total' },
  separador_decimal: 'virgula',
  prefixo_pedido: '',
  ativo: true,
};
const LOJA = '12345678000195';

function chave(cnpj: string, numero: number): string {
  return chaveCom(cnpj, numero, '12345678');
}
function chaveCom(cnpj: string, numero: number, cnf: string): string {
  const base = `352611${cnpj}65001${String(numero).padStart(9, '0')}1${cnf}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return base + String(r < 2 ? 0 : 11 - r);
}

function montar(
  o: { porFonte?: unknown[]; existentes?: Map<string, unknown>; registrados?: Map<string, string>; guardada?: unknown } = {},
) {
  const ordem: string[] = [];
  const marca =
    <T>(nome: string, r: T) =>
    (...a: unknown[]) => {
      ordem.push(nome);
      void a;
      return Promise.resolve(r);
    };
  const tx = {
    $executeRaw: jest.fn(marca('trava', 1)),
    $queryRaw: jest.fn(marca('cancelar', [{ n: 3 }])),
    importacoes: {
      findUnique: jest.fn(marca('idempotencia', o.guardada ?? null)),
      create: jest.fn(marca('importacao', { id: 'imp-1', created_at: new Date('2026-11-24T21:00:00Z') })),
      update: jest.fn(marca('resultado', {})),
    },
    vendas_origens: { update: jest.fn(marca('mapeamento', {})) },
    itens_cardapio: { findMany: jest.fn(marca('cardapio-ids', [{ id: '22222222-2222-4222-8222-222222222222' }])) },
    de_para_produtos: { createMany: jest.fn(marca('de-para', { count: 1 })) },
    vendas_documentos: {
      createManyAndReturn: jest.fn((a: { data: { chave: string }[] }) => {
        ordem.push('documentos');
        return Promise.resolve(a.data.map((d, i) => ({ id: `doc-${i}`, chave: d.chave })));
      }),
    },
    vendas: {
      deleteMany: jest.fn(marca('substituir', { count: 4 })),
      createMany: jest.fn((a: { data: unknown[] }) => {
        ordem.push('vendas');
        return Promise.resolve({ count: a.data.length });
      }),
    },
  };
  const fatos = {
    existentes: jest.fn(async () => o.existentes ?? new Map()),
    porFonte: jest.fn(async () => o.porFonte ?? []),
    arquivoJaImportado: jest.fn(async () => null),
    dePara: jest.fn(async () => new Map()),
    cardapio: jest.fn(async () => []),
    origem: jest.fn(async (id: string) => (id === ORIGEM.id ? ORIGEM : null)),
    cnpjLoja: jest.fn(async () => LOJA),
    empresas: jest.fn(async () => new Map()),
    registrados: jest.fn(async () => o.registrados ?? new Map()),
    doComanda: jest.fn(async () => new Map<string, string>()),
    vendasDosDocumentos: jest.fn(async (cs: string[]) => ({
      documentos: cs.length,
      linhas: 3,
      valor_centavos: 8750,
      ini: '2026-11-05',
      fim: '2026-11-12',
    })),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const svc = new ImportacoesVendasService(prisma as unknown as PrismaService);
  jest.spyOn(svc as unknown as { fatos: () => unknown }, 'fatos').mockReturnValue(fatos);
  return { svc, tx, fatos, ordem, prisma };
}

const planilha = (extra: Partial<VendasConfirmarDto> = {}): VendasConfirmarDto =>
  ({
    formato: 'planilha',
    origem_id: ORIGEM.id,
    arquivo: 'vendas-novembro.csv',
    modo: 'acrescentar',
    linhas_brutas: [
      { Nº: '1001', Data: '20/11/2026', Descrição: 'Caldo 300', Qtde: '2', Total: '20,00' },
      { Nº: '1002', Data: '21/11/2026', Descrição: 'Pastel', Qtde: '1', Total: '8,50' },
    ],
    chave_idempotencia: '33333333-3333-4333-8333-333333333333',
    ...extra,
  }) as VendasConfirmarDto;

const ESCRITAS = ['importacao', 'mapeamento', 'de-para', 'documentos', 'cancelar', 'substituir', 'vendas', 'resultado'];
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const r = (e as { getResponse?: () => unknown; getStatus?: () => number }).getResponse?.() as { code?: string; message?: string };
    return { status: (e as { getStatus: () => number }).getStatus(), ...r };
  }
  throw new Error('não falhou');
};

describe('prévia', () => {
  it('não grava nada e devolve a conta', async () => {
    const { svc, ordem } = montar();
    const p = await svc.previa(planilha() as VendasImportacaoDto, '2026-11-24');
    expect(ordem.filter((x) => ESCRITAS.includes(x))).toEqual([]);
    expect(p.linhas).toMatchObject({ lidas: 2, novas: 2 });
    expect(p.valor_centavos).toBe(2850);
  });
  it('mapeamento incompleto = 400 MAPEAMENTO_INCOMPLETO com os campos', async () => {
    const { svc } = montar();
    const e = await erro(svc.previa(planilha({ mapeamento: { data: 'Data', produto: 'Descrição' } }) as VendasImportacaoDto, '2026-11-24'));
    expect(e).toMatchObject({ status: 400, code: 'MAPEAMENTO_INCOMPLETO', message: 'Escolha a coluna de: quantidade, valor total.' });
  });
  it('origem inexistente = 404 ORIGEM_NAO_ENCONTRADA; planilha padrão só aceita planilha; XML não tem Substituir', async () => {
    const { svc } = montar();
    expect(
      await erro(svc.previa(planilha({ origem_id: '44444444-4444-4444-8444-444444444444' }) as VendasImportacaoDto, '2026-11-24')),
    ).toMatchObject({
      status: 404,
      code: 'ORIGEM_NAO_ENCONTRADA',
    });
    expect(
      await erro(svc.previa(planilha({ origem_id: null, formato: 'pdf', linhas: [] }) as VendasImportacaoDto, '2026-11-24')),
    ).toMatchObject({
      status: 400,
    });
    expect(
      await erro(
        svc.previa(
          { ...planilha(), formato: 'xml', modo: 'substituir', documentos: [], arquivos_lidos: 0 } as VendasImportacaoDto,
          '2026-11-24',
        ),
      ),
    ).toMatchObject({
      status: 400,
    });
  });
});

describe('confirmar', () => {
  it('ordem da transação: trava → idempotência → importação → mapeamento → de-para → vendas → resultado', async () => {
    const { svc, ordem, tx } = montar();
    const r = await svc.confirmar(planilha({ salvar_mapeamento: true, mapeamento: ORIGEM.mapeamento }), ADMIN, '2026-11-24');
    expect(ordem.filter((x) => x !== 'cardapio-ids')).toEqual([
      'trava',
      'idempotencia',
      'importacao',
      'mapeamento',
      'de-para',
      'vendas',
      'resultado',
    ]);
    expect(r.repetida).toBe(false);
    expect(r.resultado).toMatchObject({
      importacao_id: 'imp-1',
      inseridas: 2,
      ignoradas: 0,
      apagadas: 0,
      valor_centavos: 2850,
      periodo: { ini: '2026-11-20', fim: '2026-11-21' },
      novos_produtos: 2,
      mapeamento_salvo: true,
    });
    expect(tx.importacoes.create.mock.calls[0]![0]).toMatchObject({
      data: {
        tipo: 'vendas',
        origem_id: ORIGEM.id,
        formato: 'planilha',
        chave_idempotencia: '33333333-3333-4333-8333-333333333333',
        usuario_id: 'u-1',
      },
    });
    const vendas = (tx.vendas.createMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data;
    expect(vendas[0]).toMatchObject({ pedido: '1001', data: dayToDb('2026-11-20'), importacao_id: 'imp-1', documento_id: null });
    expect(Prisma.Decimal.isDecimal(vendas[0]!.valor_total)).toBe(true);
  });

  it('Substituir por origem (R3) apaga só as vendas deste sistema no período, sem cupom e sem XML', async () => {
    const { svc, tx } = montar({
      porFonte: [{ chave: `sistema:${ORIGEM.id}`, nome: ORIGEM.nome, tipo: 'sistema', vendas: 4, valor_centavos: 9900 }],
    });
    const r = await svc.confirmar(planilha({ modo: 'substituir' }), ADMIN, '2026-11-24');
    expect(tx.vendas.deleteMany).toHaveBeenCalledWith({
      where: {
        nfce_cupom_id: null,
        documento_id: null,
        importacoes: { is: { origem_id: ORIGEM.id } },
        data: { gte: dayToDb('2026-11-20'), lte: dayToDb('2026-11-21') },
      },
    });
    expect(r.resultado).toMatchObject({ apagadas: 4, apagadas_valor_centavos: 9900 });
  });

  it('Substituir da planilha padrão (R4) usa o mesmo filtro da rota antiga', async () => {
    const { svc, tx } = montar();
    await svc.confirmar(
      planilha({
        origem_id: null,
        modo: 'substituir',
        linhas_brutas: [{ pedido: 'P1', data: '2026-11-20', produto_relatorio: 'X', quantidade: '1', valor_total: '5' }],
      }),
      ADMIN,
      '2026-11-24',
    );
    expect(tx.vendas.deleteMany).toHaveBeenCalledWith({
      where: {
        nfce_cupom_id: null,
        documento_id: null,
        OR: [{ importacao_id: null }, { importacoes: { is: { origem_id: null } } }],
        data: { gte: dayToDb('2026-11-20'), lte: dayToDb('2026-11-20') },
      },
    });
  });

  it('R5: período com venda de outra fonte e sem confirmar_sobreposicao = 409, nada gravado', async () => {
    const { svc, ordem } = montar({ porFonte: [{ chave: 'cupom', nome: NOME_CUPOM, tipo: 'cupom', vendas: 2, valor_centavos: 3200 }] });
    expect(await erro(svc.confirmar(planilha(), ADMIN, '2026-11-24'))).toMatchObject({ status: 409, code: 'IMPORTACAO_SOBREPOSICAO' });
    expect(ordem.filter((x) => ESCRITAS.includes(x))).toEqual([]);
    const ok = montar({ porFonte: [{ chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao', vendas: 2, valor_centavos: 3200 }] });
    expect((await ok.svc.confirmar(planilha({ confirmar_sobreposicao: true }), ADMIN, '2026-11-24')).resultado.inseridas).toBe(2);
  });

  it('R8: mesma chave e mesmo corpo devolve o resultado guardado (sem gravar); corpo diferente = 409 IMPORTACAO_JA_CONFIRMADA', async () => {
    const primeiro = montar();
    await primeiro.svc.confirmar(planilha(), ADMIN, '2026-11-24');
    const guardado = primeiro.tx.importacoes.update.mock.calls[0]![0] as { data: { resultado: unknown } };
    const corpo = (primeiro.tx.importacoes.create.mock.calls[0]![0] as { data: { corpo_sha256: string } }).data.corpo_sha256;
    expect(corpo).toMatch(/^[0-9a-f]{64}$/);
    const guardada = { id: 'imp-1', corpo_sha256: corpo, resultado: guardado.data.resultado, created_at: new Date('2026-11-24T21:10:00Z') };

    const de_novo = montar({ guardada });
    const r = await de_novo.svc.confirmar(planilha({ confirmar_sobreposicao: true }), ADMIN, '2026-11-24');
    expect(r.repetida).toBe(true);
    expect(r.resultado).toEqual(guardado.data.resultado);
    expect(de_novo.ordem.filter((x) => ESCRITAS.includes(x))).toEqual([]);

    const outro = montar({ guardada });
    const linhas_brutas = [{ Nº: '9', Data: '20/11/2026', Descrição: 'X', Qtde: '1', Total: '1' }];
    expect(await erro(outro.svc.confirmar(planilha({ linhas_brutas }), ADMIN, '2026-11-24'))).toMatchObject({
      status: 409,
      code: 'IMPORTACAO_JA_CONFIRMADA',
    });
  });

  it('nada novo e nada a cancelar = 400 IMPORTACAO_VAZIA', async () => {
    const { svc } = montar();
    const e = await erro(
      svc.confirmar(
        planilha({ linhas_brutas: [{ Nº: '1', Data: '31/02/2026', Descrição: 'X', Qtde: '1', Total: '1' }] }),
        ADMIN,
        '2026-11-24',
      ),
    );
    expect(e).toMatchObject({
      status: 400,
      code: 'IMPORTACAO_VAZIA',
      message: 'Nenhuma venda válida no arquivo. Confira as colunas de Data e Quantidade.',
    });
  });

  it('de-para novo: item do cardápio que não existe = 400', async () => {
    const { svc, tx } = montar();
    tx.itens_cardapio.findMany.mockResolvedValueOnce([]);
    const e = await erro(
      svc.confirmar(
        planilha({ de_para_novos: [{ produto_relatorio: 'Caldo 300', item_cardapio_id: '55555555-5555-4555-8555-555555555555' }] }),
        ADMIN,
        '2026-11-24',
      ),
    );
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});

describe('confirmar XML', () => {
  const xml = (documentos: unknown[], cancelamentos: unknown[] = []) =>
    ({
      formato: 'xml',
      origem_id: ORIGEM.id,
      arquivo: 'xml-novembro.zip',
      modo: 'acrescentar',
      arquivos_lidos: documentos.length + cancelamentos.length,
      documentos,
      cancelamentos,
      ignorados: [],
      chave_idempotencia: '66666666-6666-4666-8666-666666666666',
    }) as unknown as VendasConfirmarDto;
  const doc = (n: number) => ({
    arquivo: `NFCe-${n}.xml`,
    chave: chave(LOJA, n),
    modelo: 65,
    serie: 1,
    numero: n,
    emitente_cnpj: LOJA,
    tp_amb: 1,
    dh_emi: '2026-11-20T14:30:00-03:00',
    valor_total: '22.65',
    itens: [
      {
        produto: 'CALDO 300ML',
        quantidade: '2',
        valor_unitario: '12.00',
        valor_bruto: '24.00',
        desconto: '1.35',
        outros: '0',
        frete: '0',
        cfop: '5102',
      },
    ],
  });

  it('documento novo: registra o documento antes das vendas e liga a venda ao documento', async () => {
    const { svc, ordem, tx } = montar();
    const r = await svc.confirmar(xml([doc(12)]), ADMIN, '2026-11-24');
    expect(ordem.filter((x) => x !== 'cardapio-ids')).toEqual([
      'trava',
      'idempotencia',
      'importacao',
      'de-para',
      'documentos',
      'vendas',
      'resultado',
    ]);
    const v = (tx.vendas.createMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    expect(v).toMatchObject({ pedido: 'NFC-e 1-12', documento_id: 'doc-0', produto_relatorio: 'CALDO 300ML' });
    expect(String(v.valor_total)).toBe('22.65');
    expect(r.resultado).toMatchObject({ inseridas: 1, documentos_novos: 1, valor_centavos: 2265 });
  });

  it('só cancelamentos (de cupom já importado): não é IMPORTACAO_VAZIA; aplica vendas_documento_cancelar', async () => {
    const c = chave(LOJA, 20);
    const { svc, ordem, tx } = montar({ registrados: new Map([[c, 'autorizada']]) });
    const r = await svc.confirmar(
      xml([], [{ arquivo: 'canc.xml', chave: c, dh_evento: '2026-11-21T10:00:00-03:00' }]),
      ADMIN,
      '2026-11-24',
    );
    expect(ordem).toContain('cancelar');
    expect(tx.vendas.createMany).not.toHaveBeenCalled();
    expect(r.resultado).toMatchObject({ inseridas: 0, canceladas: { documentos: 1, linhas: 3, valor_centavos: 8750 } });
  });

  it('cancelamento de cupom que nunca veio por XML, com vendas de planilha nos dias dele: a prévia avisa com as fontes (a planilha não é corrigida)', async () => {
    const c = chave(LOJA, 40);
    const { svc, fatos } = montar({
      porFonte: [
        { chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao', vendas: 40, valor_centavos: 120000 },
        { chave: 'cupom', nome: NOME_CUPOM, tipo: 'cupom', vendas: 2, valor_centavos: 3200 },
        { chave: `xml:${ORIGEM.id}`, nome: 'XML de PDV Valinhos', tipo: 'xml', vendas: 9, valor_centavos: 9900 },
      ],
    });
    const p = await svc.previa(
      xml([], [{ arquivo: 'canc-40.xml', chave: c, dh_evento: '2026-11-21T10:00:00-03:00' }]) as VendasImportacaoDto,
      '2026-11-24',
    );
    expect(fatos.porFonte).toHaveBeenCalledWith('2026-11-21', '2026-11-21');
    expect(p.documentos?.cancelamentos_sem_venda_xml).toEqual({
      documentos: 1,
      ini: '2026-11-21',
      fim: '2026-11-21',
      fontes: [{ fonte: NOME_PADRAO, tipo: 'padrao', vendas: 40, valor_centavos: 120000 }],
    });
  });

  it('cancelamento de cupom já importado por XML: sem o aviso da planilha', async () => {
    const c = chave(LOJA, 20);
    const { svc, fatos } = montar({ registrados: new Map([[c, 'autorizada']]) });
    const p = await svc.previa(xml([], [{ arquivo: 'canc.xml', chave: c, dh_evento: null }]) as VendasImportacaoDto, '2026-11-24');
    expect(fatos.porFonte).not.toHaveBeenCalled();
    expect(p.documentos?.cancelamentos_sem_venda_xml).toEqual({ documentos: 0, ini: null, fim: null, fontes: [] });
  });

  it('dois documentos novos com o mesmo pedido e chaves diferentes = 400 VALIDATION_ERROR com os arquivos', async () => {
    const { svc } = montar();
    const a = doc(61);
    const b = { ...doc(61), arquivo: 'NFCe-61-b.xml', chave: chaveCom(LOJA, 61, '99999999') };
    const e = await erro(svc.previa(xml([a, b]) as VendasImportacaoDto, '2026-11-24'));
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(e.message).toContain('NFCe-61.xml e NFCe-61-b.xml');
  });

  it('sem CNPJ da loja = 400 LOJA_SEM_CNPJ', async () => {
    const { svc, fatos } = montar();
    fatos.cnpjLoja.mockResolvedValueOnce('');
    expect(await erro(svc.previa(xml([doc(12)]) as VendasImportacaoDto, '2026-11-24'))).toMatchObject({
      status: 400,
      code: 'LOJA_SEM_CNPJ',
      message: 'Cadastre o CNPJ da empresa principal em Empresas antes de importar XML.',
    });
  });

  it('chave com DV errado = 400 VALIDATION_ERROR', async () => {
    const { svc } = montar();
    const d = doc(12);
    d.chave = d.chave.slice(0, 43) + String((Number(d.chave[43]) + 1) % 10);
    expect(await erro(svc.previa(xml([d]) as VendasImportacaoDto, '2026-11-24'))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
