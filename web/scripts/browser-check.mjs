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
  // Sem chave de IA neste ambiente: a tela segue por palavras, sem espera e sem nenhum aviso.
  check('sem chave de IA: nada de "Sugerindo"', (await page.getByText('Sugerindo').count()) === 0);
  check('sem chave de IA: nenhum aviso de IA', (await page.getByText('inteligência artificial agora').count()) === 0);
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
  // IA simulada no navegador (page.route não faz rede). Registrar ANTES do primeiro goto: o QueryClient guarda ['ia-chave'] por 10 s,
  // e uma resposta real "sem chave" em cache faria o XML2 pular a IA.
  const cors = { 'access-control-allow-origin': 'http://localhost:3026', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const simulada = (corpo, espera = 0) => async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (espera) await new Promise((res) => setTimeout(res, espera));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
  };
  await page.route('**/v1/ia-chave', simulada({ origem: 'configuracoes', provedor: 'anthropic', nome: 'Claude', dica: '••••1234' }));
  await page.route('**/v1/notas/sugerir-insumos', simulada({ itens: [{ item_estoque_id: null, novo: { nome: 'Taxa de entrega', unidade: 'UN', subgrupo: null }, fator: 1 }] }, 1500));
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
  // IA simulada demora 1,5 s: durante a espera a linha mostra "Sugerindo…" e "Dar entrada" fica travado; depois entra o "novo — confira".
  check('IA: durante a espera aparece "Sugerindo…" na linha', (await page.locator('option', { hasText: 'Sugerindo…' }).count()) > 0);
  check('IA: durante a espera aparece a linha de espera', await page.getByText('Aguarde a sugestão de insumos (alguns segundos).').isVisible());
  check('IA: durante a espera "Dar entrada" está desabilitado', await darEntrada.isDisabled());
  check('IA: depois aparece a linha da IA', await page.getByText('Os insumos marcados foram sugeridos por inteligência artificial. Confira antes de dar entrada.').waitFor({ timeout: 20_000 }).then(() => true, () => false));
  check('IA: a linha sem vínculo vira "novo — confira"', (await page.getByText('novo — confira').count()) === 1);
  check('IA: a espera acabou e "Dar entrada" libera', (await page.getByText('Aguarde a sugestão de insumos').count()) === 0 && (await darEntrada.isEnabled()));
  await page.locator('tbody tr', { hasText: 'TAXA DE ENTREGA' }).first().getByLabel('Insumo do estoque').selectOption('');
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

