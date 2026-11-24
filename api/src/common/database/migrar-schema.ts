import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { NOME_SCHEMA } from './empresa-contexto';

/** A mesma URL do banco, apontando para outro schema (o Prisma usa o parâmetro `schema` como `search_path`). */
export function urlDoSchema(base: string, schema: string, limiteConexoes?: number): string {
  if (!NOME_SCHEMA.test(schema)) throw new Error('schema de empresa inválido');
  const u = new URL(base);
  u.searchParams.set('schema', schema);
  if (limiteConexoes) u.searchParams.set('connection_limit', String(limiteConexoes));
  return u.toString();
}

const RAIZ_API = path.resolve(__dirname, '..', '..', '..', ...(__dirname.includes(`${path.sep}dist${path.sep}`) ? ['..'] : []));

/**
 * Aplica TODAS as migrações (as mesmas do `public`) num schema de empresa: cria o schema se faltar e é idempotente
 * (o `_prisma_migrations` fica dentro do próprio schema). Usa o CLI do Prisma, que já vai na imagem (o CMD roda `migrate deploy`).
 */
export function migrarSchema(databaseUrl: string, schema: string): Promise<void> {
  const url = urlDoSchema(databaseUrl, schema);
  const cli = require.resolve('prisma/build/index.js', { paths: [RAIZ_API] });
  return new Promise((ok, falha) => {
    execFile(
      process.execPath,
      [cli, 'migrate', 'deploy', '--schema', path.join(RAIZ_API, 'prisma', 'schema.prisma')],
      { cwd: RAIZ_API, env: { ...process.env, DATABASE_URL: url, NODE_OPTIONS: '--max-old-space-size=256' }, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
      (erro, _out, err) => {
        // Nunca a URL (tem a senha do banco): só o schema e o fim do stderr do Prisma.
        if (erro) falha(new Error(`migração do schema ${schema} falhou: ${String(err).replace(/postgres(ql)?:\/\/\S+/g, '[url]').slice(-400)}`));
        else ok();
      },
    );
  });
}
