#!/usr/bin/env node
// Entra no Lovable (Supabase Auth) como ADMINISTRADOR e imprime SÓ o access_token (JWT, vale ~1 h) no stdout. Roda na máquina do dono.
// Node puro. SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY vêm do ambiente. E-mail e senha são pedidos no terminal (senha sem eco);
// não há opção nem variável para a senha. Sem terminal (teste), lê duas linhas do stdin: e-mail e senha.
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node scripts/lovable-export/login.mjs > jwt
// Mensagens e erros vão para o stderr; a senha nunca é impressa.
const limpa = (v) => (v ?? '').trim().replace(/^["']|["']$/g, '');
const BASE = limpa(process.env.SUPABASE_URL).replace(/\/+$/, '');
const CHAVE = limpa(process.env.SUPABASE_PUBLISHABLE_KEY);
const falha = (m) => { process.stderr.write(`ERRO: ${m}\n`); process.exit(1); };
if (!/^https?:\/\//.test(BASE) || !CHAVE) falha('defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no ambiente (valores do .env do Lovable)');
if (process.argv.length > 2) falha('este script não aceita argumentos (a senha é pedida no terminal)');

/** Lê uma linha do terminal; com `oculto`, sem eco (modo raw: Enter termina, Backspace apaga, Ctrl-C cancela). */
function perguntar(texto, oculto) {
  return new Promise((ok) => {
    const ent = process.stdin;
    process.stderr.write(texto);
    let buf = '';
    ent.setRawMode(oculto);
    ent.resume();
    ent.setEncoding('utf8');
    const ler = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { process.stderr.write('\n'); process.exit(130); }
        if (ch === '\r' || ch === '\n') {
          ent.removeListener('data', ler);
          ent.setRawMode(false);
          ent.pause();
          if (oculto) process.stderr.write('\n');
          return ok(buf);
        }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    ent.on('data', ler);
  });
}

async function linhasDoStdin() {
  let txt = '';
  for await (const c of process.stdin) txt += c;
  const [email = '', senha = ''] = txt.split(/\r?\n/);
  return { email, senha };
}

const { email, senha } = process.stdin.isTTY
  ? { email: await perguntar('E-mail do administrador no Lovable: ', false), senha: await perguntar('Senha (não aparece): ', true) }
  : await linhasDoStdin();
if (!email.trim() || !senha) falha('e-mail e senha são obrigatórios');

let r;
try {
  r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: CHAVE, 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password: senha }),
    signal: AbortSignal.timeout(30_000),
  });
} catch (e) {
  falha(`não consegui falar com o Lovable: ${e.message}`);
}
const corpo = await r.json().catch(() => ({}));
if (!r.ok || typeof corpo.access_token !== 'string') {
  const motivo = corpo.error_description || corpo.msg || corpo.message || corpo.error || `HTTP ${r.status}`;
  falha(`login recusado pelo Lovable (${String(motivo).slice(0, 200)})`);
}
process.stderr.write(`ok: entrou como ${email.trim().replace(/^(.{2}).*@/, '$1***@')}; o token vale ${Math.round((corpo.expires_in ?? 3600) / 60)} min — rode o pull logo.\n`);
process.stdout.write(`${corpo.access_token}\n`);
