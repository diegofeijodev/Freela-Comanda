// Prova no banco real da migração `nfce` (cupom fiscal, Task 3): roda contra o Postgres do smoke e confere a estrutura (linhas semeadas,
// CHECKs da série e do número, o índice único parcial dos cupons vivos), os gatilhos de imutável (`nfce_cupons_imutavel` e
// `nfce_filhos_imutaveis`, inclusive o ON DELETE SET NULL do cardápio que passa) e as funções da venda (`nfce_lancar_venda` soma as linhas
// do mesmo item, a baixa vem do gatilho `vendas_baixa`, idempotente, recusa homologação; `nfce_desfazer_venda` apaga a venda e as baixas).
// Depois, a emissão (Task 11) e o cancelamento (Task 12) com os serviços de verdade, a porta da NFC-e FALSA e o certificado fictício dos
// testes: T1 → porta → T2 → T3 (ver `emissao`). Nenhuma rede (o smoke ainda roda sob a barreira). Cada checagem conta um "ok"; a 1ª que
// falha sai com erro.
// Uso (o smoke-capped.sh já chama):
//   DATABASE_URL=... npx ts-node --transpile-only scripts/nfce-banco.ts
// Só roda no banco descartável do smoke: em qualquer outro, sai com erro ANTES de conectar (nada é apagado). Os cupons nunca são
// apagados pela aplicação (o gatilho recusa DELETE): a limpeza desliga os 3 gatilhos numa transação só, apaga o que este script criou
// (marcado com MARCA) e religa, e confere que voltaram ligados.
import { randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import { montarChaveNfce } from '../src/common/fiscal/chave-acesso';
import { todaySp } from '../src/common/time/dates';
import { CupomCadastroService } from '../src/modules/cupom-fiscal/cadastro.service';
import { CupomCancelamentoService } from '../src/modules/cupom-fiscal/cancelamento.service';
import { cifrarCsc } from '../src/modules/cupom-fiscal/csc';
import { CupomEmissaoService, type VendaParaCupom } from '../src/modules/cupom-fiscal/emissao.service';
import { FRASES_EMISSAO } from '../src/modules/cupom-fiscal/frases';
import { CLIENTE } from '../src/modules/sefaz/__tests__/certificado-teste';
import { fixtureNfce, SefazNfceFalso } from '../src/modules/sefaz/__tests__/sefaz-nfce.falso';
import { dhSefaz } from '../src/modules/sefaz/eventos-xml';
import { lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoEvento } from '../src/modules/sefaz/nfce.adapter';
import { sefazErro } from '../src/modules/sefaz/sefaz-erro';

/** O nome que o `smoke-capped.sh` dá ao banco que ele recria a cada rodada. */
const BANCO_DO_SMOKE = 'erpfreela_smoke';
const CNPJ = '12345678000195';
/** Marca do que este script cria: `emitido_por_nome` dos cupons e prefixo dos nomes no cardápio e no estoque. */
const MARCA = 'nfce-banco';
const HASH = 'ab'.repeat(32);
const DOC_FISCAL = 'é documento fiscal e não muda';
const FILHOS = 'itens e pagamentos não mudam';
const GATILHOS: readonly [string, string][] = [
  ['nfce_cupons', 'nfce_cupons_imutavel'],
  ['nfce_cupom_itens', 'nfce_filhos_imutaveis'],
  ['nfce_cupom_pagamentos', 'nfce_filhos_imutaveis'],
];

type Ambiente = 'homologacao' | 'producao';
type Item = { id: string; nome: string };

let oks = 0;
function conferir(cond: boolean, oque: string): void {
  if (!cond) throw new Error(`falhou: ${oque}`);
  oks++;
}

/** O banco recusa o SQL e a mensagem traz o trecho (texto do gatilho/função, nome do CHECK, colunas do índice único). */
async function recusa(db: PrismaClient, sql: Prisma.Sql, trecho: string, oque: string): Promise<void> {
  try {
    await db.$executeRaw(sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    conferir(msg.includes(trecho), `${oque}: recusa por "${trecho}" (veio: ${msg})`);
    return;
  }
  conferir(false, `${oque}: o banco aceitou`);
}

/** Nome do banco na URL (só ele vai para a mensagem: a URL traz a senha); `null` se a URL não for lida. */
function nomeDoBanco(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

let cnf = 40_000_000;
let prot = 0;

type NovoCupom = {
  ambiente: Ambiente;
  serie: number;
  numero: number;
  situacao?: string;
  lancaVenda?: boolean;
  dhEmi?: Date;
  produtos?: string;
  desconto?: string;
  /** Número que vai na chave (padrão: o mesmo do cupom); diferente = chave que não casa com o número. */
  numeroNaChave?: number;
};

/** INSERT de um cupom com chave montada pela função da Task 2 (`cNF` novo a cada cupom: chave nova). */
function sqlCupom(p: NovoCupom): Prisma.Sql {
  const cNF = String(++cnf);
  const chave = montarChaveNfce({ aamm: '2611', cnpj: CNPJ, serie: p.serie, numero: p.numeroNaChave ?? p.numero, tpEmis: 1, cNF });
  const produtos = p.produtos ?? '12.00';
  const desconto = p.desconto ?? '0.00';
  return Prisma.sql`
    INSERT INTO nfce_cupons (ambiente, serie, numero, chave, c_nf, dh_emi, situacao, chave_idempotencia, pedido_hash, lanca_venda,
                             valor_produtos, valor_desconto, valor_total, emitido_por_nome)
    VALUES (${p.ambiente}, ${p.serie}::smallint, ${p.numero}::bigint, ${chave}, ${cNF}, ${p.dhEmi ?? new Date()}, ${p.situacao ?? 'enviando'},
            ${randomUUID()}::uuid, ${HASH}, ${p.lancaVenda ?? false}, ${produtos}::numeric, ${desconto}::numeric,
            ${produtos}::numeric - ${desconto}::numeric, ${MARCA})
    RETURNING id::text AS id`;
}

async function novoCupom(db: PrismaClient, p: NovoCupom): Promise<string> {
  const [r] = await db.$queryRaw<{ id: string }[]>(sqlCupom(p));
  return r!.id;
}

/** A linha do cupom com a fotografia mínima (Simples, CSOSN 102). `xProd` igual em todas: a descrição do cupom pode repetir. */
function linha(cupom: string, n: number, item: Item, q: string, unit: string, bruto: string, desc = '0.00') {
  return {
    cupom_id: cupom,
    n_item: n,
    item_cardapio_id: item.id,
    nome_cardapio: item.nome,
    c_prod: item.id,
    x_prod: 'CHOPP',
    ncm: '22030000',
    origem: 0,
    unidade: 'UN',
    cfop: '5102',
    csosn: '102',
    perfil_nome: 'Revenda',
    quantidade: q,
    valor_unitario: unit,
    valor_bruto: bruto,
    valor_desconto: desc,
  };
}

/** O que a T2 faz no 100: autorizado, com protocolo, hora e o `nfeProc`. */
async function autorizar(db: PrismaClient, id: string): Promise<void> {
  const nProt = `135260000000${String(++prot).padStart(3, '0')}`;
  await db.$executeRaw`
    UPDATE nfce_cupons SET situacao = 'autorizado', envios = 1, autorizada_em = now(), c_stat = 100, x_motivo = 'Autorizado o uso da NF-e',
           n_prot = ${nProt}, xml_autorizado = '<nfeProc/>' WHERE id = ${id}::uuid`;
}

async function cancelar(db: PrismaClient, id: string): Promise<void> {
  await db.$executeRaw`
    UPDATE nfce_cupons SET situacao = 'cancelado', cancelado_em = now(), cancelamento_motivo = 'Venda lançada em dobro no balcão',
           cancelamento_n_prot = '135269999999999' WHERE id = ${id}::uuid`;
}

/** Apaga o que este script criou: os cupons com os 3 gatilhos desligados, numa transação só (falhou = nada muda e eles seguem ligados). */
async function limpar(db: PrismaClient): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const [t, g] of GATILHOS) await tx.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER ${g}`);
    const meus = `SELECT id FROM nfce_cupons WHERE emitido_por_nome = '${MARCA}'`;
    await tx.$executeRawUnsafe(`DELETE FROM vendas WHERE nfce_cupom_id IN (${meus})`);
    await tx.$executeRawUnsafe(`DELETE FROM nfce_cupom_itens WHERE cupom_id IN (${meus})`);
    await tx.$executeRawUnsafe(`DELETE FROM nfce_cupom_pagamentos WHERE cupom_id IN (${meus})`);
    await tx.$executeRawUnsafe(`DELETE FROM nfce_envios WHERE cupom_id IN (${meus})`);
    await tx.$executeRawUnsafe(`DELETE FROM nfce_cupons WHERE emitido_por_nome = '${MARCA}'`);
    for (const [t, g] of GATILHOS) await tx.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER ${g}`);
  });
  // a venda "repetida" que a emissão usa para a T3 falhar (sem cupom: a importação faria igual)
  await db.vendas.deleteMany({ where: { produto_relatorio: { startsWith: `${MARCA} ` }, nfce_cupom_id: null } });
  await db.itens_cardapio.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } }); // e os nfce_itens deles, em cascata
  await db.itens_estoque.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } });
  await db.nfce_perfis_fiscais.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } });
  // ligar/desligar pela rota (feito por MARCA) e as paradas automáticas (sem autor); o smoke recria o banco a cada rodada
  await db.nfce_ambientes_historico.deleteMany({ where: { OR: [{ feito_por_nome: MARCA }, { feito_por: null }] } });
}

