import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { parseArgs } from './cli';
import { lerExportacao } from './exportacao';
import { executar } from './importador';

/**
 * Importador dos dados do Lovable (script avulso: NÃO sobe o app Nest). Roteiro: docs/migracao-lovable.md.
 *   node dist/src/scripts/import-lovable/main.js --file <exportacao.json> --expect-db <banco> [--dry-run | --verify]
 *        [--pular-sem-papel]
 * Sai 0 só com tudo conferido; 1 em qualquer trava ou diferença (e então nada foi gravado).
 */
async function main() {
  const op = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('falta a variável de ambiente DATABASE_URL');
  const exp = lerExportacao(op.arquivo);
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const r = await executar(prisma, exp, op);
    for (const l of r.linhas) console.log(l);
    if (!r.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
