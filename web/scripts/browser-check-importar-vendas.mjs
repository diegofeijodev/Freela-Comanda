// Grupo do browser-check: Importar vendas (`/vendas/importar`; desenho 24/11 C.4 e UX 5.2). Roda sozinho na pilha do browser-check.sh:
//   BC_ROTAS="/ /auth /painel /vendas /vendas/importar" CHECK_SCRIPT=scripts/browser-check-importar-vendas.mjs \
//     ../scripts/run-capped.sh 2400 bash scripts/browser-check.sh     (em web/)
// Admin a 1366 px: planilha CSV de outro sistema (vírgula e windows-1252) → colunas sugeridas → prévia (nada gravado) → sobreposição com
// a caixa → importar → reimportar sem duplicar (e o Substituir bloqueado pela linha com problema) → Substituir com arquivo limpo (diálogo);
// XML num .zip deflate (o leitor do navegador) com cupom, cancelamento junto e inutilização, e o cancelamento que chega depois; PDF sem chave de IA (a frase do servidor) e PDF com a IA simulada (page.route, sem
// rede) com a conferência. A 360 px: sem rolagem lateral. Nada em storage além de authUser. O banco confere cada passo.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';

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
const sim = () => true;
const nao = () => false;

// ---------- datas (Brasília) e arquivos de teste
const diaSp = (deslocamento) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + deslocamento * 864e5));
const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const D1 = diaSp(-3); // dentro dos 35 dias do seed: há vendas da planilha padrão (sobreposição)
const D2 = diaSp(-2);
const DXML = diaSp(-60); // fora do seed
const DPDF = diaSp(-50);
const pasta = join(tmpdir(), 'erp-importar-vendas');
mkdirSync(pasta, { recursive: true });

// CSV de "outro sistema": separado por vírgula, decimais entre aspas, gravado em windows-1252 (latin1 cobre º, ã, ç)
const CSV = [
  'Nº Venda,Data,Descrição,Qtde,Vl. Total',
  `BC-1,${br(D1)},Pão de Alho especial,2,"28,00"`,
  `BC-1,${br(D1)},Caldo de Cana 300 ml,1,"8,50"`,
  `BC-2,${br(D2)},Espeto de Picanha,3,"66,00"`,
  'BC-3,31/02/2026,Pastel,1,"7,00"',
].join('\r\n');
const csvPath = join(pasta, 'pdv-teste-vendas.csv');
writeFileSync(csvPath, Buffer.from(CSV, 'latin1'));
// Substituir com arquivo limpo: o BC-1 muda de valor e perde o caldo; o BC-2 fica igual
const csvSubstPath = join(pasta, 'pdv-teste-vendas-corrigido.csv');
writeFileSync(csvSubstPath, Buffer.from(['Nº Venda,Data,Descrição,Qtde,Vl. Total', `BC-1,${br(D1)},Pão de Alho especial,2,"30,00"`, `BC-2,${br(D2)},Espeto de Picanha,3,"66,00"`].join('\r\n'), 'latin1'));
// para o celular: um pedido novo (há o que importar, então a barra fixa aparece)
const csvNovoPath = join(pasta, 'pdv-teste-vendas-2.csv');
writeFileSync(csvNovoPath, Buffer.from(['Nº Venda,Data,Descrição,Qtde,Vl. Total', `BC-9,${br(D2)},Espeto de Alcatra,1,"15,00"`].join('\r\n'), 'latin1'));

const LOJA = '12345678000195'; // CNPJ da configuração do seed (12.345.678/0001-95)
function comDv(base) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return base + String(r < 2 ? 0 : 11 - r);
}
const AAMM = DXML.slice(2, 4) + DXML.slice(5, 7);
const chave = (n) => comDv(`35${AAMM}${LOJA}65001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`);
const nfce = (n, produto, q, vu, vp, vdesc, vnf) =>
  `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave(n)}" versao="4.00"><ide><mod>65</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>${DXML}T20:15:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb><finNFe>1</finNFe></ide><emit><CNPJ>${LOJA}</CNPJ></emit><det nItem="1"><prod><xProd>${produto}</xProd><CFOP>5102</CFOP><qCom>${q}</qCom><vUnCom>${vu}</vUnCom><vProd>${vp}</vProd><vDesc>${vdesc}</vDesc></prod></det><total><ICMSTot><vNF>${vnf}</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${chave(n)}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const cancelamento = (n) =>
  `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID110111${chave(n)}01"><tpAmb>1</tpAmb><CNPJ>${LOJA}</CNPJ><chNFe>${chave(n)}</chNFe><dhEvento>${DXML}T20:40:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></evento><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><chNFe>${chave(n)}</chNFe><tpEvento>110111</tpEvento></infEvento></retEvento></procEventoNFe>`;
