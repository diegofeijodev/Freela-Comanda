import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { notas_sefaz, sefaz_manifestacao } from '@prisma/client';
import { CertificadoErro, MSG_USO, type CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import { NotasService } from '../../notas/notas.service';
import { CLIENTE } from '../../sefaz/__tests__/certificado-teste';
import { SefazDfeFalso } from '../../sefaz/__tests__/sefaz-dfe.falso';
import { retornoLote, SefazEventosFalso } from '../../sefaz/__tests__/sefaz-eventos.falso';
import type { RetornoEvento, SefazEventosPort } from '../../sefaz/eventos.port';
import { sefazErro, type SefazErro } from '../../sefaz/sefaz-erro';
import { CicloSefazService } from '../ciclo.service';
import { FRASE_RESPOSTA } from '../frases';
import { CHAVE_TRAVA_SEFAZ_EVENTOS, ERRO_LOCAL, ERRO_RELOGIO, RespostasSefazService } from '../respostas.service';
import { linhaCom, montarPrismaSefaz, type TabelasSefaz } from './prisma-sefaz.falso';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000);
const seg = (n: number) => new Date(AGORA.getTime() + n * 1000);
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000);
const em = (d: Date) => () => d;

const NOSSO = '12345678000195';
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const K880 = '35261111222333000181550010000008801000000887';
const NPROT = '135260000000001'; // 15 dígitos, fictício
const LIGADA_EM = dias(7);
const CERT: CertificadoEmUso = { ...CLIENTE, impressaoDigital: 'ab'.repeat(32) };
/** Chave fictícia no formato do esquema (o DV não é conferido aqui). */
const chaveN = (i: number) => `3526111122233300018155001${String(i).padStart(9, '0')}1000000071`;

let portas: SefazEventosFalso[];
let logs: string[];

function montar(
  o: {
    env?: Record<string, string | undefined>;
    linha?: Partial<sefaz_manifestacao> | null;
    certErro?: CertificadoErro;
    certCnpj?: string;
    cert?: Partial<CertificadoEmUso>;
    cnpjEmpresa?: string;
  } = {},
) {
  const { prisma, t, trava, travaEventos, chavesUsadas } = montarPrismaSefaz({ cnpjEmpresa: o.cnpjEmpresa });
  if (o.linha !== null) {
    t.sefaz_manifestacao.push(
      linhaCom('sefaz_manifestacao', { ambiente: 'producao', cnpj: NOSSO, ligada: true, ligada_em: LIGADA_EM, ...o.linha }),
    );
  }
  const env: Record<string, string | undefined> = { SEFAZ_DFE_AMBIENTE: 'producao', SEFAZ_MANIFESTACAO: 'ligada', ...o.env };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const certificados = {
    emUso: jest.fn(async (): Promise<CertificadoEmUso> => {
      if (o.certErro) throw o.certErro;
      return { ...CERT, cnpj: o.certCnpj ?? NOSSO, ...o.cert };
    }),
  };
  const ciclo = new CicloSefazService(prisma, config, certificados, new SefazDfeFalso());
  const notas = new NotasService(prisma);
  const porta = new SefazEventosFalso();
  portas.push(porta);
  /** Outro processo da API no mesmo banco (ex.: depois de um reinício), com a sua porta. */
  const api = (p: SefazEventosPort) => new RespostasSefazService(prisma, config, ciclo, certificados, p, notas);
  return { svc: api(porta), api, t, porta, trava, travaEventos, chavesUsadas, certificados, prisma };
}

const nota = (chave: string, x: Partial<notas_sefaz> = {}) =>
  linhaCom('notas_sefaz', {
    ambiente: 'producao',
    cnpj_destinatario: NOSSO,
    chave,
    emitente_cnpj: chave.slice(6, 20),
    numero: String(Number(chave.slice(25, 34))),
    serie: String(Number(chave.slice(22, 25))),
    emitida_em: dias(2),
    autorizada_em: dias(2),
    tp_nf: 1,
    fin_nfe: 1,
    situacao_sefaz: 'autorizada',
    ...x,
  });
const evento = (n: notas_sefaz, x: Record<string, unknown> = {}) =>
  linhaCom('sefaz_manifestacoes', {
    nota_sefaz_id: n.id,
    ambiente: 'producao',
    cnpj: NOSSO,
    chave: n.chave,
    tp_evento: '210210',
    origem: 'ciencia_automatica',
    pedida_em: min(-10),
    enviar_apos: min(-10),
    ...x,
  });

const chaveDo = (xml: string) => /<chNFe>([0-9A-Z]{44})<\/chNFe>/.exec(xml)![1];
const tpDo = (xml: string) => /<tpEvento>([0-9]{6})<\/tpEvento>/.exec(xml)![1];
/** Na chamada, responde 128 com um `retEvento` por evento do lote (135 com protocolo por padrão); `antes` confere o banco no meio. */
function responder(porta: SefazEventosFalso, cStat = 135, extra: Partial<RetornoEvento> = {}, antes?: () => void) {
  porta.aoChamar = () => {
    antes?.();
    const c = porta.chamadas.at(-1)!;
    porta.proximas.push(
      retornoLote(
        128,
        c.eventos.map((x, i) => ({
          chave: chaveDo(x),
          tpEvento: tpDo(x),
          cStat,
          nProt: cStat === 135 ? `13526000000${String(i + 1).padStart(4, '0')}` : null,
          ...extra,
        })),
      ),
    );
  };
}

