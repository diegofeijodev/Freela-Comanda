// Conferência no navegador (Playwright do freela-web-v2, headless). Suba a pilha com scripts/browser-check.sh.
// Entra pelos formulários como ADMIN e como LOJA, abre todas as telas, faz os fluxos principais (nota por XML, inventário
// cego, caixa) e falha em erro de console/página. Capturas em $SHOTS.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/doutor/coding/freela/freela-web-v2/node_modules/playwright');

const BASE = process.env.BASE ?? 'http://localhost:3026';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'erp-telas');
mkdirSync(SHOTS, { recursive: true });

let ok = 0;
const falhas = [];
const check = (desc, cond, extra = '') => {
  if (cond) ok++;
  else {
    falhas.push(`${desc} ${extra}`.trim());
    console.log(`FALHOU: ${desc} ${extra}`);
  }
};

const XML = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261012345678000199550010000012341000012345">
<ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000199</CNPJ><xNome>FRIGORIFICO SA</xNome></emit>
<det nItem="1"><prod><cProd>P01</cProd><xProd>PICANHA BOVINA KG</xProd><uCom>kg</uCom><qCom>10.5000</qCom><vUnCom>65.90</vUnCom><vProd>691.95</vProd></prod></det>
<total><ICMSTot><vNF>691.95</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-20</dVenc><vDup>345.98</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-20</dVenc><vDup>345.97</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>691.95</vPag></detPag></pag></infNFe></NFe></nfeProc>`;
const xmlPath = join(tmpdir(), 'nfe-teste-erp.xml');
writeFileSync(xmlPath, XML);

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
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? d.defaultValue() || '1' : undefined));
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.fill('#email', email);
  await page.fill('#senha', 'erpfreela123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel', { timeout: 120_000 });
  return { ctx, page, erros };
}

async function abrir(page, erros, caminho, texto, nome) {
  const antes = erros.length;
  await page.goto(`${BASE}${caminho}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const achou = await page.getByText(texto, { exact: false }).first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
  check(`${caminho} mostra "${texto}"`, achou);
  const quebrou = await page.getByText('Esta página não carregou').count();
  check(`${caminho} sem tela de erro`, quebrou === 0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, `${nome}.png`), fullPage: true });
  check(`${caminho} sem erro de console`, erros.length === antes, erros.slice(antes).join(' | '));
}

