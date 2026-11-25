import { aplicarMapeamento, chaveVenda, type Mapeamento } from '../planilha';
import {
  fonteDaImportacao,
  montarPrevia,
  NOME_CUPOM,
  NOME_PADRAO,
  sugerirItemCardapio,
  type FatosPrevia,
  type Fonte,
} from '../previa';

const M: Mapeamento = { pedido: 'p', data: 'd', produto: 'x', quantidade: 'q', valor_total: 't' };
const PDV = { id: 'o-1', nome: 'PDV Valinhos' };
const PROPRIA = fonteDaImportacao('planilha', PDV);
const CENTRO: Fonte = { chave: 'sistema:o-2', nome: 'PDV Centro', tipo: 'sistema' };
const CUPOM: Fonte = { chave: 'cupom', nome: NOME_CUPOM, tipo: 'cupom' };

const ler = (linhas: Record<string, string>[], m: Mapeamento = M) => {
  const r = aplicarMapeamento(linhas, m, 'virgula', { hoje: '2026-11-24', prefixo: '' });
  return { lidas: linhas.length, ...r };
};
const fatos = (extra: Partial<FatosPrevia> = {}): FatosPrevia => ({
  propria: PROPRIA,
  modo: 'acrescentar',
  existentes: new Map(),
  porFonte: [],
  substituir: null,
  arquivoJaImportado: null,
  dePara: new Set(),
  cardapio: [],
  ...extra,
});
const existe = (pedido: string, produto: string, data: string, fonte: Fonte) =>
  [chaveVenda({ pedido, produto_relatorio: produto, data }), { ...fonte, pedido, data }] as const;

describe('prévia: as contagens fecham (lidas = novas + já existentes + com problema + somadas)', () => {
  const linhas = [
    { p: '1001', d: '20/11/2026', x: 'Caldo 300', q: '1', t: '10,00' },
    { p: '1001', d: '20/11/2026', x: 'Caldo 300', q: '1', t: '10,00' }, // somada à de cima
    { p: '1002', d: '21/11/2026', x: 'Caldo 300', q: '2', t: '20,00' }, // já existe (mesmo sistema)
    { p: '1003', d: '21/11/2026', x: 'Pastel', q: '1', t: '8,50' }, // já existe (PDV Centro)
    { p: '1004', d: '22/11/2026', x: 'Pastel', q: '3', t: '25,50' },
    { p: '1005', d: '31/02/2026', x: 'Pastel', q: '1', t: '1' }, // problema
    { p: '1006', d: '22/11/2026', x: 'Pastel', q: '0', t: '1' }, // problema
  ];
  const f = fatos({
    existentes: new Map([existe('1002', 'Caldo 300', '2026-11-21', PROPRIA), existe('1003', 'Pastel', '2026-11-21', CENTRO)]),
  });
  const p = montarPrevia(ler(linhas), f);

  it('números com a conta', () => {
    expect(p.linhas).toEqual({ lidas: 7, validas: 5, com_problema: 2, ja_existentes: 2, somadas_no_arquivo: 1, novas: 2 });
    expect(p.linhas.lidas).toBe(p.linhas.novas + p.linhas.ja_existentes + p.linhas.com_problema + p.linhas.somadas_no_arquivo);
    expect(p.valor_centavos).toBe(2000 + 2550);
    expect(p.ja_existentes_valor_centavos).toBe(2000 + 850);
    expect(p.pedidos).toBe(2);
    expect(p.itens).toBe(5);
    expect(p.periodo).toEqual({ ini: '2026-11-20', fim: '2026-11-22', dias: 3 });
  });
  it('R1: a já existente de outra fonte vem com o exemplo (pedido e data) e o nome da fonte', () => {
    expect(p.ja_existentes_mesma_fonte).toBe(1);
    expect(p.ja_existentes_de_outra_fonte).toEqual([
      { fonte: 'PDV Centro', tipo: 'sistema', linhas: 1, exemplo: { pedido: '1003', data: '2026-11-21' } },
    ]);
  });
  it('R6 e os motivos com o total de cada tipo (não só os 200 primeiros)', () => {
    expect(p.problemas).toEqual([
      { linha: 7, motivo: 'data inválida (31/02/2026)' },
      { linha: 8, motivo: 'quantidade zero' },
    ]);
    expect(p.motivos).toEqual([
      { motivo: 'data inválida', linhas: 1 },
      { motivo: 'quantidade zero', linhas: 1 },
    ]);
  });
  it('amostra das novas em centavos', () => {
    expect(p.amostra).toEqual([
      { pedido: '1001', data: '2026-11-20', hora: null, produto_relatorio: 'Caldo 300', quantidade: 2, valor_centavos: 2000 },
      { pedido: '1004', data: '2026-11-22', hora: null, produto_relatorio: 'Pastel', quantidade: 3, valor_centavos: 2550 },
    ]);
  });
});

