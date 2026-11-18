import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DescartarCupomDto,
  EmitirCupomDto,
  ItemDoCupomDto,
  LigarEmissaoDto,
  PagamentoDoCupomDto,
  PerfilEmLoteDto,
  PerfilFiscalDto,
  SalvarAmbienteDto,
  SalvarEmitenteDto,
  SalvarProdutoDto,
} from '../cupom-fiscal.dto';
import { FRASES_EMISSAO } from '../frases';
import { FRASES_CADASTRO } from '../frases-cadastro';

// Como o ValidationPipe global (whitelist + forbidNonWhitelisted + transform).
const erros = <T extends object>(cls: new () => T, o: unknown) =>
  validateSync(plainToInstance(cls, o) as object, { whitelist: true, forbidNonWhitelisted: true });
const frases = (e: ReturnType<typeof erros>) => e.flatMap((x) => [...Object.values(x.constraints ?? {}), ...frasesFilhas(x.children)]);
const frasesFilhas = (c: ReturnType<typeof erros> | undefined): string[] => (c ?? []).flatMap((x) => frases([x]));
const uuid = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;

describe('PerfilEmLoteDto (PUT produtos/perfil)', () => {
  it('1 a 500 itens passam; 501 e 0 falham com a frase', () => {
    expect(erros(PerfilEmLoteDto, { itens: [uuid(1)], perfil_fiscal_id: uuid(9) })).toHaveLength(0);
    expect(erros(PerfilEmLoteDto, { itens: Array.from({ length: 500 }, (_, n) => uuid(n)), perfil_fiscal_id: uuid(9) })).toHaveLength(0);
    for (const itens of [Array.from({ length: 501 }, (_, n) => uuid(n)), []]) {
      const e = erros(PerfilEmLoteDto, { itens, perfil_fiscal_id: uuid(9) });
      expect(e.map((x) => x.property)).toEqual(['itens']);
      expect(frases(e)).toContain(FRASES_CADASTRO.loteTamanho);
    }
  });
  it('id malformado, perfil ausente e campo a mais falham', () => {
    expect(erros(PerfilEmLoteDto, { itens: ['x'], perfil_fiscal_id: uuid(9) }).map((x) => x.property)).toEqual(['itens']);
    expect(erros(PerfilEmLoteDto, { itens: [uuid(1)] }).map((x) => x.property)).toEqual(['perfil_fiscal_id']);
    expect(erros(PerfilEmLoteDto, { itens: [uuid(1)], perfil_fiscal_id: uuid(9), extra: 1 }).length).toBeGreaterThan(0);
  });
});

describe('SalvarAmbienteDto (PUT ambientes/:ambiente)', () => {
  it('série, próximo número, IdCSC e CSC são opcionais; o CSC cifrado e a dica não entram pelo fio', () => {
    expect(erros(SalvarAmbienteDto, {})).toHaveLength(0);
    expect(erros(SalvarAmbienteDto, { serie: 2, proximo_numero: 1, id_csc: 1, csc: 'CSCTESTE0123456789ABCDEF' })).toHaveLength(0);
    for (const extra of ['csc_cifrado', 'csc_dica', 'emissao_ligada', 'situacao']) {
      expect(erros(SalvarAmbienteDto, { [extra]: 'x' }).map((x) => x.property)).toEqual([extra]);
    }
  });
  it('texto onde vai número falha (a faixa é do serviço, com 422)', () => {
    expect(erros(SalvarAmbienteDto, { serie: '2' }).map((x) => x.property)).toEqual(['serie']);
    expect(erros(SalvarAmbienteDto, { proximo_numero: '7' }).map((x) => x.property)).toEqual(['proximo_numero']);
    expect(erros(SalvarAmbienteDto, { serie: 890, proximo_numero: 0 })).toHaveLength(0);
  });
});

