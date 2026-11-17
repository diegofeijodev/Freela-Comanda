import {
  acoesDoCupom,
  PRAZO_CANCELAR_MS,
  situacaoEfetiva,
  tipoPendente,
  vendaEstoque,
  type CupomParaAcoes,
  type SituacaoCupom,
} from '../situacao-cupom';

// Horas de Brasília escritas com o fuso explícito: o teste roda igual com TZ=UTC.
const sp = (hms: string) => new Date(`2026-11-17T${hms}-03:00`);
const ENVIO = sp('14:05:00');

const cupom = (situacao: SituacaoCupom, extra: Partial<CupomParaAcoes> = {}): CupomParaAcoes => ({
  situacao,
  ambiente: 'producao',
  envios: 1,
  numero_reaproveitavel: true,
  autorizada_em: null,
  cancelamento_pedido_em: null,
  lanca_venda: true,
  venda_lancada_em: null,
  venda_desfeita_em: null,
  enviadoEm: ENVIO,
  ultimaConsultaDaChave: null,
  ...extra,
});
const autorizado = (extra: Partial<CupomParaAcoes> = {}) =>
  cupom('autorizado', { autorizada_em: sp('14:05:31'), venda_lancada_em: sp('14:05:32'), ...extra });

describe('situacaoEfetiva', () => {
  it.each([
    ['14:06:59', 'enviando'],
    ['14:07:00', 'sem_resposta'], // 2 min: a mesma hora em que a consulta abre
    ['14:07:01', 'sem_resposta'],
  ])('enviando às %s → %s', (h, esperado) => {
    expect(situacaoEfetiva(cupom('enviando'), sp(h))).toBe(esperado);
  });

  it('enviando sem a hora do envio = sem_resposta (número preso; a consulta decide)', () => {
    expect(situacaoEfetiva(cupom('enviando', { enviadoEm: null }), ENVIO)).toBe('sem_resposta');
  });

  it.each<SituacaoCupom>([
    'nao_enviado',
    'sem_resposta',
    'nao_consta',
    'rejeitado',
    'autorizado',
    'cancelando',
    'denegado',
    'cancelado',
    'descartado',
  ])('%s não muda com o tempo', (s) => {
    expect(situacaoEfetiva(cupom(s), sp('18:00:00'))).toBe(s);
  });
});

