import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conferirEsquemaNosso } from '../banco';
import { COLUNAS_SO_NOSSAS, COLUNAS_USERS, GATILHOS, TABELAS, TABELAS_SO_NOSSAS } from '../esquema';

/**
 * A única sequence permitida: avulsa, só para o `idLote` da NFC-e (não é padrão de coluna nenhuma, e a carga não a toca). Coluna com
 * `nextval`/identity continua proibida aqui e no `conferirEsquemaNosso`.
 */
const SEQUENCE_AVULSA = 'CREATE SEQUENCE "nfce_id_lote_seq" AS BIGINT MINVALUE 1 MAXVALUE 999999999999999 NO CYCLE;';

/** Lê as migrações versionadas: a lista fixa do importador não pode se afastar delas. */
const MIGR = join(__dirname, '../../../../prisma/migrations');
/** `CREATE TABLE "nome" (` (estilo Prisma) ou `CREATE TABLE nome (` (SQL à mão), até o `);` sozinho na linha. */
const CREATE_TABLE = /CREATE TABLE "?([a-z_]+)"? \(\n([\s\S]*?)\n\);/g;
const sql = readdirSync(MIGR)
  .filter((d) => !d.endsWith('.toml'))
  .sort()
  .map((d) => readFileSync(join(MIGR, d, 'migration.sql'), 'utf8'))
  .join('\n');

