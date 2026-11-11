import { parseArgs } from '../cli';
import { fmtDecimal, mesmoDecimal, normalizarDecimal } from '../decimal';
import { TABELAS, VIEWS } from '../esquema';
import { EsquemaNosso, Exportacao, FORMATO, validarExportacao } from '../exportacao';

const tipo = (c: string) => (c === 'id' || c.endsWith('_id') ? 'uuid' : 'text');
/** Esquema "nosso" e exportação mínima válida: toda tabela com as colunas da lista fixa, configuracoes com 1 linha. */
function base(): { exp: Exportacao; nosso: EsquemaNosso } {
  const nosso: EsquemaNosso = new Map(TABELAS.map((t) => [t.nome, t.colunas.map((c) => ({ nome: c, tipo: tipo(c), nulo: c !== 'id' }))]));
  const linha = (cols: readonly string[]) => Object.fromEntries(cols.map((c) => [c, null]));
  const tabelas: Exportacao['tabelas'] = Object.fromEntries(
    TABELAS.map((t) => [t.nome, t.nome === 'configuracoes' ? [linha(t.colunas)] : []]),
  );
  tabelas.profiles = [];
  tabelas.user_roles = [];
  const resumoTabelas: Exportacao['resumo']['tabelas'] = Object.fromEntries(
    [...TABELAS.map((t) => t.nome), 'profiles', 'user_roles'].map((t) => [
      t,
      { linhas: tabelas[t]?.length ?? 0, somas: {}, colunas: nosso.get(t) ?? [] },
    ]),
  );
  const exp: Exportacao = {
    formato: FORMATO,
    resumo: {
      meta: { agora: '', hoje: '', semana_ref: '', fuso: 'UTC', versao_pg: '15' },
      tabelas: resumoTabelas,
      views: Object.fromEntries(VIEWS.map((v) => [v.nome, 0])),
      usuarios: 0,
      movimentacoes_por_tipo: {},
    },
    tabelas,
    usuarios: [],
    views: Object.fromEntries(VIEWS.map((v) => [v.nome, []])),
  };
  return { exp, nosso };
}

