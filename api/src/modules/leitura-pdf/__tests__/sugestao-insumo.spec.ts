import { normalizaNome } from '../../../common/parse/normaliza';
import { limparItens, textoCatalogo, type ItemIa } from '../sugestao-insumo';

const base: ItemIa = {
  codigo: null,
  descricao: 'TOMATE ITALIANO KG',
  unidade: 'kg',
  quantidade: 2,
  valor_unitario: 5,
  valor_total: 10,
  insumo: null,
  novo_nome: null,
  novo_unidade: null,
  novo_subgrupo: null,
  fator: 1,
};
const insumos = [{ id: 'i1', nome: 'Tomate' }];
const subs = ['Hortifruti', 'Mercearia'];

describe('limparItens', () => {
  it('insumo conhecido (sem caixa/acento) aponta o id e não sugere novo', () => {
    const [r] = limparItens([{ ...base, insumo: 'TOMATE' }], insumos, subs);
    expect(r!.item_estoque_id).toBe('i1');
    expect(r!.novo).toBeNull();
    expect(r).not.toHaveProperty('insumo');
  });

  it('insumo devolvido com a unidade ("Tomate (KG)") casa pelo nome', () => {
    const [r] = limparItens([{ ...base, insumo: 'Tomate (KG)' }], insumos, subs);
    expect(r!.item_estoque_id).toBe('i1');
    expect(r!.novo).toBeNull();
  });

  it('nome real terminado em parênteses continua casando pelo nome inteiro', () => {
    const lista = [{ id: 'q1', nome: 'Queijo (fatiado)' }, { id: 'q2', nome: 'Queijo' }];
    expect(limparItens([{ ...base, insumo: 'Queijo (fatiado)' }], lista, subs)[0]!.item_estoque_id).toBe('q1');
    expect(limparItens([{ ...base, insumo: 'Queijo (fatiado) (KG)' }], lista, subs)[0]!.item_estoque_id).toBe('q1');
  });

  it('item null ou não-objeto da IA é descartado', () => {
    const r = limparItens([null, 'x', { ...base, insumo: 'TOMATE' }] as unknown as ItemIa[], insumos, subs);
    expect(r).toHaveLength(1);
    expect(r[0]!.item_estoque_id).toBe('i1');
  });

  it('insumo inexistente sugere cadastro; nome cai na descrição', () => {
    const [r] = limparItens([{ ...base, insumo: 'Inexistente' }], insumos, subs);
    expect(r!.item_estoque_id).toBeNull();
    expect(r!.novo).toEqual({ nome: 'TOMATE ITALIANO KG', unidade: 'KG', subgrupo: null });
  });

  it('usa novo_nome, novo_unidade e subgrupo da lista; subgrupo fora da lista vira null', () => {
    const ok = limparItens([{ ...base, novo_nome: 'Tomate italiano', novo_unidade: 'kg', novo_subgrupo: 'hortifruti' }], insumos, subs)[0]!;
    expect(ok.novo).toEqual({ nome: 'Tomate italiano', unidade: 'KG', subgrupo: 'Hortifruti' });
    const fora = limparItens([{ ...base, novo_subgrupo: 'Outro' }], insumos, subs)[0]!;
    expect(fora.novo!.subgrupo).toBeNull();
  });

  it('fator 0, negativo ou NaN vira 1; válido é mantido', () => {
    const f = (n: number) => limparItens([{ ...base, fator: n }], insumos, subs)[0]!.fator;
    expect([f(0), f(-3), f(NaN), f(12)]).toEqual([1, 1, 1, 12]);
  });

  it('unidade vazia: unidade da nota em maiúsculas ou UN', () => {
    expect(limparItens([{ ...base, novo_unidade: '  ' }], insumos, subs)[0]!.novo!.unidade).toBe('KG');
    expect(limparItens([{ ...base, unidade: null, novo_unidade: '' }], insumos, subs)[0]!.novo!.unidade).toBe('UN');
  });
});

describe('textoCatalogo / normalizaNome', () => {
  it('lista insumos e subgrupos', () => {
    const t = textoCatalogo([{ nome: 'Tomate', unidade: 'KG' }], ['Hortifruti']);
    expect(t).toContain('- Tomate (KG)');
    expect(t).toContain('Hortifruti');
  });
  it('normalizaNome', () => {
    expect(normalizaNome('  Requeijão   CREMOSO ')).toBe('requeijao cremoso');
  });
});
