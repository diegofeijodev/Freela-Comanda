import { ClaudeLeitorPdf } from '../claude-leitor-pdf';
import { LeituraPdfErro, MSG, type LeitorPdf, type PedidoLeitura } from '../leitor-pdf.port';
import { iso, LeituraPdfService } from '../leitura-pdf.service';
import { INSTRUCOES_SUGESTAO_ITENS, SCHEMA_DDA, SCHEMA_NOTA_SUGESTAO, SCHEMA_SUGESTAO_ITENS } from '../schemas';
import type { PrismaService } from '../../../common/database/prisma.service';

/** Leitor falso: nenhum teste faz rede. Guarda o pedido para conferir esquema/instruções. */
class LeitorFalso implements LeitorPdf {
  pedidos: PedidoLeitura[] = [];
  constructor(private readonly resposta: unknown) {}
  configurado() {
    return true;
  }
  async ler(p: PedidoLeitura) {
    this.pedidos.push(p);
    return this.resposta;
  }
}

const prismaFalso = {
  itens_estoque: { findMany: async () => [{ id: 'i1', nome: 'Tomate', unidade: 'KG' }] },
  subgrupos: { findMany: async () => [{ nome: 'Hortifruti' }] },
} as unknown as PrismaService;
const servico = (l: LeitorPdf) => new LeituraPdfService(l, prismaFalso);
const PDF = [{ base64: 'JVBERi0=', mime: 'application/pdf' as const, nome: 'nf.pdf' }];