async function estrutura(db: PrismaClient): Promise<void> {
  const emit = await db.nfce_emitente.findMany();
  conferir(
    emit.length === 1 && emit[0]!.id === 1 && emit[0]!.cupom_lanca_venda === null,
    'emitente semeado (id 1, lança venda não respondido)',
  );
  const amb = await db.nfce_ambientes.findMany({ orderBy: { ambiente: 'asc' } });
  conferir(
    amb.map((a) => `${a.ambiente}:${a.serie}:${a.proximo_numero}:${a.emissao_ligada}:${a.situacao}`).join(',') ===
      'homologacao:null:1:false:ok,producao:null:1:false:ok',
    'ambientes semeados sem série, próximo 1 e emissão desligada',
  );
  await recusa(db, Prisma.sql`UPDATE nfce_ambientes SET serie = 890 WHERE ambiente = 'homologacao'`, 'nfce_ambientes_serie', 'série 890');
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_ambientes SET proximo_numero = 0 WHERE ambiente = 'homologacao'`,
    'nfce_ambientes_proximo_numero',
    'próximo número 0',
  );
  await recusa(
    db,
    sqlCupom({ ambiente: 'homologacao', serie: 1, numero: 102, numeroNaChave: 101 }),
    'nfce_cupons_chave_partes',
    'chave de outro número',
  );
  await recusa(
    db,
    sqlCupom({ ambiente: 'homologacao', serie: 1, numero: 103, lancaVenda: true }),
    'nfce_cupons_lanca_venda',
    'homologação lançando venda',
  );

  // dois vivos com o mesmo (ambiente, série, número): o índice parcial recusa; descartado + vivo passam (chaves e idempotência diferentes)
  const primeiro = await novoCupom(db, { ambiente: 'homologacao', serie: 1, numero: 100, situacao: 'rejeitado' });
  await recusa(
    db,
    sqlCupom({ ambiente: 'homologacao', serie: 1, numero: 100, situacao: 'nao_enviado' }),
    'Key (ambiente, serie, numero)=',
    '2 vivos com o mesmo número',
  );
  await db.$executeRaw`UPDATE nfce_cupons SET situacao = 'descartado', descartado_em = now(), descarte_motivo = 'teste' WHERE id = ${primeiro}::uuid`;
  await novoCupom(db, { ambiente: 'homologacao', serie: 1, numero: 100, situacao: 'nao_enviado' });
  const n = await db.nfce_cupons.count({ where: { ambiente: 'homologacao', serie: 1, numero: BigInt(100) } });
  conferir(n === 2, 'descartado + vivo com o mesmo número');
}

async function gatilhos(db: PrismaClient, item: Item): Promise<void> {
  const g = await novoCupom(db, { ambiente: 'producao', serie: 3, numero: 1 });
  await db.nfce_cupom_itens.create({ data: linha(g, 1, item, '1.0000', '12.00', '12.00') });
  await db.nfce_cupom_pagamentos.create({ data: { cupom_id: g, ordem: 1, t_pag: '01', valor: '12.00' } });
  await autorizar(db, g);
  conferir((await db.nfce_cupons.findUniqueOrThrow({ where: { id: g } })).situacao === 'autorizado', 'enviando → autorizado passa');

  await recusa(db, Prisma.sql`UPDATE nfce_cupons SET valor_total = 1 WHERE id = ${g}::uuid`, DOC_FISCAL, 'valor_total do autorizado');
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET n_prot = '135260000000999' WHERE id = ${g}::uuid`,
    DOC_FISCAL,
    'protocolo do autorizado',
  );
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET situacao = 'rejeitado' WHERE id = ${g}::uuid`,
    'não passa para rejeitado',
    'autorizado → rejeitado',
  );
  await recusa(db, Prisma.sql`DELETE FROM nfce_cupons WHERE id = ${g}::uuid`, 'nunca é apagado', 'DELETE do cupom');
  await recusa(
    db,
    Prisma.sql`INSERT INTO nfce_cupom_itens (cupom_id, n_item, item_cardapio_id, nome_cardapio, c_prod, x_prod, ncm, origem, unidade, cfop,
                                            csosn, perfil_nome, quantidade, valor_unitario, valor_bruto)
               VALUES (${g}::uuid, 2, ${item.id}::uuid, ${item.nome}, 'X', 'CHOPP', '22030000', 0, 'UN', '5102', '102', 'Revenda', 1, 12, 12)`,
    FILHOS,
    'item novo no autorizado',
  );
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupom_itens SET quantidade = 2 WHERE cupom_id = ${g}::uuid`,
    FILHOS,
    'quantidade do item do autorizado',
  );
  await recusa(db, Prisma.sql`DELETE FROM nfce_cupom_itens WHERE cupom_id = ${g}::uuid`, FILHOS, 'DELETE do item do autorizado');
  await recusa(
    db,
    Prisma.sql`INSERT INTO nfce_cupom_pagamentos (cupom_id, ordem, t_pag, valor) VALUES (${g}::uuid, 2, '17', 1)`,
    FILHOS,
    'pagamento novo no autorizado',
  );

  // apagar o item do cardápio zera item_cardapio_id na linha do cupom (ON DELETE SET NULL) e a fotografia fica
  await db.itens_cardapio.delete({ where: { id: item.id } });
  const l = await db.nfce_cupom_itens.findFirstOrThrow({ where: { cupom_id: g } });
  conferir(l.item_cardapio_id === null && l.nome_cardapio === item.nome, 'item do cardápio apagado: SET NULL passa e o nome fica');

  await db.$executeRaw`UPDATE nfce_cupons SET situacao = 'cancelando', cancelamento_motivo = 'Cliente desistiu da compra', cancelamento_pedido_em = now() WHERE id = ${g}::uuid`;
  await cancelar(db, g);
  const c = await db.nfce_cupons.findUniqueOrThrow({ where: { id: g } });
  conferir(c.situacao === 'cancelado' && c.cancelamento_n_prot !== null, 'autorizado → cancelando → cancelado passa');
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET cancelamento_motivo = 'outro motivo qualquer' WHERE id = ${g}::uuid`,
    DOC_FISCAL,
    'motivo do cancelado',
  );
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET situacao = 'autorizado' WHERE id = ${g}::uuid`,
    'não passa para autorizado',
    'cancelado → autorizado',
  );
}

