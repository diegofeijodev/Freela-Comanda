import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ItemDoCupomDto,
  PagamentoDoCupomDto,
  PerfilEmLoteDto,
  PerfilFiscalDto,
  SalvarAmbienteDto,
  SalvarEmitenteDto,
  SalvarProdutoDto,
} from '../cupom-fiscal.dto';
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