describe('esquema.ts × migrações', () => {
  it('colunas de cada tabela = CREATE TABLE da migração init (e users)', () => {
    const criadas = new Map<string, string[]>();
    // Com ou sem aspas: as migrações do ponto e de empresas criaram tabelas sem aspas (Tarefa 0 do desenho de 24/11).
    for (const m of sql.matchAll(CREATE_TABLE)) {
      criadas.set(
        m[1]!,
        [...m[2]!.matchAll(/^\s+"([a-z_0-9]+)" /gm)].map((c) => c[1]!),
      );
    }
    expect([...criadas.keys()].sort()).toEqual([...TABELAS.map((t) => t.nome), ...TABELAS_SO_NOSSAS.filter((t) => t !== '_prisma_migrations')].sort());
    for (const t of TABELAS) expect([t.nome, criadas.get(t.nome)]).toEqual([t.nome, [...t.colunas]]);
    expect(criadas.get('users')).toEqual([...COLUNAS_USERS]);
  });

  it('ordem de carga respeita toda chave estrangeira (mãe antes da filha)', () => {
    const ordem = TABELAS.map((t) => t.nome);
    const fks = [...sql.matchAll(/ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "[a-z_]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "([a-z_]+)"/g)];
    expect(fks).toHaveLength(39); // 32 + as 4 da migração vendas_importacao (24/11) + users.empresa_id (multiempresa, 26/11) + as 2 da cana (27/11)
    for (const [, filha, mae] of fks) {
      if (filha === mae) continue; // auto-referência (notas_entrada.repetida_de): sem ordem a respeitar
      if ((TABELAS_SO_NOSSAS as readonly string[]).includes(filha!)) continue; // tabela só nossa (SEFAZ): a carga não toca
      expect([filha, ordem.indexOf(mae!) < ordem.indexOf(filha!)]).toEqual([filha, true]);
    }
  });

  it('chave estrangeira sem aspas (inline ou ALTER TABLE) só em tabela só nossa (a carga não as toca)', () => {
    const filhas: [string, string][] = [];
    for (const m of sql.matchAll(CREATE_TABLE)) {
      if (m[0].startsWith('CREATE TABLE "')) continue;
      for (const r of m[2]!.matchAll(/REFERENCES (\w+)\(/g)) filhas.push([m[1]!, r[1]!]);
    }
    for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD CONSTRAINT \w+\s+FOREIGN KEY \(\w+\) REFERENCES (\w+)\(/g)) filhas.push([m[1]!, m[2]!]);
    expect(filhas.length).toBeGreaterThan(0);
    for (const [filha, mae] of filhas) expect([filha, mae, (TABELAS_SO_NOSSAS as readonly string[]).includes(filha)]).toEqual([filha, mae, true]);
  });

  it('conferirEsquemaNosso aceita um banco migrado do zero (nenhuma tabela das migrações é desconhecida)', async () => {
    const db = { $queryRawUnsafe: async (q: string) => (q.includes('is_identity') ? [{ n: 0 }] : []) } as never;
    const esquema = new Map<string, { nome: string; tipo: string; nulo: boolean }[]>();
    for (const m of sql.matchAll(CREATE_TABLE)) esquema.set(m[1]!, []);
    const erros = await conferirEsquemaNosso(db, esquema);
    expect(erros.filter((e) => e.includes('que o importador não conhece'))).toEqual([]);
  });

  it('todo gatilho das migrações está em GATILHOS (com o que a carga faz com ele)', () => {
    const gat = [...sql.matchAll(/CREATE TRIGGER (\w+) [\s\S]*? ON (\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
    expect(gat.sort()).toEqual(GATILHOS.map((g) => `${g.tabela}.${g.nome}`).sort());
  });

  it('nenhuma sequence/identity nas migrações (a carga não faz setval), fora a sequence avulsa do idLote da NFC-e', () => {
    expect(sql.replace(SEQUENCE_AVULSA, '')).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });

  it('toda coluna acrescentada por migração em tabela do Lovable está em COLUNAS_SO_NOSSAS', () => {
    const lovable = new Set(TABELAS.map((t) => t.nome));
    const achadas = [...sql.matchAll(/ALTER TABLE "?([a-z_]+)"? ADD COLUMN "?([a-z_0-9]+)"?/g)].filter((m) => lovable.has(m[1]!));
    expect(achadas.length).toBeGreaterThan(0);
    for (const [, t, c] of achadas) expect([t, COLUNAS_SO_NOSSAS[t!]?.includes(c!)]).toEqual([t, true]);
  });
});

describe('respostas à SEFAZ (migração notas_sefaz_respostas)', () => {
  it('as 3 tabelas novas estão em TABELAS_SO_NOSSAS', () => {
    for (const t of ['sefaz_manifestacao', 'sefaz_eventos_lotes', 'sefaz_manifestacoes']) expect(TABELAS_SO_NOSSAS).toContain(t);
  });
  it('a migração não usa sequence/identity', () => {
    const m = readFileSync(join(MIGR, '20261118120000_notas_sefaz_respostas', 'migration.sql'), 'utf8');
    expect(m).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });
  it('as duas chaves estrangeiras de sefaz_manifestacoes têm índice (nota_sefaz_id e lote_id)', () => {
    expect(sql).toContain('CREATE INDEX "sefaz_manifestacoes_nota_sefaz_id_idx" ON "sefaz_manifestacoes"("nota_sefaz_id");');
    expect(sql).toContain('CREATE INDEX "sefaz_manifestacoes_lote_id_idx" ON "sefaz_manifestacoes"("lote_id");');
  });
});

describe('cupom fiscal (migração nfce)', () => {
  const m = readFileSync(join(MIGR, '20261119120000_nfce', 'migration.sql'), 'utf8');
  it('as 9 tabelas novas estão em TABELAS_SO_NOSSAS e vendas.nfce_cupom_id em COLUNAS_SO_NOSSAS', () => {
    for (const t of [
      'nfce_emitente',
      'nfce_ambientes',
      'nfce_ambientes_historico',
      'nfce_perfis_fiscais',
      'nfce_itens',
      'nfce_cupons',
      'nfce_cupom_itens',
      'nfce_cupom_pagamentos',
      'nfce_envios',
    ])
      expect(TABELAS_SO_NOSSAS).toContain(t);
    expect(COLUNAS_SO_NOSSAS.vendas).toContain('nfce_cupom_id');
  });
  it('a sequence do idLote é avulsa (aparece uma vez, e nenhuma coluna a usa como padrão)', () => {
    expect(m.split(SEQUENCE_AVULSA)).toHaveLength(2);
    expect(sql).not.toMatch(/nextval|SERIAL|IDENTITY/i);
  });
  it('os 3 gatilhos de imutável estão em GATILHOS', () => {
    for (const t of ['nfce_cupons.nfce_cupons_imutavel', 'nfce_cupom_itens.nfce_filhos_imutaveis', 'nfce_cupom_pagamentos.nfce_filhos_imutaveis'])
      expect(GATILHOS.map((g) => `${g.tabela}.${g.nome}`)).toContain(t);
  });
});

describe('importar vendas (migração vendas_importacao)', () => {
  const m = readFileSync(join(MIGR, '20261125120000_vendas_importacao', 'migration.sql'), 'utf8');
  it('as 2 tabelas novas em TABELAS_SO_NOSSAS e as colunas novas de vendas e importacoes em COLUNAS_SO_NOSSAS', () => {
    for (const t of ['vendas_origens', 'vendas_documentos']) expect(TABELAS_SO_NOSSAS).toContain(t);
    expect(COLUNAS_SO_NOSSAS.vendas).toEqual(['nfce_cupom_id', 'documento_id']);
    expect(COLUNAS_SO_NOSSAS.importacoes).toEqual(['origem_id', 'formato', 'arquivo_sha256', 'chave_idempotencia', 'corpo_sha256', 'resultado']);
  });
  it('o gatilho de imutável está em GATILHOS e a migração não usa sequence', () => {
    expect(GATILHOS.map((g) => `${g.tabela}.${g.nome}`)).toContain('vendas_documentos.vendas_documentos_imutavel');
    expect(m).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });
  it('só acrescenta: fora do corpo das funções, nada de DROP, DELETE, UPDATE, ALTER COLUMN nem RENAME', () => {
    const fora = m.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/^\s*--.*$/gm, '').replace(/^CREATE TRIGGER .*$/gm, '')
      .replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL)/g, '');
    expect(fora).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|ALTER COLUMN|RENAME/i);
  });
});

describe('controle da cana (migração cana)', () => {
  const m = readFileSync(join(MIGR, '20261127120000_cana', 'migration.sql'), 'utf8');
  it('as 4 tabelas novas em TABELAS_SO_NOSSAS e nenhuma coluna nova em tabela do Lovable', () => {
    for (const t of ['cana_parametros', 'cana_parametros_historico', 'cana_produtos', 'cana_lancamentos']) expect(TABELAS_SO_NOSSAS).toContain(t);
    expect(m).not.toMatch(/ADD COLUMN/i);
  });
  it('os 2 gatilhos de imutável estão em GATILHOS e a migração não usa sequence', () => {
    expect(GATILHOS.map((g) => `${g.tabela}.${g.nome}`)).toEqual(
      expect.arrayContaining(['cana_lancamentos.cana_lancamentos_imutavel', 'cana_parametros_historico.cana_parametros_historico_imutavel']),
    );
    expect(m).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });
  it('só acrescenta: fora do corpo das funções, nada de DROP, DELETE, UPDATE, INSERT, ALTER COLUMN nem RENAME', () => {
    const fora = m.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/^\s*--.*$/gm, '').replace(/^CREATE TRIGGER .*$/gm, '')
      .replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL)/g, '');
    expect(fora).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b|ALTER COLUMN|RENAME/i);
  });
  it('multiempresa: nenhuma FK para users e nada qualificado com public. (a migração roda em cada schema de empresa)', () => {
    expect(m).not.toMatch(/REFERENCES "?users"?/);
    expect(m).not.toMatch(/\bpublic\./);
  });
});

