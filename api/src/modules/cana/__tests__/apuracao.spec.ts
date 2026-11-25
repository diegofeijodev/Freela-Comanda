import { apurarSemana, periodoDaSemana, type EntradaSemana } from '../apuracao';

// O exemplo do desenho (B.3), com números INVENTADOS: contagem de 17/11 (4 DZ, 3 L), 12 DZ recebidas em 3 entregas, 50 L produzidos,
// contagem de 24/11 (6 DZ, 5 L); 100 copos de 300 ml e 40 frozen de 400 ml com rendimento 1,25.
const CALDO = 'c0000000-0000-4000-8000-000000000001';
const FROZEN = 'c0000000-0000-4000-8000-000000000002';
const GARAPA = 'c0000000-0000-4000-8000-000000000003';
const BURGER = 'c0000000-0000-4000-8000-000000000004';

function exemplo(mudar: Partial<EntradaSemana> = {}): EntradaSemana {
  return {
    inicial: { id: 'k1', data: '2026-11-17', duzias: 4, litros_caldo: 3, litros_frozen: null },
    final: { id: 'k2', data: '2026-11-24', duzias: 6, litros_caldo: 5, litros_frozen: null },
    hoje: '2026-11-25',
    lancamentos: [
      { tipo: 'recebimento', data: '2026-11-18', duzias: 4, litros_caldo: null },
      { tipo: 'recebimento', data: '2026-11-20', duzias: 4, litros_caldo: null },
      { tipo: 'recebimento', data: '2026-11-22', duzias: 4, litros_caldo: null },
      { tipo: 'producao', data: '2026-11-19', duzias: 5, litros_caldo: 25 },
      { tipo: 'producao', data: '2026-11-23', duzias: null, litros_caldo: 25 },
    ],
    vendas: [
      { item_cardapio_id: CALDO, nome: 'Caldo de cana 300 ml', data: '2026-11-20', quantidade: 60 },
      { item_cardapio_id: CALDO, nome: 'Caldo de cana 300 ml', data: '2026-11-24', quantidade: 40 },
      { item_cardapio_id: FROZEN, nome: 'Frozen 400 ml', data: '2026-11-21', quantidade: 40 },
      { item_cardapio_id: BURGER, nome: 'Smoke Burger', data: '2026-11-21', quantidade: 9 },
    ],
    vendas_sem_cardapio: [],
    produtos: [
      { item_cardapio_id: CALDO, ml_por_unidade: 300, frozen: false, ativo: true },
      { item_cardapio_id: FROZEN, ml_por_unidade: 400, frozen: true, ativo: true },
    ],
    parametros: { litros_por_duzia_esperado: null, rendimento_frozen: 1.25 },
    vendas_importadas_ate: '2026-11-24',
    ...mudar,
  };
}
const codigos = (e: EntradaSemana) => apurarSemana(e).avisos.map((a) => a.codigo);

