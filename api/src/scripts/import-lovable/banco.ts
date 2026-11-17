import { Prisma } from '@prisma/client';
import { mesmoDecimal } from './decimal';
import { EsquemaNosso, Linha } from './exportacao';
import { COLUNAS_SO_NOSSAS, COLUNAS_USERS, GATILHOS, SEED_SAZONALIDADE, SEED_SUBGRUPOS, TABELAS, TABELAS_COM_SEED, TABELAS_SO_NOSSAS } from './esquema';

export type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
/** Identificador SQL entre aspas — só nomes simples (todos vêm das listas fixas de esquema.ts). */
export function q(nome: string): string {
  if (!IDENT.test(nome)) throw new Error(`identificador inválido: ${JSON.stringify(nome)}`);
  return `"${nome}"`;
}

/** O banco conectado é o esperado (--expect-db). */
export async function conferirBanco(db: Db, esperado: string): Promise<string> {
  const [r] = await db.$queryRawUnsafe<{ db: string }[]>('SELECT current_database() AS db');
  if (r?.db !== esperado) throw new Error(`O banco conectado é "${r?.db}", não "${esperado}" (--expect-db). Nada foi gravado.`);
  return r.db;
}

export async function lerEsquemaNosso(db: Db): Promise<EsquemaNosso> {
  const rows = await db.$queryRawUnsafe<{ t: string; c: string; tipo: string; nulo: boolean }[]>(
    `SELECT c.table_name::text AS t, c.column_name::text AS c, c.data_type::text AS tipo, c.is_nullable::text = 'YES' AS nulo
       FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name, c.ordinal_position`,
  );
  const out: EsquemaNosso = new Map();
  for (const r of rows) out.set(r.t, [...(out.get(r.t) ?? []), { nome: r.c, tipo: r.tipo, nulo: r.nulo }]);
  return out;
}

/** O banco conectado é exatamente o que esquema.ts descreve (senão a carga perderia ou inventaria dado em silêncio). */
export async function conferirEsquemaNosso(db: Db, esquema: EsquemaNosso): Promise<string[]> {
  const erros: string[] = [];
  const esperadas = new Map<string, readonly string[]>([...TABELAS.map((t) => [t.nome, t.colunas] as const), ['users', COLUNAS_USERS]]);
  for (const t of esquema.keys()) {
    if (!esperadas.has(t) && !(TABELAS_SO_NOSSAS as readonly string[]).includes(t))
      erros.push(`tabela "${t}" no banco que o importador não conhece`);
  }
  for (const [t, cols] of esperadas) {
    const nossas = COLUNAS_SO_NOSSAS[t] ?? [];
    const reais = (esquema.get(t) ?? []).map((c) => c.nome).filter((c) => !nossas.includes(c));
    if (!reais.length) {
      erros.push(`falta a tabela "${t}" no banco (as migrações rodaram?)`);
      continue;
    }
    const a = [...cols].sort().join(',');
    const b = [...reais].sort().join(',');
    if (a !== b) erros.push(`colunas de "${t}" no banco (${b}) ≠ esquema.ts (${a})`);
  }
  const [seq] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')`,
  );
  if (seq?.n) erros.push(`${seq.n} coluna(s) com sequence/identity: a carga não sabe ajustar sequences (setval)`);
  const gat = await db.$queryRawUnsafe<{ t: string; g: string; on: string }[]>(
    `SELECT c.relname::text AS t, tg.tgname::text AS g, tg.tgenabled::text AS on FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT tg.tgisinternal`,
  );
  for (const x of gat) {
    if (!GATILHOS.some((g) => g.tabela === x.t && g.nome === x.g))
      erros.push(`gatilho ${x.t}.${x.g} não está em GATILHOS (esquema.ts): decida o que fazer com ele na carga`);
    else if (x.on !== 'O') erros.push(`gatilho ${x.t}.${x.g} já está desligado (tgenabled=${x.on}) antes da carga`);
  }
  for (const g of GATILHOS) if (!gat.some((x) => x.t === g.tabela && x.g === g.nome)) erros.push(`falta o gatilho ${g.tabela}.${g.nome}`);
  return erros;
}

/** O que impede a carga: qualquer dado além dos seeds da migração `regras` (mesma transação da carga, com as tabelas travadas). */
export async function problemasDeBancoNaoVazio(tx: Db): Promise<string[]> {
  const out: string[] = [];
  const contar = async (t: string) =>
    (await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.${q(t)}`))[0]?.n ?? 0;
  for (const t of ['users', ...TABELAS.map((x) => x.nome).filter((n) => !(TABELAS_COM_SEED as readonly string[]).includes(n))]) {
    const n = await contar(t);
    if (n) out.push(`${t}: ${n} linha(s)`);
  }
  await tx.$executeRawUnsafe('CREATE TEMP TABLE _cfg_padrao (LIKE public.configuracoes INCLUDING DEFAULTS) ON COMMIT DROP');
  await tx.$executeRawUnsafe('INSERT INTO _cfg_padrao (id) VALUES (1)');
  const [cfg] = await tx.$queryRawUnsafe<{ n: number; dif: number }[]>(
    'SELECT (SELECT count(*) FROM public.configuracoes)::int AS n, (SELECT count(*) FROM (SELECT * FROM public.configuracoes EXCEPT SELECT * FROM _cfg_padrao) d)::int AS dif',
  );
  if (cfg?.n !== 1 || cfg.dif) out.push('configuracoes: diferente da linha padrão da migração (alguém já editou as configurações)');
  const saz = await tx.$queryRawUnsafe<{ mes: number; f: string }[]>(
    'SELECT mes, fator_pct::text AS f FROM public.sazonalidade ORDER BY mes',
  );
  if (
    saz.length !== SEED_SAZONALIDADE.length ||
    saz.some((r, i) => r.mes !== SEED_SAZONALIDADE[i]?.[0] || !mesmoDecimal(r.f, SEED_SAZONALIDADE[i]?.[1]))
  ) {
    out.push('sazonalidade: diferente do seed da migração');
  }
  const sub = await tx.$queryRawUnsafe<{ nome: string; grupo: string; ordem: number }[]>(
    'SELECT nome, grupo, ordem FROM public.subgrupos ORDER BY ordem, nome',
  );
  const a = JSON.stringify(sub.map((r) => [r.nome, r.grupo, r.ordem]));
  if (a !== JSON.stringify(SEED_SUBGRUPOS)) out.push('subgrupos: diferente do seed da migração');
  return out;
}

/**
 * INSERT em lotes de 500, colunas da lista fixa, valores só como parâmetro jsonb. As chaves já foram conferidas
 * (validarExportacao): `jsonb_populate_recordset` ignoraria chave a mais e poria nulo na que falta.
 */
export async function inserirLinhas(
  db: Db,
  destino: string,
  tipoLinha: string,
  colunas: readonly string[],
  linhas: Linha[],
): Promise<void> {
  const cols = colunas.map(q).join(', ');
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500).map((r) => Object.fromEntries(colunas.map((c) => [c, r[c] ?? null])));
    await db.$executeRawUnsafe(
      `INSERT INTO ${destino} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::public.${q(tipoLinha)}, $1::jsonb)`,
      JSON.stringify(lote),
    );
  }
}
