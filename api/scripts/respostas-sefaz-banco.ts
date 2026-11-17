// Prova no banco real das respostas à SEFAZ (nota 5 do controlador, Tarefa 7): roda as rotas da caixa (ligar, ignorar avisando,
// reabrir, "Tentar de novo") e a fila (`RespostasSefazService.processar()`) contra o Postgres do smoke, em `homologacao`, com a porta dos
// eventos e o certificado FALSOS (o certificado fictício dos testes, `fixtures/tls`). Nenhuma rede: a porta é uma classe daqui que confere a
// T1 no banco e devolve um retorno montado à mão. Confere a T1 (gravado `enviando` com o XML assinado antes de a porta responder) e a T2,
// uma parada com o histórico `respostas_paradas`, os CHECKs, as FKs (e os índices delas) e os dois índices parciais (`sefaz_manifestacoes_evento_ativo` e
// `sefaz_manifestacoes_uma_final`, inclusive a 2ª resposta final ativa recusada pelo banco, e a rota que esbarra no índice devolve 409),
// e que o `reabrir` não cancela o que já saiu (nem depois de um "Tentar de novo"). Roda antes de a API do smoke subir e apaga tudo o que
// criou. Uso (o smoke-capped.sh já chama):
//   DATABASE_URL=... npx ts-node --transpile-only scripts/respostas-sefaz-banco.ts
// Só roda no banco descartável do smoke: em qualquer outro, sai com erro ANTES de conectar (nada é apagado).
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import type { CertificadoEmUso } from '../src/modules/certificado-digital/certificado-digital.port';
import { NotasService } from '../src/modules/notas/notas.service';
import { CaixaSefazService } from '../src/modules/notas-sefaz/caixa.service';
import { CicloSefazService } from '../src/modules/notas-sefaz/ciclo.service';
import { CHAVE_TRAVA_SEFAZ_EVENTOS, RespostasSefazService } from '../src/modules/notas-sefaz/respostas.service';
import type { AmbienteSefaz } from '../src/modules/sefaz/distribuicao.port';
import type { RespostaLoteEventos, SefazEventosPort } from '../src/modules/sefaz/eventos.port';
import { CLIENTE } from '../src/modules/sefaz/__tests__/certificado-teste';
import { SefazDfeFalso } from '../src/modules/sefaz/__tests__/sefaz-dfe.falso';
import { retornoLote } from '../src/modules/sefaz/__tests__/sefaz-eventos.falso';

/** O nome que o `smoke-capped.sh` dá ao banco que ele recria a cada rodada. */
const BANCO_DO_SMOKE = 'erpfreela_smoke';
const AMB = 'homologacao';
const CNPJ = '12345678000195';
const QUEM = { id: '0b8f5c2e-1111-4000-8000-0000000000aa', nome: 'Smoke' };
const DIA = 86_400_000;
// Chaves fictícias no formato do esquema (homologação; a caixa de produção do smoke usa outras).
const CH_A = '35261111222333000181550010000009011000000901'; // ciência automática
const CH_B = '35261111222333000181550010000009021000000902'; // "A compra não aconteceu"
const CH_C = '35261111222333000181550010000009031000000903'; // "Não reconheço": parada, falhou, "Tentar de novo"
const CH_D = '35261111222333000181550010000009041000000904'; // a 2ª final que escapa da conferência e esbarra no índice
const NPROT15 = '135260000000901';
const NPROT17 = '13526000000090201';

let oks = 0;
function conferir(cond: boolean, oque: string): void {
  if (!cond) throw new Error(`falhou: ${oque}`);
  oks++;
}

/** Na ordem das FKs: eventos → lotes → linha das respostas → histórico → caixa. */
async function limpar(db: PrismaClient): Promise<void> {
  const w = { where: { ambiente: AMB } };
  await db.sefaz_manifestacoes.deleteMany(w);
  await db.sefaz_eventos_lotes.deleteMany(w);
  await db.sefaz_manifestacao.deleteMany(w);
  await db.sefaz_distribuicao_historico.deleteMany(w);
  await db.notas_sefaz.deleteMany(w);
}