const arquivo = (nome, conteudo) => {
  const p = join(pasta, nome);
  writeFileSync(p, conteudo);
  return p;
};
/** .zip mínimo com deflate (método 8), como o PDV gera para o contador: diretório central + fim (sem CRC; o leitor não confere). */
function zipDeflate(entradas) {
  const partes = [];
  const dir = [];
  let off = 0;
  for (const [nomeTxt, texto] of entradas) {
    const nome = Buffer.from(nomeTxt);
    const cru = Buffer.from(texto);
    const dados = deflateRawSync(cru);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(dados.length, 18); lh.writeUInt32LE(cru.length, 22); lh.writeUInt16LE(nome.length, 26);
    partes.push(lh, nome, dados);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(dados.length, 20); ch.writeUInt32LE(cru.length, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(off, 42);
    dir.push(ch, nome);
    off += 30 + nome.length + dados.length;
  }
  const tamDir = dir.reduce((s, x) => s + x.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10); fim.writeUInt32LE(tamDir, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, ...dir, fim]);
}
const zipXml = arquivo('xml-do-mes.zip', zipDeflate([
  ['2026/NFCe-701.xml', nfce(701, 'CALDO DE CANA 500ML', '2.0000', '8.00', '16.00', '1.00', '15.00')],
  ['2026/NFCe-702.xml', nfce(702, 'PASTEL DE CARNE', '1.0000', '9.00', '9.00', '0.00', '9.00')],
  ['2026/canc-702.xml', cancelamento(702)],
  ['2026/inut-703.xml', '<?xml version="1.0"?><procInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><inutNFe/></procInutNFe>'],
]));
const cancDepois = arquivo('canc-701.xml', cancelamento(701));
const pdfPath = arquivo('relatorio-vendas.pdf', '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// ---------- navegador
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
    const onde = /Failed to load resource/.test(t) ? ` @ ${m.location()?.url ?? '?'}` : '';
    erros.push(`console: ${t.slice(0, 200)}${onde}`);
  });
  // a tela pede confirmação ao sair com arquivo carregado (beforeunload): aceitar, para o goto seguir
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForFunction(() => !!document.querySelector('#email') && Object.keys(document.querySelector('#email')).some((k) => k.startsWith('__react')), null, { timeout: 120_000 });
  await page.fill('#email', email);
  await page.fill('#senha', 'erpfreela123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel', { timeout: 120_000, waitUntil: 'commit' });
  await page.getByText(/Painel|Olá!/).first().waitFor({ timeout: 120_000 });
  return { ctx, page, erros };
}

