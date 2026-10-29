import { fichasDasLinhas, horaValida, insumosDasLinhas, rendimentoDaObservacao, vendasDasLinhas } from '../regras';

describe('importação de insumos', () => {
  it('padrões do protótipo e consumo base liga o manual', () => {
    const [i] = insumosDasLinhas([{ nome: ' Picanha ', unidade: 'kg', preco_unitario: '69,90', consumo_semanal_base: '0' }]);
    expect(i).toMatchObject({ nome: 'Picanha', tipo: 'Insumo', subgrupo: 'Mercearia', unidade: 'KG', preco_unitario: 69.9, qtd_por_embalagem: 1 });
    expect(i!.usar_manual).toBe(true); // zero explícito vale (não é "a definir")
    expect(i!.consumo_semanal_manual).toBe(0);
  });
  it('sem consumo base não liga o manual; linha sem nome sai', () => {
    const r = insumosDasLinhas([{ nome: 'Gelo', unidade: '' }, { nome: '', unidade: 'UN' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ unidade: 'UN', usar_manual: false, preco_unitario: null });
  });
});

describe('importação de fichas', () => {
  it('agrupa por item na ordem da 1ª linha e decide o grupo pela categoria', () => {
    const { grupos, cabecalhos } = fichasDasLinhas([
      { item_cardapio: 'Chopp 300', categoria: 'Chopp', preco_venda: '9,90', insumo: 'Chopp' },
      { item_cardapio: 'Espeto', categoria: '', insumo: 'Picanha' },
      { item_cardapio: 'Chopp 300', categoria: 'X', insumo: 'Copo' },
    ]);
    expect([...grupos.keys()]).toEqual(['Chopp 300', 'Espeto']);
    expect(grupos.get('Chopp 300')).toHaveLength(2);
    expect(cabecalhos).toEqual([
      { nome: 'Chopp 300', categoria: 'Chopp', grupo: 'Bebidas', preco_venda: 9.9, ativo: true },
      { nome: 'Espeto', categoria: 'Pratos', grupo: 'Alimentos', preco_venda: null, ativo: true },
    ]);
  });
  it('rendimento vem de "rend." na observação', () => {
    expect(rendimentoDaObservacao('rend. 2,5 porções')).toBe(2.5);
    expect(rendimentoDaObservacao('Rend 3')).toBe(3);
    expect(rendimentoDaObservacao('sem')).toBeNull();
  });
});

describe('importação de vendas', () => {
  it('soma pedido+produto+data repetidos, mantém hora/preço da 1ª linha e ignora data inválida', () => {
    const r = vendasDasLinhas([
      { pedido: '1', data: '2026-10-20', hora: '19:05', produto_relatorio: 'X', quantidade: '2', valor_total: '20,00', preco_unitario: '10' },
      { pedido: '1', data: '2026-10-20', hora: '22:00', produto_relatorio: 'X', quantidade: '1', valor_total: '10', taxa: '1,5' },
      { pedido: '2', data: '20/10/2026', produto_relatorio: 'X', quantidade: '1', valor_total: '10' },
      { pedido: '', data: '2026-10-20', produto_relatorio: 'X', quantidade: '1', valor_total: '10' },
    ]);
    expect(r).toEqual([
      { pedido: '1', data: '2026-10-20', hora: '19:05:00', produto_relatorio: 'X', preco_unitario: 10, quantidade: 3, valor_total: 30, desconto: 0, taxa: 1.5, frete: 0 },
    ]);
  });
  it('hora inválida vira nula', () => {
    expect(horaValida('25:00')).toBeNull();
    expect(horaValida('9:30:15')).toBe('09:30:15');
    expect(horaValida('')).toBeNull();
  });
});