describe('controle da cana: o livro também não se esvazia (migração cana_truncate)', () => {
  const m = readFileSync(join(MIGR, '20261128120000_cana_truncate', 'migration.sql'), 'utf8');
  it('BEFORE TRUNCATE por instrução nas 2 tabelas só de acréscimo, e os 2 gatilhos em GATILHOS', () => {
    const gat = [...m.matchAll(/CREATE TRIGGER (\w+) BEFORE TRUNCATE ON (\w+) FOR EACH STATEMENT/g)].map((x) => `${x[2]}.${x[1]}`);
    const esperados = ['cana_lancamentos.cana_lancamentos_sem_truncate', 'cana_parametros_historico.cana_parametros_historico_sem_truncate'];
    expect(gat.sort()).toEqual(esperados);
    expect(GATILHOS.map((g) => `${g.tabela}.${g.nome}`)).toEqual(expect.arrayContaining(esperados));
  });
  it('só acrescenta e vale para todo schema de empresa: nada de DROP, DELETE, UPDATE, INSERT nem public.', () => {
    const fora = m.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/^\s*--.*$/gm, '').replace(/^CREATE TRIGGER .*$/gm, '');
    expect(fora).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b|ALTER COLUMN|RENAME/i);
    expect(m).not.toMatch(/\bpublic\./);
  });
});

describe('conferirEsquemaNosso × COLUNAS_SO_NOSSAS', () => {
  const db = {
    $queryRawUnsafe: async (q: string) => (q.includes('is_identity') ? [{ n: 0 }] : []),
  } as never;
  const esquema = (extra: string[]) =>
    new Map<string, { nome: string; tipo: string; nulo: boolean }[]>([
      ...[...TABELAS.map((t) => [t.nome, t.colunas] as const), ['users', COLUNAS_USERS] as const].map(
        ([n, cols]) => [n, [...cols, ...(n === 'notas_entrada' ? extra : [])].map((c) => ({ nome: c, tipo: 'text', nulo: true }))] as const,
      ),
    ]);
  it('repetida_de em notas_entrada não é erro', async () => {
    const erros = await conferirEsquemaNosso(db, esquema(['repetida_de']));
    expect(erros.filter((e) => e.startsWith('colunas de'))).toEqual([]);
  });
  it('coluna desconhecida a mais é erro', async () => {
    const erros = await conferirEsquemaNosso(db, esquema(['repetida_de', 'xyz']));
    expect(erros.some((e) => e.startsWith('colunas de "notas_entrada"'))).toBe(true);
  });
});
