// Grupo do browser-check: Cana (`/cana`; desenho 24/11 C.4 e UX 5.2, itens 13–17). Roda sozinho na pilha do browser-check.sh:
//   BC_ROTAS="/ /auth /painel /cana" CHECK_SCRIPT=scripts/browser-check-cana.mjs ../scripts/run-capped.sh 2400 bash scripts/browser-check.sh   (em web/)
// Admin a 1366 px: sem contagem ("Para ver a primeira semana:") → configura 2 produtos (um frozen) e o rendimento → lança pela aba
// Lançamentos (contagem, recebimento, produção, contagem) → a Semana com as contas por extenso e o Por produto → Anular (diálogo,
// motivo curto, riscado). Loja a 360 px (tela `cana` liberada): só os 3 botões, sem data livre, lança e não vê NENHUMA conta.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/doutor/coding/freela/freela-web-v2/node_modules/playwright');

const BASE = process.env.BASE ?? 'http://localhost:3026';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'erp-telas');
const PG = process.env.PG_CONTAINER ?? 'erp-freela-postgres';
const PGDB = process.env.PGDB ?? 'erpfreela_browser';
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync('docker', ['exec', PG, 'psql', '-U', 'erpfreela', '-d', PGDB, '-t', '-A', '-c', q]).toString().trim();

let ok = 0;
const falhas = [];
const check = (desc, cond, extra = '') => {
  if (cond) ok++;
  else {
    falhas.push(`${desc} ${extra}`.trim());
    console.log(`FALHOU: ${desc} ${extra}`);
  }
};
const diaSp = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + d * 864e5));
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const C1 = diaSp(-8);
const C2 = diaSp(-1);
const HOJE = diaSp(0);

// O cardápio do seed não tem caldo: 2 produtos e as vendas da semana entram pelo banco (a importação já tem o seu grupo).
sql(`insert into itens_cardapio (nome, categoria, grupo) values ('Caldo de cana 300 ml','Bebidas','Bebidas'), ('Frozen de cana 400 ml','Bebidas','Bebidas')`);
sql(`insert into vendas (pedido, data, produto_relatorio, item_cardapio_id, quantidade, valor_total)
     select 'BC-K1', '${diaSp(-4)}', 'CALDO DE CANA 300', id, 100, 800 from itens_cardapio where nome = 'Caldo de cana 300 ml'
     union all select 'BC-K2', '${diaSp(-4)}', 'FROZEN 400', id, 40, 600 from itens_cardapio where nome = 'Frozen de cana 400 ml'`);

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });

async function sessao(email, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|DevTools|Download the React|\[HMR\]|Fast Refresh/i.test(t)) return;
    erros.push(`console: ${t.slice(0, 200)}`);
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForFunction(() => !!document.querySelector('#email') && Object.keys(document.querySelector('#email')).some((k) => k.startsWith('__react')), null, { timeout: 120_000 });
  await page.fill('#email', email);
  await page.fill('#senha', 'erpfreela123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel', { timeout: 120_000, waitUntil: 'commit' });
  return { ctx, page, erros };
}
const ve = async (page, texto, timeout = 30_000) => page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(() => true, () => false);
const foto = (page, nome) => page.screenshot({ path: join(SHOTS, `${nome}.png`), fullPage: true });
const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Lança pela aba Lançamentos do admin: `quando` = 'Ontem' ou uma data (Outra data). */
async function lancarAdmin(page, botao, quando, campos) {
  await page.getByRole('button', { name: `Novo: ${botao}` }).click();
  if (quando === 'Ontem') await page.getByRole('radio', { name: /^Ontem/ }).click();
  else {
    await page.getByRole('radio', { name: 'Outra data' }).click();
    await page.getByLabel('Data do lançamento').fill(quando);
  }
  for (const [rotulo, valor] of campos) await page.getByLabel(rotulo, { exact: true }).fill(valor);
  await page.getByRole('button', { name: /^Lançar / }).click();
  await page.getByRole('button', { name: 'Novo: Recebi cana' }).waitFor();
}