describe('apurarSemana — o exemplo do desenho, número a número', () => {
  const r = apurarSemana(exemplo());

  it('período: do dia seguinte à contagem anterior até a contagem atual', () => {
    expect(r.periodo).toEqual({ ini: '2026-11-18', fim: '2026-11-24', dias: 7 });
    expect(r.em_andamento).toBe(false);
  });
  it('cana moída = 4 + 12 − 6 = 10 dúzias (3 recebimentos, de 18/11 a 22/11)', () => {
    expect(r.cana).toEqual({
      inicio: 4,
      recebida: { duzias: 12, lancamentos: 3, ini: '2026-11-18', fim: '2026-11-22' },
      fim: 6,
      moida: 10,
      anotada_nas_producoes: { duzias: 5, producoes_com: 1, producoes: 2 },
    });
  });
  it('caldo produzido = 50 L (2 produções); litros por dúzia = 50 ÷ 10 = 5', () => {
    expect(r.caldo.produzido).toEqual({ litros: 50, lancamentos: 2, ini: '2026-11-19', fim: '2026-11-23' });
    expect(r.moagem).toEqual({ litros_por_duzia: 5, esperado: null, diferenca_litros: null, diferenca_pct: null });
  });
  it('caldo vendido = 30 L em copos + 16 L de frozen ÷ 1,25 = 12,8 L → 42,8 L; o burger não entra', () => {
    expect(r.caldo.vendido).toEqual({ litros: 42.8, em_copos: 30, em_frozen: 12.8 });
    expect(r.por_produto).toEqual([
      {
        item_cardapio_id: CALDO,
        nome: 'Caldo de cana 300 ml',
        quantidade: 100,
        ml_por_unidade: 300,
        frozen: false,
        litros: 30,
        litros_caldo: 30,
      },
      {
        item_cardapio_id: FROZEN,
        nome: 'Frozen 400 ml',
        quantidade: 40,
        ml_por_unidade: 400,
        frozen: true,
        litros: 16,
        litros_caldo: 12.8,
      },
    ]);
  });
  it('perda = 3 + 50 − 42,8 − 5 = 5,2 L (sem resto de ponto flutuante)', () => {
    expect(r.caldo.inicio).toEqual({ litros: 3, caldo: 3, frozen: null, frozen_em_caldo: null });
    expect(r.caldo.fim).toEqual({ litros: 5, caldo: 5, frozen: null, frozen_em_caldo: null });
    expect(r.caldo.perda).toBe(5.2);
  });
  it('rendimento da semana = 42,8 ÷ 10 = 4,28 L vendidos por dúzia', () => {
    expect(r.rendimento).toEqual({ litros_vendidos_por_duzia: 4.28 });
  });
  it('sem avisos quando as vendas vão até o fim da semana e tudo está configurado', () => {
    expect(r.avisos).toEqual([]);
    expect(r.nao_entram).toEqual({ sem_ml: [], frozen_sem_rendimento: [], sem_cardapio: [] });
  });
});

