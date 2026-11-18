// Conferência no navegador (Playwright do freela-web-v2, headless). Suba a pilha com scripts/browser-check.sh.
// Entra pelos formulários como ADMIN e como LOJA, abre todas as telas, faz os fluxos principais (nota por XML, inventário
// cego, caixa, notas da SEFAZ, cupom fiscal) e falha em erro de console/página. Capturas em $SHOTS.
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
    // o "Failed to load resource" leva o endereço (location): os blocos do cupom conferem cada um contra o que provocaram de propósito
    const onde = /Failed to load resource/.test(t) ? ` @ ${m.location()?.url ?? '?'}` : '';
    erros.push(`console: ${t.slice(0, 200)}${onde}`);
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
  const quadro = page.locator('#respostas-sefaz');
  const FRASE_RESP_INDISPONIVEL = 'As respostas à SEFAZ não estão ativadas neste servidor. Fale com o suporte do Freela Comanda se quiser usá-las.';
  check('sefaz respostas: servidor desligado mostra a frase', await quadro.getByText(FRASE_RESP_INDISPONIVEL).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz respostas: servidor desligado não tem "Ligar as respostas"', (await quadro.getByRole('button', { name: /Ligar as respostas/ }).count()) === 0);

  // 2) Estado simulado em memória. Registrado antes do reload que o usa.
  const cert = { ok: true, code: null, mensagem: null, avisos: [] };
  // Sem SEFAZ_MANIFESTACAO: `disponivel = false` e o resto vazio (como a API manda sem nenhuma resposta gravada; com resposta gravada,
  // `prazos_perto` vem do banco: fase "sem a variável, com prazo" abaixo).
  const RESP = { disponivel: false, ligadas: false, situacao: 'ok', mensagem: null, pausa_ate: null, ligadas_por_nome: null, ligadas_em: null, na_fila: 0, falharam: 0, prazos_perto: [] };
  const desligadaComCert = {
    ambiente: 'producao', cnpj: '12345678000199', busca_ligada: false, situacao: 'ok', mensagem: null, aviso: null, ultima_consulta: null,
    primeira_consulta_em: null, proxima_consulta_em: null, bloqueado_ate: null, em_andamento: false, lacunas: 0, dias_sem_buscar: null,
    ligada_por_nome: null, ligada_em: null, outro_cnpj_ou_modo: false, certificado: cert,
    contagem: { falta_lancar: 0, parece_lancada: 0, cancelada_depois_de_lancada: 0 }, canceladas_depois: [], historico: [], respostas: RESP,
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
    if (req.method() === 'PUT' && req.url().endsWith('/respostas')) {
      const ligadas = JSON.parse(req.postData() ?? '{}').ligadas === true;
      est = { ...est, respostas: { ...est.respostas, ligadas, situacao: 'ok', mensagem: null, ligadas_por_nome: ligadas ? 'Admin' : null, ligadas_em: ligadas ? new Date().toISOString() : null } };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify(est) });
    }
    if (req.method() === 'GET' && req.url().endsWith('/situacao')) return route.fulfill({ status: 200, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify(est) });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: corsSefaz, body: JSON.stringify({ error: { code: 'NAO_SIMULADO', message: 'Não simulado.' } }) });
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });

  // 3) Desligada com certificado: confirmação, foco, Esc, ligar.
  check('sefaz painel: tag "Desligada"', await painel.getByText('Desligada', { exact: true }).waitFor({ timeout: 30_000 }).then(() => true, () => false));
  check('sefaz respostas: sem a variável, só a frase', (await quadro.getByText(FRASE_RESP_INDISPONIVEL).count()) === 1);
  check('sefaz respostas: sem a variável, nenhum botão e nenhuma tag', (await quadro.getByRole('button').count()) === 0 && (await quadro.getByText(/^(Ligadas|Desligadas|Paradas|Esperando a SEFAZ)$/).count()) === 0);
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

  // 5b) Respostas à SEFAZ (UX §8), com a variável simulada (`disponivel`): desligadas, ligar (diálogo), ligadas, desligar, esperando e paradas.
  // A API do navegador segue sem SEFAZ_MANIFESTACAO: nada é ligado de verdade (o PUT também é simulado).
  const SP = 'America/Sao_Paulo';
  const dataSpP = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  const horaSpP = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.hour}h${p.minute}`; };
  const simQ = (l, t = 30_000) => l.waitFor({ timeout: t }).then(() => true, () => false);
  const RESP_ON = { ...RESP, disponivel: true };
  est = { ...desligadaComCert, respostas: RESP_ON };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas: tag "Desligadas"', await simQ(quadro.getByText('Desligadas', { exact: true })));
  check('sefaz respostas: abertura do quadro', (await quadro.getByText(/^Com as respostas ligadas, o Freela Comanda avisa a SEFAZ, em nome da empresa/).count()) === 1);
  check('sefaz respostas: "Ligue só depois de o seu contador concordar." em negrito', (await quadro.locator('strong', { hasText: 'Ligue só depois de o seu contador concordar.' }).count()) === 1);
  check('sefaz respostas: linha fixa desligadas', (await quadro.getByText('Com as respostas desligadas, nada é enviado à SEFAZ. O que estava na fila espera até você ligar de novo.').count()) === 1);
  const ligarResp = quadro.getByRole('button', { name: 'Ligar as respostas', exact: true });
  await ligarResp.scrollIntoViewIfNeeded();
  await ligarResp.click();
  check('sefaz respostas: diálogo "Ligar as respostas à SEFAZ?"', await simQ(dlg.getByText('Ligar as respostas à SEFAZ?', { exact: true }), 10_000));
  check('sefaz respostas: diálogo fala do prazo de 90 dias e do contador', (await dlg.getByText(/resposta\s+final em até 90 dias da data dela/).count()) === 1 && (await dlg.locator('strong', { hasText: 'Ligue só depois de o seu contador concordar.' }).count()) === 1);
  check('sefaz respostas: foco inicial em "Agora não"', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Agora não'));
  await page.screenshot({ path: join(SHOTS, 'admin-respostas-sefaz-dialogo-360.png') });
  await page.keyboard.press('Escape');
  check('sefaz respostas: Esc fecha o diálogo sem ligar', await dlg.waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false) && !pedidosSefaz.some((x) => x === 'PUT /v1/notas-sefaz/respostas'));
  await ligarResp.click();
  await dlg.getByRole('button', { name: 'Ligar as respostas', exact: true }).click();
  check('sefaz respostas: toast de ligadas', await simQ(page.getByText('Respostas ligadas. As primeiras saem em até 5 minutos.').first()));
  check('sefaz respostas: tag "Ligadas"', await simQ(quadro.getByText('Ligadas', { exact: true })));
  check('sefaz respostas: mostra "Ligadas por Admin em"', (await quadro.getByText(/^Ligadas por Admin em \d{2}\/\d{2}\/\d{4} às \d{2}h\d{2}$/).count()) === 1);
  await quadro.getByRole('button', { name: 'Desligar as respostas' }).click();
  check('sefaz respostas: desligar tem toast com "Desfazer" e sem diálogo', await simQ(page.getByText('Respostas desligadas.', { exact: true }).first()) && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1 && (await page.getByRole('alertdialog').count()) === 0);
  check('sefaz respostas: desligar volta a tag "Desligadas"', await simQ(quadro.getByText('Desligadas', { exact: true })));
  // Ligadas com dados: fila, prazo e falhas.
  const prazoA = new Date(Date.now() + 9 * 24 * 3_600_000).toISOString();
  const prazoB = new Date(Date.now() + 10 * 24 * 3_600_000).toISOString();
  est = {
    ...desligadaComCert,
    respostas: {
      ...RESP_ON, ligadas: true, ligadas_por_nome: 'Diego', ligadas_em: new Date().toISOString(), na_fila: 3, falharam: 1,
      prazos_perto: [{ id: 'a', numero: '4411', serie: '1', emitente_nome: 'ATACADÃO S.A.', prazo_final: prazoA }, { id: 'b', numero: '4412', serie: '1', emitente_nome: 'ATACADÃO S.A.', prazo_final: prazoB }],
    },
  };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas: "3 respostas na fila"', await simQ(quadro.getByText('3 respostas na fila', { exact: true })));
  check('sefaz respostas: "2 notas precisam de resposta até …"', (await quadro.getByText(`2 notas precisam de resposta até ${dataSpP(prazoA)}`, { exact: true }).count()) === 1);
  check('sefaz respostas: "1 resposta não foi enviada"', (await quadro.getByText('1 resposta não foi enviada', { exact: true }).count()) === 1);
  const lResp = await quemPassaDaBorda(page, 360);
  check('sefaz respostas: sem rolagem lateral em 360 (ligadas com dados)', lResp.scroll <= 360, JSON.stringify(lResp));
  await quadro.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'admin-respostas-sefaz-ligadas-360.png'), fullPage: true });
  // Esperando a SEFAZ: pausa no futuro, caixa âmbar com a frase do servidor como vem.
  const pausa = new Date(Date.now() + 40 * 60_000).toISOString();
  const fraseEspera = `A SEFAZ está fora do ar. As respostas saem de novo às ${horaSpP(pausa)}.`;
  est = { ...desligadaComCert, respostas: { ...RESP_ON, ligadas: true, ligadas_por_nome: 'Diego', ligadas_em: new Date().toISOString(), pausa_ate: pausa, mensagem: fraseEspera } };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas: tag "Esperando a SEFAZ"', await simQ(quadro.getByText('Esperando a SEFAZ', { exact: true })));
  check('sefaz respostas: espera em caixa de alerta com a frase (UX §8)', (await quadro.locator('[role="alert"]').getByText(fraseEspera, { exact: true }).count()) === 1);
  // Paradas: caixa vermelha (alerta) e "Ligar as respostas de novo". O estado REAL do servidor numa parada: `ligadas` continua true (o
  // servidor só muda a `situacao`), com quem ligou e a fila; o quadro não pode oferecer só "Desligar" (revisão final, I1).
  const fraseParada = 'A SEFAZ bloqueou as respostas duas vezes em 24 horas. Por segurança, elas foram desligadas. Fale com o suporte do Freela Comanda antes de ligar de novo.';
  const paradaReal = (situacao, mensagem) => ({
    ...desligadaComCert,
    respostas: { ...RESP_ON, ligadas: true, ligadas_por_nome: 'Diego', ligadas_em: new Date().toISOString(), na_fila: 2, situacao, mensagem },
  });
  est = paradaReal('parada_656', fraseParada);
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas: tag "Paradas"', await simQ(quadro.getByText('Paradas', { exact: true })));
  check('sefaz respostas: parada em alerta com a frase', (await quadro.locator('[role="alert"]').getByText(fraseParada, { exact: true }).count()) === 1);
  const deNovo = quadro.getByRole('button', { name: 'Ligar as respostas de novo' });
  check('sefaz respostas: "Ligar as respostas de novo" com 44 px', (await deNovo.count()) === 1 && ((await deNovo.boundingBox())?.height ?? 0) >= 44);
  check('sefaz respostas (parada com ligadas: true): sem "Desligar as respostas" e sem "Ligadas por…"', (await quadro.getByRole('button', { name: 'Desligar as respostas' }).count()) === 0 && (await quadro.getByText(/^Ligadas por /).count()) === 0);
  check('sefaz respostas (parada): a fila continua à vista', (await quadro.getByText('2 respostas na fila', { exact: true }).count()) === 1);
  await quadro.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'admin-respostas-sefaz-paradas-360.png'), fullPage: true });
  for (const [situacao, frase] of [
    ['parada_relogio', 'As respostas pararam: o relógio do servidor está fora da hora certa. Fale com o suporte do Freela Comanda.'],
    ['parada_configuracao', 'As respostas pararam: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda.'],
  ]) {
    est = paradaReal(situacao, frase);
    await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
    check(`sefaz respostas (${situacao}, ligadas: true): Paradas, a frase em alerta e "Ligar as respostas de novo"`, await simQ(quadro.getByText('Paradas', { exact: true }))
      && (await quadro.locator('[role="alert"]').getByText(frase, { exact: true }).count()) === 1
      && (await quadro.getByRole('button', { name: 'Ligar as respostas de novo' }).count()) === 1
      && (await quadro.getByRole('button', { name: 'Desligar as respostas' }).count()) === 0);
  }
  // "Ligar as respostas de novo" passa pelo diálogo e o PUT `ligadas: true` volta a `ok` (o mock faz o que o servidor faz).
  await quadro.getByRole('button', { name: 'Ligar as respostas de novo' }).click();
  await dlg.getByRole('button', { name: 'Ligar as respostas', exact: true }).click();
  check('sefaz respostas: Ligar de novo volta a "Ligadas"', await simQ(quadro.getByText('Ligadas', { exact: true })) && (await quadro.getByText('Paradas', { exact: true }).count()) === 0);
  // Sem a variável, com notas no aviso do prazo (I3): a frase "não estão ativadas" e a linha do prazo, ainda sem botão nem tag.
  est = { ...desligadaComCert, respostas: { ...RESP, prazos_perto: [{ id: 'a', numero: '4411', serie: '1', emitente_nome: 'ATACADÃO S.A.', prazo_final: prazoA }] } };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas (sem a variável, com prazo): a frase e a linha do prazo', await simQ(quadro.getByText(FRASE_RESP_INDISPONIVEL)) && (await quadro.getByText(`1 nota precisa de resposta até ${dataSpP(prazoA)}`, { exact: true }).count()) === 1);
  check('sefaz respostas (sem a variável, com prazo): nenhum botão de ligar e nenhuma tag', (await quadro.getByRole('button').count()) === 0 && (await quadro.getByText(/^(Ligadas|Desligadas|Paradas|Esperando a SEFAZ)$/).count()) === 0);

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
  const respostasNoBanco = execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-t', '-A', '-c', "select (select count(*) from sefaz_manifestacao) || '/' || (select count(*) from sefaz_manifestacoes)"]).toString().trim();
  check('sefaz respostas: sefaz_manifestacao e sefaz_manifestacoes vazias (as respostas nunca ligaram de verdade)', respostasNoBanco === '0/0', respostasNoBanco);
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
    valor_total: 100 + n, situacao_sefaz: 'autorizada', cancelada_em: null, situacao: 'falta_lancar', lancada: null, parecidas: [], pode_conferir: false, nao_parece_compra: false, ignorada: null,
    resposta: null, ...p,
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
  // Respostas à SEFAZ (UX §8). Sem SEFAZ_MANIFESTACAO a API manda `disponivel = false` e `resposta = null` na nota SEM nenhuma resposta
  // gravada; a que tem (ciência ou resposta final) segue com a resposta (revisão final, I3: a leitura não depende da variável). O mock faz igual.
  const RESP = { disponivel: false, ligadas: false, situacao: 'ok', mensagem: null, pausa_ate: null, ligadas_por_nome: null, ligadas_em: null, na_fila: 0, falharam: 0, prazos_perto: [] };
  let respostasEst = RESP;
  let jaFoi = false; // o "Desfazer" chega depois de a resposta sair: o reabrir devolve a nota ainda com a resposta final
  const CORPOS = []; // corpo de cada POST …/ignorar, na ordem
  const comResposta = (r) => (respostasEst.disponivel || r.resposta?.ciencia || r.resposta?.final ? r : { ...r, resposta: null });
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
      respostas: respostasEst,
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
        return json(route, (filtro === 'todas' ? rows : rows.filter((r) => A_CONFERIR.includes(r.situacao))).map(comResposta));
      }
      if (req.method() === 'POST' && caminho.endsWith('/buscar')) { buscaFase = 1; return json(route, { iniciada: true }, 202); }
      const m = caminho.match(/\/v1\/notas-sefaz\/([^/]+)\/(ignorar|reabrir|responder-de-novo)$/);
      const linha = m && rows.find((r) => r.id === m[1]);
      if (req.method() === 'POST' && linha) {
        if (m[2] === 'ignorar') {
          const b = JSON.parse(req.postData() ?? '{}');
          CORPOS.push({ id: linha.id, ...b });
          linha.situacao = 'ignorada';
          linha.ignorada = { em: new Date().toISOString(), por_nome: 'Admin', motivo: b.motivo, texto: b.texto ?? null };
          if (b.avisar_sefaz === true && linha.resposta) {
            const tipo = { nao_reconheco: 'nao_reconheco', compra_nao_aconteceu: 'nao_aconteceu' }[b.motivo] ?? 'confirmacao';
            linha.resposta = { ...linha.resposta, pode_responder: false, final: { estado: 'na_fila', em: new Date().toISOString(), protocolo: null, c_stat: null, mensagem: null, tipo, origem: 'admin' } };
          }
        } else if (m[2] === 'reabrir') {
          linha.situacao = original.get(linha.id); linha.ignorada = null;
          if (linha.resposta?.final?.origem === 'admin') {
            // O servidor cancela a resposta que ainda espera na fila; a que já saiu fica (e a nota volta com ela).
            linha.resposta = jaFoi
              ? { ...linha.resposta, final: { ...linha.resposta.final, estado: 'enviando' } }
              : { ...linha.resposta, final: null, pode_responder: true };
          }
        } else {
          const r = linha.resposta;
          if (r?.final?.estado === 'falhou') linha.resposta = { ...r, final: { ...r.final, estado: 'na_fila' } };
          else if (r?.ciencia?.estado === 'falhou') linha.resposta = { ...r, ciencia: { ...r.ciencia, estado: 'na_fila' } };
          else return json(route, { error: { code: 'SEFAZ_NADA_A_REENVIAR', message: 'Não há resposta para enviar de novo nesta nota.' } }, 409);
        }
        return json(route, comResposta(linha));
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
  // Sem SEFAZ_MANIFESTACAO (respostas.disponivel = false): nada da UX §8 na aba.
  check('sefaz aba (sem respostas): nenhum "Não reconheço…"', (await page.getByRole('button', { name: 'Não reconheço…' }).count()) === 0);
  check('sefaz aba (sem respostas): nenhuma linha de prazo nem de resposta', (await lista.getByText(/responder à SEFAZ|Responder à SEFAZ|resposta à SEFAZ|A SEFAZ já sabe|Avisando a SEFAZ|na SEFAZ em|avisou a SEFAZ|não aceitou a resposta/).count()) === 0);
  check('sefaz aba (sem respostas): nenhuma faixa do prazo', (await page.locator('[data-faixa="prazo"]').count()) === 0 && (await page.getByText(/precisam? de uma resposta à SEFAZ/).count()) === 0);
  check('sefaz aba (sem respostas): "Por quê?" com o texto das respostas desligadas', (await page.locator('details', { hasText: 'e as respostas à SEFAZ estão desligadas' }).count()) === 1);
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
  check('sefaz aba (sem respostas): Ignorar com os 4 motivos de antes', (await dlg.getByRole('radio').count()) === 4 && (await dlg.getByText('A compra não aconteceu (devolvi ou cancelei)').count()) === 0);
  check('sefaz aba (sem respostas): Ignorar diz que nada vai à SEFAZ', (await dlg.getByText('Nada é enviado à SEFAZ e nada é lançado.', { exact: false }).count()) === 1);
  // O botão fica só com aria-disabled sem motivo (o toque ainda chega e mostra o aviso); o Playwright trata aria-disabled como
  // não clicável, por isso o force.
  check('sefaz aba: "Ignorar nota" com aria-disabled sem motivo', (await dlg.getByRole('button', { name: 'Ignorar nota' }).getAttribute('aria-disabled')) === 'true');
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click({ force: true });
  check('sefaz aba: sem motivo mostra "Escolha o motivo."', await sim(dlg.getByText('Escolha o motivo.'), 10_000));
  await dlg.getByRole('radio', { name: 'Outro motivo' }).click();
  check('sefaz aba: "Outro motivo" abre "Escreva o motivo"', await sim(dlg.getByText('Escreva o motivo', { exact: true }), 10_000));
  await dlg.getByRole('radio', { name: 'Não é compra' }).click();
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz aba: toast "Nota ignorada." com Desfazer', await sim(page.getByText('Nota ignorada.').first(), 20_000) && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1);
  check('sefaz aba: K990 sai da lista "A conferir"', await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Notas da SEFAZ"] > li').length === 2, null, { timeout: 20_000 }).then(() => true, () => false));
  check('sefaz aba (sem respostas): o Ignorar não manda avisar_sefaz', CORPOS.length === 1 && CORPOS[0].motivo === 'nao_e_compra' && !('avisar_sefaz' in CORPOS[0]), JSON.stringify(CORPOS));
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
  check('sefaz aba (sem respostas): o toast do Dar entrada não fala da SEFAZ', (await page.getByText('A confirmação da compra vai para a SEFAZ em alguns minutos.').count()) === 0);
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


  // 11b) Respostas à SEFAZ (UX §8) com a variável simulada (`respostas.disponivel`). A API do navegador segue sem SEFAZ_MANIFESTACAO:
  // tudo vem do mock (o Ignorar com aviso, o Desfazer, o "Tentar de novo"), e no fim o banco confirma que nenhuma resposta existe.
  const partesHoje = () => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  // Meio-dia de Brasília (15h UTC) do dia de hoje + d: os dias contados não dependem da hora em que o roteiro roda.
  const meioDia = (d) => { const h = partesHoje(); return new Date(Date.UTC(+h.year, +h.month - 1, +h.day + d, 15)).toISOString(); };
  const dataSp = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  const ddmmSp = (iso) => dataSp(iso).slice(0, 5);
  const ONTEM = minutos(-60 * 24);
  const ev = (estado, p = {}) => ({ estado, em: ONTEM, protocolo: estado === 'registrada' ? '135260000000001' : null, c_stat: null, mensagem: null, ...p });
  const fin = (tipo, estado, p = {}) => ({ ...ev(estado, p), tipo, origem: 'dar_entrada' });
  const resp = (p = {}) => ({ ciencia: ev('registrada'), final: null, prazo_final: meioDia(40), prazo_perto: false, prazo_passou: false, pode_responder: true, ...p });
  const respondida = (final) => resp({ final, pode_responder: false });
  const jaLancada = (n, final) => nova(n, { situacao: 'ja_lancada', lancada: { ...parecida, numero: String(n), origem: 'xml', data_entrada: '2026-11-10' }, resposta: respondida(final) });
  const recusada = (n, c_stat, mensagem) => jaLancada(n, fin('confirmacao', 'recusada', { c_stat, mensagem }));
  const ignoradaPor = (motivo, texto = null) => ({ em: ONTEM, por_nome: 'Diego', motivo, texto });
  const NOVAS = [
    nova(30, { resposta: resp() }),
    nova(31, { resposta: resp({ prazo_final: meioDia(6), prazo_perto: true }) }),
    nova(32, { resposta: resp({ prazo_final: meioDia(0), prazo_perto: true }) }),
    nova(33, { resposta: resp({ prazo_final: meioDia(-1), prazo_passou: true, pode_responder: false }) }),
    nova(34, { resposta: resp({ ciencia: ev('na_fila') }) }),
    jaLancada(35, fin('confirmacao', 'na_fila')),
    jaLancada(36, fin('confirmacao', 'registrada')),
    nova(37, { situacao: 'ignorada', ignorada: ignoradaPor('nao_reconheco'), resposta: respondida({ ...fin('nao_reconheco', 'registrada'), origem: 'admin' }) }),
    nova(38, { situacao: 'ignorada', ignorada: ignoradaPor('compra_nao_aconteceu', 'Mercadoria devolvida na entrega'), resposta: respondida({ ...fin('nao_aconteceu', 'registrada'), origem: 'admin' }) }),
    recusada(39, 650, 'A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.'),
    recusada(40, 501, 'A SEFAZ não aceitou a resposta: passou o prazo.'),
    recusada(41, 655, 'Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.'),
    recusada(42, 575, 'A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa.'),
    recusada(43, 236, 'A SEFAZ não aceitou a resposta: a chave de acesso não confere.'),
    recusada(44, 999, null),
    jaLancada(45, fin('confirmacao', 'falhou')),
  ];
  const TROCAR = 'Para mudar, fale com o seu contador: a SEFAZ aceita corrigir uma vez, em até 30 dias.';
  const LINHAS = [
    [30, `Responder à SEFAZ até ${dataSp(meioDia(40))}`],
    [30, `A SEFAZ já sabe que a nota chegou (${ddmmSp(ONTEM)}).`],
    [31, `Faltam 6 dias para responder à SEFAZ (até ${dataSp(meioDia(6))}).`],
    [32, 'Último dia para responder à SEFAZ.'],
    [33, 'Passou o prazo: a SEFAZ considera esta compra confirmada.'],
    [34, 'Avisando a SEFAZ que a nota chegou…'],
    [35, 'Resposta à SEFAZ na fila: sai em alguns minutos.'],
    [36, `Compra confirmada na SEFAZ em ${ddmmSp(ONTEM)}.`],
    [37, `Você avisou a SEFAZ que não reconhece esta nota (${ddmmSp(ONTEM)}). ${TROCAR}`],
    [38, `Você avisou a SEFAZ que a compra não aconteceu (${ddmmSp(ONTEM)}). ${TROCAR}`],
    [39, 'A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.'],
    [40, 'A SEFAZ não aceitou a resposta: passou o prazo.'],
    [41, 'Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.'],
    [42, 'A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa.'],
    [43, 'A SEFAZ não aceitou a resposta: a chave de acesso não confere.'],
    [44, 'A SEFAZ não aceitou a resposta (código 999). Fale com o seu contador.'],
    [45, 'Não consegui enviar a resposta à SEFAZ depois de 3 tentativas.'],
  ];
  for (const r of NOVAS) { rows.push(r); original.set(r.id, r.situacao); }
  K990.resposta = resp();
  K880.resposta = resp();
  const altura = async (l) => (await l.boundingBox())?.height ?? 0;
  const sumiu = (l) => l.waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false);
  const toastExato = (t) => sim(page.getByText(t, { exact: true }).first(), 20_000);
  const desfazerToast = () => page.getByRole('button', { name: 'Desfazer' }).first().click();

  // A faixa de UMA nota (a 31, no aviso do prazo): com as respostas desligadas, sem a ação (nada de "toque em Não reconheço").
  const r31 = rows.find((x) => x.numero === '31');
  const prazo31 = [{ id: r31.id, numero: r31.numero, serie: r31.serie, emitente_nome: r31.emitente_nome, prazo_final: r31.resposta.prazo_final }];
  const FRASE_PRAZO_31 = `A NF 31 de ${r31.emitente_nome} precisa de uma resposta à SEFAZ até ${dataSp(meioDia(6))}.`;

  // 11b.0) Servidor SEM a variável, mas com respostas gravadas (a volta do roteiro, I3): o aviso do prazo e as linhas que o servidor manda
  // aparecem; nenhuma ação de resposta ("Não reconheço…", "Tentar de novo", a linha neutra "Responder à SEFAZ até…").
  respostasEst = { ...RESP, prazos_perto: prazo31 };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz sem a variável, com respostas gravadas: faixa do prazo sem a ação', await sim(page.locator('[data-faixa="prazo"]').getByText(FRASE_PRAZO_31, { exact: true })));
  await abaSefaz.click();
  check('sefaz sem a variável, com respostas gravadas: NF 31 com o aviso âmbar', await sim(cartao(31).getByText(`Faltam 6 dias para responder à SEFAZ (até ${dataSp(meioDia(6))}).`, { exact: true })));
  check('sefaz sem a variável, com respostas gravadas: nenhum "Não reconheço…" nem linha neutra', (await page.getByRole('button', { name: 'Não reconheço…' }).count()) === 0
    && (await lista.getByText(/^Responder à SEFAZ até /).count()) === 0);
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  check('sefaz sem a variável, com respostas gravadas: a que falhou aparece sem "Tentar de novo"', await sim(cartao(45).getByText('Não consegui enviar a resposta à SEFAZ depois de 3 tentativas.', { exact: true }))
    && (await lista.getByRole('button', { name: 'Tentar de novo' }).count()) === 0);

  // 11b.1) Variável ligada, respostas DESLIGADAS: as linhas seguem o que o servidor manda; nada de "Não reconheço…" nem de aviso no Ignorar.
  respostasEst = { ...RESP, disponivel: true, prazos_perto: prazo31 };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  check('sefaz respostas desligadas: faixa do prazo de uma nota sem a ação (nada de "Não reconheço")', await sim(page.locator('[data-faixa="prazo"]').getByText(FRASE_PRAZO_31, { exact: true }))
    && (await page.locator('[data-faixa="prazo"]').getByText(/Não reconheço/).count()) === 0);
  await abaSefaz.click();
  check('sefaz respostas desligadas: K990 aparece', await sim(cartao(990)));
  check('sefaz respostas desligadas: nenhum "Não reconheço…"', (await page.getByRole('button', { name: 'Não reconheço…' }).count()) === 0);
  check('sefaz respostas desligadas: sem a linha neutra "Responder à SEFAZ até…" (a ação não existe); o aviso âmbar fica', (await cartao(990).getByText(/^Responder à SEFAZ até /).count()) === 0
    && (await cartao(31).getByText(`Faltam 6 dias para responder à SEFAZ (até ${dataSp(meioDia(6))}).`, { exact: true }).count()) === 1);
  check('sefaz respostas desligadas: "Por quê?" com o texto das respostas desligadas', (await page.locator('details', { hasText: 'e as respostas à SEFAZ estão desligadas' }).count()) === 1);
  await cartao(990).getByRole('button', { name: 'Ignorar…' }).click();
  check('sefaz respostas desligadas: Ignorar com os 4 motivos e o texto de antes', await sim(dlg.getByText('Ignorar esta nota?'), 10_000)
    && (await dlg.getByRole('radio').count()) === 4 && (await dlg.getByText('Nada é enviado à SEFAZ e nada é lançado.', { exact: false }).count()) === 1);
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});

  // 11b.2) Respostas LIGADAS: faixa do prazo, linhas de cada cartão, botões.
  respostasEst = {
    ...RESP, disponivel: true, ligadas: true, ligadas_por_nome: 'Admin', ligadas_em: minutos(-60),
    prazos_perto: [32, 31].map((n) => { const r = rows.find((x) => x.numero === String(n)); return { id: r.id, numero: r.numero, serie: r.serie, emitente_nome: r.emitente_nome, prazo_final: r.resposta.prazo_final }; }),
  };
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  const faixaPrazo = page.locator('[data-faixa="prazo"]');
  const FRASE_PRAZO = `2 notas precisam de uma resposta à SEFAZ. A primeira vence em ${dataSp(meioDia(0))}.`;
  check('sefaz respostas: faixa do prazo com a frase e role="status"', await sim(faixaPrazo.getByText(FRASE_PRAZO, { exact: true })) && (await faixaPrazo.getAttribute('role')) === 'status');
  const yCanc = (await page.locator('[role="alert"]', { hasText: 'que você já lançou, foi cancelada' }).boundingBox())?.y ?? -1;
  const yPrazo = (await faixaPrazo.boundingBox())?.y ?? -1;
  const yAbas = (await page.getByRole('tablist').boundingBox())?.y ?? -1;
  check('sefaz respostas: faixa do prazo abaixo da de cancelamento e acima das abas', yCanc >= 0 && yCanc < yPrazo && yPrazo < yAbas, `${yCanc}/${yPrazo}/${yAbas}`);
  check('sefaz respostas: "Ver" da faixa do prazo com 44 px', (await altura(faixaPrazo.getByRole('button', { name: 'Ver', exact: true }))) >= 44);
  await abaSefaz.click();
  check('sefaz respostas: "Por quê?" com o texto das respostas ligadas', await sim(page.locator('details', { hasText: 'O sistema já avisou a SEFAZ que a nota chegou.' })));
  check('sefaz respostas: K990 tem "Não reconheço…"', await sim(cartao(990).getByRole('button', { name: 'Não reconheço…' })));
  const botoes990 = (await cartao(990).getByRole('button').allInnerTexts()).map((t) => t.trim());
  check('sefaz respostas: ordem no celular (primária, Ignorar…, Não reconheço…, Copiar chave)', JSON.stringify(botoes990) === JSON.stringify(['Conferir', 'Ignorar…', 'Não reconheço…', 'Copiar chave']), JSON.stringify(botoes990));
  check('sefaz respostas: "Não reconheço…" também em "Parece já lançada"', (await cartao(880).getByRole('button', { name: 'Não reconheço…' }).count()) === 1);
  check('sefaz respostas: "Não reconheço…" com 44 px e ícone', (await altura(cartao(990).getByRole('button', { name: 'Não reconheço…' }))) >= 44 && (await cartao(990).getByRole('button', { name: 'Não reconheço…' }).locator('svg').count()) === 1);
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  check('sefaz respostas: "Todas" mostra os cartões das respostas', await sim(cartao(45)));
  for (const [n, t] of LINHAS) check(`sefaz respostas: NF ${n} mostra "${t.slice(0, 60)}"`, (await cartao(n).getByText(t, { exact: true }).count()) === 1);
  check('sefaz respostas: prazo perto em âmbar com ícone', (await cartao(31).locator('p', { hasText: 'Faltam 6 dias' }).locator('svg').count()) === 1);
  check('sefaz respostas: linha da resposta em aria-live="polite"', (await cartao(36).locator('[aria-live="polite"]').getByText(`Compra confirmada na SEFAZ em ${ddmmSp(ONTEM)}.`).count()) === 1);
  check('sefaz respostas: só a que falhou tem "Tentar de novo"', (await lista.getByRole('button', { name: 'Tentar de novo' }).count()) === 1 && (await cartao(45).getByRole('button', { name: 'Tentar de novo' }).count()) === 1);
  check('sefaz respostas: nota já respondida não tem "Não reconheço…"', (await cartao(37).getByRole('button', { name: 'Não reconheço…' }).count()) === 0 && (await cartao(35).getByRole('button', { name: 'Não reconheço…' }).count()) === 0);
  check('sefaz respostas: "Tentar de novo" com 44 px', (await altura(cartao(45).getByRole('button', { name: 'Tentar de novo' }))) >= 44);
  const lResp = await quemPassaDaBorda(page, 360);
  check('sefaz respostas: sem rolagem lateral em 360 (Todas, com as linhas)', lResp.scroll <= 360, JSON.stringify(lResp));
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-respostas-360.png'), fullPage: true });
  // Tentar de novo: volta à fila.
  await cartao(45).getByRole('button', { name: 'Tentar de novo' }).click();
  check('sefaz respostas: "Tentar de novo" mostra "Resposta de volta à fila."', await toastExato('Resposta de volta à fila.') && OPS.includes(`POST /v1/notas-sefaz/${UID(45)}/responder-de-novo`));
  check('sefaz respostas: depois do "Tentar de novo" a linha diz "na fila"', await sim(cartao(45).getByText('Resposta à SEFAZ na fila: sai em alguns minutos.', { exact: true }), 20_000) && (await cartao(45).getByRole('button', { name: 'Tentar de novo' }).count()) === 0);

  // 11b.3) "Não reconheço…" abre o Ignorar já marcado; "A compra não aconteceu" e os 3 erros; aviso e Desfazer.
  await page.getByRole('button', { name: /^A conferir/ }).click();
  await cartao(990).getByRole('button', { name: 'Não reconheço…' }).click();
  check('sefaz respostas: "Não reconheço…" abre o Ignorar com o motivo marcado', await sim(dlg.getByText('Ignorar esta nota?'), 10_000) && (await dlg.getByRole('radio', { name: 'Não reconheço esta nota' }).isChecked()));
  const motivosTela = (await dlg.getByRole('radio').evaluateAll((els) => els.map((e) => e.closest('label')?.textContent?.trim() ?? ''))).join(' | ');
  check('sefaz respostas: 5 motivos na ordem', motivosTela === 'Já lancei de outro jeito | Não é compra | Não reconheço esta nota | A compra não aconteceu (devolvi ou cancelei) | Outro motivo', motivosTela);
  check('sefaz respostas: descrição "Nada é lançado." sem "Nada é enviado"', (await dlg.getByText('Nada é lançado.', { exact: false }).count()) === 1 && (await dlg.getByText('Nada é enviado à SEFAZ e nada é lançado.', { exact: false }).count()) === 0);
  check('sefaz respostas: linha do "Não reconheço"', (await dlg.getByText('A SEFAZ é avisada de que a empresa não reconhece esta nota. Use quando você não conhece o fornecedor ou não pediu nada a ele. Depois de enviado, não dá para desfazer aqui.', { exact: true }).count()) === 1);
  check('sefaz respostas: botão "Avisar a SEFAZ e ignorar"', (await dlg.getByRole('button', { name: 'Avisar a SEFAZ e ignorar' }).count()) === 1);
  await dlg.getByRole('radio', { name: 'A compra não aconteceu (devolvi ou cancelei)' }).click();
  const campo = dlg.getByLabel('Conte o que houve');
  check('sefaz respostas: "Conte o que houve" com "15 a 255 letras" e a linha', await sim(campo, 10_000) && (await dlg.getByText('15 a 255 letras', { exact: true }).count()) === 1
    && (await dlg.getByText('A SEFAZ é avisada de que a compra não aconteceu, com o seu texto. Depois de enviado, não dá para desfazer aqui.', { exact: true }).count()) === 1);
  const avisarBtn = dlg.getByRole('button', { name: 'Avisar a SEFAZ e ignorar' });
  check('sefaz respostas: sem texto, "Avisar a SEFAZ e ignorar" tem aria-disabled', (await avisarBtn.getAttribute('aria-disabled')) === 'true');
  for (const [txt, erro] of [
    ['devolvido', 'Conte o que houve com pelo menos 15 letras.'],
    ['x'.repeat(256), 'Use no máximo 255 letras.'],
    ['Mercadoria devolvida 😀 na entrega', 'Use só letras, números e pontuação comum (sem emoji).'],
  ]) {
    await campo.fill(txt);
    await avisarBtn.click();
    check(`sefaz respostas: erro "${erro}" em caixa no diálogo`, await sim(dlg.locator('[role="alert"]').getByText(erro, { exact: true }), 10_000));
  }
  check('sefaz respostas: nenhum texto inválido foi enviado', !CORPOS.some((c) => c.motivo === 'compra_nao_aconteceu'), JSON.stringify(CORPOS));
  const lDlg = await quemPassaDaBorda(page, 360);
  check('sefaz respostas: diálogo sem rolagem lateral em 360', lDlg.scroll <= 360 && lDlg.culpados.length === 0, JSON.stringify(lDlg));
  await page.screenshot({ path: join(SHOTS, 'admin-notas-sefaz-nao-aconteceu-360.png') });
  await campo.fill('  Mercadoria   devolvida na entrega ');
  await avisarBtn.click();
  check('sefaz respostas: toast "Nota ignorada. A resposta vai para a SEFAZ em alguns minutos." com Desfazer', await toastExato('Nota ignorada. A resposta vai para a SEFAZ em alguns minutos.') && (await page.getByRole('button', { name: 'Desfazer' }).count()) >= 1);
  const c1 = CORPOS.at(-1);
  check('sefaz respostas: mandou o motivo, o texto normalizado e avisar_sefaz = true', c1?.motivo === 'compra_nao_aconteceu' && c1.texto === 'Mercadoria devolvida na entrega' && c1.avisar_sefaz === true, JSON.stringify(c1));
  check('sefaz respostas: K990 sai de "A conferir"', await sumiu(cartao(990)));
  await desfazerToast();
  check('sefaz respostas: Desfazer devolve K990, sem o aviso de "já tinha ido"', await sim(cartao(990), 20_000) && (await page.getByText('A resposta já tinha ido para a SEFAZ', { exact: false }).count()) === 0);

  // "Outro motivo": nada vai à SEFAZ (sem avisar_sefaz).
  await cartao(990).getByRole('button', { name: 'Ignorar…' }).click();
  check('sefaz respostas: "Ignorar…" abre sem motivo marcado', await sim(dlg.getByText('Ignorar esta nota?'), 10_000) && (await dlg.getByRole('radio', { checked: true }).count()) === 0);
  await dlg.getByRole('radio', { name: 'Outro motivo' }).click();
  check('sefaz respostas: "Outro motivo" diz "Nada é enviado à SEFAZ."', await sim(dlg.getByText('Nada é enviado à SEFAZ.', { exact: true }), 10_000));
  await dlg.getByLabel('Escreva o motivo').fill('Nota de teste do fornecedor');
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz respostas: "Outro motivo" dá "Nota ignorada." e não manda avisar_sefaz', await toastExato('Nota ignorada.') && CORPOS.at(-1)?.motivo === 'outro' && !('avisar_sefaz' in CORPOS.at(-1)), JSON.stringify(CORPOS.at(-1)));
  await sumiu(cartao(990));
  await desfazerToast();
  await sim(cartao(990), 20_000);

  // "Não é compra": a caixa (desmarcada) decide o avisar_sefaz.
  await cartao(990).getByRole('button', { name: 'Ignorar…' }).click();
  await sim(dlg.getByText('Ignorar esta nota?'), 10_000);
  await dlg.getByRole('radio', { name: 'Não é compra' }).click();
  const caixaCompra = dlg.getByRole('checkbox', { name: 'Avisar a SEFAZ que a compra aconteceu' });
  check('sefaz respostas: "Não é compra" mostra a caixa desmarcada e a linha', await sim(caixaCompra, 10_000) && !(await caixaCompra.isChecked())
    && (await dlg.getByText('Marque se a nota é verdadeira e só não vai para o estoque (por exemplo, um equipamento).', { exact: true }).count()) === 1);
  check('sefaz respostas: a linha da caixa tem 44 px', (await altura(dlg.locator('label', { has: page.getByRole('checkbox', { name: 'Avisar a SEFAZ que a compra aconteceu' }) }))) >= 44);
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz respostas: caixa desmarcada manda avisar_sefaz = false e "Nota ignorada."', await toastExato('Nota ignorada.') && CORPOS.at(-1)?.motivo === 'nao_e_compra' && CORPOS.at(-1).avisar_sefaz === false, JSON.stringify(CORPOS.at(-1)));
  await sumiu(cartao(990));
  await desfazerToast();
  await sim(cartao(990), 20_000);
  // Marcada: avisa; e o Desfazer que chega depois de a resposta sair diz isso.
  await cartao(990).getByRole('button', { name: 'Ignorar…' }).click();
  await sim(dlg.getByText('Ignorar esta nota?'), 10_000);
  await dlg.getByRole('radio', { name: 'Não é compra' }).click();
  await caixaCompra.click();
  await dlg.getByRole('button', { name: 'Ignorar nota' }).click();
  check('sefaz respostas: caixa marcada manda avisar_sefaz = true e o toast do aviso', await toastExato('Nota ignorada. A resposta vai para a SEFAZ em alguns minutos.') && CORPOS.at(-1)?.motivo === 'nao_e_compra' && CORPOS.at(-1).avisar_sefaz === true, JSON.stringify(CORPOS.at(-1)));
  await sumiu(cartao(990));
  jaFoi = true;
  await desfazerToast();
  check('sefaz respostas: Desfazer tarde diz que a resposta já tinha ido', await toastExato('A resposta já tinha ido para a SEFAZ e não dá para desfazer aqui. A nota voltou para a lista.') && await sim(cartao(990), 20_000));
  jaFoi = false;
  check('sefaz respostas: depois disso K990 não oferece mais "Não reconheço…"', await page.waitForFunction(() => ![...document.querySelectorAll('ul[aria-label="Notas da SEFAZ"] > li')].some((li) => li.textContent.includes('NF 990 ·') && li.textContent.includes('Não reconheço…')), null, { timeout: 20_000 }).then(() => true, () => false));

  // "É a mesma nota" com as respostas ligadas: confirma a compra na SEFAZ.
  await cartao(880).getByRole('button', { name: 'É a mesma nota' }).click();
  check('sefaz respostas: "É a mesma nota" com o toast da confirmação', await toastExato('Nota marcada como já lançada. A confirmação vai para a SEFAZ em alguns minutos.'));
  check('sefaz respostas: "É a mesma nota" manda avisar_sefaz = true', CORPOS.at(-1)?.id === K880.id && CORPOS.at(-1).motivo === 'lancada_de_outro_jeito' && CORPOS.at(-1).avisar_sefaz === true, JSON.stringify(CORPOS.at(-1)));
  await sumiu(cartao(880));
  await desfazerToast();
  check('sefaz respostas: Desfazer devolve K880', await sim(cartao(880), 20_000));

  // Dar entrada pela aba com as respostas ligadas: a 2ª linha do toast.
  await cartao(990).getByRole('button', { name: 'Conferir', exact: true }).click();
  await sim(page.getByText('2. Dados da nota'), 60_000);
  await page.getByRole('button', { name: 'Dar entrada' }).click();
  check('sefaz respostas: Dar entrada tem a 2ª linha "A confirmação da compra vai para a SEFAZ em alguns minutos."', await sim(page.getByText('A confirmação da compra vai para a SEFAZ em alguns minutos.', { exact: true }).first(), 60_000));
  // "Ver" da faixa do prazo: aba SEFAZ, "A conferir", foco na nota que vence primeiro.
  await faixaPrazo.getByRole('button', { name: 'Ver', exact: true }).click();
  check('sefaz respostas: "Ver" da faixa do prazo abre a aba SEFAZ', await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Notas da SEFAZ'))?.getAttribute('aria-selected') === 'true', null, { timeout: 10_000 }).then(() => true, () => false));
  check('sefaz respostas: "Ver" põe o foco na nota que vence primeiro', await page.waitForFunction((id) => document.activeElement?.getAttribute('data-nota-id') === id, UID(32), { timeout: 20_000 }).then(() => true, () => false));

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
  const respostasAba = execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-t', '-A', '-c', "select (select count(*) from sefaz_manifestacao) || '/' || (select count(*) from sefaz_manifestacoes)"]).toString().trim();
  check('sefaz aba: sefaz_manifestacao e sefaz_manifestacoes vazias (nenhuma resposta saiu de verdade)', respostasAba === '0/0', respostasAba);
  await ctx.close();
}

// ================================================================================================ CUPOM FISCAL (NFC-e), Tarefa 16
// A API do navegador roda com NFCE_AMBIENTE VAZIA (desligada de fábrica): nenhum cupom sai de verdade aqui. O bloco 1 usa a API real
// (UX 8.1: menu só do admin e o aviso "não ativada"); os outros simulam o servidor ligado com page.route (UX 8.2) — nada vai para a rede
// externa, e o que não é simulado (cadastro: numeração, emitente…) segue para a API real, que funciona desligada. No fim, o banco confirma
// que nenhum cupom, envio ou emissão ligada existe.
const CF_RE = /\/v1\/cupom-fiscal\//;
const corsCupom = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS' };
const jsonCupom = (route, corpo, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: corsCupom, body: JSON.stringify(corpo) });
const UIDC = (n) => `00000000-0000-4000-8000-00000000c${String(n).padStart(3, '0')}`;
const P1 = UIDC(1), P2 = UIDC(2), P3 = UIDC(3), P4 = UIDC(4), PERF = UIDC(9);
const CUP_A = UIDC(13), CUP_539 = UIDC(14), CUP_EMP = UIDC(15), CUP_CANC = UIDC(12), CUP_SR = UIDC(16);
const chaveCupom = (n) => `3526111234567800019565001${String(n).padStart(9, '0')}1402133770`;
const emMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const MSG_ITEM = 'Chopp 300 ml não pode entrar no cupom: o perfil fiscal foi desativado.';
const MSG_PARADA = 'A SEFAZ bloqueou este sistema duas vezes em 24 horas. Por segurança, a emissão foi desligada. Fale com o contador e com o suporte do Freela Comanda antes de ligar de novo.';
const FRASE_539 = 'A SEFAZ diz que o número 14 da série 1 já foi usado por outra nota: o caixa de hoje pode estar usando esta série. A emissão parou. Descarte este cupom e troque a série em Configurações → Cupom fiscal.';
const FRASE_EMPRESA = 'A SEFAZ recusou um dado da empresa (inscrição estadual, endereço ou regime). Confira em Configurações → Cupom fiscal e toque em Enviar de novo.';
const situacaoCupom = (p = {}) => ({
  ambiente: 'producao', agora: new Date().toISOString(), emissao_ligada: true, situacao: 'ok', mensagem: null, bloqueado_ate: null, recusas_ate: null,
  serie: 1, proximo_numero: 17, falta: [], certificado: { ok: true, mensagem: null }, pendentes: { total: 0, primeiro: null }, ...p,
});
const produto = (id, nome, categoria, preco, p = {}) => ({
  item_cardapio_id: id, nome, categoria, unidade_venda: 'UN', preco_venda_centavos: preco, ativo: true, ncm: '22030000', cest: null, gtin: null,
  origem: 0, descricao_cupom: null, unidade: null, perfil_fiscal_id: PERF, perfil_nome: 'Revenda', pronto: true, motivos: [], ...p,
});
const PRODUTOS_CUPOM = [
  produto(P1, 'Chopp 300 ml', 'Bebidas', 1200),
  produto(P2, 'Espeto de Picanha', 'Espetos', 2490, { ncm: '16025000' }),
  produto(P3, 'Porção de fritas', 'Porções', 1890, { ncm: null, perfil_fiscal_id: null, perfil_nome: null, pronto: false, motivos: ['falta_ncm', 'falta_perfil'] }),
  produto(P4, 'Combo família: dois espetos de picanha, porção de mandioca frita e refrigerante de 2 litros', 'Combos', 12990, { ncm: '21069090' }),
];
const item = (n, id, nome, q, unit) => ({
  n_item: n, item_cardapio_id: id, nome_cardapio: nome, x_prod: nome.toUpperCase(), unidade: 'UN', quantidade: `${q}.0000`,
  valor_unitario_centavos: unit, valor_bruto_centavos: unit * q, valor_desconto_centavos: 0, perfil_nome: 'Revenda',
});
const detalheCupom = (p = {}) => ({
  id: CUP_A, ambiente: 'producao', serie: 1, numero: 13, chave: chaveCupom(13), situacao: 'autorizado', dh_emi: emMin(-1), envios: 1,
  numero_reaproveitavel: false, consumidor_doc: '52998224725', valor_produtos_centavos: 3690, valor_desconto_centavos: 0, valor_total_centavos: 3690,
  valor_troco_centavos: 0, itens: [item(1, P1, 'Chopp 300 ml', 1, 1200), item(2, P2, 'Espeto de Picanha', 1, 2490)], pagamentos: [{ t_pag: '17', valor_centavos: 3690 }],
  autorizada_em: emMin(-1), n_prot: '135260000000131', c_stat: 100, x_motivo: 'Autorizado o uso da NF-e', alerta: null, cancelado_em: null,
  cancelamento_motivo: null, cancelamento_n_prot: null, cancelamento_pedido_em: null, venda_estoque: 'lancada', venda_erro: null, descartado_em: null,
  descarte_motivo: null, descartado_por_nome: null, emitido_por_nome: 'Admin Demo', criado_em: emMin(-1), agora: new Date().toISOString(), consultar_a_partir_de: null,
  cancelar_ate: emMin(28), acoes: ['cancelar', 'imprimir'], recusa: null, atalho: null, mensagem: null, ...p,
});
const recusado = (id, numero, codigo, familia, frase, xMotivo, atalho, acoes) => detalheCupom({
  id, numero, chave: chaveCupom(numero), situacao: 'rejeitado', numero_reaproveitavel: true, autorizada_em: null, n_prot: null, c_stat: codigo,
  x_motivo: `Rejeição: ${xMotivo}`, venda_estoque: null, cancelar_ate: null, acoes, recusa: { codigo, familia, frase, x_motivo: xMotivo }, atalho,
});
const CUPONS_SIMULADOS = new Map([
  [CUP_A, () => detalheCupom()],
  [CUP_539, () => recusado(CUP_539, 14, 539, 'outra', FRASE_539, 'Duplicidade de NF-e, com diferença na Chave de Acesso', 'serie', ['descartar'])],
  [CUP_EMP, () => recusado(CUP_EMP, 15, 209, 'empresa', FRASE_EMPRESA, 'IE do emitente inválida', 'empresa', ['enviar_de_novo', 'descartar'])],
]);
const QR_CUPOM = `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${chaveCupom(13)}|2|1|1|0123456789ABCDEF0123456789ABCDEF01234567`;
const DANFE_CUPOM = {
  emit: { CNPJ: '12345678000195', xNome: 'Restaurante Teste Ltda', xFant: 'Comanda Teste', IE: '123456789012',
    enderEmit: { xLgr: 'Rua das Flores', nro: '100', xCpl: null, xBairro: 'Centro', xMun: 'Valinhos', UF: 'SP', CEP: '13270000', fone: null } },
  det: [
    { nItem: 1, cProd: 'CHOPP-300', xProd: 'CHOPP 300 ML', qCom: '1.0000', uCom: 'UN', vUnCom: '12.00', vProd: '12.00', vDesc: null },
    { nItem: 2, cProd: 'ESPETO-PIC', xProd: 'ESPETO DE PICANHA', qCom: '1.0000', uCom: 'UN', vUnCom: '24.90', vProd: '24.90', vDesc: null },
  ],
  total: { qItens: 2, vProd: '36.90', vDesc: '0.00', vFrete: '0.00', vSeg: '0.00', vOutro: '0.00', vNF: '36.90' },
  pag: { detPag: [{ tPag: '17', xPag: null, vPag: '36.90' }], vTroco: null },
  chave: chaveCupom(13), urlChave: 'https://www.nfce.fazenda.sp.gov.br/consulta', qrCode: QR_CUPOM,
  dest: { CPF: '52998224725', CNPJ: null, idEstrangeiro: null, xNome: null },
  ide: { nNF: '13', serie: '1', dhEmi: '2026-11-18T10:00:00-03:00', tpEmis: '1' },
  nProt: '135260000000131', dhRecbto: '2026-11-18T10:00:02-03:00', homologacao: false, infCpl: 'Obrigado pela preferência! Volte sempre.', cMsg: null, xMsg: null,
};
const linhaCupom = (id, numero, situacao, p = {}) => ({
  id, ambiente: 'producao', serie: 1, numero, chave: chaveCupom(numero), situacao, dh_emi: emMin(-30), criado_em: emMin(-30), autorizada_em: null,
  cancelado_em: null, descartado_em: null, envios: 1, valor_total_centavos: 3690, pagamentos: [{ t_pag: '17', valor_centavos: 3690 }],
  consumidor_doc: '***.982.247-**', venda_estoque: null, acoes: [], consultar_a_partir_de: null, cancelar_ate: null, ...p,
});
const LISTA_CUPONS = [
  linhaCupom(CUP_SR, 16, 'sem_resposta', { consultar_a_partir_de: emMin(1), acoes: ['consultar'], consumidor_doc: null }),
  linhaCupom(CUP_EMP, 15, 'rejeitado', { acoes: ['enviar_de_novo', 'descartar'], pagamentos: [{ t_pag: '01', valor_centavos: 2000 }, { t_pag: '03', valor_centavos: 1690 }] }),
  linhaCupom(CUP_539, 14, 'rejeitado', { acoes: ['descartar'] }),
  linhaCupom(CUP_A, 13, 'autorizado', { autorizada_em: emMin(-1), venda_estoque: 'lancada', acoes: ['cancelar', 'imprimir'], cancelar_ate: emMin(28) }),
  linhaCupom(CUP_CANC, 12, 'cancelado', { cancelado_em: emMin(-20), venda_estoque: 'desfeita', consumidor_doc: '12.345.678/0001-95' }),
];
const PERFIS_CUPOM = [{
  id: PERF, nome: 'Revenda', cfop: '5102', csosn: '102', cst_icms: null, aliq_icms: null, pis_cst: null, cofins_cst: null, c_ativ_sn: null, ibs_sn_aliq: null,
  cbs_sn_aliq: null, ibscbs_cst: null, ibscbs_cclass_trib: null, ativo: true, produtos: 3, vale_no_regime: true, atualizado_por_nome: 'Admin Demo', atualizado_em: emMin(-600),
}];
const EMITENTE_CUPOM = {
  cnpj: '12345678000195', razao_social: 'Restaurante Teste Ltda', nome_fantasia: 'Comanda Teste', ie: '123456789012', crt: 1, logradouro: 'Rua das Flores',
  numero: '100', complemento: null, bairro: 'Centro', cep: '13270000', cod_municipio: '3556206', municipio: 'Valinhos', uf: 'SP', telefone: null, nat_op: 'VENDA',
  inf_cpl: null, resp_tec_cnpj: null, resp_tec_contato: null, resp_tec_email: null, resp_tec_fone: null, series_outro_sistema: [], sem_outro_sistema: true,
  cupom_lanca_venda: true, cupom_lanca_venda_por_nome: 'Admin Demo', cupom_lanca_venda_em: emMin(-600), tp_regime_ibscbs: null, atualizado_por_nome: null, atualizado_em: null,
};

/**
 * O servidor do cupom simulado (`page.route`): `est` diz o que responder (situação, produtos, perfis, emitente, a lista, o POST cupons e a
 * busca pela chave); o que não está em `est` segue para a API real. Guarda os corpos dos POST e as buscas pela chave.
 */
async function simularCupom(page, est) {
  est.posts = [];
  est.buscas = [];
  await page.route(CF_RE, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsCupom });
    const u = new URL(req.url());
    const p = u.pathname.replace(/^.*\/v1\/cupom-fiscal\//, '');
    const m = req.method();
    if (m === 'GET' && p === 'situacao' && est.situacao) return jsonCupom(route, est.situacao());
    if (m === 'GET' && p === 'produtos' && est.produtos) {
      const prontos = u.searchParams.get('prontos');
      return jsonCupom(route, prontos === null ? est.produtos : est.produtos.filter((x) => String(x.pronto) === prontos));
    }
    if (m === 'GET' && p === 'perfis' && est.perfis) return jsonCupom(route, est.perfis);
    if (m === 'GET' && p === 'emitente' && est.emitente) return jsonCupom(route, est.emitente);
    if (m === 'GET' && p === 'cupons') {
      const k = u.searchParams.get('chave_idempotencia');
      if (k !== null) {
        est.buscas.push(k);
        return est.busca === 'abortar' ? route.abort('failed') : jsonCupom(route, []);
      }
      if (est.lista) return jsonCupom(route, est.lista);
    }
    if (m === 'POST' && p === 'cupons') {
      est.posts.push(JSON.parse(req.postData() ?? '{}'));
      if (est.post === 'abortar') return route.abort('failed');
      if (est.post === '422') return jsonCupom(route, { error: { code: 'NFCE_ITEM_INDISPONIVEL', message: MSG_ITEM } }, 422);
      return jsonCupom(route, detalheCupom(), 201);
    }
    const id = p.match(/^cupons\/([^/]+)(\/danfe)?$/);
    if (m === 'GET' && id && CUPONS_SIMULADOS.has(id[1])) return jsonCupom(route, id[2] ? DANFE_CUPOM : CUPONS_SIMULADOS.get(id[1])());
    if (m === 'PUT' && /^ambientes\/(producao|homologacao)\/emissao$/.test(p) && est.ligar) return jsonCupom(route, { error: { code: 'NFCE_PARADA', message: MSG_PARADA } }, 409);
    return route.continue();
  });
}
const simQ = (loc, timeout = 30_000) => loc.waitFor({ timeout }).then(() => true, () => false);
const focoEm = (page, fn, arg, timeout = 15_000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const antesNaTela = async (a, b) => a.evaluate((x, y) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING), await b.elementHandle());
/**
 * Os erros de console de um bloco do cupom (leva pré-final, item 21): o "Failed to load resource" NÃO é descartado em bloco; só passa o
 * que o próprio bloco provoca na rede simulada (`esperados`: o caminho do endereço e o texto do status, ex. 422 ou net::ERR_FAILED).
 * Qualquer outro 4xx/5xx ou pedido que caiu, também da API real, é erro.
 */
const reaisErros = (erros, esperados = []) =>
  erros.filter((e) => !(/Failed to load resource/.test(e) && esperados.some(([url, status]) => url.test(e.split(' @ ')[1] ?? '') && status.test(e))));
// Alvos de toque na aba aberta (e nas abas): botões, links, campos, resumos e opções com menos de 44 px de altura (o rótulo em volta conta).
const alvosPequenos = (page) => page.evaluate(() => [...document.querySelectorAll(
  '[role=tab], [role=tabpanel][data-state=active] :is(button, a[href], select, input:not([type=hidden]), summary, [role=radio], [role=checkbox])',
)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .filter((el) => Math.max(el.getBoundingClientRect().height, (el.closest('label') ?? el).getBoundingClientRect().height) < 43.5)
  .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`));

