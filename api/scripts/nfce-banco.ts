// Prova no banco real da migração `nfce` (cupom fiscal, Task 3): roda contra o Postgres do smoke e confere a estrutura (linhas semeadas,
// CHECKs da série e do número, o índice único parcial dos cupons vivos), os gatilhos de imutável (`nfce_cupons_imutavel` e
// `nfce_filhos_imutaveis`, inclusive o ON DELETE SET NULL do cardápio que passa) e as funções da venda (`nfce_lancar_venda` soma as linhas
// do mesmo item, a baixa vem do gatilho `vendas_baixa`, idempotente, recusa homologação; `nfce_desfazer_venda` apaga a venda e as baixas).
// Só SQL: nenhuma porta, nenhuma rede (o smoke ainda roda sob a barreira). Cada checagem conta um "ok"; a 1ª que falha sai com erro.
// Uso (o smoke-capped.sh já chama):
//   DATABASE_URL=... npx ts-node --transpile-only scripts/nfce-banco.ts
// Só roda no banco descartável do smoke: em qualquer outro, sai com erro ANTES de conectar (nada é apagado). Os cupons nunca são
// apagados pela aplicação (o gatilho recusa DELETE): a limpeza desliga os 3 gatilhos numa transação só, apaga o que este script criou
// (marcado com MARCA) e religa, e confere que voltaram ligados.
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { montarChaveNfce } from '../src/common/fiscal/chave-acesso';

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
  await db.itens_cardapio.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } });
  await db.itens_estoque.deleteMany({ where: { nome: { startsWith: `${MARCA} ` } } });
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
