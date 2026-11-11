import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { definirSenha } from './definir-senha';

/**
 * Define a senha de uma conta existente (ex.: o admin depois da migração do Lovable). A senha vem SÓ pelo stdin (primeira linha),
 * nunca por argumento; num terminal, é pedida sem eco. Imprime só "senha definida para <e-mail mascarado>".
 *   node dist/src/scripts/definir-senha/main.js --expect-db <banco> --email <e-mail>   (senha no stdin)
 */
const USO = 'uso: node dist/src/scripts/definir-senha/main.js --expect-db <banco> --email <e-mail>   (a senha vem pelo stdin)';

function args(argv: string[]): { expectDb: string; email: string } {
  const permitidas = new Set(['--expect-db', '--email']);
  const val = (f: string) => {
    const i = argv.indexOf(f);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v && !v.startsWith('--') ? v : undefined;
  };
  const extras = argv.filter((a, i) => !(permitidas.has(a) || permitidas.has(argv[i - 1] ?? '')));
  if (extras.length) throw new Error(`argumento não aceito: ${extras.join(' ')} (a senha nunca vai por argumento)\n${USO}`);
  const expectDb = val('--expect-db');
  const email = val('--email');
  if (!expectDb || !email) throw new Error(USO);
  return { expectDb, email };
}

/** Primeira linha do stdin; num terminal, sem eco (modo raw). */
function lerSenha(): Promise<string> {
  const ent = process.stdin;
  if (!ent.isTTY) {
    return new Promise((ok, erro) => {
      let txt = '';
      ent.setEncoding('utf8');
      ent.on('data', (c: string) => (txt += c));
      ent.on('end', () => ok(txt.split(/\r?\n/)[0] ?? ''));
      ent.on('error', erro);
    });
  }
  return new Promise((ok) => {
    process.stderr.write('Nova senha (não aparece): ');
    let buf = '';
    ent.setRawMode(true);
    ent.resume();
    ent.setEncoding('utf8');
    const ler = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') process.exit(130);
        if (ch === '\r' || ch === '\n') {
          ent.removeListener('data', ler);
          ent.setRawMode(false);
          ent.pause();
          process.stderr.write('\n');
          return ok(buf);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    ent.on('data', ler);
  });
}

async function main() {
  const { expectDb, email } = args(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('falta a variável de ambiente DATABASE_URL');
  const senha = await lerSenha();
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    console.log(await definirSenha(prisma, expectDb, email, senha));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
