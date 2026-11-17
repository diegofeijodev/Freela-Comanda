import { createPrivateKey, randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type sefaz_distribuicao } from '@prisma/client';
import { CertificadoErro, MSG_USO, type CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { CadeiaIcp } from '../../certificado-digital/cadeia';
import type { NotasService } from '../../notas/notas.service';
import { SefazDfeAdapter, URL_DISTRIBUICAO } from '../../sefaz/distribuicao.adapter';
import type { DocumentoDistribuido, SefazDfePort } from '../../sefaz/distribuicao.port';
import { sefazErro } from '../../sefaz/sefaz-erro';
import { chamarSoap12 } from '../../sefaz/transporte-soap12';
import { faultSoap12, retornoSoap, SENTINELA_FAULT } from '../../sefaz/__tests__/retorno-falso';
import { resposta, SefazDfeFalso } from '../../sefaz/__tests__/sefaz-dfe.falso';
import { SefazEventosFalso } from '../../sefaz/__tests__/sefaz-eventos.falso';
import { CaixaSefazService } from '../caixa.service';
import { CicloSefazService } from '../ciclo.service';
import { FRASE } from '../frases';
import { RespostasSefazService } from '../respostas.service';
import { linhaCom, montarPrismaSefaz, type TabelasSefaz } from './prisma-sefaz.falso';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const MAIS65 = new Date('2026-11-17T18:10:00Z'); // 15h10
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000);
const em = (d: Date) => () => d;
const fx = (nome: string) => readFileSync(join(__dirname, '../../sefaz/__tests__/fixtures', nome), 'utf8');

const NOSSO = '12345678000195';
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const K77 = '35261111222333000181550010000000771000000071';
const K880 = '35261111222333000181550010000008801000000887';
const QUEM = { id: '0b8f5c2e-1111-4000-8000-000000000001', nome: 'Ana' };

const doc = (nsu: bigint, schema: string, xml: string | null, bruto: string | null = null): DocumentoDistribuido => ({
  nsu,
  schema,
  xml,
  bruto,
});
const RES_NFE = 'resNFe_v1.01.xsd';
const RES_EVENTO = 'resEvento_v1.01.xsd';

function montar(
  o: {
    ambiente?: string;
    cnpjEmpresa?: string;
    travaOcupada?: boolean;
    certErro?: CertificadoErro;
    certCnpj?: string;
    linha?: Partial<sefaz_distribuicao> | null;
  } = {},
) {
  const { prisma, t, trava } = montarPrismaSefaz({ cnpjEmpresa: o.cnpjEmpresa, travaOcupada: o.travaOcupada });
  if (o.linha !== null) {
    t.sefaz_distribuicao.push(
      linhaCom('sefaz_distribuicao', {
        ambiente: 'producao',
        cnpj: NOSSO,
        busca_ligada: true,
        ult_nsu: 100n,
        primeira_consulta_em: min(-24 * 60),
        ultima_consulta_em: min(-120),
        proxima_consulta_em: min(-55),
        ...o.linha,
      }),
    );
  }
  const sefaz = new SefazDfeFalso();
  const certificados = {
    emUso: jest.fn(async () => {
      if (o.certErro) throw o.certErro;
      return {
        cnpj: o.certCnpj ?? NOSSO,
        validoAte: new Date('2027-11-17T00:00:00Z'),
        impressaoDigital: 'ab'.repeat(32),
      } as unknown as CertificadoEmUso;
    }),
  };
  const env: Record<string, string> = { SEFAZ_DFE_AMBIENTE: o.ambiente ?? 'producao' };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const svc = new CicloSefazService(prisma, config, certificados, sefaz);
  /** Outro processo da API no mesmo banco (ex.: depois de um reinício). */
  const outraApi = (s: SefazDfePort) => new CicloSefazService(prisma, config, certificados, s);
  return { svc, t, trava, sefaz, certificados, prisma, outraApi, config };
}

const linhaDe = (t: TabelasSefaz, cnpj = NOSSO) => t.sefaz_distribuicao.find((l) => l.ambiente === 'producao' && l.cnpj === cnpj)!;
const consultaAnterior = (resultado: string, x: Record<string, unknown> = {}) =>
  linhaCom('sefaz_consultas', {
    ciclo_id: randomUUID(),
    ambiente: 'producao',
    cnpj: NOSSO,
    origem: 'agendada',
    ult_nsu_enviado: 100n,
    iniciada_em: min(-70),
    terminada_em: min(-70),
    resultado,
    ...x,
  });

async function recusa(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    return { status: e.getStatus(), ...(e.getResponse() as { code: string; message: string }) };
  }
  throw new Error('não recusou');
}