const ve = (page, texto, timeout = 30_000) => page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(sim, nao);
const foto = (page, nome) => page.screenshot({ path: join(SHOTS, `${nome}.png`), fullPage: true });
const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const contar = (onde) => Number(sql(`select count(*) from ${onde}`));
/** Abre a tela num passo 1 limpo, com o sistema escolhido pelo nome (cartão `role=radio`). */
async function passo1(page, sistema) {
  await page.goto(`${BASE}/vendas/importar`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.getByText('Passo 1 de 3').first().waitFor({ timeout: 120_000 });
  await page.getByText('De qual sistema vêm as vendas?').waitFor();
  if (sistema) {
    await page.getByRole('radio', { name: new RegExp(sistema) }).first().click();
    await page.waitForFunction((s) => [...document.querySelectorAll('[role=radio][aria-checked=true]')].some((b) => b.textContent.includes(s)), sistema);
  }
}
async function novoSistema(page, nome, tipo) {
  await page.getByRole('button', { name: 'Novo sistema' }).click();
  await page.fill('#novo-nome', nome);
  await page.getByRole('radio', { name: tipo }).click();
  await page.getByRole('button', { name: 'Criar o sistema' }).click();
  await page.waitForFunction((s) => [...document.querySelectorAll('[role=radio][aria-checked=true]')].some((b) => b.textContent.includes(s)), nome);
}
const botaoFinal = (page) => page.locator('section[aria-labelledby="titulo-previa"] .fixed button').first();
async function prontaPrevia(page) {
  await page.getByText('Confira antes de importar').first().waitFor({ timeout: 60_000 });
  await page.getByText('Prévia atualizada.').waitFor({ state: 'attached', timeout: 60_000 });
}

// ================================================================================================ ADMIN, computador
{
  const { ctx, page, erros } = await sessao('admin@erpfreela.local');

  // 1. Vendas → "Importar vendas" → passo 1
  await page.goto(`${BASE}/vendas`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.getByText('Faturamento por dia').first().waitFor({ timeout: 120_000 });
  await page.getByRole('link', { name: 'Importar vendas' }).first().click();
  await page.waitForURL('**/vendas/importar');
  check('Vendas → Importar vendas abre o passo 1', await ve(page, 'Passo 1 de 3', 120_000));
  await foto(page, 'importar-1-passo1');

  // 2. planilha de outro sistema: colunas sugeridas e exemplos com acento (windows-1252)
  await novoSistema(page, 'PDV Teste', 'Planilha (CSV ou Excel)');
  check('sistema novo criado e marcado', (await page.getByRole('radio', { name: /PDV Teste/ }).getAttribute('aria-checked')) === 'true');
  await page.setInputFiles('#arquivo-vendas', csvPath);
  check('planilha: passo 2 (colunas)', await ve(page, 'Qual coluna do arquivo é o quê?'));
  const colunas = {};
  for (const c of ['pedido', 'data', 'produto', 'quantidade', 'valor_total']) colunas[c] = await page.locator(`#coluna-${c}`).inputValue();
  check('planilha: colunas sugeridas certas', JSON.stringify(colunas) === JSON.stringify({ pedido: 'Nº Venda', data: 'Data', produto: 'Descrição', quantidade: 'Qtde', valor_total: 'Vl. Total' }), JSON.stringify(colunas));
  check('planilha: exemplo com acento lido de windows-1252', await ve(page, 'Pão de Alho especial', 5_000));
  check('planilha: separador deduzido = vírgula', (await page.getByRole('radio', { name: 'Com vírgula: 1.234,56' }).getAttribute('aria-checked')) === 'true');
  await foto(page, 'importar-2-colunas');

  // 3. coluna obrigatória vazia: o botão diz o que falta e o toque põe o foco no campo
  await page.locator('#coluna-quantidade').selectOption('');
  check('coluna obrigatória vazia: "Escolha a coluna de: Quantidade"', await ve(page, 'Escolha a coluna de: Quantidade', 5_000));
  await page.getByRole('button', { name: 'Ver a prévia' }).click({ force: true }); // aria-disabled: o toque leva ao campo
  check('coluna obrigatória vazia: foco no campo', (await page.evaluate(() => document.activeElement?.id)) === 'coluna-quantidade');
  await page.locator('#coluna-quantidade').selectOption('Qtde');

  // 4. prévia: a conta por extenso e nada gravado
  const vendasAntes = contar('vendas');
  const importacoesAntes = contar('importacoes');
  await page.getByRole('button', { name: 'Ver a prévia' }).click();
  await prontaPrevia(page);
  check('prévia: a conta das linhas', await ve(page, '= 4 linhas lidas − 1 com problema'));
  check('prévia: total das 3 vendas novas', await ve(page, 'R$ 102,50', 5_000));
  check('prévia: a linha com problema e o motivo', await ve(page, '1 linha com problema fica de fora', 5_000));
  check('prévia: nada gravado', contar('vendas') === vendasAntes && contar('importacoes') === importacoesAntes);

  // 5. sobreposição com a planilha padrão do seed: o botão só libera com a caixa
  check('prévia: aviso "Pode contar em dobro."', await ve(page, 'Pode contar em dobro.', 5_000));
  check('botão: "Marque a caixa do aviso"', (await botaoFinal(page).innerText()).includes('Marque a caixa do aviso'));
  await botaoFinal(page).click({ force: true }); // aria-disabled: o toque leva à caixa
  check('o toque no botão leva à caixa', (await page.evaluate(() => document.activeElement?.id)) === 'sobreposicao');
  check('sem a caixa nada foi gravado', contar('vendas') === vendasAntes);
  await page.locator('#sobreposicao').click();
  await page.waitForFunction(() => /Importar 3 vendas/.test(document.querySelector('section[aria-labelledby="titulo-previa"] .fixed button')?.textContent ?? ''));
  check('botão: "Importar 3 vendas"', true);
  await foto(page, 'importar-3-previa-planilha');

  // 6. importar → resultado com os números da resposta → "Ver vendas do período"
  await botaoFinal(page).click();
  check('resultado: "Vendas importadas"', await ve(page, 'Vendas importadas', 60_000));
  check('banco: 3 vendas novas', contar('vendas') === vendasAntes + 3, `${contar('vendas')} × ${vendasAntes + 3}`);
  check('banco: o pedido do arquivo e a importação do sistema', sql("select count(*) from vendas v join importacoes i on i.id = v.importacao_id join vendas_origens o on o.id = i.origem_id where o.nome = 'PDV Teste' and v.pedido in ('BC-1', 'BC-2')") === '3');
  check('banco: colunas lembradas no sistema', sql("select mapeamento->>'quantidade' from vendas_origens where nome = 'PDV Teste'") === 'Qtde');
  await foto(page, 'importar-4-resultado');
  await page.getByRole('link', { name: 'Ver vendas do período' }).first().click();
  await page.waitForURL(/\/vendas\?ini=\d{4}-\d{2}-\d{2}&fim=\d{4}-\d{2}-\d{2}/);
  check('"Ver vendas do período" abre /vendas no período', page.url().includes(`ini=${D1}`) && page.url().includes(`fim=${D2}`), page.url());

  // 7. o mesmo arquivo de novo: colunas lembradas (direto à prévia), "já foi importado", nada novo, nada gravado
  const vendasDepois = contar('vendas');
  await passo1(page, 'PDV Teste');
  await page.setInputFiles('#arquivo-vendas', csvPath);
  await prontaPrevia(page);
  check('reimportar: colunas lembradas, direto à prévia', true);
  check('reimportar: "Este arquivo já foi importado."', await ve(page, 'Este arquivo já foi importado.'));
  check('reimportar: "Nada novo para importar."', await ve(page, 'Nada novo para importar.', 5_000));
  check('reimportar: sem botão de importar', (await page.getByRole('button', { name: /^Importar \d/ }).count()) === 0);
  // Substituir com a linha com problema e vendas a apagar: não roda (revisão 24/11)
  await page.getByRole('radio', { name: /Trocar as vendas deste sistema no período/ }).click();
  check('Substituir com linha com problema: o aviso', await ve(page, 'Substituir não roda com linhas com problema.', 30_000));
  await page.locator('#sobreposicao').click();
  await page.waitForFunction(() => /Substituir não roda/.test(document.querySelector('section[aria-labelledby="titulo-previa"] .fixed button')?.textContent ?? ''));
  check('Substituir com linha com problema: botão bloqueado', (await botaoFinal(page).getAttribute('aria-disabled')) === 'true');
  await botaoFinal(page).click({ force: true });
  check('Substituir bloqueado: nada apagado nem gravado', contar('vendas') === vendasDepois, `${contar('vendas')} × ${vendasDepois}`);
  await foto(page, 'importar-5-substituir-bloqueado');

  // 7b. Substituir com arquivo limpo: o diálogo abre com o foco em "Voltar sem apagar"; "Apagar e importar" troca as vendas do sistema
  await passo1(page, 'PDV Teste');
  await page.setInputFiles('#arquivo-vendas', csvSubstPath);
  await prontaPrevia(page);
  await page.getByRole('radio', { name: /Trocar as vendas deste sistema no período/ }).click();
  check('Substituir: aviso vermelho "Vai apagar vendas."', await ve(page, 'Vai apagar vendas.', 30_000));
  await page.locator('#sobreposicao').click();
  await page.waitForFunction(() => /Substituir 3 vendas e importar 2/.test(document.querySelector('section[aria-labelledby="titulo-previa"] .fixed button')?.textContent ?? ''));
  check('Substituir: botão "Substituir 3 vendas e importar 2"', true);
  await botaoFinal(page).click();
  check('Substituir: diálogo "Apagar 3 vendas de PDV Teste?"', await ve(page, 'Apagar 3 vendas de PDV Teste?', 10_000));
  check('Substituir: foco em "Voltar sem apagar"', (await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Voltar sem apagar');
  await foto(page, 'importar-5b-substituir-dialogo');
  check('Substituir: nada apagado antes de confirmar', contar("vendas where pedido in ('BC-1', 'BC-2')") === 3);
  await page.getByRole('button', { name: 'Apagar e importar' }).click();
  check('Substituir: resultado', await ve(page, 'Vendas importadas', 60_000));
  check('banco: as 3 antigas saíram e as 2 do arquivo entraram (o caldo saiu, o pão de alho com R$ 30)',
    sql("select string_agg(pedido || ' ' || produto_relatorio || ' ' || valor_total::float, '|' order by pedido, produto_relatorio) from vendas where pedido in ('BC-1', 'BC-2')")
      === 'BC-1 Pão de Alho especial 30|BC-2 Espeto de Picanha 66');

  // 8. XML num .zip deflate (lido pelo DecompressionStream do navegador): 2 cupons, o cancelamento de um no mesmo envio e uma inutilização
  await passo1(page);
  await novoSistema(page, 'PDV XML', 'XML (cupons)');
  await page.setInputFiles('#arquivo-vendas', zipXml);
  await prontaPrevia(page);
  check('XML: 1 cupom novo, com a conta dos arquivos', await ve(page, '= 4 arquivos lidos − 1 cancelado (a venda e o cancelamento vieram juntos) − 1 arquivo de cancelamento − 1 ignorado'));
  check('XML: "1 cupom foi cancelado"', await ve(page, '1 cupom foi cancelado (a venda e o cancelamento vieram juntos): não entram.', 5_000));
  await page.getByText('1 arquivo ignorado').first().click();
  check('XML: o ignorado com o motivo', await ve(page, 'inutilização de numeração', 5_000));
  check('XML: botão "Importar 1 cupom"', (await botaoFinal(page).innerText()).includes('Importar 1 cupom'));
  check('XML: o nome do .zip na prévia', await ve(page, 'xml-do-mes.zip', 5_000));
  await foto(page, 'importar-6-previa-xml');
  const vendasXml = contar('vendas');
  await botaoFinal(page).click();
  check('XML: resultado', await ve(page, 'Vendas importadas', 60_000));
  check('banco: o cupom 701 entrou, o 702 ficou registrado como cancelado', sql(`select string_agg(numero || ' ' || situacao, ',' order by numero) from vendas_documentos where chave in ('${chave(701)}', '${chave(702)}')`) === '701 autorizada,702 cancelada');
  check('banco: a venda do 701 com o pedido do cupom', contar("vendas where pedido = 'NFC-e 1-701'") === 1 && contar('vendas') === vendasXml + 1);

  // 9. o cancelamento do 701 chega depois: só cancelamentos (P18) → tira a venda
  await page.getByRole('button', { name: 'Importar outro arquivo' }).click();
  await page.getByText('Passo 1 de 3').first().waitFor();
  await page.setInputFiles('#arquivo-vendas', [cancDepois]);
  await prontaPrevia(page);
  check('XML só cancelamentos: "Nenhum cupom novo, só cancelamentos."', await ve(page, 'Nenhum cupom novo, só cancelamentos.'));
  check('XML só cancelamentos: botão "Tirar 1 cupom cancelado"', (await botaoFinal(page).innerText()).includes('Tirar 1 cupom cancelado'));
  await botaoFinal(page).click();
  check('XML cancelamento: resultado', await ve(page, 'Vendas importadas', 60_000));
  check('banco: a venda do 701 saiu e o documento ficou cancelado', contar("vendas where pedido = 'NFC-e 1-701'") === 0 && sql(`select situacao from vendas_documentos where chave = '${chave(701)}'`) === 'cancelada');

  // 10. PDF sem chave de IA: a frase do servidor + o que fazer (o 503 no console é o provocado aqui, e só ele)
  const errosAntesPdf = erros.length;
  await passo1(page);
  await novoSistema(page, 'PDV Relatorio', 'PDF (relatório)');
  await page.setInputFiles('#arquivo-vendas', pdfPath);
  check('PDF sem chave de IA: a frase do servidor', await ve(page, 'Leitura de PDF não configurada', 60_000));
  check('PDF sem chave de IA: "Use a planilha ou o XML do sistema."', await ve(page, 'Use a planilha ou o XML do sistema.', 5_000));
  await foto(page, 'importar-7-pdf-sem-chave');
  const doPdf = erros.splice(errosAntesPdf);
  check('PDF sem chave: o único erro de console é o 503 do ler-pdf', doPdf.length === 1 && /503.*\/v1\/importacoes\/vendas\/ler-pdf/.test(doPdf[0]), doPdf.join(' | '));

  // 11. PDF com a IA simulada (page.route, sem rede): conferência, número ambíguo, prévia e importar
  await page.route('**/v1/importacoes/vendas/ler-pdf', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sistema: 'PDV Relatório', periodo_ini: DPDF, periodo_fim: DPDF, total_relatorio: 30.5,
      linhas: [
        { pedido: null, data: DPDF, hora: null, produto: 'Caldo de Cana 300 ml', quantidade: 2, valor_total: 20, desconto: null },
        { pedido: null, data: DPDF, hora: null, produto: 'Pastel de Queijo', quantidade: 1, valor_total: 10.5, desconto: null },
      ],
    }),
  }));
  await passo1(page, 'PDV Relatorio');
  await page.setInputFiles('#arquivo-vendas', pdfPath);
  check('PDF: "Confira o que a IA leu"', await ve(page, 'Confira o que a IA leu', 60_000));
  check('PDF: soma × total impresso batem', await ve(page, 'Batem.', 5_000));
  const valor2 = page.getByLabel(/Valor da linha 2/);
  await valor2.fill('1.234');
  check('PDF: "1.234" é ambíguo (revisão 24/11)', await ve(page, 'Escreva “1.234” sem o ponto (1234) ou com vírgula (1,234)', 5_000));
  check('PDF: o botão diz o que falta', await ve(page, 'Corrija 1 linha', 5_000));
  await foto(page, 'importar-8-pdf-conferencia');
  await valor2.fill('10,50');
  check('PDF: corrigido, batem de novo', await ve(page, 'Batem.', 5_000));
  await page.getByRole('button', { name: 'Ver a prévia' }).click();
  await prontaPrevia(page);
  check('PDF: prévia com 2 vendas de R$ 30,50', await ve(page, 'R$ 30,50'));
  const vendasPdf = contar('vendas');
  await botaoFinal(page).click();
  check('PDF: resultado', await ve(page, 'Vendas importadas', 60_000));
  check('banco: as 2 vendas do PDF num pedido do dia', contar(`vendas where pedido = 'DIA ${DPDF}'`) === 2 && contar('vendas') === vendasPdf + 2);
  await page.unroute('**/v1/importacoes/vendas/ler-pdf');

  // 12. storage: só a sessão
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: sessionStorage.length }));
  check('storage: localStorage só com authUser e sessionStorage vazio', storage.local.length === 1 && storage.local[0] === 'authUser' && storage.sessao === 0, JSON.stringify(storage));
  check('admin: sem erro de console', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ================================================================================================ ADMIN, celular 360 px
{
  const { ctx, page, erros } = await sessao('admin@erpfreela.local', { width: 360, height: 800 });
  await passo1(page, 'PDV Teste');
  check('360 px: passo 1 sem rolagem lateral', await semRolagemLateral(page));
  await foto(page, 'importar-360-passo1');
  await page.setInputFiles('#arquivo-vendas', csvNovoPath);
  await prontaPrevia(page);
  check('360 px: prévia sem rolagem lateral', await semRolagemLateral(page));
  const barra = await botaoFinal(page).boundingBox();
  check('360 px: botão fixo embaixo, com 44 px', !!barra && barra.y + barra.height <= 800 && barra.height >= 44, JSON.stringify(barra));
  await foto(page, 'importar-360-previa');
  check('360 px: sem erro de console', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`browser-check (importar vendas): ${ok} ok, ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