describe('apurarSemana — parâmetros e configuração', () => {
  it('com o esperado (5,5 L por dúzia): diferença = 50 − 10 × 5,5 = −5 L (−9,09%)', () => {
    const r = apurarSemana(exemplo({ parametros: { litros_por_duzia_esperado: 5.5, rendimento_frozen: 1.25 } }));
    expect(r.moagem).toEqual({ litros_por_duzia: 5, esperado: 5.5, diferenca_litros: -5, diferenca_pct: -9.09 });
  });

  it('sem o rendimento do frozen: os frozen vendidos e os litros de frozen contados ficam fora, com o aviso', () => {
    const e = exemplo({ parametros: { litros_por_duzia_esperado: null, rendimento_frozen: null } });
    e.inicial = { ...e.inicial, litros_frozen: 2 };
    const r = apurarSemana(e);
    expect(r.caldo.vendido).toEqual({ litros: 30, em_copos: 30, em_frozen: 0 });
    expect(r.nao_entram.frozen_sem_rendimento).toEqual([{ item_cardapio_id: FROZEN, nome: 'Frozen 400 ml', quantidade: 40 }]);
    expect(r.caldo.inicio).toEqual({ litros: 3, caldo: 3, frozen: 2, frozen_em_caldo: null });
    expect(r.avisos).toContainEqual({ codigo: 'frozen_sem_rendimento', dados: { vendidos: 40, litros_frozen_contados: 2 } });
    expect(r.por_produto.map((p) => p.nome)).toEqual(['Caldo de cana 300 ml']);
  });

  it('frozen contado com rendimento vira caldo: 2 L de frozen ÷ 1,25 = 1,6 L', () => {
    const e = exemplo();
    e.final = { ...e.final!, litros_frozen: 2 };
    const r = apurarSemana(e);
    expect(r.caldo.fim).toEqual({ litros: 6.6, caldo: 5, frozen: 2, frozen_em_caldo: 1.6 });
    expect(r.caldo.perda).toBe(3.6);
  });

  it('produto que parece de caldo, vendido e sem configuração nenhuma, avisa; o que não parece fica fora calado', () => {
    const e = exemplo();
    e.vendas.push({ item_cardapio_id: GARAPA, nome: 'Garapa jarra', data: '2026-11-22', quantidade: 12 });
    const r = apurarSemana(e);
    expect(r.nao_entram.sem_ml).toEqual([{ item_cardapio_id: GARAPA, nome: 'Garapa jarra', quantidade: 12 }]);
    expect(r.avisos).toContainEqual({ codigo: 'produto_sem_ml', dados: { produtos: [{ nome: 'Garapa jarra', quantidade: 12 }] } });
    expect(r.caldo.vendido.litros).toBe(42.8);
  });

  it('produto configurado e desligado ("não leva caldo") fica fora da conta, sem o aviso de "sem ml"', () => {
    const e = exemplo();
    e.produtos = e.produtos.map((p) => (p.item_cardapio_id === CALDO ? { ...p, ativo: false } : p));
    const r = apurarSemana(e);
    expect(r.nao_entram.sem_ml).toEqual([]);
    expect(r.avisos.map((a) => a.codigo)).not.toContain('produto_sem_ml');
    expect(r.por_produto.map((p) => p.nome)).toEqual(['Frozen 400 ml']);
    expect(r.caldo.vendido).toEqual({ litros: 12.8, em_copos: 0, em_frozen: 12.8 });
  });

  it('todos os configurados desligados: "nada configurado" (nada entra na conta), e nenhum vira "sem ml"', () => {
    const e = exemplo();
    e.produtos = e.produtos.map((p) => ({ ...p, ativo: false }));
    const r = apurarSemana(e);
    expect(r.avisos.map((a) => a.codigo)).toContain('nada_configurado');
    expect(r.avisos.map((a) => a.codigo)).not.toContain('produto_sem_ml');
    expect(r.caldo.vendido.litros).toBe(0);
  });

  it('venda com nome de caldo sem item do cardápio avisa (o resto do de-para pendente não)', () => {
    const r = apurarSemana(
      exemplo({
        vendas_sem_cardapio: [
          { produto_relatorio: 'CALDO CANA 500', data: '2026-11-19', vendas: 5, quantidade: 6 },
          { produto_relatorio: 'CALDO CANA 500', data: '2026-11-20', vendas: 3, quantidade: 3 },
          { produto_relatorio: 'TAXA DE ROLHA', data: '2026-11-20', vendas: 2, quantidade: 2 },
          { produto_relatorio: 'CALDO CANA 500', data: '2026-11-17', vendas: 9, quantidade: 9 },
        ],
      }),
    );
    expect(r.nao_entram.sem_cardapio).toEqual([{ produto_relatorio: 'CALDO CANA 500', vendas: 8, quantidade: 9 }]);
    expect(r.avisos).toContainEqual({
      codigo: 'venda_sem_cardapio',
      dados: { produtos: [{ produto_relatorio: 'CALDO CANA 500', vendas: 8 }] },
    });
  });

  it('nada configurado: o aviso, e o caldo vendido é 0', () => {
    const r = apurarSemana(exemplo({ produtos: [] }));
    expect(r.caldo.vendido.litros).toBe(0);
    expect(codigos(exemplo({ produtos: [] }))).toContain('nada_configurado');
  });
});