describe('prévia: avisos', () => {
  it('R5: sobreposição lista cada OUTRA fonte do período (nunca a própria)', () => {
    const p = montarPrevia(
      ler([{ p: '1', d: '20/11/2026', x: 'X', q: '1', t: '1' }]),
      fatos({
        porFonte: [
          { ...PROPRIA, vendas: 50, valor_centavos: 100000 },
          { chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao', vendas: 1230, valor_centavos: 3450000 },
          { ...CUPOM, vendas: 12, valor_centavos: 45000 },
          { ...CENTRO, vendas: 0, valor_centavos: 0 },
        ],
      }),
    );
    expect(p.sobreposicao).toEqual([
      { fonte: NOME_PADRAO, tipo: 'padrao', vendas: 1230, valor_centavos: 3450000 },
      { fonte: NOME_CUPOM, tipo: 'cupom', vendas: 12, valor_centavos: 45000 },
    ]);
  });

  it('R3: no Substituir, a venda da própria fonte não é "já existente" (sai e volta) e a prévia diz quanto apaga', () => {
    const linhas = [
      { p: '1002', d: '21/11/2026', x: 'Caldo 300', q: '2', t: '22,00' },
      { p: '1003', d: '21/11/2026', x: 'Pastel', q: '1', t: '8,50' },
    ];
    const p = montarPrevia(
      ler(linhas),
      fatos({
        modo: 'substituir',
        existentes: new Map([existe('1002', 'Caldo 300', '2026-11-21', PROPRIA), existe('1003', 'Pastel', '2026-11-21', CUPOM)]),
        substituir: { vendas: 7, valor_centavos: 9900 },
      }),
    );
    expect(p.linhas.novas).toBe(1);
    expect(p.linhas.ja_existentes).toBe(1);
    expect(p.valor_centavos).toBe(2200);
    expect(p.substituir).toEqual({ vendas: 7, valor_centavos: 9900, ini: '2026-11-21', fim: '2026-11-21', bloqueado: false });
  });

  it('R3 com linha com problema: o Substituir fica bloqueado (a venda da linha ruim sairia e não voltaria)', () => {
    const linhas = [
      { p: '1002', d: '21/11/2026', x: 'Caldo 300', q: '2', t: '22,00' },
      { p: '1004', d: '31/02/2026', x: 'Pastel', q: '1', t: '8,50' },
    ];
    const com = montarPrevia(ler(linhas), fatos({ modo: 'substituir', substituir: { vendas: 7, valor_centavos: 9900 } }));
    expect(com.substituir).toMatchObject({ vendas: 7, bloqueado: true });
    // nada a apagar: não há o que perder, Substituir = acrescentar
    const zero = montarPrevia(ler(linhas), fatos({ modo: 'substituir', substituir: { vendas: 0, valor_centavos: 0 } }));
    expect(zero.substituir).toMatchObject({ vendas: 0, bloqueado: false });
  });

  it('R7: arquivo já importado passa adiante (não barra)', () => {
    const em = '2026-11-20T21:10:00.000Z';
    const p = montarPrevia(
      ler([{ p: '1', d: '20/11/2026', x: 'X', q: '1', t: '1' }]),
      fatos({ arquivoJaImportado: { em, por: 'Diego', vendas: 2301 } }),
    );
    expect(p.arquivo_ja_importado).toEqual({ em, por: 'Diego', vendas: 2301 });
  });

  it('P6: as já existentes cujo pedido é o sintético "DIA <data>" são contadas à parte', () => {
    const semPedido: Mapeamento = { data: 'd', produto: 'x', quantidade: 'q', valor_total: 't' };
    const p = montarPrevia(
      ler(
        [
          { d: '20/11/2026', x: 'Caldo', q: '1', t: '5' },
          { d: '20/11/2026', x: 'Pastel', q: '1', t: '5' },
        ],
        semPedido,
      ),
      fatos({ existentes: new Map([existe('DIA 2026-11-20', 'Caldo', '2026-11-20', PROPRIA)]) }),
    );
    expect(p.ja_existentes_pedido_dia).toBe(1);
    expect(p.linhas.novas).toBe(1);
  });

  it('nenhuma válida: período nulo, zero novas e os motivos (a tela mostra P15)', () => {
    const p = montarPrevia(ler([{ p: '1', d: 'ontem', x: 'X', q: '1', t: '1' }]), fatos());
    expect([p.periodo, p.linhas.novas, p.motivos]).toEqual([null, 0, [{ motivo: 'data inválida', linhas: 1 }]]);
  });
});

describe('prévia: produtos ainda não ligados ao cardápio', () => {
  it('só os produtos que não estão no de-para, com sugestão e "parece de caldo"', () => {
    const p = montarPrevia(
      ler([
        { p: '1', d: '20/11/2026', x: 'CALDO CANA 500ML', q: '1', t: '12' },
        { p: '2', d: '20/11/2026', x: 'Pastel de Carne', q: '1', t: '9' },
        { p: '3', d: '20/11/2026', x: 'Espetinho', q: '1', t: '7' },
      ]),
      fatos({
        dePara: new Set(['Espetinho']),
        cardapio: [
          { id: 'c-1', nome: 'Pastel de carne' },
          { id: 'c-2', nome: 'Caldo de cana 500 ml' },
        ],
      }),
    );
    expect(p.produtos_sem_de_para).toEqual([
      { produto_relatorio: 'CALDO CANA 500ML', linhas: 1, valor_centavos: 1200, sugestao_item_cardapio_id: 'c-2', parece_cana: true },
      { produto_relatorio: 'Pastel de Carne', linhas: 1, valor_centavos: 900, sugestao_item_cardapio_id: 'c-1', parece_cana: false },
    ]);
  });
  it('sugestão por palavras em comum (≥ 50%)', () => {
    const c = [
      { id: 'a', nome: 'Caldo de cana 300 ml' },
      { id: 'b', nome: 'Pastel' },
    ];
    expect(sugerirItemCardapio('CALDO CANA 300', c)).toBe('a');
    expect(sugerirItemCardapio('Coxinha', c)).toBeNull();
  });
});

describe('fonte da importação', () => {
  it('planilha padrão, sistema e XML do sistema são fontes diferentes', () => {
    expect(fonteDaImportacao('planilha', null)).toEqual({ chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao' });
    expect(fonteDaImportacao('pdf', PDV)).toEqual({ chave: 'sistema:o-1', nome: 'PDV Valinhos', tipo: 'sistema' });
    expect(fonteDaImportacao('xml', PDV)).toEqual({ chave: 'xml:o-1', nome: 'XML de PDV Valinhos', tipo: 'xml' });
  });
});