describe('acoesDoCupom', () => {
  it('autorizado às 14:05:31 → cancelar_ate 14:34:31; às 14:34:32, sem cancelar', () => {
    const c = autorizado();
    expect(PRAZO_CANCELAR_MS).toBe(29 * 60_000);
    expect(acoesDoCupom(c, sp('14:10:00'))).toEqual({
      acoes: ['consultar', 'cancelar', 'imprimir'],
      consultar_a_partir_de: sp('14:07:00'),
      cancelar_ate: sp('14:34:31'),
    });
    expect(acoesDoCupom(c, sp('14:34:31')).acoes).toContain('cancelar');
    const depois = acoesDoCupom(c, sp('14:34:32'));
    expect(depois.acoes).toEqual(['consultar', 'imprimir']);
    expect(depois.cancelar_ate).toEqual(sp('14:34:31')); // a tela ainda mostra "terminou às 14h34" (UX 4.4)
  });

  it('autorizado com a venda pendente: lancar_venda', () => {
    expect(acoesDoCupom(autorizado({ venda_lancada_em: null }), sp('14:10:00')).acoes).toEqual([
      'consultar',
      'cancelar',
      'lancar_venda',
      'imprimir',
    ]);
  });

  it('autorizado em teste ou sem lançar venda: sem lancar_venda', () => {
    expect(
      acoesDoCupom(autorizado({ ambiente: 'homologacao', lanca_venda: false, venda_lancada_em: null }), sp('14:10:00')).acoes,
    ).not.toContain('lancar_venda');
    expect(acoesDoCupom(autorizado({ lanca_venda: false, venda_lancada_em: null }), sp('14:10:00')).acoes).not.toContain('lancar_venda');
  });

  it.each([
    ['sem_resposta', cupom('sem_resposta')],
    ['enviando vencido', cupom('enviando')],
    ['204 (sem_resposta)', cupom('sem_resposta', { envios: 3 })],
  ])('%s → só consultar (nunca enviar de novo nem descartar)', (_nome, c) => {
    const r = acoesDoCupom(c, sp('14:08:00'));
    expect(r.acoes).toEqual(['consultar']);
    expect(r.acoes).not.toContain('enviar_de_novo');
    expect(r.acoes).not.toContain('descartar');
    expect(r.consultar_a_partir_de).toEqual(sp('14:07:00'));
    expect(r.cancelar_ate).toBeNull();
  });

  it('sem_resposta antes dos 2 min: a ação aparece com a hora (o botão habilita sozinho, nunca dispara)', () => {
    expect(acoesDoCupom(cupom('sem_resposta'), sp('14:05:30'))).toEqual({
      acoes: ['consultar'],
      consultar_a_partir_de: sp('14:07:00'),
      cancelar_ate: null,
    });
  });

  it('consultar_a_partir_de: a mais tarde entre o envio + 2 min e a última consulta da chave + 2 min', () => {
    const c = cupom('sem_resposta', { ultimaConsultaDaChave: sp('14:09:10') });
    expect(acoesDoCupom(c, sp('14:10:00')).consultar_a_partir_de).toEqual(sp('14:11:10'));
  });

  it('enviando dentro dos 2 min: nenhuma ação', () => {
    expect(acoesDoCupom(cupom('enviando'), sp('14:06:00'))).toEqual({ acoes: [], consultar_a_partir_de: null, cancelar_ate: null });
  });

  it('rejeitado com envios = 3 → só descartar e consultar', () => {
    expect(acoesDoCupom(cupom('rejeitado', { envios: 3 }), sp('14:10:00')).acoes).toEqual(['consultar', 'descartar']);
  });

  it('rejeitado com envios < 3 → enviar de novo, consultar e descartar', () => {
    expect(acoesDoCupom(cupom('rejeitado', { envios: 2 }), sp('14:10:00')).acoes).toEqual(['enviar_de_novo', 'consultar', 'descartar']);
  });

  it('numero_reaproveitavel = false (539) → só descartar', () => {
    const r = acoesDoCupom(cupom('rejeitado', { numero_reaproveitavel: false }), sp('14:10:00'));
    expect(r.acoes).toEqual(['descartar']);
    expect(r.consultar_a_partir_de).toBeNull();
  });

  it('nao_enviado → enviar de novo, consultar e descartar; com 3 envios, sem enviar de novo', () => {
    expect(acoesDoCupom(cupom('nao_enviado'), sp('14:10:00')).acoes).toEqual(['enviar_de_novo', 'consultar', 'descartar']);
    expect(acoesDoCupom(cupom('nao_enviado', { envios: 3 }), sp('14:10:00')).acoes).toEqual(['consultar', 'descartar']);
  });

  it('nao_consta → enviar de novo e descartar (sem consultar)', () => {
    expect(acoesDoCupom(cupom('nao_consta'), sp('14:10:00'))).toEqual({
      acoes: ['enviar_de_novo', 'descartar'],
      consultar_a_partir_de: null,
      cancelar_ate: null,
    });
    expect(acoesDoCupom(cupom('nao_consta', { envios: 3 }), sp('14:10:00')).acoes).toEqual(['descartar']);
  });

  it('cancelando → só consultar, a partir do pedido de cancelamento + 2 min (sem imprimir)', () => {
    const c = autorizado({ situacao: 'cancelando', cancelamento_pedido_em: sp('14:20:00') });
    expect(acoesDoCupom(c, sp('14:21:00'))).toEqual({
      acoes: ['consultar'],
      consultar_a_partir_de: sp('14:22:00'),
      cancelar_ate: sp('14:34:31'),
    });
  });

  it('cancelado: lancar_venda só se a venda ainda está no estoque', () => {
    const c = autorizado({ situacao: 'cancelado' });
    expect(acoesDoCupom(c, sp('14:30:00')).acoes).toEqual(['lancar_venda']);
    expect(acoesDoCupom({ ...c, venda_desfeita_em: sp('14:21:00') }, sp('14:30:00')).acoes).toEqual([]);
  });

  it.each<SituacaoCupom>(['denegado', 'descartado'])('%s: nenhuma ação', (s) => {
    expect(acoesDoCupom(cupom(s), sp('14:10:00'))).toEqual({ acoes: [], consultar_a_partir_de: null, cancelar_ate: null });
  });
});

