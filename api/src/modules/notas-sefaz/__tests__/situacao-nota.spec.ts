import type { NotaLancada } from '../../notas/notas.service';
import { A_CONFERIR, lancamentosDaNota, naoPareceCompra, podeConferir, situacaoDaNota, type MotivoIgnorar } from '../situacao-nota';

const VETOR = '35261112ABC34501DE35550010000044111000044116';
const N = { chave: VETOR, emitente_cnpj: '12ABC34501DE35', numero: '4411', serie: '1' };

const sit = (s: 'autorizada' | 'denegada' | 'cancelada', m: MotivoIgnorar | null, lancada: boolean, parecida: boolean) =>
  situacaoDaNota({ situacao_sefaz: s, motivo_ignorar: m }, { lancada, parecida });

describe('situacaoDaNota', () => {
  it('cancelada e lançada: qualquer Ignorar não esconde, só "cancelamento_conferido"', () => {
    expect(sit('cancelada', 'nao_e_compra', true, false)).toBe('cancelada_depois_de_lancada');
    expect(sit('cancelada', null, true, false)).toBe('cancelada_depois_de_lancada');
    expect(sit('cancelada', 'cancelamento_conferido', true, false)).toBe('ignorada');
  });
  it('cancelada e parecida também conta como lançada', () => {
    expect(sit('cancelada', null, false, true)).toBe('cancelada_depois_de_lancada');
  });
  it('ignorada, cancelada, denegada', () => {
    expect(sit('autorizada', 'outro', false, false)).toBe('ignorada');
    expect(sit('cancelada', null, false, false)).toBe('cancelada');
    expect(sit('denegada', null, false, false)).toBe('denegada');
  });
  it('ja_lancada, parece_lancada, falta_lancar', () => {
    expect(sit('autorizada', null, true, true)).toBe('ja_lancada');
    expect(sit('autorizada', null, false, true)).toBe('parece_lancada');
    expect(sit('autorizada', null, false, false)).toBe('falta_lancar');
  });
  it('A_CONFERIR = 1, 6 e 7', () => {
    expect([...A_CONFERIR].sort()).toEqual(['cancelada_depois_de_lancada', 'falta_lancar', 'parece_lancada']);
  });
});

describe('podeConferir', () => {
  it('só produção + XML + falta_lancar/parece_lancada', () => {
    expect(podeConferir('producao', true, 'falta_lancar')).toBe(true);
    expect(podeConferir('producao', true, 'parece_lancada')).toBe(true);
    expect(podeConferir('homologacao', true, 'falta_lancar')).toBe(false);
    expect(podeConferir('producao', false, 'falta_lancar')).toBe(false);
    expect(podeConferir('producao', true, 'ja_lancada')).toBe(false);
  });
});

describe('naoPareceCompra', () => {
  it('tpNF 0 ou finNFe 4', () => {
    expect(naoPareceCompra(0, 1)).toBe(true);
    expect(naoPareceCompra(1, 4)).toBe(true);
    expect(naoPareceCompra(1, 1)).toBe(false);
    expect(naoPareceCompra(null, null)).toBe(false);
  });
});

const lanc = (id: string, extra: Partial<NotaLancada>): NotaLancada => ({
  id,
  numero: '4411',
  serie: '1',
  fornecedor_nome: 'F',
  data_emissao: '2026-11-03',
  data_entrada: '2026-11-03',
  valor_total: 1,
  origem: 'xml',
  created_at: '2026-11-03T15:00:00.000Z',
  chave: null,
  fornecedor_cnpj: '12ABC34501DE35',
  ...extra,
});

describe('lancamentosDaNota', () => {
  it('lançada pela chave; parecidas sem ela e só as de mesma série', () => {
    const r = lancamentosDaNota(N, [
      lanc('a', { chave: VETOR, numero: '000.004.411', serie: '001' }),
      lanc('b', {}),
      lanc('c', { serie: '2' }),
    ]);
    expect(r.lancada?.id).toBe('a');
    expect(r.parecidas.map((p) => p.id)).toEqual(['b']);
  });
  it('chave guardada em minúsculas ainda casa; parecidas da mais nova para a mais antiga', () => {
    const r = lancamentosDaNota(N, [
      lanc('velha', { created_at: '2026-11-01T00:00:00.000Z' }),
      lanc('nova', { created_at: '2026-11-05T00:00:00.000Z' }),
      lanc('k', { chave: VETOR.toLowerCase() }),
    ]);
    expect(r.lancada?.id).toBe('k');
    expect(r.parecidas.map((p) => p.id)).toEqual(['nova', 'velha']);
  });
  it('sem nada lançado', () => {
    expect(lancamentosDaNota(N, [])).toEqual({ lancada: null, parecidas: [] });
  });
});