const linhaDe = (t: TabelasSefaz) => t.sefaz_manifestacao.find((l) => l.ambiente === 'producao' && l.cnpj === NOSSO)!;
/** Um processo da API manda o lote e morre com ele no ar (a resposta nunca chega); volta quando a porta foi chamada (a T1 já gravou). */
async function morrerNaRede(api: (p: SefazEventosPort) => RespostasSefazService, quando: Date): Promise<void> {
  let chamou: () => void = () => undefined;
  const naRede = new Promise<void>((r) => (chamou = r));
  const morta: SefazEventosPort = {
    enviarLote: () => {
      chamou();
      return new Promise<never>(() => undefined);
    },
  };
  void api(morta).processar(em(quando));
  await naRede;
}
const evDa = (t: TabelasSefaz, n: notas_sefaz, tp = '210210') =>
  t.sefaz_manifestacoes.find((e) => e.nota_sefaz_id === n.id && e.tp_evento === tp)!;

describe('RespostasSefazService', () => {
  beforeEach(() => {
    portas = [];
    logs = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // Em TODO teste: nenhum lote com 0 ou mais de 20 eventos (o falso não confere), e o log sem XML, chave de acesso nem protocolo.
    for (const p of portas) {
      for (const c of p.chamadas) {
        expect(c.eventos.length).toBeGreaterThanOrEqual(1);
        expect(c.eventos.length).toBeLessThanOrEqual(20);
      }
    }
    for (const l of logs) {
      expect(l).not.toContain('<');
      expect(l).not.toMatch(/[0-9]{6}[0-9A-Z]{12}[0-9]{26}/);
      expect(l).not.toMatch(/[0-9]{15}/);
    }
  });

  describe('condições sem rede: nenhuma chamada à porta', () => {
    const vencido = new Date('2026-11-01T03:00:00Z');
    it.each<[string, Parameters<typeof montar>[0], string]>([
      ['SEFAZ_MANIFESTACAO desligada', { env: { SEFAZ_MANIFESTACAO: 'desligada' } }, 'indisponivel'],
      ['SEFAZ_MANIFESTACAO ausente', { env: { SEFAZ_MANIFESTACAO: undefined } }, 'indisponivel'],
      ['ambiente desligado', { env: { SEFAZ_DFE_AMBIENTE: undefined } }, 'indisponivel'],
      ['sem CNPJ na empresa', { cnpjEmpresa: '' }, 'sem_cnpj'],
      ['sem linha das respostas', { linha: null }, 'nao_ligadas'],
      ['respostas não ligadas', { linha: { ligada: false } }, 'nao_ligadas'],
      ['parada_certificado', { linha: { situacao: 'parada_certificado' } }, 'parada'],
      ['parada_configuracao', { linha: { situacao: 'parada_configuracao' } }, 'parada'],
      ['parada_656', { linha: { situacao: 'parada_656' } }, 'parada'],
      ['parada_relogio', { linha: { situacao: 'parada_relogio' } }, 'parada'],
      ['pausa_ate no futuro', { linha: { pausa_ate: seg(1) } }, 'pausa'],
      [
        'certificado vencido',
        { certErro: new CertificadoErro(MSG_USO.vencido(vencido), 422, 'CERTIFICADO_VENCIDO', vencido) },
        'certificado',
      ],
      ['certificado de outra empresa (outra raiz)', { certCnpj: '99888777000166' }, 'certificado'],
    ])('%s → %s', async (_nome, o, fim) => {
      const { svc, t, porta } = montar(o);
      t.notas_sefaz.push(nota(VETOR));
      expect(await svc.processar(em(AGORA))).toEqual({ fim, enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
      expect(t.sefaz_eventos_lotes).toHaveLength(0);
      expect(t.sefaz_manifestacoes).toHaveLength(0); // nem o planejador rodou
    });

    it('a ordem: com tudo errado, vale a 1ª condição (disponível), e o certificado só é lido no fim', async () => {
      const { svc, certificados } = montar({ env: { SEFAZ_MANIFESTACAO: 'desligada' }, cnpjEmpresa: '', linha: { ligada: false } });
      expect((await svc.processar(em(AGORA))).fim).toBe('indisponivel');
      const pausada = montar({ linha: { pausa_ate: min(5) } });
      expect((await pausada.svc.processar(em(AGORA))).fim).toBe('pausa');
      expect(certificados.emUso).not.toHaveBeenCalled();
      expect(pausada.certificados.emUso).not.toHaveBeenCalled();
    });

    it('pausa_ate = agora já libera', async () => {
      const { svc, t, porta } = montar({ linha: { pausa_ate: AGORA } });
      t.notas_sefaz.push(nota(VETOR));
      responder(porta);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
    });

    describe('relógio (última consulta respondida da busca nas 24 h)', () => {
      const consulta = (dhResp: string, terminada: Date) =>
        linhaCom('sefaz_consultas', {
          ciclo_id: randomUUID(),
          ambiente: 'producao',
          cnpj: NOSSO,
          origem: 'agendada',
          ult_nsu_enviado: 100n,
          iniciada_em: terminada,
          terminada_em: terminada,
          resultado: 'respondida',
          dh_resp: dhResp,
        });

      it('deriva de 3 min → relogio, nenhuma chamada', async () => {
        const { svc, t, porta, certificados } = montar();
        t.notas_sefaz.push(nota(VETOR));
        // a anterior sem deriva (13h35), a última com 3 min (terminada 13h58, dhResp 14h01): vale a última
        t.sefaz_consultas.push(consulta('2026-11-17T13:35:00-03:00', min(-30)), consulta('2026-11-17T14:01:00-03:00', min(-7)));
        expect(await svc.processar(em(AGORA))).toEqual({ fim: 'relogio', enviados: 0 });
        expect(porta.chamadas).toHaveLength(0);
        expect(certificados.emUso).not.toHaveBeenCalled();
      });

      it('deriva de 1 min, ou a de 3 min com mais de 24 h, não segura', async () => {
        for (const c of [consulta('2026-11-17T13:59:00-03:00', min(-7)), consulta('2026-11-16T14:01:00-03:00', min(-24 * 60 - 7))]) {
          const { svc, t, porta } = montar();
          t.notas_sefaz.push(nota(VETOR));
          t.sefaz_consultas.push(c);
          responder(porta);
          expect((await svc.processar(em(AGORA))).fim).toBe('feito');
        }
      });
    });

    it('trava das respostas presa noutra conexão → ocupada, nenhuma chamada', async () => {
      const { svc, t, porta, travaEventos, chavesUsadas } = montar();
      t.notas_sefaz.push(nota(VETOR));
      travaEventos.ocupada = true;
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'ocupada', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
      expect(t.sefaz_manifestacoes).toHaveLength(0);
      expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS]);
    });

    it('a trava é a própria (7_011_171_202): a da busca presa não segura as respostas', async () => {
      const { svc, t, porta, trava, chavesUsadas } = montar();
      t.notas_sefaz.push(nota(VETOR));
      trava.ocupada = true;
      responder(porta);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(CHAVE_TRAVA_SEFAZ_EVENTOS).toBe(7_011_171_202);
      expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS, CHAVE_TRAVA_SEFAZ_EVENTOS]); // T1 tentada + T2 que espera
    });

    it('nada para enviar → vazia, sem lote', async () => {
      const { svc, t, porta } = montar();
      t.notas_sefaz.push(nota(VETOR, { tp_nf: 0 }), nota(K880, { autorizada_em: dias(10), emitida_em: dias(10) }));
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'vazia', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
      expect(t.sefaz_eventos_lotes).toHaveLength(0);
    });
  });

  describe('fila e envio', () => {
    it('VETOR elegível: 1 lote com 1 evento, gravado `enviando` e assinado ANTES da rede; 135 → registrada', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      let naRede: Record<string, unknown> = {};
      responder(porta, 135, {}, () => {
        const ev = evDa(t, n);
        const lote = t.sefaz_eventos_lotes[0];
        naRede = {
          situacao: ev.situacao,
          assinado: ev.xml_evento?.includes('<Signature') ?? false,
          tentativas: ev.tentativas,
          noLote: ev.lote_id === lote?.id,
          loteAberto: lote?.resultado === null && lote?.terminado_em === null,
          igualAoEnviado: porta.chamadas[0].eventos[0] === ev.xml_evento,
        };
      });
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(naRede).toEqual({ situacao: 'enviando', assinado: true, tentativas: 1, noLote: true, loteAberto: true, igualAoEnviado: true });

      expect(porta.chamadas).toHaveLength(1);
      expect(porta.chamadas[0]).toMatchObject({ ambiente: 'producao', idLote: BigInt(AGORA.getTime()) });
      expect(porta.chamadas[0].eventos).toHaveLength(1);
      expect(t.sefaz_manifestacoes).toHaveLength(1);
      expect(evDa(t, n)).toMatchObject({
        tp_evento: '210210',
        origem: 'ciencia_automatica',
        pedida_em: AGORA,
        enviar_apos: AGORA,
        situacao: 'registrada',
        tentativas: 1,
        c_stat: 135,
        n_prot: '135260000000001',
        x_motivo: 'teste',
        dh_evento: '2026-11-17T14:05:00-03:00',
        impressao_digital: 'ab'.repeat(32),
        xml_retorno: '<retEvento versao="1.00"></retEvento>',
      });
      expect(t.sefaz_eventos_lotes).toEqual([
        expect.objectContaining({
          id_lote: BigInt(AGORA.getTime()),
          resultado: 'respondida',
          c_stat: 128,
          eventos: 1,
          terminado_em: AGORA,
        }),
      ]);
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', mensagem: null, pausa_ate: null, falhas_seguidas: 0, ligada: true });

      // registrada: o tique seguinte não manda nada de novo
      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'vazia', enviados: 0 });
      expect(porta.chamadas).toHaveLength(1);
    });

    it('21 notas elegíveis: só 20 no lote (a mais antiga primeiro); o tique seguinte leva a 21ª', async () => {
      const { svc, t, porta } = montar();
      const notas = Array.from({ length: 21 }, (_, i) => nota(chaveN(i + 1), { autorizada_em: min(-(22 - (i + 1)) * 60) }));
      t.notas_sefaz.push(...[...notas].reverse());
      responder(porta);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 20 });
      expect(porta.chamadas[0].eventos.map(chaveDo)).toEqual(notas.slice(0, 20).map((n) => n.chave));
      expect(t.sefaz_manifestacoes.filter((e) => e.situacao === 'registrada')).toHaveLength(20);
      expect(evDa(t, notas[20])).toMatchObject({ situacao: 'na_fila', tentativas: 0, lote_id: null });

      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'feito', enviados: 1 });
      expect(porta.chamadas[1].eventos.map(chaveDo)).toEqual([notas[20].chave]);
      expect(t.sefaz_manifestacoes.filter((e) => e.situacao === 'registrada')).toHaveLength(21);
      expect(await svc.processar(em(min(10)))).toEqual({ fim: 'vazia', enviados: 0 });
    });

    it('Review Focus 2: evento do admin com enviar_apos = AGORA + 60 s não sai em +59 s e sai em +60 s', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR, { motivo_ignorar: 'nao_reconheco', ignorada_em: AGORA });
      t.notas_sefaz.push(n);
      t.sefaz_manifestacoes.push(evento(n, { tp_evento: '210220', origem: 'admin', pedida_em: AGORA, enviar_apos: seg(60) }));
      expect(await svc.processar(em(seg(59)))).toEqual({ fim: 'vazia', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
      expect(evDa(t, n, '210220')).toMatchObject({ situacao: 'na_fila', tentativas: 0 });

      responder(porta);
      expect(await svc.processar(em(seg(60)))).toEqual({ fim: 'feito', enviados: 1 });
      expect(porta.chamadas[0].eventos.map(tpDo)).toEqual(['210220']);
      expect(evDa(t, n, '210220')).toMatchObject({ situacao: 'registrada', tentativas: 1 });
      expect(t.sefaz_manifestacoes).toHaveLength(1); // nenhuma ciência para a nota com resposta final
    });

    it('ciência na fila + resposta final do admin: a ciência vira cancelada e só a final sai', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR, { motivo_ignorar: 'nao_reconheco', ignorada_em: min(-2) });
      t.notas_sefaz.push(n);
      t.sefaz_manifestacoes.push(evento(n), evento(n, { tp_evento: '210220', origem: 'admin', pedida_em: min(-2), enviar_apos: min(-1) }));
      responder(porta);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(porta.chamadas[0].eventos.map(tpDo)).toEqual(['210220']);
      expect(evDa(t, n)).toMatchObject({ situacao: 'cancelada', tentativas: 0, lote_id: null, atualizada_em: AGORA });
      expect(evDa(t, n, '210220').situacao).toBe('registrada');
    });

    it('210200 automático: nota lançada pela chave depois de ligar (mesmo ignorada antes) confirma; lançada antes, não', async () => {
      const { svc, t, porta } = montar();
      const depois = nota(VETOR, { motivo_ignorar: 'outro', motivo_texto: 'teste', ignorada_em: dias(3) });
      const antes = nota(K880);
      t.notas_sefaz.push(depois, antes);
      t.notas_entrada.push(
        linhaCom('notas_entrada', { chave: VETOR, fornecedor_cnpj: '12ABC34501DE35', numero: '4411', serie: '1', created_at: dias(1) }),
        linhaCom('notas_entrada', { chave: K880, fornecedor_cnpj: '11222333000181', numero: '880', serie: '1', created_at: dias(8) }),
      );
      responder(porta);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(porta.chamadas[0].eventos.map(tpDo)).toEqual(['210200']);
      expect(porta.chamadas[0].eventos.map(chaveDo)).toEqual([VETOR]);
      expect(evDa(t, depois, '210200')).toMatchObject({ origem: 'dar_entrada', situacao: 'registrada' });
      expect(t.sefaz_manifestacoes).toHaveLength(1); // a lançada antes de ligar: nem 210200, nem ciência
    });

    it('sem ligada_em não há confirmação automática', async () => {
      const { svc, t, porta } = montar({ linha: { ligada_em: null } });
      t.notas_sefaz.push(nota(VETOR));
      t.notas_entrada.push(linhaCom('notas_entrada', { chave: VETOR, created_at: dias(1) }));
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'vazia', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
    });
  });

  describe('retornos e falhas', () => {
    it('108 → evento na_fila com tentativas 0, pausa_ate 15h05, e nenhum envio às 14h10', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      porta.proximas.push(retornoLote(108, []));
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0, c_stat: null });
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(60), mensagem: FRASE_RESPOSTA.foraDoAr('15h05') });
      expect(t.sefaz_eventos_lotes[0]).toMatchObject({ resultado: 'respondida', c_stat: 108 });

      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(porta.chamadas).toHaveLength(1);
    });

    it('TEMPO → na_fila, tentativas 1, pausa_ate 14h20; três seguidas → falhou e parada_configuracao (3 ilegíveis)', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      const tempo = () => porta.proximas.push(sefazErro('SEFAZ_TEMPO', true));

      tempo();
      await svc.processar(em(AGORA));
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 1 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(15), falhas_seguidas: 1 });
      expect(t.sefaz_eventos_lotes[0]).toMatchObject({ resultado: 'sem_resposta', erro_code: 'SEFAZ_TEMPO', c_stat: null });

      tempo();
      await svc.processar(em(min(15)));
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 2 });
      expect(linhaDe(t).pausa_ate).toEqual(min(30));

      tempo();
      await svc.processar(em(min(30)));
      expect(evDa(t, n)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.tresIlegiveis, ligada: true });
      expect(t.sefaz_distribuicao_historico).toEqual([
        expect.objectContaining({ evento: 'respostas_paradas', situacao: 'parada_configuracao', c_stat: null, feito_em: min(30) }),
      ]);
      expect(porta.chamadas).toHaveLength(3);
      expect(await svc.processar(em(min(120)))).toEqual({ fim: 'parada', enviados: 0 });
      expect(porta.chamadas).toHaveLength(3);
    });

    it('a porta lança erro que não é SefazErro: falha ANTES de enviar, ninguém gasta tentativa, recuo de 15 min', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      // o falso só tipa SefazErro; um Error comum é o que o adaptador lança quando `corpoEnvEvento` recusa o lote
      porta.proximas.push(new Error('O lote leva de 1 a 20 eventos.') as SefazErro);
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 1 });
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
      expect(t.sefaz_eventos_lotes[0]).toMatchObject({ resultado: 'falha_antes_de_enviar', erro_code: ERRO_LOCAL, x_motivo: null });
      expect(linhaDe(t)).toMatchObject({
        situacao: 'ok',
        falhas_seguidas: 1,
        pausa_ate: min(15),
        mensagem: FRASE_RESPOSTA.semContato('14h20'),
      });
      expect(logs.join('\n')).not.toContain('O lote leva');
    });

    describe('ja_enviada (notas 8 e 9): o que conta como já saiu para a SEFAZ', () => {
      it('falha antes de enviar não conta: a ciência da nota que deixou de servir é cancelada', async () => {
        const { svc, t, porta } = montar();
        const n = nota(VETOR);
        t.notas_sefaz.push(n);
        porta.proximas.push(sefazErro('SEFAZ_REDE', false));
        await svc.processar(em(AGORA));
        expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
        expect(evDa(t, n).lote_id).not.toBeNull(); // o lote dele é `falha_antes_de_enviar`

        Object.assign(t.notas_sefaz[0], { motivo_ignorar: 'outro', motivo_texto: 'teste', ignorada_em: min(1) });
        expect(await svc.processar(em(min(15)))).toEqual({ fim: 'vazia', enviados: 0 });
        expect(evDa(t, n).situacao).toBe('cancelada');
        expect(porta.chamadas).toHaveLength(1);
      });

      it('HTTP 500 sem Fault (sem_resposta, não gasta) conta: a ciência fica e sai mesmo com a nota fora da elegibilidade', async () => {
        const { svc, t, porta } = montar();
        const n = nota(VETOR);
        t.notas_sefaz.push(n);
        porta.proximas.push(sefazErro('SEFAZ_HTTP', true, 500));
        await svc.processar(em(AGORA));
        expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
        expect(t.sefaz_eventos_lotes[0].resultado).toBe('sem_resposta');
        expect(linhaDe(t).pausa_ate).toEqual(min(60));

        Object.assign(t.notas_sefaz[0], { motivo_ignorar: 'outro', motivo_texto: 'teste', ignorada_em: min(1) });
        responder(porta);
        expect(await svc.processar(em(min(60)))).toEqual({ fim: 'feito', enviados: 1 });
        expect(porta.chamadas[1].eventos.map(chaveDo)).toEqual([VETOR]);
        expect(evDa(t, n)).toMatchObject({ situacao: 'registrada', tentativas: 1 });
      });
    });

    it('queda entre T1 e T2 (a API morreu com o lote no ar): aberto há 1 min = ocupada; depois, interrompida + pausa de 15 min, e o reenvio sai na pausa com a tentativa mantida', async () => {
      const { svc, api, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      await morrerNaRede(api, AGORA);
      expect(evDa(t, n)).toMatchObject({ situacao: 'enviando', tentativas: 1 });
      const caido = t.sefaz_eventos_lotes[0];
      expect(caido.resultado).toBeNull();

      // outro processo: o lote aberto há menos de 2 min pode ser de quem ainda espera a SEFAZ
      expect(await svc.processar(em(min(1)))).toEqual({ fim: 'ocupada', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);

      let naChamada: Record<string, unknown> = {};
      responder(porta, 573, {}, () => {
        const ev = evDa(t, n);
        naChamada = {
          antigo: t.sefaz_eventos_lotes.find((l) => l.id === caido.id)?.resultado,
          situacao: ev.situacao,
          tentativas: ev.tentativas,
          noNovo: ev.lote_id !== caido.id,
        };
      });
      // aos 5 min: o lote vira `interrompida`, o evento volta com a tentativa mantida, e a queda conta como "sem resposta": +15, sem envio
      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
      expect(t.sefaz_eventos_lotes.find((l) => l.id === caido.id)).toMatchObject({ resultado: 'interrompida', terminado_em: min(5) });
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 1 });
      expect(linhaDe(t)).toMatchObject({
        situacao: 'ok',
        pausa_ate: min(20),
        falhas_seguidas: 1,
        mensagem: FRASE_RESPOSTA.semContato('14h25'),
      });
      expect(logs.some((l) => l.includes('lote_interrompido'))).toBe(true);
      expect(await svc.processar(em(min(19)))).toEqual({ fim: 'pausa', enviados: 0 });

      expect(await svc.processar(em(min(20)))).toEqual({ fim: 'feito', enviados: 1 });
      expect(naChamada).toEqual({ antigo: 'interrompida', situacao: 'enviando', tentativas: 2, noNovo: true });
      expect(evDa(t, n)).toMatchObject({ situacao: 'registrada', c_stat: 573, n_prot: null, tentativas: 2 });
      expect(t.sefaz_eventos_lotes.map((l) => [l.resultado, l.terminado_em])).toEqual([
        ['interrompida', min(5)],
        ['respondida', min(20)],
      ]);
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', falhas_seguidas: 0, mensagem: null });
    });

    it('a T2 cai depois de a SEFAZ responder 656: o lote fica aberto, e o tique de +5 min não chama a porta (pausa de 15 min)', async () => {
      const { svc, t, porta, prisma } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      porta.proximas.push(retornoLote(656, []));
      const lotes = prisma.sefaz_eventos_lotes as unknown as { update: (a: unknown) => Promise<unknown> };
      jest.spyOn(lotes, 'update').mockImplementationOnce(async () => {
        throw new Error('queda simulada no meio da T2');
      });
      await expect(svc.processar(em(AGORA))).rejects.toThrow('queda simulada no meio da T2');
      expect(evDa(t, n)).toMatchObject({ situacao: 'enviando', tentativas: 1 });
      expect(t.sefaz_eventos_lotes[0].resultado).toBeNull();

      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(porta.chamadas).toHaveLength(1);
      expect(linhaDe(t).pausa_ate).toEqual(min(20));
      expect(await svc.processar(em(min(10)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(porta.chamadas).toHaveLength(1);
    });

    it('3 quedas seguidas param as respostas (parada_configuracao, 3 sem resposta), e o evento falha na 3ª', async () => {
      const { svc, api, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);

      await morrerNaRede(api, AGORA);
      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(linhaDe(t)).toMatchObject({ pausa_ate: min(20), falhas_seguidas: 1 });

      await morrerNaRede(api, min(20));
      expect(await svc.processar(em(min(25)))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 2 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(40), falhas_seguidas: 2 });

      await morrerNaRede(api, min(40));
      expect(await svc.processar(em(min(45)))).toEqual({ fim: 'parada', enviados: 0 });
      expect(evDa(t, n)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.tresIlegiveis, ligada: true });
      expect(t.sefaz_distribuicao_historico).toEqual([
        expect.objectContaining({ evento: 'respostas_paradas', situacao: 'parada_configuracao', c_stat: null, feito_em: min(45) }),
      ]);
      expect(t.sefaz_eventos_lotes.map((l) => l.resultado)).toEqual(['interrompida', 'interrompida', 'interrompida']);
      expect(await svc.processar(em(min(120)))).toEqual({ fim: 'parada', enviados: 0 });
      expect(porta.chamadas).toHaveLength(0);
    });

    it('lote interrompido conta como sem resposta na sequência: queda + 2 TEMPO = o 3º para', async () => {
      const { svc, api, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      await morrerNaRede(api, AGORA);
      expect((await svc.processar(em(min(5)))).fim).toBe('pausa');

      porta.proximas.push(sefazErro('SEFAZ_TEMPO', true));
      await svc.processar(em(min(20)));
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(35) });

      porta.proximas.push(sefazErro('SEFAZ_TEMPO', true));
      await svc.processar(em(min(35)));
      expect(linhaDe(t)).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.tresIlegiveis });
      expect(evDa(t, n)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
    });

    it('lote interrompido com o evento na 3ª tentativa: falhou (nunca uma 4ª), sem chamada', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      const aberto = linhaCom('sefaz_eventos_lotes', {
        ambiente: 'producao',
        cnpj: NOSSO,
        id_lote: BigInt(min(-10).getTime()),
        iniciado_em: min(-10),
        eventos: 1,
      });
      t.sefaz_eventos_lotes.push(aberto);
      t.sefaz_manifestacoes.push(evento(n, { situacao: 'enviando', tentativas: 3, lote_id: aberto.id }));
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'pausa', enviados: 0 });
      expect(evDa(t, n)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
      expect(t.sefaz_eventos_lotes[0]).toMatchObject({ resultado: 'interrompida', terminado_em: AGORA });
      expect(linhaDe(t).pausa_ate).toEqual(min(15));
      expect(porta.chamadas).toHaveLength(0);
    });

    it.each([
      ['656 do evento (dentro de um 128) e depois 656 do lote', 'evento', 'lote'],
      ['656 do lote e depois 656 do evento', 'lote', 'evento'],
    ])('%s: o 2º em 24 h para as respostas (parada_656)', async (_nome, primeiro, segundo) => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      const vez = (onde: string) => {
        if (onde === 'lote') porta.proximas.push(retornoLote(656, []));
        else responder(porta, 656);
      };
      vez(primeiro);
      await svc.processar(em(AGORA));
      porta.aoChamar = undefined;
      expect(t.sefaz_eventos_lotes[0].c_stat).toBe(656); // a marca que a próxima T1 conta
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(65), mensagem: FRASE_RESPOSTA.esperar('15h10') });

      vez(segundo);
      await svc.processar(em(min(65)));
      expect(linhaDe(t)).toMatchObject({ situacao: 'parada_656', mensagem: FRASE_RESPOSTA.bloqueouDuasVezes });
      expect(t.sefaz_distribuicao_historico).toEqual([expect.objectContaining({ evento: 'respostas_paradas', c_stat: 656 })]);
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
    });

    it('relógio (577) marca o lote; o 2º lote seguido com relógio para (parada_relogio, c_stat 577)', async () => {
      const { svc, t, porta } = montar();
      const n = nota(VETOR);
      t.notas_sefaz.push(n);
      responder(porta, 577);
      await svc.processar(em(AGORA));
      expect(t.sefaz_eventos_lotes[0]).toMatchObject({ erro_code: ERRO_RELOGIO, c_stat: 128 });
      expect(linhaDe(t)).toMatchObject({ situacao: 'ok', pausa_ate: min(60), mensagem: FRASE_RESPOSTA.relogio('15h05') });
      expect(evDa(t, n)).toMatchObject({ situacao: 'na_fila', tentativas: 0, c_stat: 577 });

      await svc.processar(em(min(60)));
      expect(linhaDe(t)).toMatchObject({ situacao: 'parada_relogio', mensagem: FRASE_RESPOSTA.relogioParou });
      expect(t.sefaz_distribuicao_historico).toEqual([expect.objectContaining({ situacao: 'parada_relogio', c_stat: 577 })]);
    });

    it('histórico da parada: c_stat da SEFAZ (280) num retorno; null por HTTP 403 (o status vai na frase)', async () => {
      const retorno = montar();
      retorno.t.notas_sefaz.push(nota(VETOR));
      retorno.porta.proximas.push(retornoLote(280, []));
      await retorno.svc.processar(em(AGORA));
      expect(linhaDe(retorno.t)).toMatchObject({ situacao: 'parada_certificado', mensagem: FRASE_RESPOSTA.certificadoRecusado(280) });
      expect(retorno.t.sefaz_distribuicao_historico).toEqual([expect.objectContaining({ c_stat: 280 })]);

      const http = montar();
      http.t.notas_sefaz.push(nota(VETOR));
      http.porta.proximas.push(sefazErro('SEFAZ_HTTP', true, 403));
      await http.svc.processar(em(AGORA));
      expect(linhaDe(http.t)).toMatchObject({ situacao: 'parada_certificado', mensagem: FRASE_RESPOSTA.certificadoRecusado(403) });
      expect(http.t.sefaz_distribuicao_historico).toEqual([expect.objectContaining({ c_stat: null })]);
      expect(http.t.sefaz_eventos_lotes[0]).toMatchObject({ resultado: 'respondida', erro_code: 'SEFAZ_HTTP', x_motivo: 'HTTP 403' });
    });

    it('recusa definitiva (650) e código fora do CHECK (099): recusada, nunca repete, e a T2 não cai', async () => {
      const { svc, t, porta } = montar();
      const a = nota(VETOR);
      const b = nota(K880, { autorizada_em: dias(3), emitida_em: dias(3) });
      t.notas_sefaz.push(a, b);
      porta.aoChamar = () => {
        porta.proximas.push(
          retornoLote(128, [
            { chave: K880, tpEvento: '210210', cStat: 650 },
            { chave: VETOR, tpEvento: '210210', cStat: 99 },
          ]),
        );
      };
      expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 2 });
      expect(evDa(t, b)).toMatchObject({ situacao: 'recusada', c_stat: 650, tentativas: 1 });
      expect(evDa(t, a)).toMatchObject({ situacao: 'recusada', c_stat: null, tentativas: 1 });
      porta.aoChamar = undefined;
      expect(await svc.processar(em(min(5)))).toEqual({ fim: 'vazia', enviados: 0 });
    });

    describe('evento que não pode ser assinado (correção 1, I2)', () => {
      const SEM_ASSINATURA = 'O XML não pôde ser assinado.';
      /** 210240 com a justificativa gravada sem a normalização (espaço repetido): a montagem do evento a recusa. */
      const naoAconteceu = (n: notas_sefaz) =>
        evento(n, {
          tp_evento: '210240',
          origem: 'admin',
          x_just: 'pedido  cancelado pelo fornecedor',
          pedida_em: min(-3),
          enviar_apos: min(-2),
        });

      it('1 de 3 não assina: ele vira falhou (motivo fixo, sem +1 e sem lote) e os outros 2 saem no lote', async () => {
        const { svc, t, porta } = montar();
        const ruim = nota(VETOR, { motivo_ignorar: 'outro', motivo_texto: 'teste', ignorada_em: min(-3) });
        const a = nota(K880, { autorizada_em: dias(3), emitida_em: dias(3) });
        const b = nota(chaveN(1));
        t.notas_sefaz.push(ruim, a, b);
        t.sefaz_manifestacoes.push(naoAconteceu(ruim));
        responder(porta);
        expect(await svc.processar(em(AGORA))).toEqual({ fim: 'feito', enviados: 2 });
        expect(porta.chamadas[0].eventos.map(chaveDo)).toEqual([K880, chaveN(1)]);
        expect(evDa(t, ruim, '210240')).toMatchObject({
          situacao: 'falhou',
          x_motivo: SEM_ASSINATURA,
          tentativas: 0,
          lote_id: null,
          xml_evento: null,
          atualizada_em: AGORA,
        });
        expect(evDa(t, a).situacao).toBe('registrada');
        expect(evDa(t, b).situacao).toBe('registrada');
        expect(t.sefaz_eventos_lotes).toEqual([expect.objectContaining({ eventos: 2, resultado: 'respondida' })]);
        expect(linhaDe(t).situacao).toBe('ok');
        const alerta = logs.find((l) => l.includes('assinatura_recusada'))!;
        expect(JSON.parse(alerta)).toMatchObject({ evento: 'sefaz.eventos', alerta: 'assinatura_recusada', eventos: 1 });
      });

      it('nenhum assina por defeito do certificado: parada_certificado com histórico, zero chamadas, nenhum lote', async () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }); // chave que a assinatura RSA-SHA1 recusa
        const { svc, t, porta } = montar({ cert: { chavePrivada: privateKey } });
        const a = nota(VETOR);
        const b = nota(K880, { autorizada_em: dias(3), emitida_em: dias(3) });
        t.notas_sefaz.push(a, b);
        expect(await svc.processar(em(AGORA))).toEqual({ fim: 'parada', enviados: 0 });
        expect(porta.chamadas).toHaveLength(0);
        expect(t.sefaz_eventos_lotes).toHaveLength(0);
        expect(linhaDe(t)).toMatchObject({
          situacao: 'parada_certificado',
          mensagem: FRASE_RESPOSTA.assinaturaCertificado,
          ligada: true,
          ligada_em: LIGADA_EM,
        });
        expect(t.sefaz_distribuicao_historico).toEqual([
          expect.objectContaining({ evento: 'respostas_paradas', situacao: 'parada_certificado', c_stat: null, feito_em: AGORA }),
        ]);
        for (const n of [a, b]) expect(evDa(t, n)).toMatchObject({ situacao: 'falhou', x_motivo: SEM_ASSINATURA, tentativas: 0 });
        expect(await svc.processar(em(min(5)))).toEqual({ fim: 'parada', enviados: 0 });
      });

      it('nenhum assina por defeito do evento (só o 210240 na fila): parada_configuracao com histórico', async () => {
        const { svc, t, porta } = montar();
        const ruim = nota(VETOR, { motivo_ignorar: 'outro', motivo_texto: 'teste', ignorada_em: min(-3) });
        t.notas_sefaz.push(ruim);
        t.sefaz_manifestacoes.push(naoAconteceu(ruim));
        expect(await svc.processar(em(AGORA))).toEqual({ fim: 'parada', enviados: 0 });
        expect(porta.chamadas).toHaveLength(0);
        expect(evDa(t, ruim, '210240')).toMatchObject({ situacao: 'falhou', x_motivo: SEM_ASSINATURA });
        expect(linhaDe(t)).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE_RESPOSTA.assinaturaConfiguracao });
        expect(t.sefaz_distribuicao_historico).toEqual([expect.objectContaining({ situacao: 'parada_configuracao', c_stat: null })]);
      });
    });

    it('o logger nunca recebe `<`, a chave nem o n_prot; 135 sem protocolo vira alerta só com a contagem', async () => {
      const { svc, t, porta } = montar();
      t.notas_sefaz.push(nota(VETOR), nota(K880, { autorizada_em: dias(3), emitida_em: dias(3) }));
      porta.aoChamar = () => {
        porta.proximas.push(
          retornoLote(128, [
            { chave: K880, tpEvento: '210210', cStat: 135, nProt: NPROT, xMotivo: 'Evento registrado <ok>' },
            { chave: VETOR, tpEvento: '210210', cStat: 135, nProt: null },
          ]),
        );
      };
      await svc.processar(em(AGORA));
      const registro = logs.find((l) => l.includes('"evento":"sefaz.eventos"'))!;
      expect(JSON.parse(registro)).toMatchObject({
        ambiente: 'producao',
        resultado: 'respondida',
        c_stat: 128,
        eventos: 2,
        estados: { registrada: 2 },
        alerta: 'registrada_sem_protocolo',
      });
      expect(typeof JSON.parse(registro).duracao_ms).toBe('number');
      for (const l of logs) {
        expect(l).not.toContain('<');
        expect(l).not.toContain(VETOR);
        expect(l).not.toContain(K880);
        expect(l).not.toContain(NPROT);
      }
    });
  });
});