// Diagnóstico mais largo que o `quemPassaDaBorda`: todo elemento que passa da borda direita (também os dentro de contêiner com rolagem),
// com a posição CSS (um `absolute` escapa do corte do contêiner que não é o bloco que o contém).
const passamDaBorda = (page, lim) => page.evaluate((l) => [...document.querySelectorAll('body *')]
  .filter((el) => el.getBoundingClientRect().right > l + 0.5)
  .slice(0, 8)
  .map((el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 50)}@${el.getBoundingClientRect().right.toFixed(1)}/${getComputedStyle(el).position}`), lim);
// Cada bloco do cupom roda isolado: uma exceção vira uma falha com captura, e os outros blocos seguem.
async function blocoCupom(nome, viewport, fn) {
  const s = await sessao('admin@erpfreela.local', viewport);
  try {
    await fn(s);
  } catch (e) {
    check(`${nome}: terminou sem exceção`, false, String(e?.message ?? e).split('\n')[0]);
    await s.page.screenshot({ path: join(SHOTS, `falha-${nome.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: true }).catch(() => {});
  } finally {
    await s.ctx.close();
  }
}
// A barra do celular pronta para conferir (o botão sem aria-disabled); se não, mostra o que ela diz.
async function barraPronta(page, nome) {
  const ok = await page.waitForFunction(() => [...document.querySelectorAll('div.fixed button')].some((b) => b.getBoundingClientRect().height > 0
    && b.textContent.trim() === 'Conferir e emitir' && b.getAttribute('aria-disabled') !== 'true'), null, { timeout: 20_000 }).then(() => true, () => false);
  check(`${nome}: a barra diz "Conferir e emitir"`, ok, ok ? '' : JSON.stringify(await page.locator('div.fixed').allInnerTexts()));
  return ok;
}

