import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLUNAS_USERS, GATILHOS, TABELAS, TABELAS_SO_NOSSAS } from '../esquema';

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
    expect(fks).toHaveLength(18);
    for (const [, filha, mae] of fks) expect([filha, ordem.indexOf(mae!) < ordem.indexOf(filha!)]).toEqual([filha, true]);
  });

  it('todo gatilho das migrações está em GATILHOS (com o que a carga faz com ele)', () => {
    const gat = [...sql.matchAll(/CREATE TRIGGER (\w+) [\s\S]*? ON (\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
    expect(gat.sort()).toEqual(GATILHOS.map((g) => `${g.tabela}.${g.nome}`).sort());
  });

  it('nenhuma sequence/identity nas migrações (a carga não faz setval)', () => {
    expect(sql).not.toMatch(/SERIAL|IDENTITY|nextval|CREATE SEQUENCE/i);
  });
});
