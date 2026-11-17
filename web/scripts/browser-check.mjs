// Conferência no navegador (Playwright do freela-web-v2, headless). Suba a pilha com scripts/browser-check.sh.
// Entra pelos formulários como ADMIN e como LOJA, abre todas as telas, faz os fluxos principais (nota por XML, inventário
// cego, caixa) e falha em erro de console/página. Capturas em $SHOTS.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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

const XML = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261012345678000199550010000012341000012340">
<ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000199</CNPJ><xNome>FRIGORIFICO SA</xNome></emit>
<det nItem="1"><prod><cProd>P01</cProd><xProd>PICANHA BOVINA KG</xProd><uCom>kg</uCom><qCom>10.5000</qCom><vUnCom>65.90</vUnCom><vProd>691.95</vProd></prod></det>
<det nItem="2"><prod><cProd>P02</cProd><xProd>TAXA DE ENTREGA</xProd><uCom>un</uCom><qCom>1.0000</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>
<total><ICMSTot><vNF>701.95</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-20</dVenc><vDup>350.98</vDup></dup><dup><nDup>002</nDup><dVenc>2026-12-20</dVenc><vDup>350.97</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>701.95</vPag></detPag></pag></infNFe></NFe></nfeProc>`;
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
  // Espera a hidratação: antes dela o formulário é HTML puro e o clique vira um GET nativo (`/auth?`).
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForFunction(() => !!document.querySelector('#email') && Object.keys(document.querySelector('#email')).some((k) => k.startsWith('__react')), null, { timeout: 120_000 });
  await page.fill('#email', email);
  await page.fill('#senha', 'erpfreela123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  try {
    await page.waitForURL('**/painel', { timeout: 120_000, waitUntil: 'commit' });
    await page.getByText(/Painel|Olá!/).first().waitFor({ timeout: 120_000 });
  } catch (e) {
    await page.screenshot({ path: join(SHOTS, `falha-login-${email.split('@')[0]}.png`), fullPage: true });
    console.log('URL:', page.url());
    console.log('ERROS:', erros.join('\n'));
    console.log('TEXTO:', (await page.locator('body').innerText()).slice(0, 800));
    throw e;
  }
  return { ctx, page, erros };
}

async function abrir(page, erros, caminho, texto, nome) {
  const antes = erros.length;
  await page.goto(`${BASE}${caminho}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const achou = await page.locator('main').getByText(texto, { exact: false }).first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
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
  check('CNPJ do XML com DV errado avisa', await page.getByText('CNPJ/CPF não confere').isVisible());
  check('número e série em campos separados', (await page.getByLabel('Número', { exact: true }).inputValue()) === '1234' && (await page.getByLabel('Série', { exact: true }).inputValue()) === '1');
  check('insumo sugerido pelo nome', (await page.getByText('sugestão — confira').count()) === 1);
  // Linha 1 vira insumo novo (nome editado); linha 2 vai a "Cadastrar novo" e volta a "não lançar": não cria nada.
  const linha1 = page.locator('tbody tr', { hasText: 'PICANHA BOVINA KG' }).first();
  const linha2 = page.locator('tbody tr', { hasText: 'TAXA DE ENTREGA' }).first();
  await linha1.getByLabel('Insumo do estoque').selectOption('__novo__');
  await linha1.getByLabel('Nome do insumo novo').fill('PICANHA NOVA TESTE');
  await linha2.getByLabel('Insumo do estoque').selectOption('__novo__');
  check('tag "novo — confira" nas 2 linhas', (await page.getByText('novo — confira').count()) === 2);
  await page.screenshot({ path: join(SHOTS, 'admin-notas-cadastrar-novo.png'), fullPage: true });
  await linha2.getByLabel('Insumo do estoque').selectOption('');
  check('linha 2 sem campos de insumo novo', (await linha2.getByLabel('Nome do insumo novo').count()) === 0);
  await page.getByRole('button', { name: 'Dar entrada' }).click();
  const lancou = await page.getByText('Entrada lançada no estoque e 2 conta(s) a pagar').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check('nota lançada com 2 parcelas', lancou);
  check('toast informa 1 insumo cadastrado', (await page.getByText('· 1 insumo(s) cadastrado(s)').count()) === 1);
  await abrir(page, erros, '/estoque', 'PICANHA NOVA TESTE', 'admin-estoque-insumo-novo');
  check('"não lançar" não criou insumo', (await page.getByText('TAXA DE ENTREGA').count()) === 0);
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