// ---------------- ADMIN: painel Notas da SEFAZ em Configurações (celular 360x800)
// A API do navegador roda SEM SEFAZ_DFE_AMBIENTE (desligada de fábrica): a busca NUNCA liga de verdade aqui. Todo estado "ligado" vem de
// page.route (inclusive o PUT da configuração), e no fim o banco confirma que nenhuma consulta existe.
{
  const PGDB = 'erpfreela_browser';
  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  const painel = page.locator('#notas-sefaz');

  // 1) API real, servidor desligado: só a frase, nenhum botão.
  await page.goto(`${BASE}/configuracoes`, { waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz painel: servidor desligado mostra a frase', await painel.getByText('A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la.').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz painel: servidor desligado não tem "Ligar a busca"', (await painel.getByRole('button', { name: /Ligar a busca/ }).count()) === 0);

  // 2) Estado simulado em memória. Registrado antes do reload que o usa.
  const cert = { ok: true, code: null, mensagem: null, avisos: [] };
  const desligadaComCert = {
    ambiente: 'producao', cnpj: '12345678000199', busca_ligada: false, situacao: 'ok', mensagem: null, aviso: null, ultima_consulta: null,
    primeira_consulta_em: null, proxima_consulta_em: null, bloqueado_ate: null, em_andamento: false, lacunas: 0, dias_sem_buscar: null,
    ligada_por_nome: null, ligada_em: null, outro_cnpj_ou_modo: false, certificado: cert,
    contagem: { falta_lancar: 0, parece_lancada: 0, cancelada_depois_de_lancada: 0 }, canceladas_depois: [], historico: [],
  };
  let est = desligadaComCert;
  const corsSefaz = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
  const pedidosSefaz = [];
  await page.route('**/v1/notas-sefaz/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsSefaz });
    pedidosSefaz.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (req.method() === 'PUT' && req.url().endsWith('/configuracao')) {
      const ligar = JSON.parse(req.postData() ?? '{}').busca_ligada === true;
      est = ligar
        ? { ...est, busca_ligada: true, ligada_por_nome: 'Admin', ligada_em: new Date().toISOString(), proxima_consulta_em: new Date(Date.now() + 60_000).toISOString() }
        : { ...est, busca_ligada: false };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify(est) });
    }
    if (req.method() === 'GET' && req.url().endsWith('/situacao')) return route.fulfill({ status: 200, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify(est) });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify({ error: { code: 'NAO_SIMULADO', message: 'Não simulado.' } }) });
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });

  // 3) Desligada com certificado: confirmação, foco, Esc, ligar.
  check('sefaz painel: tag "Desligada"', await painel.getByText('Desligada', { exact: true }).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  const ligar = painel.getByRole('button', { name: 'Ligar a busca', exact: true });
  await ligar.scrollIntoViewIfNeeded();
  await ligar.click();
  const dlg = page.getByRole('alertdialog');
  check('sefaz painel: diálogo tem o título exato', await dlg.getByText('Ligar a busca de notas?', { exact: true }).waitFor({ timeout: 10_000 }).then(() => true, () => false));
  check('sefaz painel: diálogo avisa do contador', (await dlg.getByText('Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar').count()) === 1);
  check('sefaz painel: foco inicial em "Agora não"', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Agora não'));
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-dialogo-360.png') });
  await page.keyboard.press('Escape');
  check('sefaz painel: Esc fecha o diálogo', await dlg.waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false));
  check('sefaz painel: Esc não ligou nada', !pedidosSefaz.some((x) => x.startsWith('PUT')));
  await ligar.click();
  await dlg.getByRole('button', { name: 'Ligar a busca', exact: true }).click();
  check('sefaz painel: toast de ligada', await page.getByText('Busca ligada. A primeira busca sai em até 5 minutos.').first().waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz painel: tag "Ligada"', await painel.getByText('Ligada', { exact: true }).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz painel: mostra "Ligada por"', (await painel.getByText(/Ligada por Admin em /).count()) === 1);

  // 4) Desligar: sem diálogo, toast com Desfazer.
  await painel.getByRole('button', { name: 'Desligar a busca' }).click();
  check('sefaz painel: desligar tem toast com "Desfazer"', await page.getByText('Busca desligada.').first().waitFor({ timeout: 30_000 }).then(() => true, () => false) && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1);
  check('sefaz painel: desligar não abre diálogo', (await page.getByRole('alertdialog').count()) === 0);

  // 5) Estados simulados.
  est = { ...desligadaComCert, situacao: 'parada_conflito', mensagem: 'Outro sistema também está buscando as notas deste CNPJ na SEFAZ (provavelmente o do contador). Com dois sistemas, a SEFAZ bloqueia os dois por 1 hora. A busca foi desligada: fale com o contador antes de ligar de novo.' };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz painel: parada tem alerta com a frase de conflito', await painel.locator('[role="alert"]').getByText(/Outro sistema também está buscando/).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz painel: parada tem "Ligar a busca de novo"', (await painel.getByRole('button', { name: 'Ligar a busca de novo' }).count()) === 1);
  est = { ...desligadaComCert, certificado: { ok: false, code: 'CERTIFICADO_NAO_CADASTRADO', mensagem: 'Envie o certificado digital da empresa no quadro acima para ligar a busca.', avisos: [] } };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz painel: sem certificado mostra a frase', await painel.getByText('Envie o certificado digital da empresa no quadro acima para ligar a busca.').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz painel: sem certificado desabilita o botão', await painel.getByRole('button', { name: 'Ligar a busca', exact: true }).isDisabled());
  check('sefaz painel: sem certificado tem o link para o certificado', (await painel.getByRole('link', { name: 'Ir para o certificado' }).count()) === 1);

  // 6) Medidas e captura.
  const larguraSefaz = await quemPassaDaBorda(page, 360);
  check('sefaz painel: sem rolagem lateral em 360', larguraSefaz.scroll <= 360, JSON.stringify(larguraSefaz));
  await painel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-painel-360.png'), fullPage: true });
  const reaisSefaz = erros.filter((e) => !/Failed to load resource/.test(e));
  check('sefaz painel: sem erro de console', reaisSefaz.length === 0, reaisSefaz.join(' | '));
  await page.unroute('**/v1/notas-sefaz/**');

  // 7) Nada ligou de verdade: o banco do navegador não tem nenhuma consulta.
  const consultas = execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-t', '-A', '-c', 'select count(*) from sefaz_distribuicao']).toString().trim();
  check('sefaz painel: nenhuma consulta no banco (a busca nunca ligou de verdade)', consultas === '0', consultas);
  await ctx.close();

  // 8) Loja: nada do painel em Configurações.
  const loja = await sessao('loja@erpfreela.local', { width: 360, height: 800 });
  await loja.page.goto(`${BASE}/configuracoes`, { waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz painel: loja não vê "Notas da SEFAZ"', (await loja.page.getByText('Notas da SEFAZ').count()) === 0);
  await loja.ctx.close();
}

// ---------------- ADMIN: aba Notas da SEFAZ na Entrada de Notas (celular 360x800 e computador 1366x900)
// A API do navegador segue SEM SEFAZ_DFE_AMBIENTE: a busca NUNCA liga de verdade. Todo estado "ligado", a lista, o XML, o "Ignorar" e o
// "Buscar agora" vêm de page.route; no fim o banco confirma que nenhuma consulta existe.
{
  const PGDB = 'erpfreela_browser';
  const FUSO = 'America/Sao_Paulo';
  const hhmm = (iso) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.hour}h${p.minute}`;
  };
  const dvChave = (s) => { let peso = 2; let soma = 0; for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
  const chaveK = (n) => { const base = `35261111222333000181550010${String(n).padStart(8, '0')}1${String(n).padStart(8, '0')}`; return base + dvChave(base); };
  const CNPJ_K = '11222333000181';
  const OPS = [];
  const UID = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const minutos = (m) => new Date(Date.now() + m * 60_000).toISOString();

  const parecida = { id: UID(90), numero: '880', serie: '1', fornecedor_nome: 'LATICÍNIOS K', data_emissao: '2026-11-14', data_entrada: '2026-11-15', valor_total: 80, origem: 'foto', created_at: '2026-11-15T12:00:00Z' };
  const nova = (n, p) => ({
    id: UID(n), chave: chaveK(n), emitente_cnpj: CNPJ_K, emitente_nome: 'LATICÍNIOS K', numero: String(n), serie: '1', emitida_em: '2026-11-14T13:00:00Z', autorizada_em: '2026-11-14T13:01:00Z',
    valor_total: 100 + n, situacao_sefaz: 'autorizada', cancelada_em: null, situacao: 'falta_lancar', lancada: null, parecidas: [], pode_conferir: false, nao_parece_compra: false, ignorada: null, ...p,
  });
  const K77 = nova(77, { situacao: 'cancelada_depois_de_lancada', situacao_sefaz: 'cancelada', lancada: { ...parecida, id: UID(91), numero: '77', origem: 'xml', data_entrada: '2026-11-03' } });
  const K880 = nova(880, { situacao: 'parece_lancada', parecidas: [parecida], pode_conferir: false });
  const K990 = nova(990, { situacao: 'falta_lancar', pode_conferir: true });
  const outras = [
    nova(11, { emitente_nome: 'ATACADÃO S.A.', situacao: 'ja_lancada', lancada: { ...parecida, id: UID(92), numero: '11', origem: 'xml', data_entrada: '2026-11-03' } }),
    nova(12, { emitente_nome: 'ATACADÃO S.A.', situacao: 'cancelada', situacao_sefaz: 'cancelada' }),
    nova(13, { emitente_nome: 'ATACADÃO S.A.', situacao: 'denegada', situacao_sefaz: 'denegada' }),
    nova(14, { emitente_nome: 'ATACADÃO S.A.', situacao: 'ignorada', ignorada: { em: '2026-11-15T15:00:00Z', por_nome: 'Diego', motivo: 'nao_e_compra', texto: null } }),
  ];
  const rows = [K77, K880, K990, ...outras];
  const original = new Map(rows.map((r) => [r.id, r.situacao]));
  const A_CONFERIR = ['cancelada_depois_de_lancada', 'parece_lancada', 'falta_lancar'];
  const XML_K990 = XML.replace(/Id="NFe\d{44}"/, `Id="NFe${chaveK(990)}"`).replace('<CNPJ>12345678000199</CNPJ>', `<CNPJ>${CNPJ_K}</CNPJ>`);

  let proxima = minutos(-1); // no passado: "Buscar agora" liberado
  let ultima = { em: minutos(-5), novas: 1 };
  let buscaFase = 0; // 1 = POST feito (a próxima leitura diz "em andamento"), 2 = a leitura seguinte diz "terminou, 2 novas"
  let listaModo = 'normal'; // 'normal' | 'vazia' | 'erro'
  let lancou = false;
  const situacaoAtual = () => {
    let emAndamento = false;
    if (buscaFase === 1) { emAndamento = true; buscaFase = 2; }
    else if (buscaFase === 2) { buscaFase = 0; ultima = { em: new Date().toISOString(), novas: 2 }; }
    const quais = (s) => rows.filter((r) => r.situacao === s);
    return {
      ambiente: 'producao', cnpj: '12345678000199', busca_ligada: true, situacao: 'ok', mensagem: null, aviso: null, ultima_consulta: ultima,
      primeira_consulta_em: minutos(-60 * 24 * 7), proxima_consulta_em: proxima, bloqueado_ate: null, em_andamento: emAndamento, lacunas: 0, dias_sem_buscar: 0,
      ligada_por_nome: 'Admin', ligada_em: minutos(-60 * 24), outro_cnpj_ou_modo: false, certificado: { ok: true, code: null, mensagem: null, avisos: [] },
      contagem: { falta_lancar: quais('falta_lancar').length, parece_lancada: quais('parece_lancada').length, cancelada_depois_de_lancada: quais('cancelada_depois_de_lancada').length },
      canceladas_depois: quais('cancelada_depois_de_lancada').map((r) => ({ id: r.id, numero: r.numero, serie: r.serie, emitente_nome: r.emitente_nome })), historico: [],
    };
  };
  const cors = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
  const json = (route, corpo, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(corpo) });
  const instalar = async (page) => {
    await page.route(/\/v1\/notas-sefaz(\/|\?|$)/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const caminho = new URL(req.url()).pathname;
      OPS.push(`${req.method()} ${caminho}`);
      if (req.method() === 'GET' && caminho.endsWith('/situacao')) return json(route, situacaoAtual());
      if (req.method() === 'GET' && caminho.endsWith('/xml')) return route.fulfill({ status: 200, contentType: 'text/xml', headers: cors, body: XML_K990 });
      if (req.method() === 'GET') {
        if (listaModo === 'erro') return json(route, { error: { code: 'ERRO', message: 'Falha simulada.' } }, 500);
        if (listaModo === 'vazia') return json(route, []);
        const filtro = new URL(req.url()).searchParams.get('filtro');
        return json(route, filtro === 'todas' ? rows : rows.filter((r) => A_CONFERIR.includes(r.situacao)));
      }
      if (req.method() === 'POST' && caminho.endsWith('/buscar')) { buscaFase = 1; return json(route, { iniciada: true }, 202); }
      const m = caminho.match(/\/v1\/notas-sefaz\/([^/]+)\/(ignorar|reabrir)$/);
      const linha = m && rows.find((r) => r.id === m[1]);
      if (req.method() === 'POST' && linha) {
        if (m[2] === 'ignorar') {
          const b = JSON.parse(req.postData() ?? '{}');
          linha.situacao = 'ignorada';
          linha.ignorada = { em: new Date().toISOString(), por_nome: 'Admin', motivo: b.motivo, texto: b.texto ?? null };
        } else { linha.situacao = original.get(linha.id); linha.ignorada = null; }
        return json(route, linha);
      }
      return json(route, { error: { code: 'NAO_SIMULADO', message: 'Não simulado.' } }, 404);
    });
    // Dar entrada com origem "sefaz": a API do navegador está desligada (SEFAZ_DFE_AMBIENTE ausente) e recusaria de propósito.
    // Aqui só se prova o que a TELA manda (origem e chave); o servidor conferir de novo é do jest e do smoke.
    await page.route(/\/v1\/notas(\?|$)/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'POST') {
        const b = JSON.parse(req.postData() ?? '{}');
        OPS.push(`POST /v1/notas origem=${b.origem} chave=${b.chave}`);
        if (b.origem !== 'sefaz') return route.continue();
        lancou = true;
        return json(route, { id: UID(99), contas: 2, a_vista: false, insumos_criados: 0 }, 201);
      }
      if (req.method() === 'GET' && lancou) {
        return json(route, [{ id: UID(99), numero: '990', serie: '1', fornecedor_nome: 'LATICÍNIOS K', data_entrada: '2026-11-17', valor_total: 701.95, forma_pagamento: 'boleto', origem: 'sefaz', repetida_de: null }]);
      }
      return route.continue();
    });
  };

  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  const abaLancar = page.getByRole('tab', { name: 'Lançar nota' });
  const abaSefaz = page.getByRole('tab', { name: /^Notas da SEFAZ/ });
  const cartoes = page.locator('ul[aria-label="Notas da SEFAZ"] > li');
  const cartao = (n) => cartoes.filter({ hasText: `NF ${n} ·` });
  const sim = (p, t = 30_000) => p.waitFor({ timeout: t }).then(() => true, () => false);
  const FRASE_FAIXA = 'A NF 77 de LATICÍNIOS K, que você já lançou, foi cancelada pelo fornecedor. Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso.';

  // 1) API real, desligada: tela de sempre, sem abas e sem faixa.
  await page.goto(`${BASE}/notas`, { waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz aba: tela de sempre aparece', await sim(page.getByText('1. Arquivo da nota')));
  check('sefaz aba: servidor desligado não tem aba', (await abaSefaz.count()) === 0 && (await abaLancar.count()) === 0);
  check('sefaz aba: servidor desligado não tem faixa', (await page.getByText('que você já lançou, foi cancelada').count()) === 0);

  // 2) Ligado (simulado): abas, faixa e teclado.
  await instalar(page);
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz aba: "Notas da SEFAZ · 2" existe', await sim(page.getByRole('tab', { name: 'Notas da SEFAZ · 2', exact: true })));
  check('sefaz aba: "Lançar nota" é a padrão', (await abaLancar.getAttribute('aria-selected')) === 'true');
  check('sefaz aba: a faixa aparece na aba "Lançar nota"', await sim(page.getByText(FRASE_FAIXA)));
  await abaLancar.focus();
  await page.keyboard.press('ArrowRight');
  check('sefaz aba: seta para a direita seleciona a outra aba', await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notas da SEFAZ'))?.getAttribute('aria-selected') === 'true', null, { timeout: 10_000 }).then(() => true, () => false));

  // 3) Situações e "Por quê?" (aba aberta; "Todas").
  check('sefaz aba: lista "A conferir" tem 3 cartões', await cartoes.first().waitFor({ timeout: 30_000 }).then(async () => (await cartoes.count()) === 3, () => false));
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  check('sefaz aba: "Todas" tem 7 cartões', await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Notas da SEFAZ"] > li').length === 7, null, { timeout: 20_000 }).then(() => true, () => false));
  const lista = page.locator('ul[aria-label="Notas da SEFAZ"]');
  for (const t of [
    'Cancelada pelo fornecedor depois de você lançar', 'Motivo: Não é compra · por Diego, 15/11', 'Cancelada pelo fornecedor. Não precisa lançar.',
    'Recusada pela SEFAZ (denegada). Esta nota não vale.', 'Já lançada por XML em 03/11', 'Parece a NF 880 que você lançou por foto em 15/11', 'Falta lançar',
  ]) check(`sefaz aba: situação "${t}"`, (await lista.getByText(t).count()) >= 1);
  check('sefaz aba: "Só o resumo chegou." aparece em K880', (await cartao(880).getByText('Só o resumo chegou.').count()) === 1);
  check('sefaz aba: "Por quê?" existe 1 vez (details)', (await page.locator('details', { hasText: 'A SEFAZ entrega só o resumo' }).count()) === 1);
  check('sefaz aba: K880 tem "É a mesma nota" e "Lançar mesmo assim"', (await cartao(880).getByRole('button', { name: 'É a mesma nota' }).count()) === 1 && (await cartao(880).getByRole('button', { name: 'Lançar mesmo assim' }).count()) === 1);
  check('sefaz aba: K990 tem "Conferir"', (await cartao(990).getByRole('button', { name: 'Conferir', exact: true }).count()) === 1);
  await page.getByRole('button', { name: /^A conferir/ }).click();

  // 4) Medidas em 360 + captura.
  const l360 = await quemPassaDaBorda(page, 360);
  check('sefaz aba: sem rolagem lateral em 360', l360.scroll <= 360, JSON.stringify(l360));
  const altBuscar = (await page.getByRole('button', { name: 'Buscar agora' }).boundingBox())?.height ?? 0;
  const altAba1 = (await abaLancar.boundingBox())?.height ?? 0;
  const altAba2 = (await abaSefaz.boundingBox())?.height ?? 0;
  check('sefaz aba: "Buscar agora" e as abas têm ao menos 44 px', altBuscar >= 44 && altAba1 >= 44 && altAba2 >= 44, `${altBuscar}/${altAba1}/${altAba2}`);
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-aba-360.png'), fullPage: true });

  // 5) Ignorar: motivo obrigatório, "Outro motivo", sucesso com Desfazer.
  await cartao(990).getByRole('button', { name: 'Ignorar…' }).click();
  const dlg = page.getByRole('alertdialog');
  check('sefaz aba: diálogo "Ignorar esta nota?"', await sim(dlg.getByText('Ignorar esta nota?')));
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz aba: sem motivo mostra "Escolha o motivo."', await sim(dlg.getByText('Escolha o motivo.'), 10_000));
  await dlg.getByRole('radio', { name: 'Outro motivo' }).click();
  check('sefaz aba: "Outro motivo" abre "Escreva o motivo"', await sim(dlg.getByText('Escreva o motivo', { exact: true }), 10_000));
  await dlg.getByRole('radio', { name: 'Não é compra' }).click();
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz aba: toast "Nota ignorada." com Desfazer', await sim(page.getByText('Nota ignorada.').first(), 20_000) && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1);
  check('sefaz aba: K990 sai da lista "A conferir"', await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Notas da SEFAZ"] > li').length === 2, null, { timeout: 20_000 }).then(() => true, () => false));
  await page.getByRole('button', { name: 'Desfazer' }).first().click();
  check('sefaz aba: Desfazer devolve K990', await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Notas da SEFAZ"] > li').length === 3, null, { timeout: 20_000 }).then(() => true, () => false));
  check('sefaz aba: Desfazer chamou "reabrir"', OPS.some((o) => o.endsWith('/reabrir')));

  // 6) Marcar como visto (faixa some) e Desfazer (faixa volta).
  await cartao(77).getByRole('button', { name: 'Marcar como visto' }).click();
  check('sefaz aba: "Marcar como visto" mostra toast com Desfazer', await sim(page.getByText('Nota marcada como vista.').first(), 20_000) && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1);
  check('sefaz aba: a faixa some depois de marcar como visto', await page.waitForFunction((f) => !document.body.innerText.includes(f), FRASE_FAIXA, { timeout: 20_000 }).then(() => true, () => false));
  await page.getByRole('button', { name: 'Desfazer' }).first().click();
  check('sefaz aba: Desfazer traz a faixa de volta', await sim(page.getByText(FRASE_FAIXA), 20_000));
  // "Ver" da faixa leva à aba, filtro "A conferir", foco no cartão.
  await abaLancar.click();
  await page.getByRole('button', { name: 'Ver', exact: true }).click();
  check('sefaz aba: "Ver" abre a aba SEFAZ', await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notas da SEFAZ'))?.getAttribute('aria-selected') === 'true', null, { timeout: 10_000 }).then(() => true, () => false));
  check('sefaz aba: "Ver" põe o foco no cartão da NF 77', await page.waitForFunction((id) => document.activeElement?.getAttribute('data-nota-id') === id, UID(77), { timeout: 10_000 }).then(() => true, () => false));

  // 7) Buscar agora: buscando (desabilitado) e depois o toast.
  await page.getByRole('button', { name: 'Buscar agora' }).click();
  const buscando = page.getByRole('button', { name: 'Buscando na SEFAZ…' });
  check('sefaz aba: "Buscando na SEFAZ…" aparece desabilitado', await sim(buscando, 10_000) && (await buscando.isDisabled()));
  check('sefaz aba: toast "Busca feita: 2 notas novas."', await sim(page.getByText('Busca feita: 2 notas novas.').first(), 30_000));
  check('sefaz aba: o botão volta a "Buscar agora"', await sim(page.getByRole('button', { name: 'Buscar agora' }), 20_000));

  // 8) Espera: próxima busca no futuro.
  proxima = minutos(40);
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  await abaSefaz.click();
  const esperaFrase = `Próxima busca a partir das ${hhmm(proxima)}. A SEFAZ não deixa buscar antes.`;
  check('sefaz aba: espera mostra a hora e a frase', await sim(page.getByText(esperaFrase)));
  check('sefaz aba: espera deixa "Buscar agora" desabilitado', await page.getByRole('button', { name: 'Buscar agora' }).isDisabled());
  proxima = minutos(-1);

  // 9) Vazio e erro da lista.
  listaModo = 'vazia';
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  await abaSefaz.click();
  check('sefaz aba: lista vazia mostra "Nenhuma nota chegou ainda"', await sim(page.getByText('Nenhuma nota chegou ainda')));
  listaModo = 'erro';
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  await abaSefaz.click();
  check('sefaz aba: erro da lista mostra a frase e "Tentar de novo"', await sim(page.getByText('Não consegui ver as notas da SEFAZ agora. Toque em Tentar de novo.'), 30_000) && (await page.getByRole('button', { name: 'Tentar de novo' }).count()) === 1);
  listaModo = 'normal';

  // 10) Conferir K990: a mesma conferência de hoje, com origem "sefaz".
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  await abaSefaz.click();
  await cartao(990).getByRole('button', { name: 'Conferir', exact: true }).click();
  check('sefaz aba: Conferir seleciona "Lançar nota"', await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Lançar nota')?.getAttribute('aria-selected') === 'true', null, { timeout: 30_000 }).then(() => true, () => false));
  check('sefaz aba: Conferir abre "2. Dados da nota"', await sim(page.getByText('2. Dados da nota'), 60_000));
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-conferir-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Dar entrada' }).click();
  check('sefaz aba: toast "Entrada lançada no estoque"', await sim(page.getByText(/Entrada lançada no estoque/).first(), 60_000));
  check('sefaz aba: a chamada levou origem sefaz e a chave de K990', OPS.includes(`POST /v1/notas origem=sefaz chave=${chaveK(990)}`), OPS.filter((o) => o.startsWith('POST /v1/notas')).join(' | '));
  check('sefaz aba: "Notas lançadas" mostra a tag SEFAZ', await sim(page.locator('table').getByText('SEFAZ', { exact: true }), 30_000));

  // 11) Computador: tabela com as colunas.
  await page.setViewportSize({ width: 1366, height: 900 });
  await abaSefaz.click();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  for (const c of ['Fornecedor', 'NF / série', 'Emissão', 'Valor', 'Situação']) {
    check(`sefaz aba: tabela tem a coluna "${c}"`, await sim(page.getByRole('columnheader', { name: c, exact: true }), 20_000));
  }
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-aba-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });

  // 12) Link direto, storage, console e banco.
  await page.goto(`${BASE}/painel`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.goto(`${BASE}/notas#notas-sefaz`, { waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz aba: link #notas-sefaz abre a aba SEFAZ', await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notas da SEFAZ'))?.getAttribute('aria-selected') === 'true', null, { timeout: 30_000 }).then(() => true, () => false));
  const guardado = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('sefaz aba: localStorage só com authUser e sessionStorage vazio', guardado.local.length === 1 && guardado.local[0] === 'authUser' && guardado.sessao === 0, JSON.stringify(guardado));
  const reaisAba = erros.filter((e) => !/Failed to load resource/.test(e));
  check('sefaz aba: sem erro de console', reaisAba.length === 0, reaisAba.join(' | '));
  const consultasAba = execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-t', '-A', '-c', 'select count(*) from sefaz_distribuicao']).toString().trim();
  check('sefaz aba: nenhuma consulta no banco (a busca nunca ligou de verdade)', consultasAba === '0', consultasAba);
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
