// Prova no banco real (Decisão 14 do plano): roda o ciclo da busca na SEFAZ contra o Postgres do smoke, em `homologacao`, com a
// porta da SEFAZ e o certificado FALSOS. Nenhuma rede: as respostas são envelopes montados à mão com as fixtures da Task 3.
// Roda antes de a API do smoke subir e apaga tudo o que criou. Uso (o smoke-capped.sh já chama):
//   DATABASE_URL=... npx ts-node --transpile-only scripts/ciclo-sefaz-banco.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import type { CertificadoEmUso } from '../src/modules/certificado-digital/certificado-digital.port';
import { CHAVE_TRAVA_SEFAZ, CicloSefazService } from '../src/modules/notas-sefaz/ciclo.service';
import { lerRetornoDistribuicao } from '../src/modules/sefaz/distribuicao.adapter';
import { retornoSoap } from '../src/modules/sefaz/__tests__/retorno-falso';
import { SefazDfeFalso } from '../src/modules/sefaz/__tests__/sefaz-dfe.falso';

const AMB = 'homologacao';
const CNPJ = '12345678000195';
const fx = (nome: string) => readFileSync(join(__dirname, '../src/modules/sefaz/__tests__/fixtures', nome), 'utf8');

let oks = 0;
function conferir(cond: boolean, oque: string): void {
  if (!cond) throw new Error(`falhou: ${oque}`);
  oks++;
}

/** Na ordem das FKs: caixa → lacunas e documentos → consultas → histórico → estado. */
async function limpar(db: PrismaClient): Promise<void> {
  const w = { where: { ambiente: AMB } };
  await db.notas_sefaz.deleteMany(w);
  await db.sefaz_lacunas.deleteMany(w);
  await db.sefaz_documentos.deleteMany(w);
  await db.sefaz_consultas.deleteMany(w);
  await db.sefaz_distribuicao_historico.deleteMany(w);
  await db.sefaz_distribuicao.deleteMany(w);
}