describe('CicloSefazService', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('138 → 137 no mesmo ciclo: duas consultas, NSU adotado, reserva de 65 min, documentos e caixa', async () => {
    const { svc, t, sefaz } = montar();
    sefaz.responder(
      resposta(138, {
        ultNsu: 150n,
        maxNsu: 160n,
        documentos: [doc(149n, RES_NFE, fx('res-nfe.xml')), doc(150n, RES_EVENTO, fx('res-evento-110111.xml'))],
      }),
      resposta(137, { ultNsu: 160n, maxNsu: 160n }),
    );
    expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 2 });
    expect(sefaz.chamadas.map((c) => c.ultNsu)).toEqual([100n, 150n]);
    expect(sefaz.chamadas.every((c) => c.ambiente === 'producao' && c.cnpj === NOSSO)).toBe(true);

    expect(t.sefaz_consultas).toHaveLength(2);
    expect(t.sefaz_consultas.map((c) => [c.resultado, c.c_stat, c.ult_nsu_enviado, c.documentos])).toEqual([
      ['respondida', 138, 100n, 2],
      ['respondida', 137, 150n, 0],
    ]);
    expect(new Set(t.sefaz_consultas.map((c) => c.ciclo_id)).size).toBe(1);
    expect(t.sefaz_consultas.every((c) => c.origem === 'agendada' && c.terminada_em?.getTime() === AGORA.getTime())).toBe(true);

    const l = linhaDe(t);
    expect(l).toMatchObject({
      ult_nsu: 160n,
      max_nsu: 160n,
      proxima_consulta_em: MAIS65,
      em_andamento_desde: null,
      ultima_consulta_em: AGORA,
      falhas_seguidas: 0,
      situacao: 'ok',
      busca_ligada: true,
    });

    expect(t.sefaz_documentos.map((d) => [d.nsu, d.tipo, d.chave, d.tp_evento])).toEqual([
      [149n, 'resNFe', VETOR, null],
      [150n, 'resEvento', K77, '110111'],
    ]);
    expect(t.sefaz_documentos.every((d) => d.processado_em !== null && d.erro_processamento === null)).toBe(true);
    expect(t.notas_sefaz.map((n) => [n.chave, n.situacao_sefaz])).toEqual([
      [VETOR, 'autorizada'],
      [K77, 'cancelada'],
    ]);
    expect(t.notas_sefaz.every((n) => n.atualizada_em instanceof Date && n.cnpj_destinatario === NOSSO)).toBe(true);
    expect(t.notas_sefaz[0].resumo_id).toBe(t.sefaz_documentos[0].id);
  });

  it('10 páginas por ciclo: a 11ª fica para o próximo tique, liberada na hora', async () => {
    const { svc, t, sefaz } = montar();
    for (let i = 1; i <= 11; i++) sefaz.responder(resposta(138, { ultNsu: 100n + BigInt(i), maxNsu: 500n }));
    expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 10 });
    expect(sefaz.chamadas).toHaveLength(10);
    expect(linhaDe(t)).toMatchObject({ ult_nsu: 110n, proxima_consulta_em: AGORA, em_andamento_desde: null });
  });

  it('reserva antes da rede: quando a pergunta sai, a próxima já está em +65 min; se a API cai ali, a reserva segura a próxima', async () => {
    const { svc, t, sefaz, outraApi } = montar();
    let naRede: (estado: unknown) => void = () => undefined;
    const estadoNaRede = new Promise((r) => (naRede = r));
    sefaz.antesDeResponder = () => {
      const l = linhaDe(t);
      naRede({ proxima: l.proxima_consulta_em, emAndamento: l.em_andamento_desde, consultas: t.sefaz_consultas.map((c) => c.resultado) });
      return new Promise<void>(() => undefined); // a resposta nunca chega: o processo morreu com a pergunta no ar
    };
    void svc.ciclo('agendada', null, em(AGORA));
    expect(await estadoNaRede).toEqual({ proxima: MAIS65, emAndamento: AGORA, consultas: [null] });

    // a API volta (outro processo, mesmo banco): passados os 2 min do "em andamento", a reserva ainda segura
    const depois = new SefazDfeFalso();
    const api2 = outraApi(depois);
    expect(await api2.ciclo('agendada', null, em(min(3)))).toEqual({ fim: 'aguarde', paginas: 0 });
    expect((await recusa(api2.buscarAgora(QUEM, em(min(30))))).code).toBe('SEFAZ_AGUARDE');
    expect(depois.chamadas).toHaveLength(0);

    // vencida a reserva, sai de novo com o MESMO NSU, e a pergunta perdida vira `interrompida`
    depois.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
    expect(await api2.ciclo('agendada', null, em(min(65)))).toEqual({ fim: 'feito', paginas: 1 });
    expect(depois.chamadas.map((c) => c.ultNsu)).toEqual([100n]);
    expect(t.sefaz_consultas.map((c) => c.resultado)).toEqual(['interrompida', 'respondida']);
  });

  it('T2 que falha desfaz tudo: NSU, documentos e fechamento voltam, e a reserva da T1 continua valendo', async () => {
    const { svc, t, sefaz, prisma } = montar();
    // a gravação da linha no T2 acontece e logo depois a transação cai (a 1ª chamada é a reserva da T1, a 2ª é a do T2)
    const linhas = prisma.sefaz_distribuicao as unknown as { update: (a: unknown) => Promise<unknown> };
    const original = linhas.update;
    let vezes = 0;
    const espiao = jest.spyOn(linhas, 'update').mockImplementation(async (a) => {
      const r = await original(a);
      if (++vezes === 2) throw new Error('queda simulada no meio do T2');
      return r;
    });
    sefaz.responder(
      resposta(138, {
        ultNsu: 150n,
        maxNsu: 150n,
        documentos: [doc(149n, RES_NFE, fx('res-nfe.xml')), doc(150n, RES_EVENTO, fx('res-evento-110111.xml'))],
      }),
    );
    await expect(svc.ciclo('agendada', null, em(AGORA))).rejects.toThrow('queda simulada no meio do T2');
    expect(vezes).toBe(2); // o T2 chegou a gravar a linha (ult_nsu 150) antes de cair

    expect(t.sefaz_documentos).toHaveLength(0);
    expect(t.notas_sefaz).toHaveLength(0);
    expect(t.sefaz_consultas).toHaveLength(1);
    expect(t.sefaz_consultas[0]).toMatchObject({ resultado: null, terminada_em: null, c_stat: null, documentos: null });
    expect(linhaDe(t)).toMatchObject({
      ult_nsu: 100n,
      max_nsu: null,
      proxima_consulta_em: MAIS65,
      em_andamento_desde: AGORA,
      ultima_consulta_em: min(-120),
      falhas_seguidas: 0,
    });

    // não libera em 2 min: ocupada, depois aguarde, sem chamada
    espiao.mockRestore();
    expect((await svc.ciclo('agendada', null, em(min(1)))).fim).toBe('ocupada');
    expect((await svc.ciclo('agendada', null, em(min(3)))).fim).toBe('aguarde');
    expect(sefaz.chamadas).toHaveLength(1);

    // em +65 min sai com o NSU antigo (os documentos voltam) e a consulta caída vira `interrompida`
    sefaz.responder(
      resposta(138, {
        ultNsu: 150n,
        maxNsu: 150n,
        documentos: [doc(149n, RES_NFE, fx('res-nfe.xml')), doc(150n, RES_EVENTO, fx('res-evento-110111.xml'))],
      }),
    );
    expect(await svc.ciclo('agendada', null, em(MAIS65))).toEqual({ fim: 'feito', paginas: 1 });
    expect(sefaz.chamadas.map((c) => c.ultNsu)).toEqual([100n, 100n]);
    expect(t.sefaz_consultas.map((c) => c.resultado)).toEqual(['interrompida', 'respondida']);
    expect(t.sefaz_documentos).toHaveLength(2);
    expect(linhaDe(t).ult_nsu).toBe(150n);
  });

  describe('falha ao gravar a resposta (T2) repetida', () => {
    const recusada = () => new Prisma.PrismaClientKnownRequestError('valor recusado pelo banco', { code: 'P2000', clientVersion: 'falso' });
    const pagina = () =>
      resposta(138, {
        ultNsu: 150n,
        maxNsu: 150n,
        documentos: [doc(149n, RES_NFE, fx('res-nfe.xml')), doc(150n, RES_EVENTO, fx('res-evento-110111.xml'))],
      });

    it('3 vezes seguidas com o mesmo NSU: as 2 primeiras respeitam os 65 min, a 3ª desliga a busca com a frase', async () => {
      const { svc, t, sefaz, prisma } = montar();
      jest.spyOn(prisma.sefaz_documentos, 'createMany').mockRejectedValue(recusada()); // a gravação sempre falha
      sefaz.responder(pagina(), pagina(), pagina(), pagina());

      // 1ª: a T2 é desfeita, a reserva de 65 min da T1 segura; nada para
      await expect(svc.ciclo('agendada', null, em(AGORA))).rejects.toThrow('valor recusado pelo banco');
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', mensagem: null, ult_nsu: 100n, proxima_consulta_em: MAIS65 });
      expect((await svc.ciclo('agendada', null, em(min(64)))).fim).toBe('aguarde');

      // 2ª, só depois dos 65 min
      await expect(svc.ciclo('agendada', null, em(min(65)))).rejects.toThrow('valor recusado pelo banco');
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', mensagem: null, proxima_consulta_em: min(130) });
      expect((await svc.ciclo('agendada', null, em(min(129)))).fim).toBe('aguarde');
      expect(sefaz.chamadas).toHaveLength(2);
      expect(t.sefaz_distribuicao_historico).toHaveLength(0);

      // 3ª: a busca para (situação de parada, desligada, histórico), sem mexer no NSU nem na próxima consulta
      await expect(svc.ciclo('agendada', null, em(min(130)))).rejects.toThrow('valor recusado pelo banco');
      expect(sefaz.chamadas.map((c) => c.ultNsu)).toEqual([100n, 100n, 100n]);
      expect(linhaDe(t)).toMatchObject({
        busca_ligada: false,
        situacao: 'parada_configuracao',
        mensagem: 'A busca parou: não consegui guardar as notas que a SEFAZ mandou. Avise o suporte antes de ligar de novo.',
        ult_nsu: 100n,
        proxima_consulta_em: min(195),
        bloqueado_ate: null,
        em_andamento_desde: null,
      });
      expect(t.sefaz_consultas.map((c) => [c.resultado, c.erro_code, c.ult_nsu_enviado])).toEqual([
        ['interrompida', 'GRAVACAO_FALHOU', 100n],
        ['interrompida', 'GRAVACAO_FALHOU', 100n],
        ['interrompida', 'GRAVACAO_FALHOU', 100n],
      ]);
      expect(t.sefaz_consultas[2].terminada_em).toEqual(min(130));
      expect(t.sefaz_distribuicao_historico).toHaveLength(1);
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({
        evento: 'parada_automatica',
        situacao: 'parada_configuracao',
        c_stat: 138,
        mensagem: FRASE.gravacaoFalhou,
        feito_por: null,
      });
      expect(t.sefaz_documentos).toHaveLength(0);

      // parada: nenhuma consulta nova até o admin ligar de novo
      expect((await svc.ciclo('agendada', null, em(min(300)))).fim).toBe('nao_ligada');
      expect(sefaz.chamadas).toHaveLength(3);
    });

    it('só conta falhas de GRAVAÇÃO imediatamente antes, com o MESMO NSU e depois do último "Ligar"', async () => {
      // `falhou` = interrompida por falha ao gravar (marca GRAVACAO_FALHOU); a interrompida sem marca é queda da API e não conta
      const falhou = (x: Record<string, unknown> = {}) => consultaAnterior('interrompida', { erro_code: 'GRAVACAO_FALHOU', ...x });
      const ligada = (feito_em: Date) =>
        linhaCom('sefaz_distribuicao_historico', { ambiente: 'producao', cnpj: NOSSO, evento: 'ligada', situacao: 'ok', feito_em });
      const casos: { anteriores: ReturnType<typeof consultaAnterior>[]; historico?: ReturnType<typeof ligada>[]; para: boolean }[] = [
        { anteriores: [falhou({ iniciada_em: min(-140) }), falhou()], para: true },
        { anteriores: [falhou({ iniciada_em: min(-140) }), falhou()], historico: [ligada(min(-200))], para: true },
        { anteriores: [falhou({ iniciada_em: min(-140), ult_nsu_enviado: 90n }), falhou()], para: false },
        {
          anteriores: [
            falhou({ iniciada_em: min(-210) }),
            consultaAnterior('respondida', { iniciada_em: min(-140), c_stat: 137 }),
            falhou(),
          ],
          para: false,
        },
        { anteriores: [consultaAnterior('sem_resposta', { iniciada_em: min(-140) }), falhou()], para: false },
        // queda da API no meio da consulta (interrompida SEM a marca): não é falha de gravação
        { anteriores: [consultaAnterior('interrompida', { iniciada_em: min(-140) }), consultaAnterior('interrompida')], para: false },
        { anteriores: [falhou({ iniciada_em: min(-140) }), consultaAnterior('interrompida')], para: false },
        // religar zera: as falhas de antes do último "Ligar" não contam
        { anteriores: [falhou({ iniciada_em: min(-140) }), falhou()], historico: [ligada(min(-100))], para: false },
      ];
      for (const { anteriores, historico, para } of casos) {
        const { svc, t, sefaz, prisma } = montar();
        t.sefaz_consultas.push(...anteriores);
        t.sefaz_distribuicao_historico.push(...(historico ?? []));
        jest.spyOn(prisma.sefaz_documentos, 'createMany').mockRejectedValue(recusada());
        sefaz.responder(pagina());
        await expect(svc.ciclo('agendada', null, em(AGORA))).rejects.toThrow('valor recusado pelo banco');
        expect(linhaDe(t)).toMatchObject(
          para
            ? { busca_ligada: false, situacao: 'parada_configuracao' }
            : { busca_ligada: true, situacao: 'ok', proxima_consulta_em: MAIS65 },
        );
        expect(t.sefaz_distribuicao_historico.filter((h) => h.evento === 'parada_automatica')).toHaveLength(para ? 1 : 0);
      }
    });

    it('religar ("Ligar a busca") zera a contagem: 3 falhas param; religada, a próxima falha não para; mais 2, para de novo', async () => {
      const { svc, t, sefaz, prisma, certificados, config } = montar();
      const notas = { notasLancadas: jest.fn(async () => []) } as unknown as NotasService;
      const respostas = new RespostasSefazService(prisma, config, svc, certificados, new SefazEventosFalso(), notas);
      const caixa = new CaixaSefazService(prisma, svc, notas, certificados, respostas);
      jest.spyOn(prisma.sefaz_documentos, 'createMany').mockRejectedValue(recusada());
      sefaz.responder(...Array.from({ length: 6 }, pagina));
      const falha = (m: number) => expect(svc.ciclo('agendada', null, em(min(m)))).rejects.toThrow('valor recusado pelo banco');

      for (const m of [0, 65, 130]) await falha(m);
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_configuracao', mensagem: FRASE.gravacaoFalhou });

      await caixa.configurar(true, QUEM, min(140)); // o admin religa
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', mensagem: null, proxima_consulta_em: min(195) });

      await falha(195); // conta 1
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', proxima_consulta_em: min(260) });
      await falha(260); // conta 2
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', proxima_consulta_em: min(325) });
      await falha(325); // 3ª depois de religar: para de novo
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_configuracao', mensagem: FRASE.gravacaoFalhou });
      expect(t.sefaz_distribuicao_historico.map((h) => h.evento)).toEqual(['parada_automatica', 'ligada', 'parada_automatica']);
      expect(sefaz.chamadas).toHaveLength(6);
      expect(sefaz.chamadas.every((c) => c.ultNsu === 100n)).toBe(true);
    });
  });

  it('queda entre as transações: ocupada, depois aguarde, e com 65 min a consulta aberta vira interrompida', async () => {
    const { svc, t, sefaz } = montar({ linha: { em_andamento_desde: min(-1), proxima_consulta_em: min(64) } });
    const aberta = linhaCom('sefaz_consultas', {
      ciclo_id: randomUUID(),
      ambiente: 'producao',
      cnpj: NOSSO,
      origem: 'agendada',
      ult_nsu_enviado: 100n,
      iniciada_em: min(-1),
    });
    t.sefaz_consultas.push(aberta);
    sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));

    expect((await svc.ciclo('agendada', null, em(AGORA))).fim).toBe('ocupada');
    expect(sefaz.chamadas).toHaveLength(0);
    expect((await svc.ciclo('agendada', null, em(min(30)))).fim).toBe('aguarde');
    expect(sefaz.chamadas).toHaveLength(0);
    expect(await svc.ciclo('agendada', null, em(min(65)))).toEqual({ fim: 'feito', paginas: 1 });
    expect(sefaz.chamadas).toHaveLength(1);

    const antiga = t.sefaz_consultas.find((c) => c.id === aberta.id)!;
    expect(antiga).toMatchObject({ resultado: 'interrompida', terminada_em: min(65) });
    expect(t.sefaz_consultas.filter((c) => c.resultado === null)).toHaveLength(0);
  });

  describe('656: esperar, bloquear duas vezes, resposta perdida e outro sistema', () => {
    it('656 sem NSU maior grava o bloqueio e a frase, sem desligar', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(resposta(656, { ultNsu: 100n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({
        bloqueado_ate: MAIS65,
        proxima_consulta_em: MAIS65,
        busca_ligada: true,
        situacao: 'ok',
        mensagem: FRASE.esperar('15h10'),
      });
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'respondida', c_stat: 656 });
      expect(linhaDe(t).ultima_consulta_em).toEqual(min(-120)); // 656 não é "última busca"
    });

    it('o 2º 656 em 24 h desliga a busca e registra a parada automática', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(resposta(656, { ultNsu: 100n }), resposta(656, { ultNsu: 100n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect((await svc.ciclo('agendada', null, em(min(65)))).fim).toBe('feito');
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_656', mensagem: FRASE.bloqueouDuasVezes });
      expect(t.sefaz_distribuicao_historico).toHaveLength(1);
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({
        ambiente: 'producao',
        cnpj: NOSSO,
        evento: 'parada_automatica',
        situacao: 'parada_656',
        c_stat: 656,
        feito_por: null,
        feito_por_nome: null,
      });
    });

    it('resposta perdida (anterior sem resposta): adota o NSU e grava a lacuna, sem desligar', async () => {
      const { svc, t, sefaz } = montar();
      t.sefaz_consultas.push(consultaAnterior('sem_resposta'));
      sefaz.responder(resposta(656, { ultNsu: 130n }));
      await svc.ciclo('agendada', null, em(AGORA));
      const nova = t.sefaz_consultas.find((c) => c.iniciada_em.getTime() === AGORA.getTime())!;
      expect(t.sefaz_lacunas).toHaveLength(1);
      expect(t.sefaz_lacunas[0]).toMatchObject({
        ambiente: 'producao',
        cnpj: NOSSO,
        nsu_de: 101n,
        nsu_ate: 130n,
        causa: 'resposta_perdida',
        consulta_id: nova.id,
      });
      expect(linhaDe(t)).toMatchObject({ busca_ligada: true, situacao: 'ok', ult_nsu: 130n, bloqueado_ate: MAIS65 });
      expect(t.sefaz_distribuicao_historico).toHaveLength(0);
    });

    it('2º 656 em 24 h logo depois de resposta perdida: grava a lacuna e desliga (parada_656)', async () => {
      const { svc, t, sefaz } = montar();
      t.sefaz_consultas.push(
        consultaAnterior('respondida', { c_stat: 656, iniciada_em: min(-140), terminada_em: min(-140) }),
        consultaAnterior('sem_resposta'),
      );
      sefaz.responder(resposta(656, { ultNsu: 130n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_656', ult_nsu: 130n, bloqueado_ate: MAIS65 });
      expect(t.sefaz_lacunas.map((l) => [l.nsu_de, l.nsu_ate, l.causa])).toEqual([[101n, 130n, 'resposta_perdida']]);
      expect(t.sefaz_distribuicao_historico).toHaveLength(1);
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({ evento: 'parada_automatica', situacao: 'parada_656', c_stat: 656 });
    });

    it('a mesma lacuna não é gravada duas vezes', async () => {
      const { svc, t, sefaz } = montar();
      const anterior = consultaAnterior('interrompida');
      t.sefaz_consultas.push(anterior);
      t.sefaz_lacunas.push(
        linhaCom('sefaz_lacunas', {
          ambiente: 'producao',
          cnpj: NOSSO,
          nsu_de: 101n,
          nsu_ate: 130n,
          causa: 'resposta_perdida',
          consulta_id: anterior.id,
        }),
      );
      sefaz.responder(resposta(656, { ultNsu: 130n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(t.sefaz_lacunas).toHaveLength(1);
      expect(linhaDe(t).ult_nsu).toBe(130n);
    });

    it('D2 (anterior respondida): parada_conflito com a lacuna outro_sistema', async () => {
      const { svc, t, sefaz } = montar();
      t.sefaz_consultas.push(consultaAnterior('respondida', { c_stat: 137 }));
      sefaz.responder(resposta(656, { ultNsu: 130n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_conflito', mensagem: FRASE.conflito, ult_nsu: 130n });
      expect(t.sefaz_lacunas.map((l) => [l.nsu_de, l.nsu_ate, l.causa])).toEqual([[101n, 130n, 'outro_sistema']]);
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({ evento: 'parada_automatica', situacao: 'parada_conflito', c_stat: 656 });
    });

    it('D2 na 1ª consulta: parada_conflito sem lacuna', async () => {
      const { svc, t, sefaz } = montar({
        linha: { ult_nsu: 0n, ultima_consulta_em: null, primeira_consulta_em: null, proxima_consulta_em: null },
      });
      sefaz.responder(resposta(656, { ultNsu: 130n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({
        busca_ligada: false,
        situacao: 'parada_conflito',
        ult_nsu: 130n,
        primeira_consulta_em: null, // 656 não é a 1ª busca feita (só 137/138)
        ultima_consulta_em: null,
      });
      expect(t.sefaz_lacunas).toHaveLength(0);
    });
  });

  it('busca desligada e CNPJ trocado durante a consulta: grava na linha da própria consulta e não busca a página seguinte', async () => {
    const { svc, t, sefaz } = montar();
    sefaz.antesDeResponder = async () => {
      linhaDe(t).busca_ligada = false;
      t.configuracoes.cnpj = '11222333000181';
    };
    sefaz.responder(resposta(138, { ultNsu: 150n, maxNsu: 300n }), resposta(137, { ultNsu: 300n, maxNsu: 300n }));
    expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 1 });
    expect(sefaz.chamadas).toHaveLength(1);
    expect(linhaDe(t)).toMatchObject({ ult_nsu: 150n, max_nsu: 300n, busca_ligada: false, em_andamento_desde: null });
    expect(t.sefaz_consultas).toHaveLength(1);
    expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'respondida', c_stat: 138, cnpj: NOSSO });
    expect(t.sefaz_distribuicao).toHaveLength(1); // nenhuma linha para o CNPJ novo
  });

  it('só o CNPJ trocado no meio (busca ainda ligada na linha antiga): a página seguinte não sai', async () => {
    const { svc, t, sefaz } = montar();
    sefaz.antesDeResponder = async () => {
      t.configuracoes.cnpj = '11222333000181';
    };
    sefaz.responder(resposta(138, { ultNsu: 150n, maxNsu: 300n }), resposta(137, { ultNsu: 300n, maxNsu: 300n }));
    expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 1 });
    expect(sefaz.chamadas).toHaveLength(1);
    expect(linhaDe(t)).toMatchObject({ ult_nsu: 150n, busca_ligada: true, proxima_consulta_em: AGORA });
  });

  describe('buscar agora', () => {
    it('trava presa noutra conexão: 409 SEFAZ_OCUPADA sem chamada', async () => {
      const { svc, t, sefaz } = montar({ travaOcupada: true });
      expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
        status: 409,
        code: 'SEFAZ_OCUPADA',
        message: 'Já existe uma busca em andamento.',
      });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(t.sefaz_consultas).toHaveLength(0);
    });

    it('próxima às 18:10Z: 409 SEFAZ_AGUARDE com a hora de Brasília', async () => {
      const { svc, sefaz } = montar({ linha: { proxima_consulta_em: MAIS65 } });
      expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
        status: 409,
        code: 'SEFAZ_AGUARDE',
        message: 'A SEFAZ só permite nova busca a partir de 15h10.',
      });
      expect(sefaz.chamadas).toHaveLength(0);
    });

    it('bloqueio mais tarde que a próxima: a hora é a do bloqueio', async () => {
      const { svc } = montar({ linha: { proxima_consulta_em: min(10), bloqueado_ate: MAIS65 } });
      expect((await recusa(svc.buscarAgora(QUEM, em(AGORA)))).message).toBe('A SEFAZ só permite nova busca a partir de 15h10.');
    });

    it('caminho feliz: reserva antes de devolver e o ciclo termina sozinho', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      const r = await svc.buscarAgora(QUEM, em(AGORA));
      expect(r.iniciada).toBe(true);
      expect(t.sefaz_consultas).toHaveLength(1); // a transação 1 já rodou
      expect(t.sefaz_consultas[0]).toMatchObject({
        origem: 'botao',
        iniciada_por: QUEM.id,
        iniciada_por_nome: 'Ana',
        ult_nsu_enviado: 100n,
      });
      expect(await r.ciclo).toEqual({ fim: 'feito', paginas: 1 });
      expect(linhaDe(t)).toMatchObject({ proxima_consulta_em: MAIS65, em_andamento_desde: null });
    });

    it('logo depois de uma busca, desligar e ligar de novo não antecipa: SEFAZ_AGUARDE', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      await svc.ciclo('agendada', null, em(AGORA));
      linhaDe(t).busca_ligada = false;
      linhaDe(t).busca_ligada = true;
      expect((await recusa(svc.buscarAgora(QUEM, em(min(1))))).code).toBe('SEFAZ_AGUARDE');
      expect(sefaz.chamadas).toHaveLength(1);
    });

    it('toque duplo: o 2º "Buscar agora" (em andamento há menos de 2 min) recebe 409 SEFAZ_OCUPADA sem rede', async () => {
      const { svc, sefaz } = montar();
      let soltar: () => void = () => undefined;
      sefaz.antesDeResponder = () => new Promise<void>((r) => (soltar = r)); // a 1ª consulta fica no ar
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      const primeiro = await svc.buscarAgora(QUEM, em(AGORA));
      expect(await recusa(svc.buscarAgora(QUEM, em(min(1))))).toEqual({
        status: 409,
        code: 'SEFAZ_OCUPADA',
        message: 'Já existe uma busca em andamento.',
      });
      expect(sefaz.chamadas).toHaveLength(1);
      soltar();
      expect(await primeiro.ciclo).toEqual({ fim: 'feito', paginas: 1 });
    });

    it('o ciclo em segundo plano nunca rejeita (falha do banco na transação 2)', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.antesDeResponder = async () => {
        t.sefaz_documentos = null as unknown as TabelasSefaz['sefaz_documentos']; // derruba a gravação dos documentos
      };
      sefaz.responder(resposta(138, { ultNsu: 101n, maxNsu: 101n, documentos: [doc(101n, RES_NFE, fx('res-nfe.xml'))] }));
      const r = await svc.buscarAgora(QUEM, em(AGORA));
      await expect(r.ciclo).resolves.toMatchObject({ paginas: 1 });
      expect(logs.some((l) => l.includes('TypeError'))).toBe(true);
    });
  });

  describe('duas ao mesmo tempo: só uma chama a SEFAZ', () => {
    it('dois ciclos', async () => {
      const { svc, sefaz } = montar();
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      const r = await Promise.all([svc.ciclo('agendada', null, em(AGORA)), svc.ciclo('agendada', null, em(AGORA))]);
      expect(r.map((x) => x.fim).sort()).toEqual(['feito', 'ocupada']);
      expect(sefaz.chamadas).toHaveLength(1);
    });

    it('o botão e o tique', async () => {
      const { svc, sefaz } = montar();
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      const [botao, tique] = await Promise.allSettled([svc.buscarAgora(QUEM, em(AGORA)), svc.ciclo('agendada', null, em(AGORA))]);
      const ok = [botao.status === 'fulfilled', tique.status === 'fulfilled' && tique.value.fim === 'feito'];
      expect(ok.filter(Boolean)).toHaveLength(1);
      if (botao.status === 'rejected') expect((botao.reason as HttpException).getResponse()).toMatchObject({ code: 'SEFAZ_OCUPADA' });
      if (tique.status === 'fulfilled' && tique.value.fim !== 'feito') expect(tique.value.fim).toBe('ocupada');
      if (botao.status === 'fulfilled') await botao.value.ciclo;
      expect(sefaz.chamadas).toHaveLength(1);
    });
  });

  describe('nenhuma chamada quando não pode', () => {
    it('ambiente desligado (ou valor estranho): fim desligado e 503', async () => {
      for (const ambiente of ['desligado', '', 'qualquer']) {
        const { svc, sefaz, certificados, t } = montar({ ambiente });
        expect(svc.ambiente()).toBe('desligado');
        expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'desligado', paginas: 0 });
        expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
          status: 503,
          code: 'SEFAZ_DESLIGADA',
          message: 'A busca de notas na SEFAZ não está ativada neste servidor.',
        });
        expect(sefaz.chamadas).toHaveLength(0);
        expect(certificados.emUso).not.toHaveBeenCalled();
        expect(t.sefaz_consultas).toHaveLength(0);
      }
    });

    it('busca desligada: nao_ligada e 409 SEFAZ_BUSCA_DESLIGADA', async () => {
      const { svc, sefaz, certificados } = montar({ linha: { busca_ligada: false } });
      expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'nao_ligada', paginas: 0 });
      expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
        status: 409,
        code: 'SEFAZ_BUSCA_DESLIGADA',
        message: 'A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ.',
      });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(certificados.emUso).not.toHaveBeenCalled();
    });

    it('sem linha para o (ambiente, CNPJ) atual também é nao_ligada', async () => {
      const { svc, sefaz } = montar({ linha: null });
      expect((await svc.ciclo('agendada', null, em(AGORA))).fim).toBe('nao_ligada');
      expect(sefaz.chamadas).toHaveLength(0);
    });

    it('empresa sem CNPJ válido: sem_cnpj, sem chamar emUso, e 422 SEFAZ_SEM_CNPJ', async () => {
      for (const cnpjEmpresa of ['00000000000000', '', '12.345.678/0001-90']) {
        const { svc, sefaz, certificados } = montar({ cnpjEmpresa });
        expect(await svc.cnpjDaEmpresa()).toBeNull();
        expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'sem_cnpj', paginas: 0 });
        expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
          status: 422,
          code: 'SEFAZ_SEM_CNPJ',
          message: 'Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página.',
        });
        expect(certificados.emUso).not.toHaveBeenCalled();
        expect(sefaz.chamadas).toHaveLength(0);
      }
    });

    it('CNPJ da empresa com máscara é normalizado', async () => {
      const { svc } = montar({ cnpjEmpresa: '12.345.678/0001-95' });
      expect(await svc.cnpjDaEmpresa()).toBe(NOSSO);
    });

    it('certificado ausente: fim certificado e o erro da porta vira HttpException', async () => {
      const certErro = new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO');
      const { svc, sefaz, t } = montar({ certErro });
      expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'certificado', paginas: 0 });
      expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
        status: 503,
        code: 'CERTIFICADO_NAO_CADASTRADO',
        message: MSG_USO.naoCadastrado,
      });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(t.sefaz_consultas).toHaveLength(0);
    });

    it('certificado de outra raiz: fim certificado e 422 SEFAZ_CERTIFICADO_OUTRA_EMPRESA', async () => {
      const { svc, sefaz } = montar({ certCnpj: '99888777000100' });
      expect((await svc.ciclo('agendada', null, em(AGORA))).fim).toBe('certificado');
      expect(await recusa(svc.buscarAgora(QUEM, em(AGORA)))).toEqual({
        status: 422,
        code: 'SEFAZ_CERTIFICADO_OUTRA_EMPRESA',
        message:
          'O certificado digital é de outra empresa, e a SEFAZ recusaria a busca. Confira o CNPJ da empresa ou envie o certificado certo.',
      });
      expect(sefaz.chamadas).toHaveLength(0);
    });

    it('certificado de filial (mesma raiz) serve', async () => {
      const { svc, sefaz } = montar({ certCnpj: '12345678000276' });
      sefaz.responder(resposta(137, { ultNsu: 100n, maxNsu: 100n }));
      expect((await svc.ciclo('agendada', null, em(AGORA))).fim).toBe('feito');
    });
  });

  describe('falhas da rede', () => {
    it('falha antes de enviar não espera os 65 min', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(sefazErro('SEFAZ_TLS', false));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({
        proxima_consulta_em: min(15),
        falhas_seguidas: 1,
        em_andamento_desde: null,
        ultima_consulta_em: min(-120),
        mensagem: FRASE.semContato('14h20'),
      });
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'falha_antes_de_enviar', erro_code: 'SEFAZ_TLS', c_stat: null });
    });

    it('1ª tentativa que falha no TLS não grava primeira_consulta_em; a 1ª respondida (137) grava, e as seguintes não mudam', async () => {
      const { svc, t, sefaz } = montar({
        linha: { ult_nsu: 0n, ultima_consulta_em: null, primeira_consulta_em: null, proxima_consulta_em: null },
      });
      sefaz.responder(sefazErro('SEFAZ_TLS', false), resposta(137, { ultNsu: 0n, maxNsu: 0n }), resposta(137, { ultNsu: 0n, maxNsu: 0n }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({ primeira_consulta_em: null, ultima_consulta_em: null, proxima_consulta_em: min(15) });
      await svc.ciclo('agendada', null, em(min(15)));
      expect(linhaDe(t)).toMatchObject({ primeira_consulta_em: min(15), ultima_consulta_em: min(15) });
      await svc.ciclo('agendada', null, em(min(80)));
      expect(linhaDe(t)).toMatchObject({ primeira_consulta_em: min(15), ultima_consulta_em: min(80) });
    });

    it('a causa técnica do TLS vai só para a linha de log da consulta (nem banco nem agenda)', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(sefazErro('SEFAZ_TLS', false, undefined, 'CERT_HAS_EXPIRED'));
      await svc.ciclo('agendada', null, em(AGORA));
      const linha = logs.find((l) => l.includes('sefaz.distribuicao'))!;
      expect(JSON.parse(linha.slice(linha.indexOf('{')))).toMatchObject({ erro_code: 'SEFAZ_TLS', causa: 'CERT_HAS_EXPIRED' });
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'falha_antes_de_enviar', erro_code: 'SEFAZ_TLS', x_motivo: null });
      expect(JSON.stringify(t.sefaz_consultas[0], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('CERT_HAS');
      expect(linhaDe(t).mensagem).toBe(FRASE.semContato('14h20'));
    });

    it('NUL no envelope (adaptador de verdade, transporte falso): a consulta grava normalmente, sem o NUL', async () => {
      const envelope = retornoSoap({ cStat: 137, xMotivo: 'Nenhum documento&#0; localizado', ultNsu: 100n, maxNsu: 100n }).replace(
        '<dhResp>2026',
        '<dhResp>&#0;2026',
      );
      const { t, outraApi } = montar();
      const svc = outraApi(new SefazDfeAdapter({ ancoras: [] } as unknown as CadeiaIcp, async () => envelope));
      expect(await svc.ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 1 });
      expect(t.sefaz_consultas[0]).toMatchObject({
        resultado: 'respondida',
        c_stat: 137,
        x_motivo: 'Nenhum documento localizado',
        dh_resp: '2026-11-17T09:00:00-03:00',
      });
      expect(linhaDe(t)).toMatchObject({ ult_nsu: 100n, ultima_consulta_em: AGORA, proxima_consulta_em: MAIS65 });
    });

    it('HTTP 500 com SOAP Fault VersionMismatch (HTTPS local, adaptador e transporte de verdade): o registro guarda o código e o passo', async () => {
      // Só servidor HTTPS LOCAL com os certificados fictícios do teste do transporte; a URL da SEFAZ que o adaptador passa é TROCADA aqui.
      const tlsFx = (n: string) => readFileSync(join(__dirname, '../../sefaz/__tests__/fixtures/tls', n), 'utf8');
      const acTeste = tlsFx('ac-teste.pem');
      const cliente = {
        chavePrivada: createPrivateKey(tlsFx('cliente.key')),
        certificado: new X509Certificate(tlsFx('cliente.pem')),
        cadeia: [],
      } as unknown as CertificadoEmUso;
      const pedidos: string[] = [];
      const servidor = https.createServer(
        { key: tlsFx('servidor.key'), cert: tlsFx('servidor.pem'), ca: [acTeste], requestCert: true, rejectUnauthorized: true },
        (req, res) => {
          pedidos.push(String(req.headers['content-type']));
          req.resume();
          req.on('end', () =>
            res.writeHead(500, { 'Content-Type': 'application/soap+xml; charset=utf-8' }).end(faultSoap12('soap:VersionMismatch')),
          );
        },
      );
      await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
      const local = `https://127.0.0.1:${(servidor.address() as AddressInfo).port}/ws`;
      const urlsPedidas: string[] = [];
      try {
        const { t, outraApi } = montar();
        const adaptador = new SefazDfeAdapter({ ancoras: [] } as unknown as CadeiaIcp, (c) => {
          urlsPedidas.push(c.url);
          return chamarSoap12({ ...c, url: local, certificado: cliente, confianca: [acTeste], tempoLimiteMs: 5_000 });
        });
        expect(await outraApi(adaptador).ciclo('agendada', null, em(AGORA))).toEqual({ fim: 'feito', paginas: 1 });

        expect(urlsPedidas).toEqual([URL_DISTRIBUICAO.producao]); // o que o adaptador pediu; a chamada foi para o servidor local
        expect(pedidos).toHaveLength(1);
        expect(t.sefaz_consultas[0]).toMatchObject({
          resultado: 'respondida',
          erro_code: 'SEFAZ_HTTP',
          x_motivo: 'HTTP 500 · passo http · Fault VersionMismatch',
          c_stat: null,
        });
        // a agenda não muda: 500 = fora do ar, +65 min
        expect(linhaDe(t)).toMatchObject({ proxima_consulta_em: MAIS65, mensagem: FRASE.foraDoAr('15h10'), busca_ligada: true });
        const linha = logs.find((l) => l.includes('sefaz.distribuicao'))!;
        expect(JSON.parse(linha.slice(linha.indexOf('{')))).toMatchObject({ http_status: 500, passo: 'http', fault: 'VersionMismatch' });
        const tudo = JSON.stringify([t.sefaz_consultas, t.sefaz_distribuicao], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
        for (const texto of [tudo, ...logs]) expect(texto).not.toContain(SENTINELA_FAULT);
      } finally {
        servidor.closeAllConnections();
        await new Promise<void>((ok) => servidor.close(() => ok()));
      }
    });

    it('resposta ilegível: o registro guarda o passo e o Fault (rótulos), a agenda segue a de sem resposta', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(sefazErro('SEFAZ_RESPOSTA_INVALIDA', true, undefined, undefined, { passo: 'soap', fault: 'Sender' }));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(t.sefaz_consultas[0]).toMatchObject({
        resultado: 'sem_resposta',
        erro_code: 'SEFAZ_RESPOSTA_INVALIDA',
        x_motivo: 'passo soap · Fault Sender',
      });
      expect(linhaDe(t)).toMatchObject({ proxima_consulta_em: MAIS65, falhas_seguidas: 1 });
    });

    it('enviado sem resposta mantém a reserva de 65 min', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.responder(sefazErro('SEFAZ_TEMPO', true));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({ proxima_consulta_em: MAIS65, falhas_seguidas: 1, ultima_consulta_em: min(-120), ult_nsu: 100n });
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_TEMPO' });
    });

    it('erro que não é SefazErro conta como resposta inválida já enviada', async () => {
      const { svc, t, sefaz } = montar();
      sefaz.antesDeResponder = async () => {
        throw new Error('qualquer coisa <resNFe>');
      };
      await svc.ciclo('agendada', null, em(AGORA));
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_RESPOSTA_INVALIDA' });
      expect(linhaDe(t).proxima_consulta_em).toEqual(MAIS65);
    });

    it('na 3ª sem resposta seguida a busca para', async () => {
      const { svc, t, sefaz } = montar({ linha: { falhas_seguidas: 2 } });
      t.sefaz_consultas.push(
        consultaAnterior('sem_resposta', { iniciada_em: min(-140) }),
        consultaAnterior('sem_resposta', { iniciada_em: min(-70) }),
      );
      sefaz.responder(sefazErro('SEFAZ_RESPOSTA_INVALIDA', true));
      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({ busca_ligada: false, situacao: 'parada_configuracao', mensagem: FRASE.tresIlegiveis });
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({ situacao: 'parada_configuracao', c_stat: null });
    });

    it('503 e depois 138 com documentos ainda é D1', async () => {
      const { svc, t, sefaz } = montar({
        linha: { ult_nsu: 0n, ultima_consulta_em: null, primeira_consulta_em: null, proxima_consulta_em: null },
      });
      const quarenta = Array.from({ length: 40 }, (_, i) => doc(BigInt(i + 1), 'resCTe_v1.00.xsd', '<resCTe/>'));
      sefaz.responder(sefazErro('SEFAZ_HTTP', true, 503), resposta(138, { ultNsu: 40n, maxNsu: 40n, documentos: quarenta }));

      await svc.ciclo('agendada', null, em(AGORA));
      expect(linhaDe(t)).toMatchObject({
        ultima_consulta_em: null,
        primeira_consulta_em: null, // a 1ª tentativa falhou: o painel não diz "Primeira busca feita"
        proxima_consulta_em: MAIS65,
        mensagem: FRASE.foraDoAr('15h10'),
      });
      expect(t.sefaz_consultas[0]).toMatchObject({ resultado: 'respondida', erro_code: 'SEFAZ_HTTP', x_motivo: 'HTTP 503', c_stat: null });

      await svc.ciclo('agendada', null, em(MAIS65));
      expect(linhaDe(t)).toMatchObject({
        aviso: FRASE.indicioD1,
        ultima_consulta_em: MAIS65,
        ult_nsu: 40n,
        primeira_consulta_em: MAIS65, // a 1ª respondida
        situacao: 'ok',
        mensagem: null,
      });
      expect(t.sefaz_documentos).toHaveLength(40);
      expect(t.sefaz_documentos.every((d) => d.tipo === 'outro' && d.processado_em !== null)).toBe(true);
    });
  });

  it('classificação: um documento ruim não para os outros e fica para a próxima vez', async () => {
    const { svc, t, sefaz } = montar();
    sefaz.responder(
      resposta(138, {
        ultNsu: 103n,
        maxNsu: 103n,
        documentos: [
          doc(101n, RES_NFE, '<!DOCTYPE x><resNFe/>'),
          doc(102n, RES_NFE, fx('res-nfe.xml')),
          doc(103n, RES_NFE, null, 'nao-e-gzip'),
        ],
      }),
    );
    await svc.ciclo('agendada', null, em(AGORA));
    const [ruim, bom, ilegivel] = t.sefaz_documentos;
    expect(ruim).toMatchObject({ processado_em: null, chave: null });
    expect(ruim.erro_processamento).toEqual(expect.any(String));
    expect(bom).toMatchObject({ chave: VETOR, erro_processamento: null });
    expect(bom.processado_em).not.toBeNull();
    expect(ilegivel).toMatchObject({ tipo: 'ilegivel', xml: null, conteudo_bruto: 'nao-e-gzip' });
    expect(ilegivel.processado_em).not.toBeNull();
    expect(t.notas_sefaz.map((n) => n.chave)).toEqual([VETOR]);

    expect(await svc.classificarPendentes()).toBe(0);
    expect(t.sefaz_documentos[0].processado_em).toBeNull();
  });

  it('classificação: documento que o banco recusa 3 vezes sai da fila como descartado, com o motivo, e a fila anda', async () => {
    const { svc, t, prisma } = montar();
    const pendente = (nsu: bigint, schema: string, tipo: string, xml: string) =>
      linhaCom('sefaz_documentos', { ambiente: 'producao', cnpj: NOSSO, nsu, schema, tipo, xml, consulta_id: randomUUID() });
    t.sefaz_documentos.push(
      pendente(101n, RES_NFE, 'resNFe', fx('res-nfe.xml')),
      pendente(102n, RES_NFE, 'resNFe', fx('res-nfe.xml')),
      pendente(103n, 'procNFe_v4.00.xsd', 'procNFe', fx('proc-nfe.xml')),
    );
    const criar = prisma.notas_sefaz.create.bind(prisma.notas_sefaz);
    const recusa = jest.spyOn(prisma.notas_sefaz, 'create').mockImplementation(((a: { data: { chave: string } }) => {
      if (a.data.chave === VETOR) {
        throw new Prisma.PrismaClientKnownRequestError('valor grande demais', { code: 'P2000', clientVersion: 'falso' });
      }
      return criar(a as never);
    }) as never);
    const doc = (nsu: bigint) => t.sefaz_documentos.find((d) => d.nsu === nsu)!;
    const avisos = () => logs.filter((l) => l.includes('sefaz.classificacao'));

    // com 2 por vez, os dois presos ocupam a vez inteira: 1ª e 2ª tentativas ficam pendentes, com a contagem
    for (const n of [1, 2]) {
      expect(await svc.classificarPendentes(2)).toBe(0);
      for (const nsu of [101n, 102n]) {
        expect(doc(nsu).processado_em).toBeNull();
        expect(doc(nsu).erro_processamento).toBe(
          `Não foi possível classificar (PrismaClientKnownRequestError P2000). Tentativa ${n} de 3.`,
        );
      }
    }
    expect(doc(103n).processado_em).toBeNull();

    // 3ª recusa: descartados (fora da fila), com o motivo; o NSU 103 ainda não teve vez
    expect(await svc.classificarPendentes(2)).toBe(0);
    for (const nsu of [101n, 102n]) {
      expect(doc(nsu).processado_em).not.toBeNull();
      expect(doc(nsu).erro_processamento).toBe(
        'Descartado depois de 3 tentativas: Não foi possível classificar (PrismaClientKnownRequestError P2000).',
      );
      expect(doc(nsu).chave).toBeNull();
    }
    expect(avisos()).toHaveLength(6);
    expect(avisos().filter((l) => l.includes('"descartado":true'))).toHaveLength(2);

    // a fila anda: o 103 é classificado, e os descartados não são tentados de novo (nem logados)
    const chamadas = recusa.mock.calls.length;
    expect(await svc.classificarPendentes(2)).toBe(1);
    expect(doc(103n).processado_em).not.toBeNull();
    expect(t.notas_sefaz.map((n) => n.chave)).toEqual([K880]);
    expect(recusa.mock.calls.length).toBe(chamadas + 1);
    expect(await svc.classificarPendentes(2)).toBe(0);
    expect(avisos()).toHaveLength(6);
  });

  it('classificação: cancelamento depois do resumo cancela a nota; resumo atrasado não descancela', async () => {
    const { svc, t, sefaz } = montar();
    const cancelVetor = fx('res-evento-110111.xml').replace(K77, VETOR);
    sefaz.responder(
      resposta(138, {
        ultNsu: 103n,
        maxNsu: 103n,
        documentos: [doc(101n, RES_NFE, fx('res-nfe.xml')), doc(102n, RES_EVENTO, cancelVetor), doc(103n, RES_NFE, fx('res-nfe.xml'))],
      }),
    );
    await svc.ciclo('agendada', null, em(AGORA));
    expect(t.notas_sefaz).toHaveLength(1);
    expect(t.notas_sefaz[0]).toMatchObject({ chave: VETOR, situacao_sefaz: 'cancelada', resumo_id: t.sefaz_documentos[2].id });
  });

  it('log sem XML: só a linha estruturada sefaz.distribuicao, com números e códigos', async () => {
    const { svc, sefaz } = montar();
    sefaz.responder(
      resposta(138, {
        ultNsu: 103n,
        maxNsu: 103n,
        documentos: [
          doc(101n, RES_NFE, fx('res-nfe.xml')),
          doc(102n, 'procNFe_v4.00.xsd', fx('proc-nfe.xml')),
          doc(103n, RES_NFE, '<!DOCTYPE x><resNFe>BEGIN</resNFe>'),
        ],
      }),
    );
    await svc.ciclo('botao', QUEM, em(AGORA));
    for (const l of logs) for (const proibido of ['<resNFe', '<nfeProc', 'BEGIN']) expect(l).not.toContain(proibido);
    const linha = logs.find((l) => l.includes('sefaz.distribuicao'));
    expect(linha).toBeDefined();
    const j = JSON.parse(linha!.slice(linha!.indexOf('{')));
    expect(j).toMatchObject({
      evento: 'sefaz.distribuicao',
      origem: 'botao',
      ambiente: 'producao',
      c_stat: 138,
      documentos: 3,
      ult_nsu: '103',
      max_nsu: '103',
    });
    expect(typeof j.duracao_ms).toBe('number');
  });

  it('caixa: procNFe do nosso CNPJ cria a nota com o XML completo', async () => {
    const { svc, t, sefaz } = montar();
    sefaz.responder(resposta(138, { ultNsu: 101n, maxNsu: 101n, documentos: [doc(101n, 'procNFe_v4.00.xsd', fx('proc-nfe.xml'))] }));
    await svc.ciclo('agendada', null, em(AGORA));
    expect(t.notas_sefaz[0]).toMatchObject({ chave: K880, documento_completo_id: t.sefaz_documentos[0].id, fin_nfe: 1, nat_op: 'VENDA' });
    expect(Number(t.notas_sefaz[0].valor_total)).toBe(890);
  });
});