describe('leitura de PDF', () => {
  it('nota: usa o esquema do protótipo e corrige datas dd/mm/aaaa', async () => {
    const leitor = new LeitorFalso({
      chave: null,
      numero: '1',
      serie: '1',
      emitente_nome: 'X',
      emitente_cnpj: null,
      data_emissao: '20/10/2026',
      valor_total: 10,
      forma_pagamento: 'boleto',
      itens: [{ codigo: null, descricao: 'A', unidade: 'UN', quantidade: 1, valor_unitario: 10, valor_total: 10 }],
      parcelas: [{ numero: '1', vencimento: '20/11/2026', valor: 10 }],
    });
    const r = await servico(leitor).lerNota(PDF);
    expect(r.data_emissao).toBe('2026-10-20');
    expect(r.parcelas).toEqual([{ numero: '1', vencimento: '2026-11-20', valor: 10 }]);
    expect(leitor.pedidos[0]!.schema).toBe(SCHEMA_NOTA_SUGESTAO);
    expect(leitor.pedidos[0]!.arquivos).toEqual([{ base64: 'JVBERi0=', mime: 'application/pdf', nome: 'nf.pdf' }]);
  });

  it('nota: itens saem limpos, com o insumo indicado pela IA', async () => {
    const leitor = new LeitorFalso({
      data_emissao: '2026-10-20',
      itens: [{ codigo: null, descricao: 'TOMATE', unidade: 'KG', quantidade: 1, valor_unitario: 1, valor_total: 1, insumo: 'tomate', novo_nome: null, novo_unidade: null, novo_subgrupo: null, fator: 1 }],
    });
    const r = await servico(leitor).lerNota(PDF);
    expect(r.itens[0]).toMatchObject({ item_estoque_id: 'i1', novo: null, fator: 1 });
  });

  it('foto: 2 imagens seguem no pedido, junto com o catálogo', async () => {
    const leitor = new LeitorFalso({ itens: [] });
    const fotos = [
      { base64: 'AA', mime: 'image/jpeg' as const, nome: 'a.jpg' },
      { base64: 'BB', mime: 'image/png' as const, nome: 'b.png' },
    ];
    await servico(leitor).lerNota(fotos);
    expect(leitor.pedidos[0]!.arquivos).toHaveLength(2);
    expect(leitor.pedidos[0]!.pedido).toContain('- Tomate (KG)');
    expect(leitor.pedidos[0]!.pedido).toContain('Hortifruti');
  });

  it('foto sem itens: mensagem de foto', async () => {
    await expect(servico(new LeitorFalso({ foo: 1 })).lerNota([{ base64: 'AA', mime: 'image/jpeg', nome: 'a.jpg' }])).rejects.toEqual(
      new LeituraPdfErro('Não consegui identificar os dados desta foto.', 422, 'PDF_ILEGIVEL'),
    );
  });

  it('data de emissão ilegível vira ""; dd/mm/aaaa é convertida; vencimento inválido também vira ""', async () => {
    const nota = (data_emissao: string, venc = '2026-11-20') => new LeitorFalso({ data_emissao, itens: [], parcelas: [{ numero: '1', vencimento: venc, valor: 1 }] });
    const a = await servico(nota('ilegível', '31/02/2026')).lerNota(PDF);
    expect(a.data_emissao).toBe('');
    expect(a.parcelas).toEqual([{ numero: '1', vencimento: '', valor: 1 }]);
    expect((await servico(nota('31/12/2026')).lerNota(PDF)).data_emissao).toBe('2026-12-31');
  });

  it('chave: normaliza, confere o DV e só devolve se for válida; senão null', async () => {
    const lida = async (chave: unknown) => ((await servico(new LeitorFalso({ chave, data_emissao: '2026-10-20', itens: [] })).lerNota(PDF)) as { chave?: unknown }).chave;
    expect(await lida('35 2610 1234 5678 0001 9955 0010 0000 7001 1000 0700 19')).toBe('35261012345678000199550010000070011000070019');
    expect(await lida('35261012345678000199550010000070011000070011')).toBeNull();
    expect(await lida('35261112abc34501de35550010000044111000044116')).toBe('35261112ABC34501DE35550010000044111000044116');
    expect(await lida('3526101234567800019955001000007001100007001')).toBeNull();
    expect(await lida(null)).toBeNull();
  });

  it('emitente_cnpj: normalizado (letras maiúsculas, sem pontuação) ou null', async () => {
    const lido = async (emitente_cnpj: unknown) => ((await servico(new LeitorFalso({ emitente_cnpj, data_emissao: '2026-10-20', itens: [] })).lerNota(PDF)) as { emitente_cnpj?: unknown }).emitente_cnpj;
    expect(await lido('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(await lido('')).toBeNull();
  });

  it('DDA: devolve a lista de boletos', async () => {
    const leitor = new LeitorFalso({ boletos: [{ beneficiario: 'B', cnpj: null, vencimento: '2026-11-10T00:00', valor: 5, linha_digitavel: null }] });
    const r = await servico(leitor).lerDDA('JVBERi0=', '');
    expect(r).toEqual([{ beneficiario: 'B', cnpj: null, vencimento: '2026-11-10', valor: 5, linha_digitavel: null }]);
    expect(leitor.pedidos[0]!.schema).toBe(SCHEMA_DDA);
    expect(leitor.pedidos[0]!.arquivos).toEqual([{ base64: 'JVBERi0=', mime: 'application/pdf', nome: 'dda.pdf' }]);
  });

  it('resposta sem itens vira a mensagem de PDF ilegível', async () => {
    await expect(servico(new LeitorFalso({ foo: 1 })).lerNota(PDF)).rejects.toThrow(
      'Não consegui identificar os dados deste PDF.',
    );
  });

  it('sem chave: "Leitura de PDF não configurada" sem chamar a rede', async () => {
    const leitor = new ClaudeLeitorPdf('', 'claude-opus-5-5');
    expect(leitor.configurado()).toBe(false);
    await expect(leitor.ler({} as PedidoLeitura)).rejects.toEqual(new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO'));
  });

  it('iso do protótipo', () => {
    expect(iso('05/03/2026')).toBe('2026-03-05');
    expect(iso('2026-03-05T10:00:00')).toBe('2026-03-05');
    expect(iso(null)).toBe('');
  });
});

describe('sugerirInsumos', () => {
  const linhas = [{ descricao: 'TOMATE ITALIANO', unidade: 'KG' }, { descricao: 'SACOLA PLASTICA', unidade: 'un' }, { descricao: 'FRETE' }];
  const resposta = {
    itens: [
      { indice: 2, insumo: null, novo_nome: 'Sacola plástica', novo_unidade: 'un', novo_subgrupo: 'hortifruti', fator: 0 },
      { indice: 1, insumo: 'tomate', novo_nome: null, novo_unidade: null, novo_subgrupo: null, fator: 1 },
    ],
  };

  it('pedido só de texto, com catálogo e linhas numeradas; resposta casada por índice e limpa', async () => {
    const leitor = new LeitorFalso(resposta);
    const r = await servico(leitor).sugerirInsumos(linhas);
    const p = leitor.pedidos[0]!;
    expect(p.arquivos).toEqual([]);
    expect(p.schema).toBe(SCHEMA_SUGESTAO_ITENS);
    expect(p.instrucoes).toBe(INSTRUCOES_SUGESTAO_ITENS);
    expect(p.pedido).toContain('- Tomate (KG)');
    expect(p.pedido).toContain('1. TOMATE ITALIANO (KG)');
    expect(r).toEqual({
      itens: [
        { item_estoque_id: 'i1', novo: null, fator: 1 },
        { item_estoque_id: null, novo: { nome: 'Sacola plástica', unidade: 'UN', subgrupo: 'Hortifruti' }, fator: 1 },
        { item_estoque_id: null, novo: { nome: 'FRETE', unidade: 'UN', subgrupo: null }, fator: 1 },
      ],
    });
  });

  it('nada além de descrição e unidade vai para a IA', async () => {
    const leitor = new LeitorFalso(resposta);
    await servico(leitor).sugerirInsumos([{ descricao: 'TOMATE', unidade: 'KG', valor_total: 99, fornecedor_cnpj: '12345678000195' } as never]);
    expect(leitor.pedidos[0]!.pedido).not.toMatch(/99|12345678000195/);
  });

  it('resposta sem itens em array: 422 SUGESTAO_ILEGIVEL', async () => {
    await expect(servico(new LeitorFalso({ foo: 1 })).sugerirInsumos(linhas)).rejects.toMatchObject({
      message: 'Não consegui sugerir os insumos desta nota.',
      status: 422,
      code: 'SUGESTAO_ILEGIVEL',
    });
  });

  it('erro do leitor (503 sem chave) passa como está', async () => {
    const leitor: LeitorPdf = {
      ler: async () => {
        throw new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO');
      },
    };
    await expect(servico(leitor).sugerirInsumos(linhas)).rejects.toMatchObject({ status: 503, code: 'PDF_NAO_CONFIGURADO' });
  });
});