function umaConexao(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  Logger.overrideLogger(['error', 'warn']);
  const db = new PrismaClient();
  // 2ª conexão (uma só no pool): segura a trava de sessão como "outro processo"
  const outra = new PrismaClient({ datasources: { db: { url: umaConexao(url) } } });
  try {
    await limpar(db);
    const sefaz = new SefazDfeFalso();
    const certificados = {
      emUso: async () =>
        ({
          cnpj: CNPJ,
          validoAte: new Date(Date.now() + 365 * 86_400_000),
          impressaoDigital: 'ab'.repeat(32),
        }) as unknown as CertificadoEmUso,
    };
    const config = { get: (k: string) => (k === 'SEFAZ_DFE_AMBIENTE' ? AMB : undefined) } as unknown as ConfigService;
    const svc = new CicloSefazService(db as unknown as PrismaService, config, certificados, sefaz);
    conferir(svc.ambiente() === AMB, 'ambiente homologacao');
    conferir((await svc.cnpjDaEmpresa()) === CNPJ, 'CNPJ da empresa do seed');

    // 1. linha (homologacao, CNPJ) ligada
    const onde = { ambiente_cnpj: { ambiente: AMB, cnpj: CNPJ } };
    await db.sefaz_distribuicao.upsert({
      where: onde,
      create: { ambiente: AMB, cnpj: CNPJ, busca_ligada: true },
      update: { busca_ligada: true },
    });

    // 2. 138 (2 documentos, ult 2, max 3) e depois 137 (ult 3), no mesmo ciclo
    sefaz.responder(
      lerRetornoDistribuicao(
        retornoSoap({
          cStat: 138,
          ultNsu: 2n,
          maxNsu: 3n,
          docs: [
            { nsu: 1n, schema: 'resNFe_v1.01.xsd', conteudo: fx('res-nfe.xml') },
            { nsu: 2n, schema: 'resEvento_v1.01.xsd', conteudo: fx('res-evento-110111.xml') },
          ],
        }),
      ),
      lerRetornoDistribuicao(retornoSoap({ cStat: 137, ultNsu: 3n, maxNsu: 3n })),
    );
    const antes = Date.now();
    const r1 = await svc.ciclo('agendada', null);
    conferir(r1.fim === 'feito' && r1.paginas === 2, `ciclo 138 → 137 (veio ${JSON.stringify(r1)})`);
    conferir(sefaz.chamadas.map((c) => c.ultNsu).join(',') === '0,2', 'NSUs enviados 0 e 2');
    const consultas = await db.sefaz_consultas.findMany({ where: { ambiente: AMB } });
    conferir(consultas.length === 2, '2 consultas');
    conferir(consultas[0].ciclo_id === consultas[1].ciclo_id, 'mesmo ciclo_id');
    conferir(
      consultas.every((c) => c.resultado === 'respondida' && c.terminada_em !== null),
      'consultas respondidas e fechadas',
    );
    const linha = await db.sefaz_distribuicao.findUniqueOrThrow({ where: onde });
    conferir(linha.ult_nsu === 3n, 'ult_nsu 3');
    conferir(linha.em_andamento_desde === null, 'em_andamento_desde limpo');
    conferir(linha.ultima_consulta_em !== null && linha.primeira_consulta_em !== null, 'primeira e última busca gravadas');
    const espera = (linha.proxima_consulta_em?.getTime() ?? 0) - antes;
    conferir(espera >= 64 * 60_000 && espera <= 66 * 60_000, 'próxima em ≈ +65 min');
    conferir((await db.sefaz_documentos.count({ where: { ambiente: AMB } })) === 2, '2 documentos');
    conferir((await db.sefaz_documentos.count({ where: { ambiente: AMB, processado_em: null } })) === 0, 'documentos classificados');
    conferir((await db.notas_sefaz.count({ where: { ambiente: AMB } })) >= 1, 'ao menos uma nota na caixa');

    // 3. de novo: a SEFAZ só permite depois de 65 min
    const r2 = await svc.ciclo('agendada', null);
    conferir(r2.fim === 'aguarde' && sefaz.chamadas.length === 2, 'aguarde e nenhuma chamada');

    // 4. próxima no passado, mas a trava presa noutra conexão
    await db.sefaz_distribuicao.update({ where: onde, data: { proxima_consulta_em: new Date(Date.now() - 60_000) } });
    await outra.$executeRaw`SELECT pg_advisory_lock(${CHAVE_TRAVA_SEFAZ}::bigint)`;
    try {
      const r3 = await svc.ciclo('agendada', null);
      conferir(r3.fim === 'ocupada' && sefaz.chamadas.length === 2, 'trava presa = ocupada, sem chamada');
    } finally {
      await outra.$executeRaw`SELECT pg_advisory_unlock(${CHAVE_TRAVA_SEFAZ}::bigint)`;
    }
    conferir((await db.sefaz_consultas.count({ where: { ambiente: AMB } })) === 2, 'nenhuma consulta nova');

    // 5. NSU repetido com skipDuplicates não duplica
    const doc1 = await db.sefaz_documentos.findUniqueOrThrow({ where: { ambiente_cnpj_nsu: { ambiente: AMB, cnpj: CNPJ, nsu: 1n } } });
    const rep = await db.sefaz_documentos.createMany({
      data: [
        { ambiente: AMB, cnpj: CNPJ, nsu: 1n, schema: 'resNFe_v1.01.xsd', tipo: 'resNFe', xml: '<x/>', consulta_id: doc1.consulta_id },
      ],
      skipDuplicates: true,
    });
    conferir(rep.count === 0 && (await db.sefaz_documentos.count({ where: { ambiente: AMB } })) === 2, 'NSU repetido ignorado');
  } finally {
    await limpar(db);
    await db.$disconnect();
    await outra.$disconnect();
  }
  console.log(`ciclo-sefaz-banco: ${oks} ok`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`ciclo-sefaz-banco: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