// ================================================================================================ ADMIN, computador
{
  const { ctx, page, erros } = await sessao('admin@erpfreela.local');
  await page.goto(`${BASE}/cana`, { waitUntil: 'networkidle' });
  check('14: sem contagem, a lista "Para ver a primeira semana:"', await ve(page, 'Para ver a primeira semana:'));
  check('14: o passo da primeira contagem', await ve(page, 'Faça a primeira contagem: ela é o ponto de partida da primeira semana.'));

  // configuração: nada vem preenchido; 2 produtos (um frozen) e o rendimento
  await page.goto(`${BASE}/cana?aba=configuracao`, { waitUntil: 'networkidle' });
  check('configuração: "Nada configurado" antes de tudo', await ve(page, 'Nada configurado: o caldo vendido aparece como 0.'));
  check('configuração: abre nos que parecem de caldo (2)', await ve(page, 'Parecem de caldo (2)'));
  check('configuração: nenhum switch ligado de fábrica', (await page.getByRole('switch', { checked: true }).count()) === 0);
  await page.getByRole('switch', { name: 'Caldo de cana 300 ml leva caldo' }).click();
  await page.getByLabel('ml de caldo em 1 unidade').fill('300');
  check('configuração: a conta de 1 venda ao vivo', await ve(page, 'Cada venda conta 0,3 L de caldo.'));
  await page.getByRole('button', { name: 'Salvar Caldo de cana 300 ml' }).click();
  check('configuração: caldo salvo', await ve(page, 'Caldo de cana 300 ml salvo'));
  await page.getByRole('switch', { name: 'Frozen de cana 400 ml leva caldo' }).click();
  await page.getByRole('checkbox', { name: 'Frozen de cana 400 ml é frozen' }).click();
  await page.getByLabel('ml de frozen em 1 unidade (o tamanho do copo)').fill('400');
  check('configuração: frozen sem rendimento avisa', await ve(page, 'Falta o rendimento do frozen: este produto ainda não entra na conta.'));
  await page.getByRole('button', { name: 'Salvar Frozen de cana 400 ml' }).click();
  await page.getByLabel('1 litro de caldo vira quantos litros de frozen?').fill('1,25');
  await page.getByRole('button', { name: 'Salvar os números' }).click();
  check('configuração: números salvos, com quem mudou', await ve(page, 'Última mudança: Admin Demo'));
  check('banco: 2 produtos e o rendimento', sql(`select count(*) || ' ' || (select rendimento_frozen::float from cana_parametros) from cana_produtos where ativo`) === '2 1.25');
  await foto(page, 'cana-1366-configuracao');

  // lançamentos (formulário com Outra data)
  await page.goto(`${BASE}/cana?aba=lancamentos`, { waitUntil: 'networkidle' });
  await lancarAdmin(page, 'Contagem do que sobrou', C1, [['Dúzias de cana que sobraram', '4'], ['Litros de caldo que sobraram', '3']]);
  await lancarAdmin(page, 'Recebi cana', diaSp(-5), [['Quantas dúzias chegaram?', '12']]);
  await lancarAdmin(page, 'Produzi caldo', diaSp(-3), [['Quantos litros de caldo saíram?', '50']]);
  await lancarAdmin(page, 'Recebi cana', diaSp(-2), [['Quantas dúzias chegaram?', '7']]);
  await lancarAdmin(page, 'Contagem do que sobrou', 'Ontem', [['Dúzias de cana que sobraram', '6'], ['Litros de caldo que sobraram', '5']]);
  check('banco: 5 lançamentos do admin', sql('select count(*) from cana_lancamentos') === '5');

  // 17: anular (o recebimento de 7 dúzias, lançado "em dobro")
  const linha = page.getByRole('listitem').filter({ hasText: 'Recebi cana · 7 dúzias' });
  await linha.getByRole('button', { name: /^Anular/ }).click();
  const voltar = page.getByRole('button', { name: 'Voltar sem anular' });
  await voltar.waitFor();
  check('17: o diálogo abre com o foco em "Voltar sem anular"', await voltar.evaluate((b) => b === document.activeElement));
  await page.getByLabel('Motivo (obrigatório)').fill('ab');
  await page.getByRole('button', { name: 'Anular o lançamento' }).click();
  check('17: motivo curto mostra o erro', await ve(page, 'Escreva o motivo (pelo menos 3 letras).'));
  await page.getByRole('button', { name: 'Lançado em dobro' }).click();
  await page.getByRole('button', { name: 'Anular o lançamento' }).click();
  check('17: anulado (toast)', await ve(page, 'Lançamento anulado.'));
  const anulada = page.getByRole('listitem').filter({ hasText: 'Lançado em dobro' });
  check('17: o anulado fica na lista, riscado e com a tag', (await anulada.locator('.line-through').count()) === 1 && (await anulada.getByText('Anulado', { exact: true }).count()) === 1);
  check('banco: o anulado continua no livro', sql("select count(*) from cana_lancamentos where anulado_motivo = 'Lançado em dobro'") === '1');

  // 13: a Semana com a conta escrita (C1 → ontem): 4 + 12 − 6 = 10 dúzias; 3 + 50 − 42,8 − 5 = 5,2 L; 42,8 ÷ 10 = 4,28
  await page.goto(`${BASE}/cana?aba=semana`, { waitUntil: 'networkidle' });
  check('13: a semana fechada abre primeiro', await ve(page, `Semana de ${dm(diaSp(-7))} a ${dm(C2)}`));
  check('13: cana moída com a conta', await ve(page, `= 4 dúzias que sobraram (contagem de ${dm(C1)})`) && await ve(page, `− 6 dúzias que sobraram (contagem de ${dm(C2)})`));
  check('13: perda de caldo com a conta', await ve(page, '− 42,8 L vendidos') && await ve(page, '5,2 L'));
  check('13: rendimento da semana', await ve(page, '4,28 L vendidos por dúzia') && await ve(page, '= 42,8 L de caldo vendido ÷ 10 dúzias de cana moída'));
  check('13: Por produto com a conta do frozen', await ve(page, '40 × 400 ml = 16 L de frozen ÷ 1,25 = 12,8 L de caldo'));
  await foto(page, 'cana-1366-semana');
  check('admin: sem erro de console', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ================================================================================================ LOJA, celular 360 px
sql("update users set modulos = array_append(modulos, 'cana') where email = 'loja@erpfreela.local'");
{
  const { ctx, page, erros } = await sessao('loja@erpfreela.local', { width: 360, height: 800 });
  await page.goto(`${BASE}/cana?aba=semana`, { waitUntil: 'networkidle' });
  check('16: /cana?aba=semana direto continua na visão de lançar', await ve(page, 'Anote o que chegou, o que produziu e o que sobrou.'));
  check('15: sem abas', (await page.getByRole('tab').count()) === 0);
  for (const b of ['Recebi cana', 'Produzi caldo', 'Contagem do que sobrou']) check(`15: o botão "${b}"`, (await page.getByRole('button', { name: new RegExp(`^${b}`) }).count()) === 1);
  check('15: "Seus lançamentos dos últimos 7 dias"', await ve(page, 'Seus lançamentos dos últimos 7 dias'));
  const alto = await page.getByRole('button', { name: /^Recebi cana/ }).boundingBox();
  check('15: botão grande (72 px)', !!alto && alto.height >= 72, JSON.stringify(alto));
  await page.getByRole('button', { name: /^Recebi cana/ }).click();
  check('16: só Hoje e Ontem, sem campo de data', (await page.getByRole('radio').count()) === 2 && (await page.locator('input[type=date]').count()) === 0);
  await page.getByLabel('Quantas dúzias chegaram?').fill('12');
  check('15: o botão diz o que vai ser gravado', (await page.getByRole('button', { name: 'Lançar 12 dúzias recebidas hoje' }).count()) === 1);
  check('360 px: formulário sem rolagem lateral', await semRolagemLateral(page));
  await foto(page, 'cana-360-loja-recebi');
  await page.getByRole('button', { name: 'Lançar 12 dúzias recebidas hoje' }).click();
  check('15: "Lançado: …"', await ve(page, `Lançado: 12 dúzias de cana recebidas em ${dm(HOJE)} (hoje)`));
  check('15: a lista mostra o que ela lançou', await ve(page, 'Recebi cana · 12 dúzias'));
  check('banco: o lançamento da loja', sql(`select count(*) from cana_lancamentos l join users u on u.id = l.lancado_por where u.email = 'loja@erpfreela.local' and l.data = '${HOJE}'`) === '1');
  const textos = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join(' '));
  check('15: nenhuma palavra de conta na tela da loja (texto e aria-label)', !/perda|vendido|L\/DZ|rendimento|esperado|sumiu/i.test(textos), (textos.match(/perda|vendido|L\/DZ|rendimento|esperado|sumiu/gi) ?? []).join(','));
  check('360 px: sem rolagem lateral', await semRolagemLateral(page));
  await foto(page, 'cana-360-loja');
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('storage: só authUser', storage.local.length === 1 && storage.local[0] === 'authUser' && storage.sessao === 0, JSON.stringify(storage));
  check('loja: sem erro de console', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`browser-check (cana): ${ok} ok, ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
