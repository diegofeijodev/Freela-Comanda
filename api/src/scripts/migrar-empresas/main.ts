/**
 * Deploy multiempresa: depois do `prisma migrate deploy` (schema `public`), aplica as mesmas migrações no schema de cada empresa.
 * Idempotente. Uso (o CMD do Dockerfile já roda):  node dist/src/scripts/migrar-empresas/main.js
 * Em dev:  npx ts-node --transpile-only src/scripts/migrar-empresas/main.ts
 */
import { PrismaClient } from '@prisma/client';
import { NOME_SCHEMA, SCHEMA_PADRAO } from '../../common/database/empresa-contexto';
import { migrarSchema } from '../../common/database/migrar-schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  const prisma = new PrismaClient();
  try {
    const es = await prisma.empresas.findMany({ where: { schema_banco: { not: null } }, select: { schema_banco: true } });
    const schemas = es.map((e) => e.schema_banco!).filter((s) => s !== SCHEMA_PADRAO && NOME_SCHEMA.test(s));
    for (const s of schemas) {
      await migrarSchema(url, s);
      console.log(`migrar-empresas: ${s} em dia`);
    }
    console.log(`migrar-empresas: ${schemas.length} schema(s) de empresa conferido(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(String(e));
  process.exit(1);
});
