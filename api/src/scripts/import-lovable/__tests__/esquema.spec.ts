import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conferirEsquemaNosso } from '../banco';
import { COLUNAS_SO_NOSSAS, COLUNAS_USERS, GATILHOS, TABELAS, TABELAS_SO_NOSSAS } from '../esquema';

/** Lê as migrações versionadas: a lista fixa do importador não pode se afastar delas. */
const MIGR = join(__dirname, '../../../../prisma/migrations');
const sql = readdirSync(MIGR)
  .filter((d) => !d.endsWith('.toml'))
  .sort()
  .map((d) => readFileSync(join(MIGR, d, 'migration.sql'), 'utf8'))
  .join('\n');

describe('esquema.ts × migrações', () => {
  it('colunas de cada tabela = CREATE TABLE da migração init (e users)', () => {
    const criadas = new Map<string, string[]>();
    for (const m of sql.matchAll(/CREATE TABLE "([a-z_]+)" \(\n([\s\S]*?)\n\);/g)) {
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
    expect(fks).toHaveLength(23);
    for (const [, filha, mae] of fks) {
      if (filha === mae) continue; // auto-referência (notas_entrada.repetida_de): sem ordem a respeitar
      if ((TABELAS_SO_NOSSAS as readonly string[]).includes(filha!)) continue; // tabela só nossa (SEFAZ): a carga não toca
      expect([filha, ordem.indexOf(mae!) < ordem.indexOf(filha!)]).toEqual([filha, true]);
    }
  });

  it('todo gatilho das migrações está em GATILHOS (com o que a carga faz com ele)', () => {
    const gat = [...sql.matchAll(/CREATE TRIGGER (\w+) [\s\S]*? ON (\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
    expect(gat.sort()).toEqual(GATILHOS.map((g) => `${g.tabela}.${g.nome}`).sort());
  });

  it('nenhuma sequence/identity nas migrações (a carga não faz setval)', () => {
    expect(sql).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });

  it('toda coluna acrescentada por migração em tabela do Lovable está em COLUNAS_SO_NOSSAS', () => {
    const lovable = new Set(TABELAS.map((t) => t.nome));
    const achadas = [...sql.matchAll(/ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_0-9]+)"/g)].filter((m) => lovable.has(m[1]!));
    expect(achadas.length).toBeGreaterThan(0);
    for (const [, t, c] of achadas) expect([t, COLUNAS_SO_NOSSAS[t!]?.includes(c!)]).toEqual([t, true]);
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