describe('validarExportacao', () => {
  it('conta com campo de senha (formato 1) é recusada', () => {
    const { exp, nosso } = base();
    exp.resumo.usuarios = 1;
    exp.usuarios = [
      { id: 'u', email: 'a@x.com', encrypted_password: '$2a$', created_at: '', ultimo_acesso: null, confirmada: true, apagada: false, banida: false, anonima: false },
    ];
    expect(validarExportacao(exp, nosso)).toEqual([expect.stringContaining('chave(s) desconhecida(s) encrypted_password')]);
    expect(validarExportacao({ ...exp, formato: 'erpfreela-export/1' }, nosso)).toEqual([expect.stringContaining('formato')]);
  });

  it('exportação igual ao esquema passa', () => {
    const { exp, nosso } = base();
    expect(validarExportacao(exp, nosso)).toEqual([]);
  });
  it('chave desconhecida ou coluna faltando numa linha aborta', () => {
    const { exp, nosso } = base();
    exp.tabelas.configuracoes![0]!.extra = 1;
    delete exp.tabelas.configuracoes![0]!.cnpj;
    expect(validarExportacao(exp, nosso)).toEqual([
      expect.stringMatching(/configuracoes, linha 1: chave\(s\) desconhecida\(s\) extra; falta\(m\) cnpj/),
    ]);
  });
  it('tabela nova no Lovable ou tabela faltando aborta', () => {
    const { exp, nosso } = base();
    exp.resumo.tabelas.novidade = { linhas: 0, somas: {}, colunas: [] };
    delete exp.resumo.tabelas.caixa_fechamentos;
    const e = validarExportacao(exp, nosso);
    expect(e).toEqual([expect.stringContaining('tabela "novidade"'), expect.stringContaining('falta a tabela "caixa_fechamentos"')]);
  });
  it('coluna, tipo ou nulabilidade diferente no Lovable aborta (vale até para tabela vazia)', () => {
    const { exp, nosso } = base();
    const cols = exp.resumo.tabelas.vendas!.colunas;
    exp.resumo.tabelas.vendas!.colunas = [
      ...cols
        .filter((c) => c.nome !== 'frete')
        .map((c) => (c.nome === 'pedido' ? { ...c, tipo: 'integer' } : c.nome === 'hora' ? { ...c, nulo: false } : c)),
      { nome: 'cupom', tipo: 'text', nulo: true },
    ];
    const e = validarExportacao(exp, nosso);
    expect(e).toEqual(
      expect.arrayContaining([
        expect.stringContaining('vendas: coluna(s) que existem no Lovable e não no sistema novo: cupom'),
        expect.stringContaining('vendas: coluna(s) do sistema novo que não existem no Lovable: frete'),
        expect.stringContaining('vendas.pedido: tipo integer no Lovable × text aqui'),
        expect.stringContaining('vendas.hora: não aceita nulo no Lovable'),
      ]),
    );
  });
  it('linhas ≠ resumo, view faltando, configuracoes vazia e formato errado', () => {
    const { exp, nosso } = base();
    exp.resumo.tabelas.vendas!.linhas = 3;
    delete exp.views.v_cmv_periodo;
    exp.tabelas.configuracoes = [];
    exp.resumo.tabelas.configuracoes!.linhas = 0;
    expect(validarExportacao(exp, nosso)).toEqual([
      expect.stringContaining('vendas: 0 linha(s) no arquivo; o resumo do Lovable diz 3'),
      expect.stringContaining('configuracoes: o Lovable tem 0 linha(s)'),
      expect.stringContaining('a view v_cmv_periodo não veio'),
    ]);
    expect(validarExportacao({ ...exp, formato: 'x' }, nosso)).toEqual([expect.stringContaining('formato')]);
  });
});

describe('decimais exatos (texto)', () => {
  it('compara sem passar por double', () => {
    expect(mesmoDecimal('21.9666666666666667', '21.96666666666666670')).toBe(true);
    expect(mesmoDecimal('21.9666666666666667', '21.9666666666666668')).toBe(false);
    expect(mesmoDecimal('-0.000', '0')).toBe(true);
    expect(mesmoDecimal(null, null)).toBe(true);
    expect(mesmoDecimal(null, '0')).toBe(false);
    expect(normalizarDecimal('007.50')).toBe('7.5');
    expect(() => normalizarDecimal('1e5')).toThrow('não é um decimal');
  });
  it('formata em pt-BR sem arredondar', () => {
    expect(fmtDecimal('1234567.8901')).toBe('1.234.567,8901');
    expect(fmtDecimal('-45.10')).toBe('−45,1');
    expect(fmtDecimal(null)).toBe('—');
  });
});

describe('linha de comando', () => {
  it('modos e opções', () => {
    expect(parseArgs(['--file', 'a.json', '--expect-db', 'erpfreela_stage', '--dry-run', '--pular-sem-papel'])).toEqual({
      arquivo: 'a.json',
      expectDb: 'erpfreela_stage',
      modo: 'ensaio',
      pularSemPapel: true,
    });
    expect(parseArgs(['--file', 'a', '--expect-db', 'b']).modo).toBe('carga');
    expect(() => parseArgs(['--file', 'a'])).toThrow('uso:');
    expect(() => parseArgs(['--file', 'a', '--expect-db', 'b', '--dry-run', '--verify'])).toThrow('escolha só um');
    expect(() => parseArgs(['--file', 'a', '--expect-db', 'b', '--force'])).toThrow('opção desconhecida: --force');
    expect(() => parseArgs(['--file', 'a', '--expect-db', 'b', '--importar-sem-senha'])).toThrow('opção desconhecida: --importar-sem-senha');
  });
});
