#!/usr/bin/env node
// Imita o PostgREST do Lovable SÓ para o teste ponta a ponta: POST /rest/v1/rpc/export_erpfreela executa a função SQL DE VERDADE
// (instalada num banco local descartável) com o papel `anon` — sem nenhum grant nas tabelas, o que prova o SECURITY DEFINER.
//   DATABASE_URL=<banco "Lovable" local> node scripts/lovable-export/fake-lovable.mjs --port-file <arquivo>
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const PORT_FILE = argv[argv.indexOf('--port-file') + 1];
const prisma = new PrismaClient();
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/rest/v1/rpc/export_erpfreela') return json(res, 404, { message: 'not found' });
  if (!req.headers.apikey) return json(res, 401, { message: 'sem apikey' });
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    try {
      const b = JSON.parse(raw || '{}');
      const r = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE anon');
        const [row] = await tx.$queryRawUnsafe(
          'SELECT public.export_erpfreela($1::text, $2::text, $3::text, $4::int, $5::int) AS r',
          b.p_token ?? null, b.p_action ?? null, b.p_name ?? null, b.p_limit ?? 1000, b.p_offset ?? 0,
        );
        return row.r;
      });
      json(res, 200, r);
    } catch (e) {
      json(res, 400, { message: String(e.message ?? e).slice(-300) });
    }
  });
});
server.listen(0, '127.0.0.1', () => writeFileSync(PORT_FILE, String(server.address().port)));
