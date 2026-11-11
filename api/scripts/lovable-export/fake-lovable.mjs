#!/usr/bin/env node
// Imita o Supabase do Lovable SÓ para o teste ponta a ponta, sobre um banco local descartável:
//   POST /auth/v1/token?grant_type=password → confere e-mail/senha em auth.users (pgcrypto) e devolve um JWT HS256 (role authenticated, 1 h);
//   POST /rest/v1/rpc/export_erpfreela      → como o PostgREST: sem JWT válido = papel anon; com JWT = papel authenticated e
//                                             request.jwt.claim.sub = sub (é o que auth.uid()/is_admin() leem). Executa a função SQL DE VERDADE.
// Erro 42501 (sem permissão) vira 401 para anon e 403 para authenticated, como no PostgREST.
//   DATABASE_URL=<banco> FAKE_JWT_SECRET=<segredo> node scripts/lovable-export/fake-lovable.mjs --port-file <arquivo>
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const PORT_FILE = argv[argv.indexOf('--port-file') + 1];
const SEGREDO = process.env.FAKE_JWT_SECRET ?? '';
if (!SEGREDO) throw new Error('falta FAKE_JWT_SECRET');
const prisma = new PrismaClient();
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const assinar = (h, p) => createHmac('sha256', SEGREDO).update(`${h}.${p}`).digest('base64url');
const jwt = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload); return `${h}.${p}.${assinar(h, p)}`; };

/** null = anon; { erro } = 401; { sub } = authenticated. */
function quem(req) {
  const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!tok || tok === req.headers.apikey) return null;
  const [h, p, s] = tok.split('.');
  if (!h || !p || !s) return { erro: 'JWT inválido' };
  const certo = Buffer.from(assinar(h, p));
  if (certo.length !== Buffer.from(s).length || !timingSafeEqual(certo, Buffer.from(s))) return { erro: 'JWT com assinatura inválida' };
  const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) return { erro: 'JWT expired' };
  return { sub: c.sub };
}

const lerCorpo = (req) => new Promise((ok) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => ok(JSON.parse(raw || '{}'))); });

const server = createServer(async (req, res) => {
  try {
    if (!req.headers.apikey) return json(res, 401, { message: 'sem apikey' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = await lerCorpo(req);
      const [u] = await prisma.$queryRawUnsafe(
        `SELECT id::text AS id FROM auth.users WHERE lower(email) = lower($1) AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL
            AND encrypted_password = crypt($2, encrypted_password)`,
        String(b.email ?? ''), String(b.password ?? ''),
      );
      if (!u) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      const agora = Math.floor(Date.now() / 1000);
      return json(res, 200, { access_token: jwt({ sub: u.id, role: 'authenticated', iat: agora, exp: agora + 3600 }), token_type: 'bearer', expires_in: 3600 });
    }
    if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/export_erpfreela') {
      const q = quem(req);
      if (q?.erro) return json(res, 401, { code: 'PGRST301', message: q.erro });
      const b = await lerCorpo(req);
      try {
        const r = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${q ? 'authenticated' : 'anon'}`);
          if (q) await tx.$queryRawUnsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, q.sub);
          const [row] = await tx.$queryRawUnsafe(
            'SELECT public.export_erpfreela($1::text, $2::text, $3::int, $4::int) AS r',
            b.p_action ?? null, b.p_name ?? null, b.p_limit ?? 1000, b.p_offset ?? 0,
          );
          return row.r;
        });
        return json(res, 200, r);
      } catch (e) {
        const msg = String(e.meta?.message ?? e.message ?? e).slice(-300);
        const semPermissao = e.meta?.code === '42501' || /42501|permission denied|Acesso negado/.test(String(e.message));
        return json(res, semPermissao ? (q ? 403 : 401) : 400, { code: semPermissao ? '42501' : 'P0001', message: msg });
      }
    }
    return json(res, 404, { message: 'not found' });
  } catch (e) {
    return json(res, 500, { message: String(e.message ?? e).slice(-300) });
  }
});
server.listen(0, '127.0.0.1', () => writeFileSync(PORT_FILE, String(server.address().port)));