// ---------------- CUPOM 1: servidor desligado (UX 8.1), API real, celular 360x800
await blocoCupom('cupom 1 (desligado)', { width: 360, height: 800 }, async ({ page, erros }) => {
  const pedidos = [];
  page.on('request', (r) => { if (CF_RE.test(r.url()) && r.method() !== 'OPTIONS') pedidos.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const menu = await page.locator('header nav a').allInnerTexts();
  check('cupom desligado: o admin vê "Cupom Fiscal" no menu', menu.some((t) => t.includes('Cupom Fiscal')), JSON.stringify(menu));
  await page.goto(`${BASE}/cupom`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  check('cupom desligado: Emitir avisa "não está ativada"', await simQ(page.getByText('A emissão de cupom fiscal não está ativada neste servidor. Você já pode cadastrar os dados fiscais dos produtos e da empresa; para ativar, fale com o suporte do Freela Comanda.', { exact: true }), 120_000));
  check('cupom desligado: "Preparar os produtos" e nada de emitir', (await page.getByRole('link', { name: 'Preparar os produtos' }).count()) === 1
    && (await page.getByRole('button', { name: /Conferir e emitir|Adicione um produto/ }).count()) === 0);
  const l1 = await quemPassaDaBorda(page, 360);
  check('cupom desligado: sem rolagem lateral em 360', l1.scroll <= 360, JSON.stringify(l1));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-desligado-360.png'), fullPage: true });
  await page.goto(`${BASE}/configuracoes?aba=cupom`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const painel = page.locator('#cupom-fiscal');
  check('cupom desligado: Configurações › Cupom fiscal avisa "não está ativada"', await simQ(painel.getByText('A emissão de cupom fiscal não está ativada neste servidor.', { exact: false }).first(), 120_000));
  check('cupom desligado: nenhum botão de ligar', (await painel.getByRole('button', { name: /Ligar a emissão/ }).count()) === 0);
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-configuracoes-desligado-360.png'), fullPage: true });
  // âncora de "Para ligar a emissão, falta: … Preencher" (regime): abre a aba e põe o foco no grupo do regime
  await page.goto(`${BASE}/painel`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.goto(`${BASE}/configuracoes?aba=cupom#cupom-crt`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  check('cupom: o link #cupom-crt põe o foco no regime', await focoEm(page, () => !!document.activeElement?.closest('#cupom-crt'), null, 60_000));
  check('cupom desligado: nenhum POST/PUT ao cupom', !pedidos.some((x) => !x.startsWith('GET')), JSON.stringify(pedidos));
  const reais = reaisErros(erros);
  check('cupom desligado: sem erro de console', reais.length === 0, reais.join(' | '));
});

// ---------------- CUPOM 2: Emitir no celular (360x800, captura também em 390), servidor simulado ligado (UX 8.2)
await blocoCupom('cupom 2 (emitir 360)', { width: 360, height: 800 }, async ({ page, erros }) => {
  const est = { situacao: () => situacaoCupom(), produtos: PRODUTOS_CUPOM, lista: [], post: 'ok', busca: 'vazia' };
  await simularCupom(page, est);
  const busca = page.locator('#cupom-busca');
  const resultado = (nome) => page.locator('li > button', { hasText: nome }).first();
  const botaoBarra = page.locator('div.fixed button:visible', { hasText: /Conferir e emitir|Adicione|Escolha|Confira|Falta/ });
  const dlg = page.getByRole('dialog');
  await page.goto(`${BASE}/cupom`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  check('emitir 360: a busca aparece', await simQ(busca, 120_000));
  check('emitir 360: barra sem produto diz "Adicione um produto"', await simQ(page.locator('div.fixed button:visible', { hasText: 'Adicione um produto' })));
  await busca.fill('chopp');
  await resultado('Chopp 300 ml').click();
  await busca.fill('espeto');
  await busca.press('Enter');
  check('emitir 360: 2 itens no cupom (toque e Enter)', await simQ(page.getByText('No cupom (2 itens)')));
  await busca.fill('fritas');
  check('emitir 360: o produto sem NCM aparece em "Não entram no cupom"', await simQ(page.getByText('Porção de fritas · Falta NCM')));
  await busca.fill('');
  // o toque no pagamento vem DIRETO, com o foco ainda na busca: a linha "Acabou de entrar" some sem deslocar o layout (leva pré-final,
  // itens 15 e 18; antes, o roteiro tirava o foco da busca para o 1º toque não se perder)
  // a posição na PÁGINA (não na janela: o clique rola a tela até o botão antes de tocar)
  const noDocumento = () => page.getByRole('radio', { name: 'PIX' }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const antesDoToque = await noDocumento();
  await page.getByRole('radio', { name: 'PIX' }).click();
  check('emitir 360: o 1º toque no pagamento, direto da busca, escolhe o PIX', (await page.getByRole('radio', { name: 'PIX' }).getAttribute('aria-checked')) === 'true');
  const depoisDoToque = await noDocumento();
  check('emitir 360: sair da busca não desloca o pagamento', Math.abs(antesDoToque - depoisDoToque) < 0.5, JSON.stringify([antesDoToque, depoisDoToque]));
  await page.locator('#cupom-doc').fill('52998224725');
  check('emitir 360: CPF com máscara', (await page.locator('#cupom-doc').inputValue()) === '529.982.247-25');
  await barraPronta(page, 'emitir 360');
  check('emitir 360: total R$ 36,90 na barra', await simQ(page.locator('div.fixed').getByText('R$ 36,90')));
  const l360 = await quemPassaDaBorda(page, 360);
  check('emitir 360: sem rolagem lateral', l360.scroll <= 360, JSON.stringify(l360));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-emitir-360.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const l390 = await quemPassaDaBorda(page, 390);
  check('emitir 390: sem rolagem lateral', l390.scroll <= 390, JSON.stringify(l390));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-emitir-390.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });

  // Conferir (folha de baixo) → Emitir → a página do cupom autorizado
  await botaoBarra.click();
  check('emitir 360: "Conferir o cupom" abre', await simQ(dlg.getByText('Conferir o cupom', { exact: true })));
  check('emitir 360: conferir mostra o CPF e o valendo', (await dlg.getByText('CPF 529.982.247-25').count()) === 1
    && (await dlg.getByText('Este cupom vale como documento fiscal e vai para a SEFAZ em nome da empresa.').count()) === 1);
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-conferir-360.png') });
  await dlg.getByRole('button', { name: 'Emitir cupom' }).click();
  check('emitir 360: abre o cupom autorizado', await page.waitForURL(`**/cupom/${CUP_A}`, { timeout: 60_000 }).then(() => true, () => false)
    && await simQ(page.getByRole('heading', { name: 'Cupom nº 13' })));
  const b1 = est.posts[0];
  check('emitir 360: o POST leva itens, PIX, CPF e o total visto', b1 && b1.itens.length === 2 && b1.itens.every((i) => i.quantidade === '1')
    && b1.pagamentos[0].t_pag === '17' && b1.pagamentos[0].valor_centavos === 3690 && b1.consumidor_doc === '52998224725' && b1.total_esperado_centavos === 3690, JSON.stringify(b1));
  check('emitir 360: o DANFE aparece', await simQ(page.locator('section.danfe')));
  check('emitir 360: Imprimir e Novo cupom na barra de baixo', await simQ(page.locator('div.fixed a:visible', { hasText: 'Imprimir' })) && (await page.locator('div.fixed a:visible', { hasText: 'Novo cupom' }).count()) === 1);
  const lAut = await quemPassaDaBorda(page, 360);
  check('cupom autorizado 360: sem rolagem lateral', lAut.scroll <= 360, JSON.stringify(lAut));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-autorizado-360.png'), fullPage: true });

  // "Não sei se saiu" (UX 2.7): o POST e a busca pela chave caem; a venda trava; "Tentar de novo" manda a MESMA chave; o 422 destrava (T14 I1)
  await page.locator('div.fixed a:visible', { hasText: 'Novo cupom' }).click();
  check('não sei se saiu: volta para Emitir', await simQ(page.getByText('No cupom (0 itens)'), 60_000));
  await busca.fill('chopp');
  await resultado('Chopp 300 ml').click();
  await page.getByRole('radio', { name: 'Dinheiro' }).click();
  await barraPronta(page, 'não sei se saiu');
  await botaoBarra.click();
  await simQ(dlg.getByRole('button', { name: 'Emitir cupom' }));
  est.post = 'abortar';
  est.busca = 'abortar';
  await dlg.getByRole('button', { name: 'Emitir cupom' }).click();
  check('não sei se saiu: a frase aparece', await simQ(dlg.getByText('Não consegui falar com o servidor do Freela Comanda. O cupom pode ter saído ou não.')));
  const tentar = dlg.getByRole('button', { name: 'Tentar de novo' });
  check('não sei se saiu: "Tentar de novo" liberado depois da única busca', await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.trim() === 'Tentar de novo' && !b.disabled), null, { timeout: 30_000 }).then(() => true, () => false));
  check('não sei se saiu: procurou UMA vez, pela chave do POST', est.buscas.length === 1 && est.buscas[0] === est.posts[1]?.chave_idempotencia, JSON.stringify(est.buscas));
  check('não sei se saiu: a venda fica travada', await busca.isDisabled() && (await page.getByText('Para mudar a venda, primeiro toque em Tentar de novo.').count()) === 1);
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-nao-sei-se-saiu-360.png') });
  est.post = '422';
  await tentar.click();
  check('não sei se saiu: o erro definitivo aparece no "Tentar de novo"', await simQ(dlg.getByRole('alert').getByText(MSG_ITEM)));
  check('não sei se saiu: "Tentar de novo" mandou a mesma chave', est.posts.length === 3 && est.posts[2].chave_idempotencia === est.posts[1].chave_idempotencia, JSON.stringify(est.posts.map((x) => x.chave_idempotencia)));
  check('não sei se saiu: o foco vai para a caixa do erro', await focoEm(page, (m) => document.activeElement?.textContent?.includes(m), MSG_ITEM));
  await dlg.getByRole('button', { name: 'Voltar e corrigir' }).click();
  check('não sei se saiu: o erro definitivo destrava a venda', await page.waitForFunction(() => !document.querySelector('#cupom-busca')?.disabled, null, { timeout: 20_000 }).then(() => true, () => false)
    && (await page.getByText('Para mudar a venda, primeiro toque em Tentar de novo.').count()) === 0);
  check('não sei se saiu: a venda continua no carrinho', (await page.getByText('No cupom (1 item)').count()) === 1);
  const guardado = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('emitir 360: a venda não vai para o storage (só authUser)', guardado.local.length === 1 && guardado.local[0] === 'authUser' && guardado.sessao === 0, JSON.stringify(guardado));
  // só os três que o bloco provoca: o POST e a busca pela chave que caem (route.abort) e o 422 do "Tentar de novo"
  const reais = reaisErros(erros, [
    [/\/v1\/cupom-fiscal\/cupons(\?[^ ]*)?$/, /net::ERR_FAILED/],
    [/\/v1\/cupom-fiscal\/cupons$/, /status of 422/],
  ]);
  check('emitir 360: sem erro de console', reais.length === 0, reais.join(' | '));
});

// ---------------- CUPOM 3: Emitir no computador (1366x900), a página do cupom (atalhos e a ordem da UX 6.1) e a impressão em 80 mm
await blocoCupom('cupom 3 (desktop)', undefined, async ({ page, erros }) => {
  const est = { situacao: () => situacaoCupom(), produtos: PRODUTOS_CUPOM, lista: LISTA_CUPONS, post: 'ok', busca: 'vazia' };
  await simularCupom(page, est);
  const dlg = page.getByRole('dialog');
  await page.goto(`${BASE}/cupom`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const busca = page.locator('#cupom-busca');
  check('emitir desktop: a busca aparece', await simQ(busca, 120_000));
  await busca.fill('combo');
  await page.locator('li > button', { hasText: 'Combo família' }).first().click();
  await page.getByRole('radio', { name: 'Débito' }).click();
  const lDesk = await quemPassaDaBorda(page, 1366);
  check('emitir desktop: sem rolagem lateral', lDesk.scroll <= 1366, JSON.stringify(lDesk));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-emitir-desktop.png'), fullPage: true });
  await page.locator('button:visible', { hasText: 'Conferir e emitir' }).click();
  check('emitir desktop: "Conferir o cupom" em diálogo, sem CPF', await simQ(dlg.getByText('Conferir o cupom', { exact: true })) && (await dlg.getByText('Sem CPF na nota').count()) === 1);
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-conferir-desktop.png') });
  await dlg.getByRole('button', { name: 'Emitir cupom' }).click();
  check('emitir desktop: abre o cupom autorizado', await page.waitForURL(`**/cupom/${CUP_A}`, { timeout: 60_000 }).then(() => true, () => false) && await simQ(page.locator('section.danfe')));
  check('emitir desktop: o POST leva Débito e o total', est.posts[0]?.pagamentos[0]?.t_pag === '04' && est.posts[0]?.total_esperado_centavos === 12990 && est.posts[0]?.consumidor_doc === null, JSON.stringify(est.posts[0]));
  // autorizado: Imprimir antes de "Mostrar QR"; o "Cancelar o cupom…" aparece no prazo
  check('cupom autorizado: "Imprimir" vem antes de "Mostrar QR para o cliente"', await antesNaTela(page.locator('a:visible', { hasText: 'Imprimir' }).first(), page.getByRole('button', { name: 'Mostrar QR para o cliente' })));
  check('cupom autorizado: "Cancelar o cupom…" no prazo', (await page.getByRole('button', { name: 'Cancelar o cupom…' }).count()) === 1);
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-autorizado-desktop.png'), fullPage: true });

  // 539: "Descartar… · [Trocar a série]" (o atalho DEPOIS do botão) e o atalho leva ao campo da série do ambiente do cupom
  await page.goto(`${BASE}/cupom/${CUP_539}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const descartar = page.getByRole('button', { name: 'Descartar…' });
  const trocar = page.getByRole('link', { name: 'Trocar a série' });
  check('cupom 539: a frase do servidor', await simQ(page.getByText(FRASE_539), 60_000));
  check('cupom 539: só "Descartar…" (sem "Enviar de novo")', (await descartar.count()) === 1 && (await page.getByRole('button', { name: 'Enviar de novo' }).count()) === 0);
  check('cupom 539: "Descartar…" antes de "Trocar a série" (UX 6.1)', (await trocar.count()) === 1 && await antesNaTela(descartar, trocar));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-539-desktop.png'), fullPage: true });
  await trocar.click();
  check('cupom 539: "Trocar a série" abre Configurações › Cupom fiscal', await page.waitForURL(/\/configuracoes\?aba=cupom#cupom-serie-producao$/, { timeout: 60_000 }).then(() => true, () => false));
  check('cupom 539: o foco vai para a série do valendo', await focoEm(page, () => document.activeElement?.id === 'cupom-serie-producao', null, 60_000));
  // família empresa: "[Ir para Configurações] · Enviar de novo" (o atalho ANTES)
  await page.goto(`${BASE}/cupom/${CUP_EMP}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const irConfig = page.getByRole('link', { name: 'Ir para Configurações' });
  check('cupom empresa: a frase do servidor', await simQ(page.getByText(FRASE_EMPRESA), 60_000));
  check('cupom empresa: "Ir para Configurações" antes de "Enviar de novo"', (await irConfig.count()) === 1 && await antesNaTela(irConfig, page.getByRole('button', { name: 'Enviar de novo' })));
  check('cupom empresa: o atalho leva à inscrição estadual', (await irConfig.getAttribute('href')) === '/configuracoes?aba=cupom#cupom-ie');

  // Impressão (UX 3.4): `window.print()` uma vez só, depois que o QR carregou; no papel, só o DANFE, até 80 mm, com o QR de 25 mm ou mais
  await page.addInitScript(() => {
    window.__impressoes = [];
    window.print = () => {
      const qr = document.querySelector('img[alt^="QR Code do cupom"]');
      window.__impressoes.push(!!qr && qr.complete && qr.naturalWidth > 0);
    };
  });
  await page.goto(`${BASE}/cupom/${CUP_A}/imprimir?imprimir=1`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  check('imprimir: o DANFE aparece', await simQ(page.locator('section.danfe'), 60_000));
  await page.waitForTimeout(2_000);
  const impressoes = await page.evaluate(() => window.__impressoes);
  check('imprimir: window.print() uma vez só', impressoes.length === 1, JSON.stringify(impressoes));
  check('imprimir: depois que o QR carregou (onLoad)', impressoes[0] === true, JSON.stringify(impressoes));
  const regraPagina = await page.evaluate(() => {
    for (const s of document.styleSheets) {
      let regras;
      try { regras = s.cssRules; } catch { continue; }
      for (const r of regras) if (r.type === 6) return r.style.cssText;
    }
    return null;
  });
  // leva pré-final, itens 14 e 19: o @page só com margem 0 (sem o "size", que não é CSS válido; o papel de 80 mm vem do diálogo de
  // impressão) e o DANFE com 72 mm de largura útil pelo CSS de impressão (medido num viewport de 1366 px: não é o max-w do componente)
  check('imprimir: o @page tem margem 0 e nenhum "size"', /margin: 0(px)?;/.test(regraPagina ?? '') && !/size/.test(regraPagina ?? ''), String(regraPagina));
  const telaAntes = await page.evaluate(() => (document.querySelector('section.danfe').getBoundingClientRect().width * 25.4) / 96);
  await page.emulateMedia({ media: 'print' });
  const papel = await page.evaluate(() => {
    const mm = (px) => (px * 25.4) / 96;
    const s = document.querySelector('section.danfe');
    const qr = s?.querySelector('img');
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    return {
      largura: mm(r.width), margens: [cs.marginLeft, cs.marginRight], padding: [cs.paddingLeft, cs.paddingRight],
      qr: qr ? mm(qr.getBoundingClientRect().width) : 0, soDanfe: document.body.innerText.trim() === s.innerText.trim(),
    };
  });
  check('imprimir: na tela o DANFE segue o max-w de 80 mm (o 72 mm é só do CSS de impressão)', Math.abs(telaAntes - 80) < 0.1, String(telaAntes));
  check('imprimir: no papel, o DANFE tem 72 mm de largura útil', Math.abs(papel.largura - 72) < 0.1, JSON.stringify(papel));
  check('imprimir: no papel, sem padding e no meio (margens iguais)', papel.padding.every((x) => x === '0px') && papel.margens[0] === papel.margens[1], JSON.stringify(papel));
  check('imprimir: o QR tem 25 mm ou mais', papel.qr >= 25, JSON.stringify(papel));
  check('imprimir: só o DANFE vai para o papel', papel.soDanfe, JSON.stringify(papel));
  await page.locator('section.danfe').screenshot({ path: join(SHOTS, 'admin-cupom-danfe-80mm.png') });
  await page.pdf({ path: join(SHOTS, 'admin-cupom-danfe-80mm.pdf'), width: '80mm', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  check('imprimir: a prévia não chamou window.print() de novo', (await page.evaluate(() => window.__impressoes.length)) === 1);
  const reais = reaisErros(erros);
  check('cupom desktop: sem erro de console', reais.length === 0, reais.join(' | '));
});

// ---------------- CUPOM 4: Configurações › Cupom fiscal (celular 360x800): "Ligar valendo" recusado DENTRO do diálogo (T15 I1) e os focos
await blocoCupom('cupom 4 (configurações)', { width: 360, height: 800 }, async ({ page, erros }) => {
  const est = { situacao: () => situacaoCupom({ emissao_ligada: false }), produtos: PRODUTOS_CUPOM, perfis: PERFIS_CUPOM, emitente: EMITENTE_CUPOM, lista: [], ligar: true };
  await simularCupom(page, est);
  const mudancas = [];
  page.on('request', (r) => { if (CF_RE.test(r.url()) && !['GET', 'OPTIONS'].includes(r.method())) mudancas.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/configuracoes?aba=cupom`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const ligar = page.getByRole('button', { name: 'Ligar a emissão de cupons' });
  check('ligar valendo: o botão aparece', await simQ(ligar, 120_000));
  await ligar.click();
  const ad = page.getByRole('alertdialog');
  check('ligar valendo: o diálogo abre', await simQ(ad.getByText('Ligar a emissão valendo?', { exact: true })));
  check('ligar valendo: foco inicial em "Agora não"', await focoEm(page, () => document.activeElement?.textContent?.trim() === 'Agora não'));
  for (const c of await ad.getByRole('checkbox').all()) await c.click();
  await ad.getByRole('button', { name: 'Ligar valendo' }).click();
  check('ligar valendo: o erro do servidor aparece DENTRO do diálogo', await simQ(ad.getByRole('alert').getByText(MSG_PARADA)));
  check('ligar valendo: o foco vai para o erro', await focoEm(page, (m) => !!document.activeElement?.closest('[role=alertdialog]') && document.activeElement.textContent.includes(m), MSG_PARADA));
  check('ligar valendo: as marcas ficam', (await ad.getByRole('checkbox', { checked: true }).count()) === 3);
  const lLig = await quemPassaDaBorda(page, 360);
  check('ligar valendo: sem rolagem lateral em 360', lLig.scroll <= 360, JSON.stringify(lLig));
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-ligar-valendo-erro-360.png') });
  await ad.getByRole('button', { name: 'Agora não' }).click();
  check('ligar valendo: "Agora não" fecha', await ad.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false));
  // "Mudar o regime da empresa?" com perfil do Simples ativo: foco inicial em "Manter o regime"
  await page.getByRole('radio', { name: '3 Regime normal (Lucro Presumido ou Real)' }).click();
  check('regime: o diálogo da troca abre', await simQ(ad.getByText('Mudar o regime da empresa?', { exact: true })));
  check('regime: foco inicial em "Manter o regime"', await focoEm(page, () => document.activeElement?.textContent?.trim() === 'Manter o regime'));
  await ad.getByRole('button', { name: 'Manter o regime' }).click();
  check('regime: "Manter o regime" não muda o regime', await page.getByRole('radio', { name: '1 Simples Nacional', exact: true }).isChecked());
  await page.screenshot({ path: join(SHOTS, 'admin-cupom-configuracoes-360.png'), fullPage: true });
  // Desativar um perfil em uso: foco inicial em "Manter ativo"
  await page.goto(`${BASE}/cupom?aba=produtos`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const resumoPerfis = page.locator('[role=tabpanel][data-state=active] details > summary').first();
  check('perfis: o quadro aparece', await simQ(resumoPerfis, 120_000));
  await resumoPerfis.click();
  await page.getByRole('button', { name: 'Editar o perfil Revenda' }).click();
  await page.getByRole('button', { name: 'Desativar', exact: true }).click();
  check('perfil: o diálogo de desativar abre', await simQ(ad.getByText('Desativar o perfil Revenda?', { exact: true })));
  check('perfil: foco inicial em "Manter ativo"', await focoEm(page, () => document.activeElement?.textContent?.trim() === 'Manter ativo'));
  await ad.getByRole('button', { name: 'Manter ativo' }).click();
  check('perfil: "Manter ativo" fecha o diálogo', await ad.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false));
  check('configurações: só o PUT de ligar (simulado) mudou algo; nada desativado', mudancas.length === 1 && /\/ambientes\/producao\/emissao$/.test(mudancas[0]), JSON.stringify(mudancas));
  // só o 409 do PUT de ligar, que o bloco simula de propósito
  const reais = reaisErros(erros, [[/\/v1\/cupom-fiscal\/ambientes\/producao\/emissao$/, /status of 409/]]);
  check('cupom configurações: sem erro de console', reais.length === 0, reais.join(' | '));
});

// ---------------- CUPOM 5: Emitidos e Produtos sem rolagem lateral (360, 768, 800 e 1000 px) e com alvos de 44 px
await blocoCupom('cupom 5 (emitidos e produtos)', { width: 360, height: 800 }, async ({ page, erros }) => {
  const est = { situacao: () => situacaoCupom(), produtos: PRODUTOS_CUPOM, perfis: PERFIS_CUPOM, emitente: EMITENTE_CUPOM, lista: LISTA_CUPONS };
  await simularCupom(page, est);
  for (const [aba, texto] of [['emitidos', 'Cupom nº 16'], ['produtos', 'Porção de fritas']]) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/cupom?aba=${aba}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    if (aba === 'produtos') await simQ(page.getByRole('button', { name: /^Todos \(/ }), 120_000).then(() => page.getByRole('button', { name: /^Todos \(/ }).click());
    check(`cupom ${aba}: a lista aparece`, await simQ(page.locator('[role=tabpanel][data-state=active]').getByText(texto).first(), 120_000));
    for (const largura of [360, 768, 800, 1000]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.waitForTimeout(400);
      const l = await quemPassaDaBorda(page, largura);
      check(`cupom ${aba}: sem rolagem lateral em ${largura}`, l.scroll <= largura, l.scroll <= largura ? '' : JSON.stringify({ ...l, todos: await passamDaBorda(page, largura) }));
      const pequenos = await alvosPequenos(page);
      check(`cupom ${aba}: alvos com 44 px em ${largura}`, pequenos.length === 0, JSON.stringify(pequenos.slice(0, 6)));
      if (largura === 360 || largura === 800) await page.screenshot({ path: join(SHOTS, `admin-cupom-${aba}-${largura}.png`), fullPage: true });
    }
  }
  const reais = reaisErros(erros);
  check('cupom emitidos/produtos: sem erro de console', reais.length === 0, reais.join(' | '));
  const banco = execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', 'erpfreela_browser', '-t', '-A', '-c',
    "select (select count(*) from nfce_cupons) || '/' || (select count(*) from nfce_envios) || '/' || (select count(*) from nfce_ambientes where emissao_ligada)"]).toString().trim();
  check('cupom: nenhum cupom, envio ou emissão ligada no banco (nada saiu de verdade)', banco === '0/0/0', banco);
});

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
  check('loja não vê "Cupom Fiscal" no menu', !menu.some((t) => t.includes('Cupom Fiscal')), JSON.stringify(menu));
  const pedidosCupom = [];
  page.on('request', (r) => { if (r.url().includes('/v1/cupom-fiscal')) pedidosCupom.push(r.url()); });
  await abrir(page, erros, '/cupom', 'Acesso negado.', 'loja-cupom-negado');
  check('loja: nenhum pedido ao cupom fiscal', pedidosCupom.length === 0, pedidosCupom.join(' | '));
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