// ---------------- ADMIN
{
  const { ctx, page, erros } = await sessao('admin@erpfreela.local');
  await abrir(page, erros, '/painel', 'Faturamento da semana', 'admin-painel');
  await abrir(page, erros, '/vendas', 'Faturamento por dia', 'admin-vendas');
  check('vendas: lançamentos sem ficha avisados', (await page.getByText('sem ficha técnica').count()) > 0);
  await abrir(page, erros, '/fichas', 'Espeto de Picanha', 'admin-fichas');
  await page.getByText('Espeto de Picanha').first().click();
  await page.waitForURL(/\/fichas\/[0-9a-f-]{36}/);
  await page.getByText('Preço sugerido').first().waitFor();
  check('ficha gerencial abre', true);
  await page.screenshot({ path: join(SHOTS, 'admin-ficha.png'), fullPage: true });
  await abrir(page, erros, '/estoque', 'Saldo teórico', 'admin-estoque');
  await abrir(page, erros, '/objetivo', 'Sazonalidade por mês', 'admin-objetivo');
  await abrir(page, erros, '/compras', 'Lista de Compras', 'admin-compras');

  // Nota por XML → itens → dar entrada → 2 contas a pagar
  await abrir(page, erros, '/notas', '1. Arquivo da nota', 'admin-notas');
  await page.setInputFiles('input[type=file]', xmlPath);
  await page.getByText('2. Dados da nota').waitFor();
  check('XML lido (fornecedor)', (await page.locator('input[value="FRIGORIFICO SA"]').count()) === 1);
  check('insumo sugerido pelo nome', (await page.getByText('sugestão — confira').count()) === 1);
  await page.getByRole('button', { name: 'Dar entrada' }).click();
  const lancou = await page.getByText('Entrada lançada no estoque e 2 conta(s) a pagar').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check('nota lançada com 2 parcelas', lancou);
  await abrir(page, erros, '/contas', 'NF 1234', 'admin-contas');
  check('parcela 1/2 listada', (await page.getByText('1/2').count()) > 0);

  // Caixa: lançar o dia
  await abrir(page, erros, '/caixa', 'Lançar fechamento do dia', 'admin-caixa');
  await page.locator('input[inputmode=decimal]').first().fill('123,45');
  await page.getByRole('button', { name: 'Salvar' }).click();
  check('caixa salvo', await page.getByText(/Caixa de .* salvo/).waitFor({ timeout: 20_000 }).then(() => true, () => false));

  await abrir(page, erros, '/dre', 'FATURAMENTO BRUTO', 'admin-dre');
  await abrir(page, erros, '/importar', 'De-para do relatório', 'admin-importar');
  await abrir(page, erros, '/configuracoes', 'Empresa', 'admin-configuracoes');
  await page.getByRole('tab', { name: 'Contas de despesas' }).click();
  check('aba de contas de despesas', await page.getByText('Plano de contas de despesas').waitFor({ timeout: 20_000 }).then(() => true, () => false));
  await abrir(page, erros, '/usuarios', 'loja@erpfreela.local', 'admin-usuarios');

  // Inventário: abrir o inicial e contar um subgrupo
  await abrir(page, erros, '/inventario', 'Abrir novo inventário', 'admin-inventario');
  await page.getByRole('button', { name: 'Abrir inventário' }).click();
  await page.waitForURL(/\/inventario\/[0-9a-f-]{36}/);
  await page.getByText('Carnes e Proteínas').first().waitFor();
  await page.getByText('Carnes e Proteínas').first().click();
  const campos = page.locator('input[inputmode=decimal]');
  const n = await campos.count();
  for (let i = 0; i < n; i++) await campos.nth(i).fill('5');
  await page.getByRole('button', { name: 'Enviar Carnes e Proteínas' }).click();
  check('contagem enviada', await page.getByText('Contagem enviada').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  await page.screenshot({ path: join(SHOTS, 'admin-contagem.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Visão do admin' }).click();
  check('visão do admin com contagens', await page.getByText('Sem quantidade final').waitFor({ timeout: 20_000 }).then(() => true, () => false));
  await page.screenshot({ path: join(SHOTS, 'admin-inventario-visao.png'), fullPage: true });
  check('admin sem erro de console no fim', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ---------------- LOJA (celular)
{
  const { ctx, page, erros } = await sessao('loja@erpfreela.local', { width: 390, height: 844 });
  await abrir(page, erros, '/painel', 'Contar estoque', 'loja-painel-celular');
  const menu = await page.locator('header nav a').allInnerTexts();
  check('menu da loja tem 4 itens', menu.length === 4, JSON.stringify(menu));
  check('loja não vê Vendas no menu', !menu.some((t) => t.includes('Vendas')));
  await abrir(page, erros, '/fichas', 'Modo consulta', 'loja-fichas');
  check('loja não vê custo nas fichas', (await page.getByText('Custo').count()) === 0);
  await page.goto(`${BASE}/painel`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Contar estoque').click();
  await page.waitForURL(/\/inventario\/[0-9a-f-]{36}/);
  check('contagem da loja', await page.getByText('itens contados').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('loja não vê teórico', (await page.getByText('Teórico').count()) === 0);
  await page.screenshot({ path: join(SHOTS, 'loja-contagem-celular.png'), fullPage: true });
  await abrir(page, erros, '/compras', 'Lista de Compras', 'loja-compras');
  check('loja sem erro de console', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`browser-check: ${ok} ok, ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