async function venda(db: PrismaClient, a: Item, b: Item, insumo: string): Promise<void> {
  // 22h30 em Brasília = 01h30 UTC do dia seguinte: a venda é do dia 17
  const dhEmi = new Date('2026-11-18T01:30:00Z');
  const c12 = await novoCupom(db, {
    ambiente: 'producao',
    serie: 2,
    numero: 12,
    lancaVenda: true,
    dhEmi,
    produtos: '36.00',
    desconto: '1.00',
  });
  await db.nfce_cupom_itens.createMany({
    data: [linha(c12, 1, a, '1.0000', '12.00', '12.00', '1.00'), linha(c12, 2, a, '2.0000', '12.00', '24.00')],
  });
  await db.nfce_cupom_pagamentos.create({ data: { cupom_id: c12, ordem: 1, t_pag: '01', valor: '35.00' } });
  await recusa(db, Prisma.sql`SELECT nfce_lancar_venda(${c12}::uuid)`, 'Só o cupom autorizado', 'lançar venda antes de autorizar');
  await autorizar(db, c12);

  const [r1] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_lancar_venda(${c12}::uuid) AS n`;
  conferir(r1?.n === 1, `2 linhas do mesmo item = 1 venda (veio ${r1?.n})`);
  const vs = await db.$queryRaw<{ id: string; ok: boolean }[]>`
    SELECT id::text AS id,
           (pedido = 'NFC-e 2-12' AND produto_relatorio = ${a.nome} AND item_cardapio_id = ${a.id}::uuid AND quantidade = 3
            AND preco_unitario = 12 AND desconto = 1 AND valor_total = 35 AND taxa = 0 AND frete = 0 AND importacao_id IS NULL
            AND data = DATE '2026-11-17' AND hora = TIME '22:30:00') AS ok
      FROM vendas WHERE nfce_cupom_id = ${c12}::uuid`;
  conferir(vs.length === 1 && vs[0]!.ok, 'venda NFC-e 2-12: quantidade somada, valores, data e hora de Brasília');
  const vendaId = vs[0]!.id;
  const [mv] = await db.$queryRaw<{ n: number; ok: boolean }[]>`
    SELECT count(*)::int AS n, coalesce(sum(quantidade) = -0.9, false) AS ok FROM movimentacoes
     WHERE venda_id = ${vendaId}::uuid AND tipo = 'baixa_venda' AND item_estoque_id = ${insumo}::uuid`;
  conferir(mv?.n === 1 && mv.ok, 'baixa_venda pelo gatilho vendas_baixa (0,3 × 3)');
  const c = await db.nfce_cupons.findUniqueOrThrow({ where: { id: c12 } });
  conferir(c.venda_lancada_em !== null && c.venda_erro === null, 'venda_lancada_em gravado');

  const [r2] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_lancar_venda(${c12}::uuid) AS n`;
  conferir(r2?.n === 0 && (await db.vendas.count({ where: { nfce_cupom_id: c12 } })) === 1, '2ª chamada devolve 0 e não duplica');

  // dois itens com a mesma descrição no cupom não colidem: a chave da venda é o nome do cardápio
  const c13 = await novoCupom(db, { ambiente: 'producao', serie: 2, numero: 13, lancaVenda: true, dhEmi, produtos: '22.00' });
  await db.nfce_cupom_itens.createMany({
    data: [linha(c13, 1, a, '1.0000', '12.00', '12.00'), linha(c13, 2, b, '1.0000', '10.00', '10.00')],
  });
  await autorizar(db, c13);
  const [r3] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_lancar_venda(${c13}::uuid) AS n`;
  conferir(r3?.n === 2, 'mesma descrição do cupom em 2 itens = 2 vendas');

  const h = await novoCupom(db, { ambiente: 'homologacao', serie: 1, numero: 200 });
  await db.nfce_cupom_itens.create({ data: linha(h, 1, a, '1.0000', '12.00', '12.00') });
  await autorizar(db, h);
  await recusa(db, Prisma.sql`SELECT nfce_lancar_venda(${h}::uuid)`, 'homologação', 'homologação não lança venda');

  const semLanca = await novoCupom(db, { ambiente: 'producao', serie: 2, numero: 14, lancaVenda: false });
  await db.nfce_cupom_itens.create({ data: linha(semLanca, 1, a, '1.0000', '12.00', '12.00') });
  await autorizar(db, semLanca);
  await recusa(db, Prisma.sql`SELECT nfce_lancar_venda(${semLanca}::uuid)`, 'não lança a venda', 'cupom sem lanca_venda');
  conferir((await db.vendas.count({ where: { nfce_cupom_id: { in: [h, semLanca] } } })) === 0, 'nenhuma venda dos recusados');

  // desfazer: só no cancelado; apaga a venda e as baixas (cascata); idempotente
  await recusa(db, Prisma.sql`SELECT nfce_desfazer_venda(${c12}::uuid)`, 'Só o cupom cancelado', 'desfazer com o cupom autorizado');
  await cancelar(db, c12);
  const [d1] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_desfazer_venda(${c12}::uuid) AS n`;
  conferir(d1?.n === 1 && (await db.vendas.count({ where: { nfce_cupom_id: c12 } })) === 0, 'desfazer apaga a venda');
  conferir((await db.movimentacoes.count({ where: { venda_id: vendaId } })) === 0, 'desfazer apaga as baixas');
  const cd = await db.nfce_cupons.findUniqueOrThrow({ where: { id: c12 } });
  conferir(cd.venda_desfeita_em !== null && cd.venda_erro === null, 'venda_desfeita_em gravado');
  const [d2] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_desfazer_venda(${c12}::uuid) AS n`;
  conferir(d2?.n === 0, '2º desfazer devolve 0');
  conferir((await db.vendas.count({ where: { nfce_cupom_id: c13 } })) === 2, 'o outro cupom continua com a venda');
}

// --- emissão (Tarefa 11): o serviço de verdade, com a porta da NFC-e e o certificado FALSOS (nunca rede) ----------------------------

const SEGREDO_HARNESS = 'nfce-banco-segredo-de-teste-0123456789';
const CSC_TESTE = 'CSCTESTE0123456789ABCDEF';
const SERIE = 7;
const PRIMEIRO = 41;
const QUEM = { id: '0b8f5c2e-2222-4000-8000-0000000000bb', nome: MARCA };
const CH_FIXTURE = '35261112345678000195650010000000121402133776';
const DIG_FIXTURE = 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=';
const DH_FIXTURE = '2026-11-17T14:30:02-03:00';

/** A operação recusa com este HttpException (status e code). */
async function recusaHttp(p: Promise<unknown>, status: number, code: string, oque: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const r = e instanceof HttpException ? (e.getResponse() as { code?: string }) : null;
    conferir(
      e instanceof HttpException && e.getStatus() === status && r?.code === code,
      `${oque} (veio ${e instanceof Error ? e.message : e})`,
    );
    return;
  }
  conferir(false, `${oque}: não recusou`);
}

/** Uma resposta fictícia (fixtures/nfce) com a chave e o DigestValue do pedido `base`, a hora de agora e `tpAmb` 1 (valendo). */
function respostaDe(fixture: string, chave: string, base: string): string {
  const dig = /<DigestValue>([^<]+)<\/DigestValue>/.exec(base)?.[1];
  if (!dig) throw new Error('pedido sem DigestValue');
  return fixtureNfce(fixture)
    .replaceAll(CH_FIXTURE, chave)
    .replaceAll(DIG_FIXTURE, dig)
    .replaceAll(DH_FIXTURE, dhSefaz(new Date()))
    .replaceAll('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>');
}

/** O retorno fictício de um evento (fixtures/nfce) com a chave do pedido, a hora de agora (o relógio confere) e `tpAmb` 1 (valendo). */
function eventoDe(fixture: string, chave: string, cStat?: number): string {
  const x = fixtureNfce(fixture)
    .replaceAll(CH_FIXTURE, chave)
    .replace(/<dhRegEvento>[^<]*<\/dhRegEvento>/g, `<dhRegEvento>${dhSefaz(new Date())}</dhRegEvento>`)
    .replaceAll('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>');
  return cStat === undefined ? x : x.replace(/<cStat>573<\/cStat>/, `<cStat>${cStat}</cStat>`);
}

/**
 * Emissão valendo contra o Postgres de verdade: ligar pela rota, dois `emitir` em paralelo (o `FOR UPDATE` da T1 = N e N+1), a T2 que
 * grava `autorizado` num UPDATE só (o gatilho de imutável aceita) e a T3 com `nfce_lancar_venda` (uma venda e uma baixa por cupom; de
 * novo = 409), a consulta num cupom autorizado (só a lista branca), a T3 que falha (venda repetida no banco: `venda_erro` gravado no
 * autorizado) e o "Lançar de novo", o número descartado que volta (índice parcial: descartado + vivo), o cancelamento (Task 12: T1
 * `autorizado → cancelando`, 573 que fica `cancelando` até a consulta achar o evento, 135 direto a `cancelado`, recusa que volta a
 * `autorizado` sem o motivo, a venda desfeita uma vez só e o gatilho recusando o resto) e a série do caixa de hoje igual à daqui (a T1
 * recusa sem reservar nem enviar). Devolve o emitente, os ambientes e a empresa como estavam.
 */
async function emissao(db: PrismaClient, a: Item): Promise<void> {
  const conf = await db.configuracoes.findUniqueOrThrow({ where: { id: 1 } });
  const { id: _id, ...emitente } = await db.nfce_emitente.findUniqueOrThrow({ where: { id: 1 } });
  const ambientes = await db.nfce_ambientes.findMany();
  try {
    await emissaoNoBanco(db, a);
  } finally {
    await db.configuracoes.update({ where: { id: 1 }, data: { cnpj: conf.cnpj } });
    await db.nfce_emitente.update({ where: { id: 1 }, data: emitente });
    for (const { ambiente, ...resto } of ambientes) await db.nfce_ambientes.update({ where: { ambiente }, data: resto });
  }
}

async function emissaoNoBanco(db: PrismaClient, a: Item): Promise<void> {
  const config = {
    get: (k: string) => (k === 'NFCE_AMBIENTE' ? 'producao' : k === 'CERTIFICADO_SECRET' ? SEGREDO_HARNESS : undefined),
  } as unknown as ConfigService;
  const certificados = { emUso: async () => CLIENTE };
  const porta = new SefazNfceFalso();
  const prisma = db as unknown as PrismaService;
  const cadastro = new CupomCadastroService(prisma, config, certificados);
  const svc = new CupomEmissaoService(prisma, config, certificados, porta, cadastro);
  const cancelamento = new CupomCancelamentoService(prisma, porta, svc);

  // a porta falsa responde a cada pedido com a chave e o DigestValue dele: autorizado (100), ou "não consegui falar" quando pedido;
  // o evento, com o código escolhido em `evento`; a consulta, com a nota (100) ou, com `consultaCancelada`, a nota e o cancelamento
  let proxima: 'autorizar' | 'nao_enviado' = 'autorizar';
  let evento: 135 | 573 | 501 = 135;
  let consultaCancelada = false;
  porta.aoChamar = () => {
    const ult = porta.chamadas[porta.chamadas.length - 1]!;
    if (ult.servico === 'autorizacao') {
      const chave = /Id="NFe([0-9A-Z]{44})"/.exec(ult.corpo)![1]!;
      porta.respostas.push(
        proxima === 'nao_enviado'
          ? sefazErro('SEFAZ_REDE', false)
          : lerRetornoAutorizacao(respostaDe('ret-autorizacao-100.xml', chave, ult.corpo)),
      );
    } else if (ult.servico === 'consulta') {
      const chave = /<chNFe>([0-9A-Z]{44})<\/chNFe>/.exec(ult.corpo)![1]!;
      const base = porta.chamadas.find((c) => c.servico === 'autorizacao' && c.corpo.includes(`Id="NFe${chave}"`))!.corpo;
      const fixture = consultaCancelada ? 'ret-consulta-cancelada.xml' : 'ret-consulta-100.xml';
      porta.respostas.push(lerRetornoConsulta(respostaDe(fixture, chave, base)));
    } else if (ult.servico === 'evento') {
      const chave = /<chNFe>([0-9A-Z]{44})<\/chNFe>/.exec(ult.corpo)![1]!;
      const x = evento === 135 ? eventoDe('ret-evento-135.xml', chave) : eventoDe('ret-evento-573.xml', chave, evento);
      porta.respostas.push(lerRetornoEvento(x));
    }
  };

  await db.configuracoes.update({ where: { id: 1 }, data: { cnpj: CNPJ } });
  await db.nfce_emitente.update({
    where: { id: 1 },
    data: {
      ie: '123456789012',
      crt: 1,
      logradouro: 'Rua das Flores',
      numero: '10',
      bairro: 'Centro',
      cep: '13270000',
      sem_outro_sistema: true,
      series_outro_sistema: [],
      cupom_lanca_venda: true,
    },
  });
  await db.nfce_ambientes.update({
    where: { ambiente: 'producao' },
    data: {
      serie: SERIE,
      proximo_numero: BigInt(PRIMEIRO),
      id_csc: 1,
      csc_cifrado: cifrarCsc(CSC_TESTE, SEGREDO_HARNESS),
      csc_dica: CSC_TESTE.slice(-4),
      situacao: 'ok',
      mensagem: null,
      bloqueado_ate: null,
      ultimo_656_em: null,
    },
  });
  const perfil = await db.nfce_perfis_fiscais.create({ data: { nome: `${MARCA} Revenda`, cfop: '5102', csosn: '102' } });
  await db.nfce_itens.upsert({
    where: { item_cardapio_id: a.id },
    create: { item_cardapio_id: a.id, ncm: '22030000', perfil_fiscal_id: perfil.id },
    update: { ncm: '22030000', perfil_fiscal_id: perfil.id },
  });
  // ligar valendo pede um cupom autorizado e um cancelado no modo de teste (o autorizado de homologação já existe da `venda`)
  await novoCupom(db, { ambiente: 'homologacao', serie: 1, numero: 400, situacao: 'cancelado' });
  await svc.ligarEmissao('producao', true, true, QUEM);
  const ligado = await db.nfce_ambientes.findUniqueOrThrow({ where: { ambiente: 'producao' } });
  conferir(ligado.emissao_ligada && ligado.ligada_cnpj === CNPJ && ligado.ligada_serie === SERIE, 'emissão ligada valendo pela rota');

  const venda = (): VendaParaCupom => ({
    chave_idempotencia: randomUUID(),
    itens: [{ item_cardapio_id: a.id, quantidade: '2' }],
    desconto_centavos: 0,
    pagamentos: [{ t_pag: '01', valor_centavos: 2400 }],
    consumidor_doc: null,
    total_esperado_centavos: 2400,
  });
  const proximoNumero = async () => (await db.nfce_ambientes.findUniqueOrThrow({ where: { ambiente: 'producao' } })).proximo_numero;

  // 1. dois emitir ao mesmo tempo: o FOR UPDATE da T1 põe um atrás do outro (N e N+1, nenhum índice violado)
  const [r1, r2] = await Promise.all([svc.emitir(venda(), QUEM), svc.emitir(venda(), QUEM)]);
  const numeros = [r1.cupom.numero, r2.cupom.numero].sort((x, y) => x - y);
  conferir(numeros[0] === PRIMEIRO && numeros[1] === PRIMEIRO + 1, `dois emitir em paralelo = N e N+1 (veio ${numeros.join(', ')})`);
  conferir((await proximoNumero()) === BigInt(PRIMEIRO + 2), 'próximo número = N+2');
  for (const r of [r1, r2]) {
    const c = await db.nfce_cupons.findUniqueOrThrow({ where: { id: r.cupom.id } });
    conferir(
      r.status === 201 && c.situacao === 'autorizado' && c.n_prot === '13526000000012345' && !!c.xml_autorizado?.startsWith('<nfeProc'),
      `T2: autorizado num UPDATE só, com protocolo e nfeProc, sob o gatilho de imutável (nº ${r.cupom.numero})`,
    );
    const vs = await db.vendas.findMany({ where: { nfce_cupom_id: r.cupom.id } });
    conferir(
      vs.length === 1 && vs[0]!.pedido === `NFC-e ${SERIE}-${r.cupom.numero}` && Number(vs[0]!.quantidade) === 2,
      `T3: nfce_lancar_venda lançou uma venda (nº ${r.cupom.numero})`,
    );
    conferir(
      (await db.movimentacoes.count({ where: { venda_id: vs[0]!.id, tipo: 'baixa_venda' } })) === 1 && r.cupom.venda_estoque === 'lancada',
      `T3: uma baixa pelo gatilho vendas_baixa (nº ${r.cupom.numero})`,
    );
  }
  await recusaHttp(svc.lancarVenda(r1.cupom.id), 409, 'NFCE_SITUACAO', 'lançar de novo a venda já lançada = 409');
  conferir((await db.vendas.count({ where: { nfce_cupom_id: r1.cupom.id } })) === 1, 'a venda entrou uma vez só');

  // 2. consulta num cupom já autorizado: só a lista branca do gatilho (nada do documento muda)
  const c1 = await svc.consultar(r1.cupom.id, QUEM, new Date(Date.now() + 3 * 60_000));
  conferir(
    c1.situacao === 'autorizado' &&
      (await db.nfce_envios.count({ where: { cupom_id: r1.cupom.id, servico: 'consulta', resultado: 'respondida' } })) === 1,
    'consulta no autorizado: continua autorizado e o envio fica no diário',
  );

  // 3. a T3 falha (a venda "NFC-e 7-43" já está no banco: chave única de vendas) → autorizado com venda_erro; tirada a repetida, lança
  const n3 = PRIMEIRO + 2;
  await db.vendas.create({
    data: { pedido: `NFC-e ${SERIE}-${n3}`, data: new Date(`${todaySp()}T00:00:00Z`), produto_relatorio: a.nome, quantidade: '1' },
  });
  const r3 = await svc.emitir(venda(), QUEM);
  conferir(
    r3.cupom.numero === n3 &&
      r3.cupom.situacao === 'autorizado' &&
      r3.cupom.venda_estoque === 'pendente' &&
      r3.cupom.venda_erro === FRASES_EMISSAO.vendaErro,
    `T3 falhou: o cupom continua autorizado, com venda_erro gravado sob o gatilho (veio ${r3.cupom.situacao}/${r3.cupom.venda_erro})`,
  );
  await db.vendas.deleteMany({ where: { pedido: `NFC-e ${SERIE}-${n3}`, nfce_cupom_id: null } });
  const r3b = await svc.lancarVenda(r3.cupom.id);
  conferir(
    r3b.venda_estoque === 'lancada' && r3b.venda_erro === null && (await db.vendas.count({ where: { nfce_cupom_id: r3.cupom.id } })) === 1,
    'Lançar no estoque de novo: a venda entra uma vez e o erro some',
  );

  // 4. falha antes de enviar → nao_enviado; descartado, o número vai para o próximo (descartado + vivo com o mesmo número)
  proxima = 'nao_enviado';
  const r4 = await svc.emitir(venda(), QUEM);
  conferir(r4.cupom.numero === n3 + 1 && r4.cupom.situacao === 'nao_enviado', 'falha antes de enviar: nao_enviado');
  await svc.descartar(r4.cupom.id, 'Venda desfeita', QUEM);
  proxima = 'autorizar';
  const r5 = await svc.emitir(venda(), QUEM);
  conferir(r5.cupom.numero === n3 + 1 && r5.cupom.situacao === 'autorizado' && r5.cupom.id !== r4.cupom.id, 'o número descartado volta');
  conferir((await proximoNumero()) === BigInt(n3 + 2), 'o reaproveitado não avança o próximo número');

  // 5. cancelamento (Task 12) sob o gatilho de imutável e com a venda de verdade
  const vendaDo = (id: string) => db.vendas.count({ where: { nfce_cupom_id: id } });
  const cupom = (id: string) => db.nfce_cupons.findUniqueOrThrow({ where: { id } });
  const MOTIVO = 'Cliente desistiu da compra';
  // 5a. 573: a T1 grava `cancelando` (autorizado → cancelando passa no gatilho) e a T2 deixa assim; a venda fica até a resposta
  evento = 573;
  const k1 = await cancelamento.cancelar(r2.cupom.id, MOTIVO, QUEM);
  const c573 = await cupom(r2.cupom.id);
  conferir(
    k1.situacao === 'cancelando' &&
      c573.situacao === 'cancelando' &&
      c573.cancelamento_motivo === MOTIVO &&
      c573.cancelamento_pedido_em !== null &&
      (await vendaDo(r2.cupom.id)) === 1,
    `573: cancelando gravado pela T1 sob o gatilho, com o motivo e a hora do pedido; a venda fica (veio ${k1.situacao})`,
  );
  const e573 = await db.nfce_envios.findFirstOrThrow({ where: { cupom_id: r2.cupom.id, servico: 'cancelamento' } });
  conferir(
    e573.resultado === 'respondida' &&
      e573.c_stat === 573 &&
      e573.tentativa === 1 &&
      !!e573.xml_enviado?.includes(`<xJust>${MOTIVO}</xJust>`),
    'o pedido de cancelamento no diário: o evento assinado com o motivo e o 573',
  );
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET n_prot = '135260000000998' WHERE id = ${r2.cupom.id}::uuid`,
    DOC_FISCAL,
    'protocolo da autorização do cancelando',
  );
  await recusaHttp(cancelamento.cancelar(r2.cupom.id, MOTIVO, QUEM), 409, 'NFCE_SITUACAO', 'cancelar de novo o cancelando = 409');
  // a consulta (2 min depois do pedido) acha o evento: cancelando → cancelado e a T3 desfaz a venda
  consultaCancelada = true;
  const k2 = await svc.consultar(r2.cupom.id, QUEM, new Date(Date.now() + 3 * 60_000));
  consultaCancelada = false;
  conferir(
    k2.situacao === 'cancelado' && k2.venda_estoque === 'desfeita' && (await vendaDo(r2.cupom.id)) === 0,
    `a consulta achou o cancelamento: cancelado e a venda desfeita (veio ${k2.situacao}/${k2.venda_estoque})`,
  );

  // 5b. 135 direto: cancelado num UPDATE só (com o protocolo e o motivo), a T3 apaga a venda e as baixas uma vez só
  evento = 135;
  const vendaR5 = await db.vendas.findFirstOrThrow({ where: { nfce_cupom_id: r5.cupom.id } });
  const k3 = await cancelamento.cancelar(r5.cupom.id, MOTIVO, QUEM);
  const c135 = await cupom(r5.cupom.id);
  conferir(
    k3.situacao === 'cancelado' &&
      c135.cancelamento_n_prot === '13526000000067890' &&
      c135.cancelamento_motivo === MOTIVO &&
      c135.cancelado_em !== null &&
      c135.n_prot === '13526000000012345',
    `135: cancelado com o protocolo do cancelamento sob o gatilho (veio ${k3.situacao})`,
  );
  conferir(
    (await vendaDo(r5.cupom.id)) === 0 &&
      (await db.movimentacoes.count({ where: { venda_id: vendaR5.id } })) === 0 &&
      c135.venda_desfeita_em !== null &&
      k3.venda_estoque === 'desfeita',
    'T3 do cancelamento: a venda e a baixa saíram do estoque',
  );
  const [d2] = await db.$queryRaw<{ n: number }[]>`SELECT nfce_desfazer_venda(${r5.cupom.id}::uuid) AS n`;
  conferir(d2?.n === 0, 'desfazer de novo devolve 0 (a venda saiu uma vez só)');
  await recusaHttp(svc.lancarVenda(r5.cupom.id), 409, 'NFCE_SITUACAO', 'lançar ou tirar de novo a venda já desfeita = 409');
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET situacao = 'cancelando' WHERE id = ${r5.cupom.id}::uuid`,
    'não passa para cancelando',
    'cancelado → cancelando',
  );
  await recusa(
    db,
    Prisma.sql`UPDATE nfce_cupons SET cancelamento_n_prot = '135269999999998' WHERE id = ${r5.cupom.id}::uuid`,
    DOC_FISCAL,
    'protocolo do cancelamento do cancelado',
  );

  // 5c. recusa (501): de volta a autorizado sem o motivo (cancelando → autorizado passa no gatilho), a venda fica, conta no teto
  evento = 501;
  const k4 = await cancelamento.cancelar(r3.cupom.id, MOTIVO, QUEM);
  const c501 = await cupom(r3.cupom.id);
  const e501 = await db.nfce_envios.findFirstOrThrow({ where: { cupom_id: r3.cupom.id, servico: 'cancelamento' } });
  conferir(
    k4.situacao === 'autorizado' &&
      k4.recusa?.codigo === 501 &&
      c501.situacao === 'autorizado' &&
      c501.cancelamento_motivo === null &&
      c501.cancelamento_pedido_em === null &&
      e501.rejeicao &&
      (await vendaDo(r3.cupom.id)) === 1,
    `recusa: volta a autorizado sem o motivo, o pedido no diário conta no teto e a venda fica (veio ${k4.situacao})`,
  );
  evento = 135;

  // 6. a série daqui virou uma das do caixa de hoje (fora da rota, que recusaria): a T1 recusa sem reservar número nem chamar a porta
  const chamadas = porta.chamadas.length;
  const cupons = await db.nfce_cupons.count({ where: { emitido_por_nome: MARCA } });
  await db.nfce_emitente.update({ where: { id: 1 }, data: { sem_outro_sistema: false, series_outro_sistema: [SERIE] } });
  await recusaHttp(svc.emitir(venda(), QUEM), 422, 'NFCE_SERIE_INVALIDA', 'série do caixa de hoje igual à daqui: a T1 recusa');
  conferir(
    porta.chamadas.length === chamadas &&
      (await db.nfce_cupons.count({ where: { emitido_por_nome: MARCA } })) === cupons &&
      (await proximoNumero()) === BigInt(n3 + 2),
    'série do caixa de hoje: nada reservado, nada enviado',
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  const banco = nomeDoBanco(url);
  if (banco !== BANCO_DO_SMOKE) {
    throw new Error(`recusado: só roda no banco descartável do smoke (${BANCO_DO_SMOKE}), não em "${banco ?? '?'}". Nada foi apagado.`);
  }
  Logger.overrideLogger(['error', 'warn']);
  const db = new PrismaClient();
  try {
    try {
      await limpar(db);
      const insumo = await db.itens_estoque.create({ data: { nome: `${MARCA} malte`, unidade: 'KG', preco_unitario: '10' } });
      const criar = async (nome: string, preco: string): Promise<Item> => {
        const c = await db.itens_cardapio.create({ data: { nome: `${MARCA} ${nome}`, preco_venda: preco } });
        await db.ficha_ingredientes.create({ data: { item_cardapio_id: c.id, item_estoque_id: insumo.id, quantidade: '0.3' } });
        return { id: c.id, nome: c.nome };
      };
      const a = await criar('Chopp 300 ml', '12.00');
      const b = await criar('Chopp 500 ml', '10.00');
      const g = await criar('Chopp do gatilho', '12.00');

      await estrutura(db);
      await gatilhos(db, g);
      await venda(db, a, b, insumo.id);
      await emissao(db, a);
    } finally {
      await limpar(db);
    }
    const [lig] = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('nfce_cupons_imutavel', 'nfce_filhos_imutaveis') AND tgenabled = 'O'`;
    conferir(lig?.n === 3, 'limpeza: os 3 gatilhos de imutável religados');
    conferir((await db.nfce_cupons.count({ where: { emitido_por_nome: MARCA } })) === 0, 'limpeza: nenhum cupom de teste sobrando');
  } finally {
    await db.$disconnect();
  }
  console.log(`nfce-banco: ${oks} ok`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`nfce-banco: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