describe('SalvarEmitenteDto (PUT emitente)', () => {
  it('UF, CNPJ e razão social não entram (o CNPJ é da aba Geral; a UF é SP)', () => {
    for (const extra of ['uf', 'cnpj', 'razao_social', 'atualizado_por']) {
      expect(erros(SalvarEmitenteDto, { [extra]: 'x' }).map((x) => x.property)).toEqual([extra]);
    }
  });
  it('regime fora de 1–4 falha com a frase; séries têm de ser números', () => {
    expect(frases(erros(SalvarEmitenteDto, { crt: 5 }))).toContain(FRASES_CADASTRO.crt);
    expect(
      erros(SalvarEmitenteDto, { crt: 3, series_outro_sistema: [1, 2], sem_outro_sistema: false, cupom_lanca_venda: true }),
    ).toHaveLength(0);
    expect(erros(SalvarEmitenteDto, { series_outro_sistema: ['1'] }).map((x) => x.property)).toEqual(['series_outro_sistema']);
    expect(erros(SalvarEmitenteDto, { cupom_lanca_venda: 'sim' }).map((x) => x.property)).toEqual(['cupom_lanca_venda']);
  });
});

describe('PerfilFiscalDto (POST perfis)', () => {
  it('nome e CFOP obrigatórios; alíquota em número vira texto', () => {
    expect(frases(erros(PerfilFiscalDto, { cfop: '5102' }))).toContain(FRASES_CADASTRO.perfilSemNome);
    const d = plainToInstance(PerfilFiscalDto, { nome: 'A', cfop: '5102', cst_icms: '00', aliq_icms: 18 });
    expect(d.aliq_icms).toBe('18');
    expect(validateSync(d, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(frases(erros(PerfilFiscalDto, { nome: 'x'.repeat(61), cfop: '5102' }))).toContain(FRASES_CADASTRO.perfilNomeLongo);
  });
});

describe('SalvarProdutoDto (PUT produtos/:itemCardapioId)', () => {
  it('perfil malformado e origem em texto falham; tudo opcional', () => {
    expect(erros(SalvarProdutoDto, {})).toHaveLength(0);
    expect(erros(SalvarProdutoDto, { ncm: '1602.50.00', perfil_fiscal_id: null, origem: 0 })).toHaveLength(0);
    expect(erros(SalvarProdutoDto, { perfil_fiscal_id: 'x' }).map((x) => x.property)).toEqual(['perfil_fiscal_id']);
    expect(erros(SalvarProdutoDto, { origem: '2' }).map((x) => x.property)).toEqual(['origem']);
    expect(erros(SalvarProdutoDto, { preco_venda: 10 }).map((x) => x.property)).toEqual(['preco_venda']);
  });
});

describe('peças do corpo da emissão (preparadas para a Tarefa 11)', () => {
  it('quantidade: texto com ponto, até 4 casas e maior que zero (frase do Review Focus 1)', () => {
    for (const quantidade of ['1', '0.350', '2.5', '9999999.9999']) {
      expect(erros(ItemDoCupomDto, { item_cardapio_id: uuid(1), quantidade })).toHaveLength(0);
    }
    for (const quantidade of ['0,350', '0', '-1', '1.23456', '', ' 1', 1, '0.0000']) {
      const e = erros(ItemDoCupomDto, { item_cardapio_id: uuid(1), quantidade });
      expect(frases(e)).toEqual([FRASES_CADASTRO.quantidade]);
    }
  });
  it('pagamento: forma da lista (01, 03, 04, 10, 11, 17) e valor em centavos inteiros > 0', () => {
    for (const t_pag of ['01', '03', '04', '10', '11', '17']) {
      expect(erros(PagamentoDoCupomDto, { t_pag, valor_centavos: 1 })).toHaveLength(0);
    }
    expect(frases(erros(PagamentoDoCupomDto, { t_pag: '99', valor_centavos: 100 }))).toEqual([FRASES_CADASTRO.tPag]);
    for (const valor_centavos of [0, -1, 1.5, '100']) {
      expect(frases(erros(PagamentoDoCupomDto, { t_pag: '01', valor_centavos }))).toContain(FRASES_CADASTRO.valorPagamento);
    }
  });
});

describe('EmitirCupomDto (POST cupons)', () => {
  const corpo = (o: Record<string, unknown> = {}) => ({
    chave_idempotencia: uuid(7),
    itens: [{ item_cardapio_id: uuid(1), quantidade: '0.350' }],
    desconto_centavos: 0,
    pagamentos: [{ t_pag: '17', valor_centavos: 1000 }],
    consumidor_doc: '529.982.247-25',
    total_esperado_centavos: 1000,
    ...o,
  });
  it('o corpo do desenho passa; desconto e documento são opcionais', () => {
    expect(erros(EmitirCupomDto, corpo())).toHaveLength(0);
    const { desconto_centavos: _d, consumidor_doc: _c, ...minimo } = corpo();
    expect(erros(EmitirCupomDto, minimo)).toHaveLength(0);
  });
  it('itens e pagamentos são conferidos um a um (aninhados): "0,350" e valor 0 falham com a frase', () => {
    const q = erros(EmitirCupomDto, corpo({ itens: [{ item_cardapio_id: uuid(1), quantidade: '0,350' }] }));
    expect(q.map((x) => x.property)).toEqual(['itens']);
    expect(frases(q)).toEqual([FRASES_CADASTRO.quantidade]);
    const p = erros(EmitirCupomDto, corpo({ pagamentos: [{ t_pag: '01', valor_centavos: 0 }] }));
    expect(frases(p)).toContain(FRASES_CADASTRO.valorPagamento);
    expect(frases(erros(EmitirCupomDto, corpo({ pagamentos: [] })))).toContain(FRASES_CADASTRO.tPag);
  });
  it('lista de itens vazia passa (o serviço responde 400 NFCE_SEM_ITENS); itens que não é lista falha', () => {
    expect(erros(EmitirCupomDto, corpo({ itens: [] }))).toHaveLength(0);
    expect(erros(EmitirCupomDto, corpo({ itens: 'x' })).map((x) => x.property)).toEqual(['itens']);
  });
  it('centavos inteiros de 0 em diante; chave da venda uuid; campo a mais (preço, entrega) é recusado', () => {
    expect(frases(erros(EmitirCupomDto, corpo({ total_esperado_centavos: 10.5 })))).toContain(FRASES_EMISSAO.valorEmCentavos);
    expect(frases(erros(EmitirCupomDto, corpo({ desconto_centavos: -1 })))).toContain(FRASES_EMISSAO.valorEmCentavos);
    expect(frases(erros(EmitirCupomDto, corpo({ chave_idempotencia: 'x' })))).toContain(FRASES_EMISSAO.chaveDaVenda);
    expect(erros(EmitirCupomDto, corpo({ entrega: 'digital' })).map((x) => x.property)).toEqual(['entrega']);
    const comPreco = corpo({ itens: [{ item_cardapio_id: uuid(1), quantidade: '1', preco_centavos: 1 }] });
    expect(erros(EmitirCupomDto, comPreco).map((x) => x.property)).toEqual(['itens']);
  });
});

describe('DescartarCupomDto e LigarEmissaoDto', () => {
  it('motivo opcional no DTO (o serviço responde NFCE_MOTIVO); ligada obrigatória e booleana', () => {
    expect(erros(DescartarCupomDto, {})).toHaveLength(0);
    expect(erros(DescartarCupomDto, { motivo: 'Venda desfeita' })).toHaveLength(0);
    expect(erros(DescartarCupomDto, { motivo: 3 }).map((x) => x.property)).toEqual(['motivo']);
    expect(erros(LigarEmissaoDto, { ligada: true })).toHaveLength(0);
    expect(erros(LigarEmissaoDto, { ligada: true, confirmado: true })).toHaveLength(0);
    expect(erros(LigarEmissaoDto, {}).map((x) => x.property)).toEqual(['ligada']);
    expect(erros(LigarEmissaoDto, { ligada: 'sim' }).map((x) => x.property)).toEqual(['ligada']);
  });
});