/** Nome do banco na URL (só ele vai para a mensagem: a URL traz a senha); `null` se a URL não for lida. */
function nomeDoBanco(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

function umaConexao(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

/** A operação recusa com este HttpException (status e code). */
async function recusaHttp(p: Promise<unknown>, status: number, code: string, oque: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const r = e instanceof HttpException ? (e.getResponse() as { code?: string }) : null;
    conferir(
      e instanceof HttpException && e.getStatus() === status && r?.code === code,
      `${oque} (veio ${e instanceof Error ? e.name : e})`,
    );
    return;
  }
  conferir(false, `${oque}: não recusou`);
}

/**
 * Como o Postgres cita cada índice único parcial ao recusar (o Prisma repassa o DETAIL, "Key (…)=(…) already exists", e não o nome):
 * as colunas distinguem os dois.
 */
const INDICE = {
  evento_ativo: 'Code: `23505`. Message: `Key (ambiente, chave, tp_evento, n_seq)=',
  uma_final: 'Code: `23505`. Message: `Key (ambiente, chave)=',
};

/** O banco recusa o SQL e a mensagem cita a regra (nome do CHECK ou da FK; colunas do índice único). */
async function bancoRecusa(db: PrismaClient, sql: string, regra: string): Promise<void> {
  try {
    await db.$executeRawUnsafe(sql);
  } catch (e) {
    conferir(e instanceof Error && e.message.includes(regra), `banco recusa por ${regra} (veio: ${e instanceof Error ? e.message : e})`);
    return;
  }
  conferir(false, `banco aceitou o que ${regra} proíbe`);
}

/** Porta falsa: confere o banco ANTES de responder (a T1 já gravou `enviando`) e devolve as respostas na ordem. Nunca rede. */
class PortaConferida implements SefazEventosPort {
  readonly chamadas: { idLote: bigint; eventos: string[] }[] = [];
  proximas: RespostaLoteEventos[] = [];
  antes?: (idLote: bigint, eventos: string[]) => Promise<void>;

  async enviarLote(_cert: CertificadoEmUso, ambiente: AmbienteSefaz, idLote: bigint, eventos: string[]): Promise<RespostaLoteEventos> {
    if (ambiente !== AMB) throw new Error('ambiente inesperado');
    this.chamadas.push({ idLote, eventos: [...eventos] });
    await this.antes?.(idLote, eventos);
    const r = this.proximas.shift();
    if (!r) throw new Error('chamada inesperada à porta');
    return r;
  }
}

const sqlEvento = (chave: string, notaId: string, x: Record<string, string>) => {
  const colunas = {
    nota_sefaz_id: `'${notaId}'`,
    ambiente: `'${AMB}'`,
    cnpj: `'${CNPJ}'`,
    chave: `'${chave}'`,
    origem: `'admin'`,
    enviar_apos: 'now()',
    ...x,
  };
  return `insert into sefaz_manifestacoes (${Object.keys(colunas).join(', ')}) values (${Object.values(colunas).join(', ')})`;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  const banco = nomeDoBanco(url);
  if (banco !== BANCO_DO_SMOKE) {
    throw new Error(`recusado: só roda no banco descartável do smoke (${BANCO_DO_SMOKE}), não em "${banco ?? '?'}". Nada foi apagado.`);
  }
  Logger.overrideLogger(['error']);
  const db = new PrismaClient();
  // 2ª conexão (uma só no pool): segura a trava das respostas como "outro processo"
  const outra = new PrismaClient({ datasources: { db: { url: umaConexao(url) } } });
  try {
    await limpar(db);
    const config = {
      get: (k: string) => (k === 'SEFAZ_DFE_AMBIENTE' ? AMB : k === 'SEFAZ_MANIFESTACAO' ? 'ligada' : undefined),
    } as unknown as ConfigService;
    const certificados = { emUso: async (): Promise<CertificadoEmUso> => ({ ...CLIENTE, impressaoDigital: 'ab'.repeat(32) }) };
    const prisma = db as unknown as PrismaService;
    const ciclo = new CicloSefazService(prisma, config, certificados, new SefazDfeFalso());
    const notas = new NotasService(prisma);
    const porta = new PortaConferida();
    const respostas = new RespostasSefazService(prisma, config, ciclo, certificados, porta, notas);
    const caixa = new CaixaSefazService(prisma, ciclo, notas, certificados, respostas);
    conferir(respostas.disponivel(), 'respostas disponíveis (homologacao + ligada)');
    conferir((await ciclo.cnpjDaEmpresa()) === CNPJ, 'CNPJ da empresa do seed');

    // 1. três notas de compra autorizadas, sem o XML completo: A (2 dias) recebe a ciência automática; B (3 dias) é ignorada antes do
    //    tique; C tem 12 dias (passou da janela de 9 dias da ciência, ainda no prazo de 90 para a resposta final)
    const nota = (chave: string, dias: number) =>
      db.notas_sefaz.create({
        data: {
          ambiente: AMB,
          cnpj_destinatario: CNPJ,
          chave,
          emitente_cnpj: '11222333000181',
          emitente_nome: 'Fornecedor Smoke',
          numero: String(Number(chave.slice(25, 34))),
          serie: '1',
          situacao_sefaz: 'autorizada',
          tp_nf: 1,
          fin_nfe: 1,
          emitida_em: new Date(Date.now() - dias * DIA),
          autorizada_em: new Date(Date.now() - dias * DIA),
        },
      });
    const [a, b, c] = [await nota(CH_A, 2), await nota(CH_B, 3), await nota(CH_C, 12)];

    // 2. "Ligar as respostas" (a rota): linha ligada, histórico respostas_ligadas no CHECK de verdade
    await caixa.configurarRespostas(true, QUEM);
    const onde = { ambiente_cnpj: { ambiente: AMB, cnpj: CNPJ } };
    const ligada = await db.sefaz_manifestacao.findUniqueOrThrow({ where: onde });
    conferir(ligada.ligada && ligada.situacao === 'ok' && ligada.ligada_em !== null, 'respostas ligadas');
    conferir(
      (await db.sefaz_distribuicao_historico.count({ where: { ambiente: AMB, evento: 'respostas_ligadas' } })) === 1,
      'histórico ligadas',
    );

    // 3. ignorar avisando: 210220 na fila; o 2º (outra aba) = 409; reabrir cancela; "A compra não aconteceu" com a justificativa normalizada
    await caixa.ignorar(b.id, 'nao_reconheco', null, QUEM, new Date(), true);
    await recusaHttp(caixa.ignorar(b.id, 'lancada_de_outro_jeito', null, QUEM, new Date(), true), 409, 'SEFAZ_JA_RESPONDIDA', '2º ignorar');
    await recusaHttp(
      caixa.ignorar(b.id, 'compra_nao_aconteceu', 'curta', QUEM, new Date(), true),
      409,
      'SEFAZ_JA_RESPONDIDA',
      'regra 6 antes da 7',
    );
    await caixa.reabrir(b.id, QUEM);
    conferir((await db.sefaz_manifestacoes.count({ where: { nota_sefaz_id: b.id, situacao: 'cancelada' } })) === 1, 'reabrir cancelou');
    await caixa.ignorar(b.id, 'compra_nao_aconteceu', 'Mercadoria devolvida — “recusada” na porta’', QUEM, new Date(), true);
    const evB = await db.sefaz_manifestacoes.findFirstOrThrow({ where: { nota_sefaz_id: b.id, situacao: 'na_fila' } });
    conferir(evB.tp_evento === '210240' && evB.x_just === 'Mercadoria devolvida - "recusada" na porta\'', 'x_just normalizado');
    conferir(evB.enviar_apos.getTime() - evB.pedida_em.getTime() === 60_000, 'evento do admin espera 60 s');
    const notaB = await db.notas_sefaz.findUniqueOrThrow({ where: { id: b.id } });
    conferir(notaB.motivo_ignorar === 'compra_nao_aconteceu' && notaB.motivo_texto === evB.x_just, 'nota ignorada com o motivo novo');

    // 4. um tique: T1 grava `enviando` (XML assinado, tentativa 1, lote aberto) antes da porta; T2 grava o retorno e fecha o lote
    await db.sefaz_manifestacoes.update({ where: { id: evB.id }, data: { enviar_apos: new Date(Date.now() - 1000) } });
    porta.antes = async (idLote, eventos) => {
      const lote = await db.sefaz_eventos_lotes.findFirstOrThrow({ where: { ambiente: AMB, id_lote: idLote } });
      conferir(lote.resultado === null && lote.eventos === 2, 'T1: lote aberto com 2 eventos');
      const env = await db.sefaz_manifestacoes.findMany({ where: { lote_id: lote.id } });
      conferir(
        env.length === 2 && env.every((e) => e.situacao === 'enviando' && e.tentativas === 1),
        'T1: 2 eventos enviando, 1ª tentativa',
      );
      conferir(
        env.every((e) => !!e.xml_evento?.includes('<Signature') && e.impressao_digital === 'ab'.repeat(32)),
        'T1: XML assinado gravado',
      );
      conferir(
        env.every((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(e.dh_evento ?? '')),
        'T1: dhEvento com -03:00',
      );
      conferir(eventos.length === 2 && eventos[0]!.includes(`ID210240${CH_B}01`), 'T1: a resposta final vai antes da ciência');
    };
    porta.proximas.push(
      retornoLote(128, [
        { chave: CH_B, tpEvento: '210240', cStat: 135, nProt: NPROT15, dhRegEvento: '2026-11-17T14:05:00-03:00' },
        { chave: CH_A, tpEvento: '210210', cStat: 135, nProt: NPROT17, dhRegEvento: '2026-11-17T14:05:01-03:00' },
      ]),
    );
    const r1 = await respostas.processar();
    conferir(r1.fim === 'feito' && r1.enviados === 2 && porta.chamadas.length === 1, `tique 1 (veio ${JSON.stringify(r1)})`);
    const lote1 = await db.sefaz_eventos_lotes.findFirstOrThrow({ where: { ambiente: AMB } });
    conferir(lote1.resultado === 'respondida' && lote1.c_stat === 128 && lote1.terminado_em !== null, 'T2: lote fechado');
    const regA = await db.sefaz_manifestacoes.findFirstOrThrow({ where: { nota_sefaz_id: a.id } });
    const regB = await db.sefaz_manifestacoes.findUniqueOrThrow({ where: { id: evB.id } });
    conferir(regA.tp_evento === '210210' && regA.origem === 'ciencia_automatica', 'ciência automática criada pelo planejador');
    conferir(regA.situacao === 'registrada' && regA.n_prot === NPROT17 && regA.c_stat === 135, 'T2: ciência registrada (protocolo de 17)');
    conferir(
      regB.situacao === 'registrada' && regB.n_prot === NPROT15 && regB.xml_retorno !== null,
      'T2: 210240 registrada (protocolo de 15)',
    );
    const lista = await caixa.listar('todas', 100);
    const linhaA = lista.find((l) => l.id === a.id)!;
    const linhaB = lista.find((l) => l.id === b.id)!;
    conferir(linhaA.resposta?.ciencia?.estado === 'registrada' && linhaA.resposta.ciencia.protocolo === NPROT17, 'caixa: ciência de A');
    conferir(linhaA.resposta?.pode_responder === true && linhaA.resposta.prazo_perto === false, 'caixa: A respondível, sem aviso');
    conferir(linhaB.resposta?.final?.tipo === 'nao_aconteceu' && linhaB.resposta.final.estado === 'registrada', 'caixa: final de B');
    conferir(linhaB.resposta?.pode_responder === false, 'caixa: B já respondida');

    // 5. parada: o lote volta 280 (certificado) → `parada_certificado` com o histórico `respostas_paradas` no CHECK de verdade
    porta.antes = undefined;
    await caixa.ignorar(c.id, 'nao_reconheco', null, QUEM, new Date(), true);
    await db.sefaz_manifestacoes.updateMany({ where: { nota_sefaz_id: c.id }, data: { enviar_apos: new Date(Date.now() - 1000) } });
    porta.proximas.push(retornoLote(280, []));
    const r2 = await respostas.processar();
    conferir(r2.fim === 'feito' && porta.chamadas.length === 2, 'tique 2 saiu');
    const parada = await db.sefaz_manifestacao.findUniqueOrThrow({ where: onde });
    conferir(parada.situacao === 'parada_certificado' && !!parada.mensagem?.includes('código 280'), 'parada_certificado com a frase');
    const hist = await db.sefaz_distribuicao_historico.findFirst({ where: { ambiente: AMB, evento: 'respostas_paradas' } });
    conferir(hist?.c_stat === 280 && hist.situacao === 'parada_certificado', 'histórico respostas_paradas com o código');
    const evC = await db.sefaz_manifestacoes.findFirstOrThrow({ where: { nota_sefaz_id: c.id } });
    conferir(evC.situacao === 'na_fila' && evC.tentativas === 0, '280 não gasta tentativa: volta à fila');
    conferir((await respostas.processar()).fim === 'parada' && porta.chamadas.length === 2, 'parada: nenhum lote');
    await caixa.configurarRespostas(true, QUEM); // "Ligar as respostas de novo"
    const religada = await db.sefaz_manifestacao.findUniqueOrThrow({ where: onde });
    conferir(religada.situacao === 'ok' && religada.mensagem === null && religada.falhas_seguidas === 0, 'religada: ok');
    conferir(religada.ligada_em?.getTime() === ligada.ligada_em?.getTime(), 'religar depois da parada não reescreve ligada_em');
    // "Voltar para a lista" depois da parada: o lote do 280 chegou à SEFAZ (`respondida`), então pela regra da fila (`jaEnviada`) o
    // evento já saiu e fica na fila (decisão do controlador na rodada de correção 1)
    await caixa.reabrir(c.id, QUEM);
    conferir(
      (await db.sefaz_manifestacoes.findUniqueOrThrow({ where: { id: evC.id } })).situacao === 'na_fila',
      'reabrir depois do 280: o que saiu fica na fila',
    );

    // 6. a 3ª tentativa com 999 → falhou; "Tentar de novo" zera as tentativas (CHECK 0–3 de verdade) e mantém o lote
    await db.sefaz_manifestacoes.update({ where: { id: evC.id }, data: { tentativas: 2, enviar_apos: new Date(Date.now() - 1000) } });
    porta.proximas.push(retornoLote(128, [{ chave: CH_C, tpEvento: '210220', cStat: 999 }]));
    conferir((await respostas.processar()).fim === 'feito', 'tique 3 saiu');
    conferir((await db.sefaz_manifestacoes.findUniqueOrThrow({ where: { id: evC.id } })).situacao === 'falhou', '999 na 3ª = falhou');
    await caixa.responderDeNovo(c.id, QUEM);
    const deNovo = await db.sefaz_manifestacoes.findUniqueOrThrow({ where: { id: evC.id } });
    conferir(
      deNovo.situacao === 'na_fila' && deNovo.tentativas === 0 && deNovo.lote_id !== null,
      'Tentar de novo: na fila, 0 tentativas, lote',
    );
    await recusaHttp(caixa.responderDeNovo(a.id, QUEM), 409, 'SEFAZ_NADA_A_REENVIAR', 'nada a reenviar');
    // I1: "Voltar para a lista" depois do "Tentar de novo": a resposta que falhou depois de sair continua na fila e ocupa a vaga
    await caixa.reabrir(c.id, QUEM);
    conferir(
      (await db.sefaz_manifestacoes.findUniqueOrThrow({ where: { id: evC.id } })).situacao === 'na_fila',
      'reabrir depois de Tentar de novo não cancela',
    );
    await recusaHttp(
      caixa.ignorar(c.id, 'lancada_de_outro_jeito', null, QUEM, new Date(), true),
      409,
      'SEFAZ_JA_RESPONDIDA',
      'vaga ocupada',
    );

    // 7. trava presa noutra conexão = ocupada, sem chamada à porta
    await db.sefaz_manifestacao.update({ where: onde, data: { pausa_ate: null } });
    await outra.$executeRaw`SELECT pg_advisory_lock(${CHAVE_TRAVA_SEFAZ_EVENTOS}::bigint)`;
    try {
      const r3 = await respostas.processar();
      conferir(r3.fim === 'ocupada' && porta.chamadas.length === 3, `trava presa = ocupada (veio ${r3.fim})`);
    } finally {
      await outra.$executeRaw`SELECT pg_advisory_unlock(${CHAVE_TRAVA_SEFAZ_EVENTOS}::bigint)`;
    }

    // 7b. a 2ª resposta final que escapa da conferência (outra conexão, sem a trava, grava entre a leitura e o INSERT) é recusada pelo
    //     índice `sefaz_manifestacoes_uma_final` do banco de verdade: a rota devolve 409, não 500, e a transação desfaz a nota ignorada
    const d = await nota(CH_D, 20);
    let corrida = true;
    const dbCorrida = db.$extends({
      query: {
        sefaz_manifestacoes: {
          async findMany({ args, query }) {
            const r = await query(args);
            if (corrida && args.where?.nota_sefaz_id === d.id) {
              corrida = false;
              await outra.$executeRawUnsafe(sqlEvento(CH_D, d.id, { tp_evento: `'210200'` }));
            }
            return r;
          },
        },
      },
    });
    const caixaCorrida = new CaixaSefazService(dbCorrida as unknown as PrismaService, ciclo, notas, certificados, respostas);
    await recusaHttp(
      caixaCorrida.ignorar(d.id, 'nao_reconheco', null, QUEM, new Date(), true),
      409,
      'SEFAZ_JA_RESPONDIDA',
      'índice uma_final no banco de verdade: 409, não 500',
    );
    conferir(!corrida, 'a outra conexão gravou entre a leitura e o INSERT');
    const notaD = await db.notas_sefaz.findUniqueOrThrow({ where: { id: d.id } });
    conferir(notaD.ignorada_em === null && notaD.motivo_ignorar === null, 'índice recusou: a nota não ficou ignorada');
    const evD = await db.sefaz_manifestacoes.findMany({ where: { nota_sefaz_id: d.id } });
    conferir(evD.length === 1 && evD[0]!.tp_evento === '210200', 'só o evento da outra conexão');

    // 8. CHECKs, FKs e os dois índices parciais
    const lixo = '00000000-0000-4000-8000-00000000dead';
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'110111'` }), 'sefaz_manifestacoes_tp_evento');
    await bancoRecusa(
      db,
      sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, x_just: `'Pedido cancelado pelo fornecedor'` }),
      'sefaz_manifestacoes_x_just',
    );
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210240'` }), 'sefaz_manifestacoes_x_just');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210240'`, x_just: `'Pedido cancela'` }), 'sefaz_manifestacoes_x_just');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, n_prot: `'1352600000009011'` }), 'sefaz_manifestacoes_n_prot');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, tentativas: '4' }), 'sefaz_manifestacoes_tentativas');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, c_stat: '99' }), 'sefaz_manifestacoes_c_stat');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, situacao: `'perdida'` }), 'sefaz_manifestacoes_situacao');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, origem: `'robo'` }), 'sefaz_manifestacoes_origem');
    await bancoRecusa(db, sqlEvento('ABC', a.id, { tp_evento: `'210200'` }), 'sefaz_manifestacoes_chave');
    await bancoRecusa(db, sqlEvento(CH_A, lixo, { tp_evento: `'210200'` }), 'sefaz_manifestacoes_nota_sefaz_id_fkey');
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210200'`, lote_id: `'${lixo}'` }), 'sefaz_manifestacoes_lote_id_fkey');
    await bancoRecusa(db, `delete from notas_sefaz where id = '${a.id}'`, 'sefaz_manifestacoes_nota_sefaz_id_fkey');
    await bancoRecusa(db, `delete from sefaz_eventos_lotes where id = '${lote1.id}'`, 'sefaz_manifestacoes_lote_id_fkey');
    // o mesmo evento ativo duas vezes: recusado; cancelado não ocupa a vaga
    await bancoRecusa(db, sqlEvento(CH_A, a.id, { tp_evento: `'210210'`, origem: `'ciencia_automatica'` }), INDICE.evento_ativo);
    await db.$executeRawUnsafe(sqlEvento(CH_A, a.id, { tp_evento: `'210210'`, origem: `'ciencia_automatica'`, situacao: `'cancelada'` }));
    conferir(true, 'ciência cancelada repetida aceita');
    // uma resposta final ativa por chave: a 2ª (de outro tipo) é recusada; recusada pela SEFAZ não conta
    await bancoRecusa(db, sqlEvento(CH_B, b.id, { tp_evento: `'210200'` }), INDICE.uma_final);
    await bancoRecusa(db, sqlEvento(CH_C, c.id, { tp_evento: `'210200'`, situacao: `'falhou'` }), INDICE.uma_final);
    await db.$executeRawUnsafe(sqlEvento(CH_B, b.id, { tp_evento: `'210200'`, situacao: `'recusada'`, c_stat: '650' }));
    conferir(true, 'final recusada ao lado da ativa aceita');
    // as outras tabelas
    await bancoRecusa(db, `update sefaz_manifestacao set situacao = 'parada_x' where ambiente = '${AMB}'`, 'sefaz_manifestacao_situacao');
    await bancoRecusa(db, `update sefaz_eventos_lotes set resultado = 'xyz' where id = '${lote1.id}'`, 'sefaz_eventos_lotes_resultado');
    await bancoRecusa(
      db,
      `insert into sefaz_eventos_lotes (ambiente, cnpj, id_lote, iniciado_em) values ('${AMB}', '${CNPJ}', 0, now())`,
      'sefaz_eventos_lotes_id_lote',
    );
    await bancoRecusa(
      db,
      `insert into sefaz_distribuicao_historico (ambiente, cnpj, evento, situacao) values ('${AMB}', '${CNPJ}', 'respostas_x', 'ok')`,
      'sefaz_distribuicao_historico_evento',
    );
    await bancoRecusa(db, `update notas_sefaz set motivo_ignorar = 'compra_feita' where id = '${b.id}'`, 'notas_sefaz_motivo');
    // 9. os índices das duas chaves estrangeiras (migração 20261118120100_notas_sefaz_respostas_indices), aplicados pela sequência
    const indices = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'sefaz_manifestacoes'`,
    );
    const def = (nome: string) => indices.find((i) => i.indexname === nome)?.indexdef ?? '';
    conferir(/USING btree \(nota_sefaz_id\)$/.test(def('sefaz_manifestacoes_nota_sefaz_id_idx')), 'índice de nota_sefaz_id no banco');
    conferir(/USING btree \(lote_id\)$/.test(def('sefaz_manifestacoes_lote_id_idx')), 'índice de lote_id no banco');
  } finally {
    await limpar(db);
    await db.$disconnect();
    await outra.$disconnect();
  }
  console.log(`respostas-sefaz-banco: ${oks} ok`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`respostas-sefaz-banco: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