// Diagnóstico de rolagem lateral: elementos que passam da borda direita e NÃO estão dentro de um contêiner com rolagem/corte próprio.
const quemPassaDaBorda = (page, limite) => page.evaluate((lim) => {
  const cortado = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return true; } return false; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 70)}@${Math.round(el.getBoundingClientRect().right)}`;
  return { scroll: document.documentElement.scrollWidth,
    culpados: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > lim + 1 && !cortado(el)).slice(0, 6).map(desc) };
}, limite);

// ---------------- ADMIN: certificado digital (A1) em Configurações, celular 360x800
{
  const fx = (nome) => fileURLToPath(new URL(`../../api/src/modules/certificado-digital/__tests__/fixtures/${nome}`, import.meta.url));
  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  await page.goto(`${BASE}/configuracoes`, { waitUntil: 'networkidle', timeout: 180_000 });
  const painel = page.locator('#certificado-digital');
  check('certificado: painel aparece', await painel.getByText('Nenhum certificado guardado').waitFor({ timeout: 60_000 }).then(() => true, () => false));
  check('certificado: Configurações sem rolagem lateral em 360 ao abrir', (await quemPassaDaBorda(page, 360)).scroll <= 360, JSON.stringify(await quemPassaDaBorda(page, 360)));
  // O CNPJ conferido é o SALVO: grava pelo quadro Empresa + "Salvar" do topo.
  await page.getByPlaceholder('00.000.000/0000-00').fill('12.abc.345/01de-35');
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  check('CNPJ com letras salvo', await page.getByText('Configurações salvas').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
  check('CNPJ com letras volta formatado', await page.waitForFunction(() => document.querySelector('input[placeholder="00.000.000/0000-00"]')?.value === '12.ABC.345/01DE-35', null, { timeout: 20_000 }).then(() => true, () => false));
  await page.getByPlaceholder('00.000.000/0000-00').fill('12.345.678/0001-94');
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  check('CNPJ inválido recusado com a frase', await page.getByText('CNPJ inválido. Confira os 14 caracteres (pode ter letras).').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
  await page.getByPlaceholder('00.000.000/0000-00').fill('12.345.678/0001-95');
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  check('certificado: CNPJ da empresa salvo', await page.getByText('Configurações salvas').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));

  const guardar = painel.getByRole('button', { name: 'Conferir e guardar certificado' });
  const senha = page.locator('#certificado-senha');
  check('certificado: botão desabilitado sem arquivo e senha', await guardar.isDisabled());
  await page.setInputFiles('#certificado-arquivo', fx('valido.pfx'));
  check('certificado: só com arquivo ainda desabilitado', await guardar.isDisabled());
  await senha.fill('errada');
  check('certificado: com arquivo e senha habilita', await guardar.isEnabled());
  for (let i = 1; i <= 2; i++) {
    if (i === 2) await senha.fill('errada');
    await guardar.click();
    check(`certificado: senha errada (${i}ª vez) avisa`, await painel.getByRole('alert').getByText('Senha do certificado incorreta. Digite de novo.').waitFor({ timeout: 30_000 }).then(() => true, () => false));
    await page.waitForFunction(() => document.activeElement?.id === 'certificado-senha' && document.activeElement.value === '', null, { timeout: 10_000 }).then(
      () => check(`certificado: senha vazia e com foco (${i}ª vez)`, true),
      () => check(`certificado: senha vazia e com foco (${i}ª vez)`, false),
    );
    check(`certificado: nome do arquivo segue visível (${i}ª vez)`, await painel.getByText('valido.pfx').isVisible());
  }
  await senha.fill('senha-de-teste');
  await guardar.click();
  check('certificado: toast de guardado', await page.getByText('Certificado guardado.').first().waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('certificado: mostra o CNPJ', await painel.getByText('CNPJ 12.345.678/0001-95', { exact: true }).isVisible());
  check('certificado: aviso da cadeia', await painel.getByText('não consegui conferir a emissora').isVisible());
  check('certificado: senha não está no HTML', !(await page.content()).includes('senha-de-teste'));
  const largura = await quemPassaDaBorda(page, 360);
  check('certificado: sem rolagem lateral em 360', largura.scroll <= 360, JSON.stringify(largura));
const caixas = await Promise.all(['Substituir certificado', 'Remover'].map((n) => painel.getByRole('button', { name: n, exact: true }).boundingBox()));
  check('certificado: botões de ação empilhados e dentro de 360 px', caixas.every((c) => c && c.x >= 0 && c.x + c.width <= 360) && caixas[1].y > caixas[0].y, JSON.stringify(caixas));
  await painel.getByText('Ver histórico').click();
  check('certificado: histórico mostra "Enviado por"', await painel.locator('details li').first().getByText('Enviado por').isVisible());
  await painel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'admin-certificado-360.png'), fullPage: true });

  // Substituir por um certificado de outro CNPJ: recusa e o atual segue intacto.
  await painel.getByRole('button', { name: 'Substituir certificado' }).click();
  await page.setInputFiles('#certificado-arquivo', fx('outro-cnpj.pfx'));
  await page.locator('#certificado-senha').fill('senha-de-teste');
  await painel.getByRole('button', { name: 'Conferir e trocar certificado' }).click();
  check('certificado: troca recusada diz que o atual não mudou', await painel.getByRole('alert').getByText('O certificado atual não foi alterado.').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('certificado: CNPJ antigo ainda visível', await painel.getByText('CNPJ 12.345.678/0001-95', { exact: true }).isVisible());
  await painel.getByRole('button', { name: 'Cancelar' }).click();

  // Remover: foco em "Manter certificado", Esc fecha, confirmar apaga.
  await painel.getByRole('button', { name: 'Remover', exact: true }).click();
  const dialogo = page.getByRole('alertdialog');
  await dialogo.waitFor();
  check('certificado: foco inicial em "Manter certificado"', (await page.evaluate(() => document.activeElement?.textContent)) === 'Manter certificado');
  await page.keyboard.press('Escape');
  check('certificado: Esc fecha o diálogo', await dialogo.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false));
  await painel.getByRole('button', { name: 'Remover', exact: true }).click();
  await dialogo.getByRole('button', { name: 'Remover certificado' }).click();
  check('certificado: toast de removido', await page.getByText('Certificado removido.').first().waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('certificado: volta a "Nenhum certificado guardado"', await painel.getByText('Nenhum certificado guardado').waitFor({ timeout: 20_000 }).then(() => true, () => false));

  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('certificado: localStorage só com authUser e sessionStorage vazio', storage.local.length === 1 && storage.local[0] === 'authUser' && storage.sessao === 0, JSON.stringify(storage));
  // As recusas (400) viram "Failed to load resource" no console do navegador: é esperado, não é erro da tela.
  const reais = erros.filter((e) => !/Failed to load resource/.test(e));
  check('certificado: sem erro de console', reais.length === 0, reais.join(' | '));
  await ctx.close();
}

// ---------------- ADMIN: faixa do certificado no topo (celular 360x800)
{
  const fx = (nome) => fileURLToPath(new URL(`../../api/src/modules/certificado-digital/__tests__/fixtures/${nome}`, import.meta.url));
  const PGDB = 'erpfreela_browser';
  const venceEm = (intervalo) =>
    execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-c', `update certificado_digital set valido_ate = now() + interval '${intervalo}'`]);
  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  const faixa = page.locator('main [role="status"], main [role="alert"]').filter({ hasText: 'O certificado digital' });
  // Reenvia o certificado (o bloco anterior removeu) e deixa a validade original (longe): sem faixa.
  await page.goto(`${BASE}/configuracoes`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.setInputFiles('#certificado-arquivo', fx('valido.pfx'));
  await page.locator('#certificado-senha').fill('senha-de-teste');
  await page.locator('#certificado-digital').getByRole('button', { name: 'Conferir e guardar certificado' }).click();
  check('faixa: certificado reenviado', await page.getByText('Certificado guardado.').first().waitFor({ timeout: 30_000 }).then(() => true, () => false));
  await page.goto(`${BASE}/painel`, { waitUntil: 'networkidle', timeout: 120_000 });
  check('faixa: sem faixa com o certificado longe de vencer', (await faixa.count()) === 0);

  // 20 dias: aviso dispensável.
  venceEm('20 days');
  await page.reload({ waitUntil: 'networkidle' });
  check('faixa: 20 dias mostra "vence em N dias"', await faixa.getByText(/vence em \d+ dias/).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  const caixa = await faixa.boundingBox();
  check('faixa: cabe em 360 px e tem 44 px de altura', !!caixa && caixa.x >= 0 && caixa.x + caixa.width <= 360 && caixa.height >= 44, JSON.stringify(caixa));
  check('faixa: sem rolagem lateral em 360', await page.evaluate(() => document.documentElement.scrollWidth <= 360));
  const x = await page.getByRole('button', { name: 'Esconder aviso' }).boundingBox();
  check('faixa: botão de esconder com 44 px', !!x && x.width >= 44 && x.height >= 44, JSON.stringify(x));
  await page.screenshot({ path: join(SHOTS, 'admin-faixa-certificado-360.png') });
  await page.getByRole('button', { name: 'Esconder aviso' }).click();
  check('faixa: esconder some a faixa', await faixa.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false));
  // Navegação do cliente (clique no menu, sem recarregar): continua escondida. Nunca page.goto aqui, que zera o estado.
  await page.locator('header nav a', { hasText: 'Vendas' }).click();
  await page.waitForURL('**/vendas', { timeout: 60_000 });
  check('faixa: continua escondida em outra tela (sem recarregar)', (await faixa.count()) === 0);
  await page.reload({ waitUntil: 'networkidle' });
  check('faixa: voltou depois de recarregar', await faixa.getByText(/vence em \d+ dias/).waitFor({ timeout: 30_000 }).then(() => true, () => false));

  // 3 dias: aviso forte, sem esconder; o clique leva ao painel do certificado.
  venceEm('3 days');
  await page.goto(`${BASE}/painel`, { waitUntil: 'networkidle' });
  check('faixa: 3 dias mostra a faixa', await faixa.getByText(/vence em \d+ dias/).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('faixa: 3 dias sem "Esconder aviso"', (await page.getByRole('button', { name: 'Esconder aviso' }).count()) === 0);
  await faixa.getByRole('link').click();
  await page.waitForURL('**/configuracoes#certificado-digital', { timeout: 60_000 });
  check('faixa: o clique leva ao painel do certificado', page.url().endsWith('/configuracoes#certificado-digital'));

  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('faixa: localStorage só com authUser e sessionStorage vazio', storage.local.length === 1 && storage.local[0] === 'authUser' && storage.sessao === 0, JSON.stringify(storage));
  const reais = erros.filter((e) => !/Failed to load resource/.test(e));
  check('faixa: sem erro de console', reais.length === 0, reais.join(' | '));
  await ctx.close();
}

// ---------------- ADMIN: nota repetida na Entrada de Notas (celular 360x800)
{
  // Mesma nota (CNPJ, número 1234, série 1) com outra chave de acesso (DV conferido): "parece repetida", mas não é a mesma chave.
  const XML2 = XML.replace('Id="NFe35261012345678000199550010000012341000012340"', 'Id="NFe35261012345678000199550010000012341000012390"');
  const xml2Path = join(tmpdir(), 'nfe-teste-erp-2.xml');
  writeFileSync(xml2Path, XML2);
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').reverse().join('/');
  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  const faixa = page.locator('main [role="alert"]');
  const darEntrada = page.getByRole('button', { name: 'Dar entrada' });
  await page.goto(`${BASE}/notas`, { waitUntil: 'networkidle', timeout: 180_000 });

  // Chave igual: caixa vermelha dentro da tela, sem opção de lançar.
  await page.setInputFiles('input[type=file]', xmlPath);
  await page.getByText('2. Dados da nota').waitFor();
  const vermelha = faixa.filter({ hasText: 'Esta nota já foi lançada' });
  check('repetida: chave igual mostra a caixa vermelha com a data de hoje', await vermelha.getByText(`A chave de acesso é a mesma de NF 1234 (FRIGORIFICO SA), de ${hoje}. Não dá para lançar duas vezes.`).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('repetida: chave igual desabilita "Dar entrada"', await darEntrada.isDisabled());
  check('repetida: chave igual só tem "Não lançar esta nota"', (await vermelha.getByRole('button').count()) === 1 && (await page.getByRole('button', { name: 'É outra nota, lançar mesmo assim' }).count()) === 0);
  const largura1 = await quemPassaDaBorda(page, 360);
  check('repetida: caixa vermelha sem rolagem lateral em 360', largura1.scroll <= 360, JSON.stringify(largura1));
  await page.screenshot({ path: join(SHOTS, 'admin-nota-chave-igual-360.png'), fullPage: true });
  await vermelha.getByRole('button', { name: 'Não lançar esta nota' }).click();
  check('repetida: "Não lançar esta nota" mostra o toast', await page.getByText('Nota descartada. Nada foi lançado.').first().waitFor({ timeout: 10_000 }).then(() => true, () => false));
  check('repetida: a tela de conferência some', (await page.getByText('2. Dados da nota').count()) === 0);
  check('repetida: foco vai para o campo de arquivo', await page.evaluate(() => document.activeElement?.matches('input[type=file]') === true));

  // Nota parecida (outra chave): faixa âmbar com foco.
  await page.setInputFiles('input[type=file]', xml2Path);
  await page.getByText('2. Dados da nota').waitFor();
  const ambar = faixa.filter({ hasText: 'Parece que esta nota já foi lançada' });
  check('repetida: nota parecida mostra a faixa âmbar', await ambar.waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('repetida: a faixa traz as linhas da nota mais nova', (await ambar.innerText()).includes('NF 1234 · série 1 · R$ 701,95') && (await ambar.innerText()).includes(`Entrou em ${hoje} por XML`));
  check('repetida: a faixa recebe o foco (role=alert)', await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert', null, { timeout: 10_000 }).then(() => true, () => false));
  const bots = await Promise.all(['Não lançar esta nota', 'É outra nota, lançar mesmo assim'].map((n) => ambar.getByRole('button', { name: n }).boundingBox()));
  check('repetida: botões empilhados, dentro de 360 px e com 44 px', bots.every((c) => c && c.x >= 0 && c.x + c.width <= 360 && c.height >= 44) && bots[1].y > bots[0].y, JSON.stringify(bots));
  const largura2 = await quemPassaDaBorda(page, 360);
  check('repetida: faixa âmbar sem rolagem lateral em 360', largura2.scroll <= 360, JSON.stringify(largura2));
  await page.screenshot({ path: join(SHOTS, 'admin-nota-parecida-360.png'), fullPage: true });

  // "Dar entrada" sem confirmar: diálogo, foco em "Não lançar", Esc fecha.
  await darEntrada.click();
  const dialogo = page.getByRole('alertdialog');
  await dialogo.waitFor({ timeout: 10_000 });
  check('repetida: diálogo com o título exato', await dialogo.getByText('Esta nota parece já lançada', { exact: true }).isVisible());
  check('repetida: diálogo com a frase e o aviso do dobro', (await dialogo.innerText()).includes('Já existe a NF 1234 série 1 de FRIGORIFICO SA') && (await dialogo.innerText()).includes('Se for a mesma nota, o estoque e as contas a pagar ficam em dobro.'));
  check('repetida: foco inicial em "Não lançar"', (await page.evaluate(() => document.activeElement?.textContent)) === 'Não lançar');
  await page.screenshot({ path: join(SHOTS, 'admin-nota-dialogo-360.png') });
  await page.keyboard.press('Escape');
  check('repetida: Esc fecha o diálogo', await dialogo.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false));
  check('repetida: a nota segue na tela depois do Esc', await page.getByText('2. Dados da nota').isVisible());

  // "É outra nota": confirmação na faixa.
  await ambar.getByRole('button', { name: 'É outra nota, lançar mesmo assim' }).click();
  const confirmacao = 'Você confirmou que esta é outra nota. Ao dar entrada, ela fica marcada como possível repetição.';
  check('repetida: a faixa mostra o texto de confirmação', await page.getByText(confirmacao).waitFor({ timeout: 10_000 }).then(() => true, () => false));
  check('repetida: o foco fica na faixa depois de confirmar', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'status'));

  // Mudar a série derruba a faixa e a confirmação; voltar traz a faixa sem confirmação.
  const serie = page.getByLabel('Série', { exact: true });
  await serie.fill('2');
  await serie.blur();
  check('repetida: série 2 + sair do campo some a faixa', await page.getByText(confirmacao).waitFor({ state: 'hidden', timeout: 20_000 }).then(() => true, () => false) && (await ambar.count()) === 0);
  await serie.fill('1');
  await serie.blur();
  check('repetida: série 1 + sair do campo traz a faixa âmbar sem confirmação', await ambar.getByRole('button', { name: 'É outra nota, lançar mesmo assim' }).waitFor({ timeout: 20_000 }).then(() => true, () => false) && (await page.getByText(confirmacao).count()) === 0);

  // Confirmar e dar entrada: lança e marca a nota na lista.
  await ambar.getByRole('button', { name: 'É outra nota, lançar mesmo assim' }).click();
  await page.getByText(confirmacao).waitFor({ timeout: 10_000 });
  await darEntrada.click();
  check('repetida: confirmada, "Dar entrada" lança sem diálogo', await page.getByText('Entrada lançada no estoque').first().waitFor({ timeout: 30_000 }).then(() => true, () => false) && (await page.getByRole('alertdialog').count()) === 0);
  check('repetida: a lista marca "confirmada como outra nota"', await page.getByText('confirmada como outra nota').first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
  const largura3 = await quemPassaDaBorda(page, 360);
  check('repetida: tela sem rolagem lateral em 360 no fim', largura3.scroll <= 360, JSON.stringify(largura3));
  const reais = erros.filter((e) => !/Failed to load resource/.test(e));
  check('repetida: sem erro de console', reais.length === 0, reais.join(' | '));
  await ctx.close();
}

// ---------------- LOJA (celular)
{
  const { ctx, page, erros } = await sessao('loja@erpfreela.local', { width: 390, height: 844 });
  const pedidosCertificado = [];
  page.on('request', (r) => { if (r.url().includes('/v1/certificado-digital')) pedidosCertificado.push(r.url()); });
  await abrir(page, erros, '/painel', 'Contar estoque', 'loja-painel-celular');
  check('loja: nenhum pedido ao certificado digital', pedidosCertificado.length === 0, pedidosCertificado.join(' | '));
  check('loja: nenhuma faixa do certificado', (await page.getByText('O certificado digital').count()) === 0);
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