describe('vendaEstoque (UX 3.2, ponto 10.8)', () => {
  it.each<[string, CupomParaAcoes, ReturnType<typeof vendaEstoque>]>([
    ['lancada', autorizado(), 'lancada'],
    ['pendente (falhou ou ainda não rodou)', autorizado({ venda_lancada_em: null }), 'pendente'],
    ['desfeita', autorizado({ situacao: 'cancelado', venda_desfeita_em: sp('14:21:00') }), 'desfeita'],
    ['desfazer_pendente', autorizado({ situacao: 'cancelado' }), 'desfazer_pendente'],
    ['teste', autorizado({ ambiente: 'homologacao', lanca_venda: false, venda_lancada_em: null }), 'teste'],
    ['nao_lanca', autorizado({ lanca_venda: false, venda_lancada_em: null }), 'nao_lanca'],
    ['cancelando mantém a venda', autorizado({ situacao: 'cancelando' }), 'lancada'],
    ['cancelado sem venda lançada: nada no estoque', autorizado({ situacao: 'cancelado', venda_lancada_em: null }), 'desfeita'],
    ['teste cancelado', autorizado({ situacao: 'cancelado', ambiente: 'homologacao', lanca_venda: false }), 'teste'],
    ['rejeitado: nulo', cupom('rejeitado'), null],
    ['sem_resposta: nulo', cupom('sem_resposta'), null],
    ['denegado: nulo', cupom('denegado'), null],
  ])('%s', (_nome, c, esperado) => {
    expect(vendaEstoque(c)).toBe(esperado);
  });
});

describe('tipoPendente (ponto 10.7)', () => {
  const agora = sp('14:10:00');
  it.each<[string, CupomParaAcoes, ReturnType<typeof tipoPendente>]>([
    ['sem_resposta', cupom('sem_resposta'), 'sem_resposta'],
    ['enviando vencido', cupom('enviando'), 'sem_resposta'],
    ['cancelando', autorizado({ situacao: 'cancelando' }), 'sem_resposta'],
    ['nao_enviado', cupom('nao_enviado'), 'nao_saiu'],
    ['nao_consta', cupom('nao_consta'), 'nao_saiu'],
    ['rejeitado', cupom('rejeitado'), 'recusado'],
    ['autorizado com venda pendente', autorizado({ venda_lancada_em: null }), 'venda_pendente'],
    ['cancelado com a venda ainda no estoque', autorizado({ situacao: 'cancelado' }), 'venda_pendente'],
    ['autorizado em dia', autorizado(), null],
    ['enviando dentro dos 2 min', cupom('enviando', { enviadoEm: sp('14:09:00') }), null],
    ['denegado', cupom('denegado'), null],
    ['descartado', cupom('descartado'), null],
    ['cancelado e desfeito', autorizado({ situacao: 'cancelado', venda_desfeita_em: sp('14:21:00') }), null],
  ])('%s', (_nome, c, esperado) => {
    expect(tipoPendente(c, agora)).toBe(esperado);
  });
});
