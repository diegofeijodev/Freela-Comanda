#!/usr/bin/env node
// Puxa a exportação do Lovable (função SQL public.export_erpfreela, ver export_erpfreela.sql) e grava UM arquivo JSON (modo 600).
// Roda no EC2, dentro da imagem da API (Node puro, sem dependências). A URL e a chave publishable vêm SÓ do ambiente; o login é o JWT
// de um ADMINISTRADOR do Lovable gerado pelo login.mjs na máquina do dono (vale ~1 h):
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<chave> \
//     node scripts/lovable-export/pull.mjs --jwt-file <arquivo> --out <arquivo.json> [--check-only]
//
// --check-only: só o resumo (tabelas, linhas, contas), sem gravar nada.
// Confere: linhas de cada tabela/view/contas = resumo, e o resumo do FIM igual ao do começo (contagens e somas) — se a base mudou
// durante o pull, sai 1 sem gravar (congele o Lovable e rode de novo). Login vencido/recusado: sai 1 pedindo para entrar de novo.
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const FORMATO = 'erpfreela-export/2';
// Página por chamada (a função aceita até 2000). PULL_PAGINA só existe para o teste forçar várias páginas.
const PAGINA = Math.min(Math.max(Number(process.env.PULL_PAGINA) || 1000, 1), 2000);
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const falha = (m) => { console.error(`ERRO: ${m}`); process.exit(1); };
const ENTRE = 'Entre de novo (login.mjs na sua máquina, como ADMINISTRADOR do Lovable) e rode o pull logo em seguida.';

const limpa = (v) => (v ?? '').trim().replace(/^["']|["']$/g, '');
const BASE = limpa(process.env.SUPABASE_URL).replace(/\/+$/, '');
const CHAVE = limpa(process.env.SUPABASE_PUBLISHABLE_KEY);
if (!/^https?:\/\//.test(BASE) || !CHAVE) falha('defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no ambiente (valores do .env do Lovable)');
const arqJwt = flag('--jwt-file');
if (!arqJwt) falha('falta --jwt-file (o login do administrador, gerado pelo login.mjs)');
const JWT = readFileSync(arqJwt, 'utf8').trim();
if (!JWT) falha(`--jwt-file vazio. ${ENTRE}`);
const CHECK_ONLY = argv.includes('--check-only');
const OUT = flag('--out') ? resolve(flag('--out')) : undefined;
if (!CHECK_ONLY && !OUT) falha('falta --out <arquivo.json>');

// Vencimento lido do próprio JWT (sem conferir assinatura: quem confere é o Lovable) só para avisar antes de começar.
const exp = (() => {
  try { return JSON.parse(Buffer.from(JWT.split('.')[1] ?? '', 'base64url').toString('utf8')).exp; } catch { return undefined; }
})();
if (typeof exp !== 'number') falha(`o --jwt-file não tem um login válido. ${ENTRE}`);
if (exp * 1000 < Date.now() + 60_000) falha(`o login venceu (ou vence em menos de 1 min). ${ENTRE}`);

const RPC = `${BASE}/rest/v1/rpc/export_erpfreela`;
const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${JWT}`, 'content-type': 'application/json' };

async function rpc(acao, nome = null, offset = 0) {
  const body = JSON.stringify({ p_action: acao, p_name: nome, p_limit: PAGINA, p_offset: offset });
  for (let tentativa = 1; ; tentativa++) {
    let r;
    try {
      r = await fetch(RPC, { method: 'POST', headers: cabecalhos, body, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      if (tentativa >= 3) throw new Error(`${acao} ${nome ?? ''}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
      continue;
    }
    if (r.ok) return r.json();
    const texto = (await r.text()).slice(0, 300);
    if (r.status === 401 || r.status === 403) {
      throw new Error(`o Lovable recusou o login (HTTP ${r.status}: ${texto}). Só um ADMINISTRADOR consegue exportar. ${ENTRE}`);
    }
    if (tentativa >= 3 || r.status < 500) throw new Error(`${acao} ${nome ?? ''} → HTTP ${r.status}: ${texto}`);
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
  }
}

async function paginas(acao, nome, esperado) {
  const linhas = [];
  for (let offset = 0; offset < esperado; offset += PAGINA) {
    const { linhas: pagina } = await rpc(acao, nome, offset);
    if (!Array.isArray(pagina) || pagina.length === 0) break;
    linhas.push(...pagina);
  }
  return linhas;
}

/** O que precisa ficar parado durante o pull: linhas e somas de cada tabela, nº de contas e movimentações por tipo. */
const assinatura = (r) =>
  JSON.stringify({
    t: Object.fromEntries(Object.entries(r.tabelas).map(([k, v]) => [k, { linhas: v.linhas, somas: v.somas }])),
    u: r.usuarios,
    m: r.movimentacoes_por_tipo,
  });

try {
  const resumo = await rpc('resumo');
  const nLinhas = Object.values(resumo.tabelas).reduce((a, t) => a + Number(t.linhas), 0);
  console.log(`Lovable: ${Object.keys(resumo.tabelas).length} tabelas, ${nLinhas} linhas, ${resumo.usuarios} conta(s); fuso ${resumo.meta.fuso}, Postgres ${resumo.meta.versao_pg}`);
  for (const [t, info] of Object.entries(resumo.tabelas)) console.log(`  ${t}: ${info.linhas}`);
  console.log(`views: ${Object.entries(resumo.views).map(([v, n]) => `${v} ${n}`).join(', ')}`);
  if (CHECK_ONLY) process.exit(0);

  let falhas = 0;
  const confere = (o, n, esperado) => { if (n !== Number(esperado)) { falhas++; console.log(`FALHA ${o}: ${n} de ${esperado}`); } };
  const tabelas = {};
  for (const [t, info] of Object.entries(resumo.tabelas)) {
    tabelas[t] = await paginas('tabela', t, Number(info.linhas));
    confere(t, tabelas[t].length, info.linhas);
  }
  const usuarios = await paginas('usuarios', null, Number(resumo.usuarios));
  confere('contas (auth.users)', usuarios.length, resumo.usuarios);
  const views = {};
  for (const [v, n] of Object.entries(resumo.views)) {
    views[v] = await paginas('view', v, Number(n));
    confere(v, views[v].length, n);
  }
  if (falhas) falha(`${falhas} contagem(ns) não bateram com o resumo. Nada foi gravado; rode de novo.`);
  if (assinatura(await rpc('resumo')) !== assinatura(resumo)) {
    falha('a base do Lovable mudou durante a exportação (contagens/somas do fim ≠ começo). Congele o uso e rode de novo. Nada foi gravado.');
  }

  mkdirSync(dirname(OUT), { recursive: true, mode: 0o700 });
  const tmp = `${OUT}.parcial`;
  writeFileSync(tmp, JSON.stringify({ formato: FORMATO, resumo, tabelas, usuarios, views }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, OUT);
  console.log(`\nexportação completa e conferida: ${OUT} (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, modo 600)`);
} catch (e) {
  falha(e.message);
}