describe('apurarSemana — contas que não dá para fazer', () => {
  it('cana moída negativa: −2 dúzias, sem litros por dúzia nem rendimento, com o aviso', () => {
    const e = exemplo();
    e.final = { ...e.final!, duzias: 18 };
    const r = apurarSemana(e);
    expect(r.cana.moida).toBe(-2);
    expect(r.moagem.litros_por_duzia).toBeNull();
    expect(r.rendimento.litros_vendidos_por_duzia).toBeNull();
    expect(r.avisos).toContainEqual({ codigo: 'cana_moida_negativa', dados: { duzias: -2 } });
  });

  it('cana moída zero: sem divisão por zero (null), com o aviso, e a diferença da moagem também fica nula', () => {
    const e = exemplo({ parametros: { litros_por_duzia_esperado: 5, rendimento_frozen: 1.25 } });
    e.final = { ...e.final!, duzias: 16 };
    const r = apurarSemana(e);
    expect(r.cana.moida).toBe(0);
    expect(r.moagem).toEqual({ litros_por_duzia: null, esperado: 5, diferenca_litros: null, diferenca_pct: null });
    expect(r.rendimento.litros_vendidos_por_duzia).toBeNull();
    expect(r.avisos).toContainEqual({ codigo: 'cana_moida_zero', dados: {} });
    expect(codigos(e)).not.toContain('cana_moida_negativa');
  });

  it('produção zero com venda: o aviso com os litros vendidos', () => {
    const e = exemplo();
    e.lancamentos = e.lancamentos.filter((l) => l.tipo !== 'producao');
    expect(apurarSemana(e).avisos).toContainEqual({ codigo: 'producao_zero_com_venda', dados: { litros_vendidos: 42.8 } });
  });

  it('vendas incompletas: importadas só até 21/11 numa semana que vai até 24/11 (e sem venda nenhuma)', () => {
    expect(apurarSemana(exemplo({ vendas_importadas_ate: '2026-11-21' })).avisos).toContainEqual({
      codigo: 'vendas_incompletas',
      dados: { ate: '2026-11-21', fim: '2026-11-24' },
    });
    expect(codigos(exemplo({ vendas_importadas_ate: null }))).toContain('vendas_incompletas');
    expect(codigos(exemplo({ vendas_importadas_ate: '2026-11-24' }))).not.toContain('vendas_incompletas');
  });
});

describe('apurarSemana — bordas do período (as mesmas de v_cmv_periodo)', () => {
  it('venda e lançamento no dia da contagem anterior ficam fora; no dia da contagem atual, dentro', () => {
    const e = exemplo();
    e.vendas.push({ item_cardapio_id: CALDO, nome: 'Caldo de cana 300 ml', data: '2026-11-17', quantidade: 1000 });
    e.vendas.push({ item_cardapio_id: CALDO, nome: 'Caldo de cana 300 ml', data: '2026-11-25', quantidade: 1000 });
    e.lancamentos.push({ tipo: 'recebimento', data: '2026-11-17', duzias: 100, litros_caldo: null });
    e.lancamentos.push({ tipo: 'recebimento', data: '2026-11-24', duzias: 1, litros_caldo: null });
    const r = apurarSemana(e);
    expect(r.caldo.vendido.em_copos).toBe(30);
    expect(r.cana.recebida).toEqual({ duzias: 13, lancamentos: 4, ini: '2026-11-18', fim: '2026-11-24' });
  });

  it('periodoDaSemana: semana irregular conta os dias de verdade', () => {
    expect(periodoDaSemana('2026-11-17', '2026-11-26')).toEqual({ ini: '2026-11-18', fim: '2026-11-26', dias: 9 });
  });
});

describe('apurarSemana — semana em andamento (sem a contagem final)', () => {
  const e = exemplo({ final: null, hoje: '2026-11-22' });
  const r = apurarSemana(e);
  it('vai da contagem até hoje e não calcula perda, cana moída nem rendimento', () => {
    expect(r.em_andamento).toBe(true);
    expect(r.periodo).toEqual({ ini: '2026-11-18', fim: '2026-11-22', dias: 5 });
    expect(r.cana).toEqual({
      inicio: 4,
      recebida: { duzias: 12, lancamentos: 3, ini: '2026-11-18', fim: '2026-11-22' },
      fim: null,
      moida: null,
      anotada_nas_producoes: { duzias: 5, producoes_com: 1, producoes: 1 },
    });
    expect([r.caldo.fim, r.caldo.perda, r.moagem.litros_por_duzia, r.rendimento.litros_vendidos_por_duzia]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(r.caldo.vendido.litros).toBe(18 + 12.8);
  });
});
