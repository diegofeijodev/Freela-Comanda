import { randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type sefaz_distribuicao, type sefaz_manifestacao } from '@prisma/client';
import { CertificadoErro, MSG_USO, type CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { NotaLancada, NotasService } from '../../notas/notas.service';
import { SefazDfeFalso } from '../../sefaz/__tests__/sefaz-dfe.falso';
import { SefazEventosFalso } from '../../sefaz/__tests__/sefaz-eventos.falso';
import { CaixaSefazService } from '../caixa.service';
import { CHAVE_TRAVA_SEFAZ, CicloSefazService } from '../ciclo.service';
import { CHAVE_TRAVA_SEFAZ_EVENTOS, MOTIVO_SEM_ASSINATURA, RespostasSefazService } from '../respostas.service';
import { linhaCom, montarPrismaSefaz, type TabelasSefaz } from './prisma-sefaz.falso';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const MAIS65 = new Date('2026-11-17T18:10:00Z');
const NOSSO = '12345678000195';
const EMIT = '12ABC34501DE35';
const FORN = '11222333000181';
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const KPARECE = '35261112ABC34501DE35550010000044111999999993';
const K880 = '35261111222333000181550010000008801000000887';
const K120 = '35261111222333000181550010000001201000000120';
const K15 = '35261111222333000181550020000000151000000016';
const QUEM = { id: '0b8f5c2e-1111-4000-8000-000000000001', nome: 'Ana' };
const ID_FORA = '00000000-0000-4000-8000-000000000000';
const OID_CLIENT = '1.3.6.1.5.5.7.3.2';
const dia = (d: string) => new Date(`2026-11-${d}T12:00:00Z`);

const lancada = (x: Partial<NotaLancada>): NotaLancada => ({
  id: randomUUID(),
  numero: '4411',
  serie: '1',
  fornecedor_nome: 'Atacadão',
  data_emissao: '2026-11-03',
  data_entrada: '2026-11-03',
  valor_total: 10,
  origem: 'xml',
  created_at: '2026-11-03T15:00:00.000Z',
  chave: null,
  fornecedor_cnpj: EMIT,
  ...x,
});

type Opcoes = {
  ambiente?: string;
  /** `SEFAZ_MANIFESTACAO` (ausente = desligada). */
  manifestacao?: string;
  /** Linha das respostas (`sefaz_manifestacao`) do (ambiente, CNPJ); ausente = nenhuma. */
  respostas?: Partial<sefaz_manifestacao>;
  cnpjEmpresa?: string;
  certErro?: CertificadoErro;
  certCnpj?: string;
  keyUsage?: string[] | undefined;
  linha?: Partial<sefaz_distribuicao> | null;
  lancadas?: NotaLancada[];
  semear?: boolean;
};

/** As portas dos eventos de cada `montar`: nenhuma rota da caixa chama a SEFAZ (conferido no afterEach). */
let portas: SefazEventosFalso[] = [];

function montar(o: Opcoes = {}) {
  const ambiente = o.ambiente ?? 'producao';
  const { prisma, t, chavesUsadas } = montarPrismaSefaz({ cnpjEmpresa: o.cnpjEmpresa });
  if (o.linha !== null && o.linha !== undefined) {
    t.sefaz_distribuicao.push(linhaCom('sefaz_distribuicao', { ambiente, cnpj: NOSSO, busca_ligada: true, ult_nsu: 100n, ...o.linha }));
  }
  if (o.respostas) t.sefaz_manifestacao.push(linhaCom('sefaz_manifestacao', { ambiente, cnpj: NOSSO, ...o.respostas }));
  const certificados = {
    emUso: jest.fn(async () => {
      if (o.certErro) throw o.certErro;
      return {
        cnpj: o.certCnpj ?? NOSSO,
        validoAte: new Date('2027-11-17T00:00:00Z'),
        impressaoDigital: 'ab'.repeat(32),
        certificado: { keyUsage: 'keyUsage' in o ? o.keyUsage : [OID_CLIENT] },
      } as unknown as CertificadoEmUso;
    }),
  };
  const env: Record<string, string> = ambiente === 'desligado' ? {} : { SEFAZ_DFE_AMBIENTE: ambiente };
  if (o.manifestacao !== undefined) env.SEFAZ_MANIFESTACAO = o.manifestacao;
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const ciclo = new CicloSefazService(prisma, config, certificados, new SefazDfeFalso());
  const lancadas = o.lancadas ?? [];
  const notas = { notasLancadas: jest.fn(async () => lancadas) } as unknown as NotasService;
  const porta = new SefazEventosFalso();
  portas.push(porta);
  const respostas = new RespostasSefazService(prisma, config, ciclo, certificados, porta, notas);
  const svc = new CaixaSefazService(prisma, ciclo, notas, certificados, respostas);
  if (o.semear) semear(t, ambiente);
  return { svc, t, certificados, notas: notas as unknown as { notasLancadas: jest.Mock }, ciclo, prisma, chavesUsadas };
}

const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID(), e: randomUUID(), doc: randomUUID() };

/** As 5 notas do smoke: (a) falta lançar, (b) cancelada depois de lançada, (c) parece lançada, (d) denegada sem XML, (e) saída. */
function semear(t: TabelasSefaz, ambiente: string) {
  t.sefaz_documentos.push(
    linhaCom('sefaz_documentos', { id: ids.doc, ambiente, cnpj: NOSSO, nsu: 1n, schema: 'procNFe_v4.00.xsd', tipo: 'procNFe', xml: '<nfeProc>K880</nfeProc>' }),
  );
  const nota = (id: string, chave: string, emit: string, numero: string, serie: string, sit: string, emitida: Date | null, x = {}) =>
    t.notas_sefaz.push(
      linhaCom('notas_sefaz', {
        id,
        ambiente,
        cnpj_destinatario: NOSSO,
        chave,
        emitente_cnpj: emit,
        emitente_nome: `Forn ${numero}`,
        numero,
        serie,
        situacao_sefaz: sit,
        emitida_em: emitida,
        criada_em: AGORA,
        ...x,
      }),
    );
  nota(ids.a, K880, FORN, '880', '1', 'autorizada', dia('10'), { documento_completo_id: ids.doc, tp_nf: 1, fin_nfe: 1, valor_total: '123.45' });
  nota(ids.b, VETOR, EMIT, '4411', '1', 'cancelada', dia('11'), { cancelada_em: dia('12') });
  nota(ids.c, KPARECE, EMIT, '4411', '1', 'autorizada', dia('12'));
  nota(ids.d, K15, FORN, '15', '2', 'denegada', null);
  nota(ids.e, K120, FORN, '120', '1', 'autorizada', dia('09'), { tp_nf: 0 });
}

const LANCADAS = [
  lancada({ id: 'l-novo', chave: '35261112ABC34501DE35550010000044111000044124', numero: '000.004.411', created_at: '2026-11-05T15:00:00.000Z', origem: 'xml' }),
  lancada({ id: 'l-vetor', chave: VETOR, created_at: '2026-11-03T15:00:00.000Z' }),
];

async function recusa(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    return { status: e.getStatus(), ...(e.getResponse() as { code: string; message: string }) };
  }
  throw new Error('não recusou');
}

const aberta = async (svc: CaixaSefazService) => {
  const s = await svc.situacao(AGORA);
  if (s.ambiente === 'desligado') throw new Error('desligado');
  return s;
};

describe('CaixaSefazService', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    portas = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // nenhuma rota da caixa fala com a SEFAZ: os eventos só saem pelo tique
    expect(portas.flatMap((p) => p.chamadas)).toEqual([]);
  });

  describe('servidor desligado', () => {
    it('situação devolve só { ambiente: "desligado" } e as outras 5 operações dão 503 SEFAZ_DESLIGADA', async () => {
      const { svc } = montar({ ambiente: 'desligado', linha: null });
      expect(await svc.situacao(AGORA)).toEqual({ ambiente: 'desligado' });
      const frase = 'A busca de notas na SEFAZ não está ativada neste servidor.';
      for (const op of [
        () => svc.configurar(true, QUEM, AGORA),
        () => svc.listar('todas', 10),
        () => svc.xml(ids.a),
        () => svc.ignorar(ids.a, 'nao_e_compra', null, QUEM, AGORA),
        () => svc.reabrir(ids.a, QUEM),
      ]) {
        expect(await recusa(op())).toEqual({ status: 503, code: 'SEFAZ_DESLIGADA', message: frase });
      }
    });
  });

  describe('ligar e desligar', () => {
    it('sem CNPJ: 422 SEFAZ_SEM_CNPJ com a frase', async () => {
      const { svc, t } = montar({ cnpjEmpresa: '', linha: null });
      expect(await recusa(svc.configurar(true, QUEM, AGORA))).toEqual({
        status: 422,
        code: 'SEFAZ_SEM_CNPJ',
        message: 'Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página.',
      });
      expect(t.sefaz_distribuicao).toHaveLength(0);
    });

    it('sem certificado: 503 CERTIFICADO_NAO_CADASTRADO com a frase da porta, e nada é gravado', async () => {
      const { svc, t } = montar({ certErro: new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO'), linha: null });
      expect(await recusa(svc.configurar(true, QUEM, AGORA))).toEqual({
        status: 503,
        code: 'CERTIFICADO_NAO_CADASTRADO',
        message: MSG_USO.naoCadastrado,
      });
      expect(t.sefaz_distribuicao).toHaveLength(0);
      expect(t.sefaz_distribuicao_historico).toHaveLength(0);
    });

    it('certificado de outra empresa (erro da porta): 422 CERTIFICADO_OUTRO_CNPJ', async () => {
      const { svc } = montar({ certErro: new CertificadoErro('Certificado de outra empresa.', 422, 'CERTIFICADO_OUTRO_CNPJ'), linha: null });
      expect(await recusa(svc.configurar(true, QUEM, AGORA))).toMatchObject({ status: 422, code: 'CERTIFICADO_OUTRO_CNPJ' });
    });

    it('certificado de outra raiz de CNPJ: 422 e nada gravado', async () => {
      const { svc, t } = montar({ certCnpj: '99888777000100', linha: null });
      expect(await recusa(svc.configurar(true, QUEM, AGORA))).toMatchObject({ status: 422, code: 'SEFAZ_CERTIFICADO_OUTRA_EMPRESA' });
      expect(t.sefaz_distribuicao).toHaveLength(0);
    });

    it('ligar grava quem e quando, uma linha "ligada" no histórico, e a situação devolve ligada_por_nome', async () => {
      const { svc, t } = montar({ linha: null });
      const s = await svc.configurar(true, QUEM, AGORA);
      expect(t.sefaz_distribuicao).toHaveLength(1);
      expect(t.sefaz_distribuicao[0]).toMatchObject({
        ambiente: 'producao',
        cnpj: NOSSO,
        busca_ligada: true,
        situacao: 'ok',
        mensagem: null,
        alterada_por: QUEM.id,
        alterada_por_nome: 'Ana',
        alterada_em: AGORA,
      });
      expect(t.sefaz_distribuicao_historico).toHaveLength(1);
      expect(t.sefaz_distribuicao_historico[0]).toMatchObject({ evento: 'ligada', feito_por_nome: 'Ana', feito_em: AGORA });
      expect(s).toMatchObject({ busca_ligada: true, ligada_por_nome: 'Ana', ligada_em: AGORA.toISOString() });
      expect(logs.join('\n')).toContain('"evento":"sefaz.caixa"');
    });

    it('desligar e ligar não antecipa a próxima busca: os quatro campos ficam iguais', async () => {
      const { svc, t } = montar({
        linha: { proxima_consulta_em: MAIS65, bloqueado_ate: MAIS65, ult_nsu: 100n, falhas_seguidas: 2, em_andamento_desde: null },
      });
      const antes = { ...t.sefaz_distribuicao[0]! };
      const desligada = await svc.configurar(false, QUEM, AGORA);
      expect(desligada).toMatchObject({ busca_ligada: false });
      await svc.configurar(true, QUEM, new Date(AGORA.getTime() + 60_000));
      const depois = t.sefaz_distribuicao[0]!;
      expect(depois.proxima_consulta_em).toEqual(antes.proxima_consulta_em);
      expect(depois.bloqueado_ate).toEqual(antes.bloqueado_ate);
      expect(depois.ult_nsu).toBe(100n);
      expect(depois.falhas_seguidas).toBe(2);
      expect(depois.em_andamento_desde).toBeNull();
      expect(t.sefaz_distribuicao_historico.map((h) => h.evento)).toEqual(['desligada', 'ligada']);
    });

    it('ligar de novo depois de parada_conflito: situação ok, mensagem nula, bloqueado_ate intacto', async () => {
      const { svc, t } = montar({
        linha: { busca_ligada: false, situacao: 'parada_conflito', mensagem: 'Outro sistema...', bloqueado_ate: MAIS65 },
      });
      await svc.configurar(true, QUEM, AGORA);
      const l = t.sefaz_distribuicao[0]!;
      expect(l).toMatchObject({ busca_ligada: true, situacao: 'ok', mensagem: null });
      expect(l.bloqueado_ate).toEqual(MAIS65);
    });

    it('desligar sem linha não faz nada', async () => {
      const { svc, t } = montar({ linha: null });
      const s = await svc.configurar(false, QUEM, AGORA);
      expect(t.sefaz_distribuicao).toHaveLength(0);
      expect(t.sefaz_distribuicao_historico).toHaveLength(0);
      expect(s).toMatchObject({ busca_ligada: false });
    });
  });

  describe('situação', () => {
    it('certificado sem clientAuth: aviso do código 280, sem bloquear', async () => {
      const { svc } = montar({ keyUsage: ['1.3.6.1.5.5.7.3.4'] });
      const s = await aberta(svc);
      expect(s.certificado.ok).toBe(true);
      expect(s.certificado.avisos).toEqual([
        'A SEFAZ pode recusar este certificado (código 280). Se a busca falhar, peça ao contador um certificado A1 de empresa novo.',
      ]);
    });

    it('certificado sem a extensão keyUsage não gera aviso', async () => {
      const { svc } = montar({ keyUsage: undefined });
      expect((await aberta(svc)).certificado.avisos).toEqual([]);
    });

    it('certificado vencido: a frase da UX com a data de Brasília', async () => {
      const erro = new CertificadoErro('x', 422, 'CERTIFICADO_VENCIDO', new Date('2026-03-10T15:00:00Z'));
      const { svc } = montar({ certErro: erro });
      expect((await aberta(svc)).certificado).toEqual({
        ok: false,
        code: 'CERTIFICADO_VENCIDO',
        mensagem: 'O certificado digital venceu em 10/03/2026. Envie o renovado para a busca voltar.',
        avisos: [],
      });
    });

    it('sem certificado, ilegível e de outro CNPJ', async () => {
      const a = await aberta(montar({ certErro: new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO') }).svc);
      expect(a.certificado).toMatchObject({
        ok: false,
        code: 'CERTIFICADO_NAO_CADASTRADO',
        mensagem: 'Envie o certificado digital da empresa no quadro acima para ligar a busca.',
      });
      const b = await aberta(montar({ certErro: new CertificadoErro(MSG_USO.ilegivel, 503, 'CERTIFICADO_ILEGIVEL') }).svc);
      expect(b.certificado).toMatchObject({ code: 'CERTIFICADO_ILEGIVEL', mensagem: MSG_USO.ilegivel });
      const c = await aberta(montar({ certErro: new CertificadoErro('De outra empresa.', 422, 'CERTIFICADO_OUTRO_CNPJ') }).svc);
      expect(c.certificado).toMatchObject({ code: 'CERTIFICADO_OUTRO_CNPJ', mensagem: 'De outra empresa.' });
    });

    it('empresa sem CNPJ: EMPRESA_SEM_CNPJ com a frase de SEFAZ_SEM_CNPJ, conferido antes do certificado', async () => {
      const { svc, certificados } = montar({ cnpjEmpresa: '', linha: null });
      const s = await aberta(svc);
      expect(s).toMatchObject({ cnpj: null, busca_ligada: false });
      expect(s.certificado).toMatchObject({
        ok: false,
        code: 'EMPRESA_SEM_CNPJ',
        mensagem: 'Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página.',
      });
      expect(certificados.emUso).not.toHaveBeenCalled();
    });

    it('ligada noutro (ambiente, CNPJ): outro_cnpj_ou_modo verdadeiro; ligada aqui, falso', async () => {
      const outra = linhaCom('sefaz_distribuicao', { ambiente: 'producao', cnpj: '11222333000181', busca_ligada: true });
      const a = montar({ linha: { busca_ligada: false } });
      a.t.sefaz_distribuicao.push(outra);
      expect((await aberta(a.svc)).outro_cnpj_ou_modo).toBe(true);
      const b = montar({ linha: { busca_ligada: true } });
      b.t.sefaz_distribuicao.push(outra);
      expect((await aberta(b.svc)).outro_cnpj_ou_modo).toBe(false);
      const c = montar({ linha: null });
      expect((await aberta(c.svc)).outro_cnpj_ou_modo).toBe(false);
    });

    it('agenda, lacunas, dias sem buscar, em andamento e histórico', async () => {
      const { svc, t } = montar({
        linha: {
          situacao: 'parada_656',
          mensagem: 'x',
          busca_ligada: false,
          ultima_consulta_em: new Date('2026-11-12T17:05:00Z'),
          proxima_consulta_em: MAIS65,
          em_andamento_desde: new Date(AGORA.getTime() - 60_000),
        },
      });
      const consulta = randomUUID();
      t.sefaz_lacunas.push(
        linhaCom('sefaz_lacunas', { ambiente: 'producao', cnpj: NOSSO, nsu_de: 10n, nsu_ate: 14n, causa: 'outro_sistema', consulta_id: consulta }),
        linhaCom('sefaz_lacunas', { ambiente: 'producao', cnpj: NOSSO, nsu_de: 20n, nsu_ate: 20n, causa: 'resposta_perdida', consulta_id: consulta }),
        linhaCom('sefaz_lacunas', {
          ambiente: 'producao', cnpj: NOSSO, nsu_de: 30n, nsu_ate: 39n, causa: 'outro_sistema', consulta_id: consulta, preenchida_em: AGORA,
        }),
      );
      for (let i = 0; i < 7; i++) {
        t.sefaz_distribuicao_historico.push(
          linhaCom('sefaz_distribuicao_historico', {
            ambiente: 'producao', cnpj: NOSSO, evento: 'ligada', situacao: 'ok', feito_em: new Date(AGORA.getTime() - i * 3_600_000),
          }),
        );
      }
      const s = await aberta(svc);
      expect(s).toMatchObject({
        situacao: 'parada_656',
        mensagem: 'x',
        lacunas: 6,
        dias_sem_buscar: 5,
        em_andamento: true,
        proxima_consulta_em: MAIS65.toISOString(),
        ligada_por_nome: null,
      });
      expect(s.historico).toHaveLength(5);
      expect(s.historico[0]!.feito_em).toBe(AGORA.toISOString());
    });

    it('"N notas novas": linhas criadas desde o início do último ciclo com retorno', async () => {
      const { svc, t } = montar({ semear: true, lancadas: LANCADAS, linha: { ultima_consulta_em: AGORA } });
      const ciclo = randomUUID();
      t.sefaz_consultas.push(
        linhaCom('sefaz_consultas', { ciclo_id: ciclo, ambiente: 'producao', cnpj: NOSSO, origem: 'agendada', ult_nsu_enviado: 0n, iniciada_em: new Date(AGORA.getTime() - 60_000), resultado: 'respondida' }),
        linhaCom('sefaz_consultas', { ciclo_id: ciclo, ambiente: 'producao', cnpj: NOSSO, origem: 'agendada', ult_nsu_enviado: 5n, iniciada_em: new Date(AGORA.getTime() - 30_000), resultado: 'respondida' }),
      );
      t.notas_sefaz[0]!.criada_em = new Date(AGORA.getTime() - 3_600_000); // antiga
      const s = await aberta(svc);
      expect(s.ultima_consulta).toEqual({ em: AGORA.toISOString(), novas: 4 });
    });

    it('contagem e canceladas_depois batem com a caixa semeada; o cruzamento é uma consulta só, com chaves e CNPJs normalizados', async () => {
      const { svc, notas } = montar({ semear: true, lancadas: LANCADAS });
      const s = await aberta(svc);
      expect(s.contagem).toEqual({ falta_lancar: 2, parece_lancada: 1, cancelada_depois_de_lancada: 1 });
      expect(s.canceladas_depois).toEqual([{ id: ids.b, numero: '4411', serie: '1', emitente_nome: 'Forn 4411' }]);
      expect(notas.notasLancadas).toHaveBeenCalledTimes(1);
      const arg = notas.notasLancadas.mock.calls[0]![0] as { chaves: string[]; emitentes: string[] };
      expect(arg.chaves.sort()).toEqual([K120, K15, K880, KPARECE, VETOR].sort());
      expect(arg.emitentes.sort()).toEqual([EMIT, FORN].sort());
    });

    it('a caixa de homologação não aparece na situação de produção', async () => {
      const { svc, t } = montar({ semear: true, lancadas: LANCADAS });
      for (const n of t.notas_sefaz) n.ambiente = 'homologacao';
      const s = await aberta(svc);
      expect(s.contagem).toEqual({ falta_lancar: 0, parece_lancada: 0, cancelada_depois_de_lancada: 0 });
      expect(s.canceladas_depois).toEqual([]);
    });
  });

  describe('lista', () => {
    it('a_conferir traz só as situações 1, 6 e 7, por emissão decrescente', async () => {
      const { svc } = montar({ semear: true, lancadas: LANCADAS });
      const r = await svc.listar('a_conferir', 100);
      expect(r.map((n) => [n.chave, n.situacao])).toEqual([
        [KPARECE, 'parece_lancada'],
        [VETOR, 'cancelada_depois_de_lancada'],
        [K880, 'falta_lancar'],
        [K120, 'falta_lancar'],
      ]);
    });

    it('todas traz tudo, com a nota sem data de emissão no fim', async () => {
      const { svc } = montar({ semear: true, lancadas: LANCADAS });
      const r = await svc.listar('todas', 100);
      expect(r.map((n) => n.chave)).toEqual([KPARECE, VETOR, K880, K120, K15]);
      expect(r[4]).toMatchObject({ situacao: 'denegada', emitida_em: null });
    });

    it('campos de cada linha: parecidas (a mais nova primeiro), pode_conferir, nao_parece_compra e valor numérico', async () => {
      const { svc } = montar({ semear: true, lancadas: LANCADAS });
      const r = await svc.listar('todas', 100);
      const por = (c: string) => r.find((n) => n.chave === c)!;
      expect(por(KPARECE).parecidas.map((p) => p.id)).toEqual(['l-novo', 'l-vetor']);
      expect(por(KPARECE).lancada).toBeNull();
      expect(por(VETOR).lancada?.id).toBe('l-vetor');
      expect(por(K880)).toMatchObject({ pode_conferir: true, nao_parece_compra: false, valor_total: 123.45, ignorada: null });
      expect(por(K120)).toMatchObject({ pode_conferir: false, nao_parece_compra: true }); // sem XML completo
      expect(por(KPARECE).pode_conferir).toBe(false); // sem XML completo
      expect(por(VETOR).pode_conferir).toBe(false);
    });

    it('limite: 600 vira 500; 0 e negativo viram 1; 2 corta', async () => {
      const { svc, t } = montar({ semear: true });
      const base = t.notas_sefaz[0]!;
      for (let i = 0; i < 510; i++) {
        t.notas_sefaz.push({ ...base, id: randomUUID(), chave: `35261111222333000181550010${String(i).padStart(9, '0')}1000000000`.slice(0, 44) });
      }
      expect((await svc.listar('todas', 600)).length).toBe(500);
      expect((await svc.listar('todas', 0)).length).toBe(1);
      expect((await svc.listar('todas', 2)).length).toBe(2);
    });

    it('pode_conferir é falso em homologação, e só aparece a caixa do ambiente atual', async () => {
      const { svc, t } = montar({ ambiente: 'homologacao', linha: { ambiente: 'homologacao' }, semear: true });
      const r = await svc.listar('todas', 100);
      expect(r.every((n) => n.pode_conferir === false)).toBe(true);
      // linha de produção semeada à parte nunca entra
      t.notas_sefaz.push({ ...t.notas_sefaz[0]!, id: randomUUID(), ambiente: 'producao', chave: K15 + 'x' });
      expect(await svc.listar('todas', 100)).toHaveLength(5);
    });

    it('outro CNPJ destinatário nunca entra', async () => {
      const { svc, t } = montar({ semear: true });
      t.notas_sefaz[0]!.cnpj_destinatario = '99888777000100';
      expect(await svc.listar('todas', 100)).toHaveLength(4);
    });
  });

  describe('XML', () => {
    it('homologação: 409 SEFAZ_HOMOLOGACAO', async () => {
      const { svc } = montar({ ambiente: 'homologacao', linha: { ambiente: 'homologacao' }, semear: true });
      expect(await recusa(svc.xml(ids.a))).toEqual({
        status: 409,
        code: 'SEFAZ_HOMOLOGACAO',
        message: 'Nota de teste (homologação) não entra no estoque.',
      });
    });
    it('cancelada: 409 SEFAZ_CANCELADA', async () => {
      const { svc } = montar({ semear: true, lancadas: LANCADAS });
      expect(await recusa(svc.xml(ids.b))).toEqual({
        status: 409,
        code: 'SEFAZ_CANCELADA',
        message: 'Esta nota foi cancelada pelo fornecedor e não entra no estoque.',
      });
    });
    it('sem documento completo: 404 SEFAZ_SEM_XML', async () => {
      const { svc } = montar({ semear: true });
      expect(await recusa(svc.xml(ids.d))).toEqual({
        status: 404,
        code: 'SEFAZ_SEM_XML',
        message: 'A SEFAZ ainda não liberou o XML desta nota. Dê entrada pelo arquivo ou pela foto.',
      });
    });
    it('caminho feliz: o XML guardado', async () => {
      const { svc } = montar({ semear: true });
      expect(await svc.xml(ids.a)).toBe('<nfeProc>K880</nfeProc>');
    });
    it('id desconhecido ou de outro CNPJ: 404 NOT_FOUND', async () => {
      const { svc, t } = montar({ semear: true });
      expect(await recusa(svc.xml(ID_FORA))).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Não encontrado.' });
      t.notas_sefaz[0]!.cnpj_destinatario = '99888777000100';
      expect(await recusa(svc.xml(ids.a))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('ignorar e reabrir', () => {
    it('outro sem texto (só espaços): 400 "Escreva o motivo." e nada gravado', async () => {
      const { svc, t } = montar({ semear: true });
      expect(await recusa(svc.ignorar(ids.e, 'outro', '  ', QUEM, AGORA))).toEqual({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Escreva o motivo.',
      });
      expect(t.notas_sefaz.find((n) => n.id === ids.e)!.motivo_ignorar).toBeNull();
    });

    it('ignorar grava as 5 colunas, devolve a linha ignorada e loga id, motivo e usuário; reabrir limpa as 5', async () => {
      const { svc, t } = montar({ semear: true });
      const r = await svc.ignorar(ids.e, 'nao_e_compra', null, QUEM, AGORA);
      expect(r).toMatchObject({
        situacao: 'ignorada',
        ignorada: { em: AGORA.toISOString(), por_nome: 'Ana', motivo: 'nao_e_compra', texto: null },
      });
      expect(t.notas_sefaz.find((n) => n.id === ids.e)).toMatchObject({
        ignorada_em: AGORA, ignorada_por: QUEM.id, ignorada_por_nome: 'Ana', motivo_ignorar: 'nao_e_compra', motivo_texto: null,
      });
      const log = logs.find((l) => l.includes('"acao":"ignorar"'))!;
      expect(JSON.parse(log)).toEqual({ evento: 'sefaz.caixa', acao: 'ignorar', id: ids.e, motivo: 'nao_e_compra', usuario_id: QUEM.id });

      const volta = await svc.reabrir(ids.e, QUEM);
      expect(volta).toMatchObject({ situacao: 'falta_lancar', ignorada: null });
      expect(t.notas_sefaz.find((n) => n.id === ids.e)).toMatchObject({
        ignorada_em: null, ignorada_por: null, ignorada_por_nome: null, motivo_ignorar: null, motivo_texto: null,
      });
      expect(JSON.parse(logs.find((l) => l.includes('"acao":"reabrir"'))!)).toMatchObject({ id: ids.e, usuario_id: QUEM.id });
    });

    it('outro com texto: guarda o texto sem as pontas', async () => {
      const { svc } = montar({ semear: true });
      const r = await svc.ignorar(ids.e, 'outro', '  Nota de outra filial ', QUEM, AGORA);
      expect(r.ignorada).toMatchObject({ motivo: 'outro', texto: 'Nota de outra filial' });
    });

    it('Ignorar comum numa cancelada depois de lançada mantém a situação; "cancelamento_conferido" a deixa ignorada', async () => {
      const { svc } = montar({ semear: true, lancadas: LANCADAS });
      const a = await svc.ignorar(ids.b, 'nao_e_compra', null, QUEM, AGORA);
      expect(a.situacao).toBe('cancelada_depois_de_lancada');
      const b = await svc.ignorar(ids.b, 'cancelamento_conferido', null, QUEM, AGORA);
      expect(b.situacao).toBe('ignorada');
      expect((await aberta(svc)).contagem.cancelada_depois_de_lancada).toBe(0);
    });

    it('id de outro CNPJ ou desconhecido: 404, e nada muda', async () => {
      const { svc, t } = montar({ semear: true });
      t.notas_sefaz.find((n) => n.id === ids.e)!.cnpj_destinatario = '99888777000100';
      expect(await recusa(svc.ignorar(ids.e, 'nao_e_compra', null, QUEM, AGORA))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(await recusa(svc.reabrir(ids.e, QUEM))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(await recusa(svc.ignorar(ID_FORA, 'nao_e_compra', null, QUEM, AGORA))).toMatchObject({ status: 404 });
      expect(t.notas_sefaz.find((n) => n.id === ids.e)!.motivo_ignorar).toBeNull();
    });
  });

  // ------------------------------------------------------------------------------------------------- respostas à SEFAZ

  describe('respostas à SEFAZ', () => {
    const D = 86_400_000;
    const diasAtras = (n: number) => new Date(AGORA.getTime() - n * D);
    const MAIS60S = new Date(AGORA.getTime() + 60_000);
    /** Chave fictícia no formato do esquema (o DV não é conferido aqui). */
    const chaveN = (i: number) => `3526111122233300018155001${String(i).padStart(9, '0')}1000000071`;
    const NOMES = ['ok', 'saida', 'cancelada', 'denegada', 'velha', 'perto', 'perto2', 'semBase', 'semTpNf'] as const;
    type Nome = (typeof NOMES)[number];
    const N = Object.fromEntries(NOMES.map((k) => [k, randomUUID()])) as Record<Nome, string>;
    const CH = Object.fromEntries(NOMES.map((k, i) => [k, chaveN(i + 1)])) as Record<Nome, string>;
    const NPROT = '135260000000001';
    const FRASE_DESLIGADAS = 'As respostas à SEFAZ não estão ativadas neste servidor.';

    /** Variável ligada, respostas ligadas há 7 dias e as notas: respondível, saída, cancelada, denegada, 91 dias, 85 e 82 dias, sem data, sem tipo. */
    function montarR(o: Opcoes = {}) {
      const m = montar({ manifestacao: 'ligada', respostas: { ligada: true, ligada_em: diasAtras(7) }, linha: null, ...o });
      const nota = (k: Nome, x: Record<string, unknown> = {}) =>
        m.t.notas_sefaz.push(
          linhaCom('notas_sefaz', {
            id: N[k],
            ambiente: 'producao',
            cnpj_destinatario: NOSSO,
            chave: CH[k],
            emitente_cnpj: FORN,
            emitente_nome: `Forn ${k}`,
            numero: String(NOMES.indexOf(k) + 101),
            serie: '1',
            situacao_sefaz: 'autorizada',
            tp_nf: 1,
            fin_nfe: 1,
            emitida_em: diasAtras(2),
            autorizada_em: diasAtras(2),
            criada_em: AGORA,
            ...x,
          }),
        );
      nota('ok');
      nota('saida', { tp_nf: 0 });
      nota('cancelada', { situacao_sefaz: 'cancelada', cancelada_em: diasAtras(1) });
      nota('denegada', { situacao_sefaz: 'denegada' });
      nota('velha', { emitida_em: diasAtras(91), autorizada_em: diasAtras(91) });
      nota('perto', { emitida_em: diasAtras(85), autorizada_em: diasAtras(85) });
      nota('perto2', { emitida_em: diasAtras(82), autorizada_em: diasAtras(82) });
      nota('semBase', { emitida_em: null, autorizada_em: null });
      nota('semTpNf', { tp_nf: null });
      return m;
    }
    const evento = (k: Nome, tp: string, x: Record<string, unknown> = {}) =>
      linhaCom('sefaz_manifestacoes', {
        nota_sefaz_id: N[k],
        ambiente: 'producao',
        cnpj: NOSSO,
        chave: CH[k],
        tp_evento: tp,
        origem: tp === '210210' ? 'ciencia_automatica' : 'admin',
        pedida_em: diasAtras(1),
        enviar_apos: diasAtras(1),
        criada_em: diasAtras(1),
        atualizada_em: diasAtras(1),
        ...x,
      });
    const lote = (resultado: string | null) =>
      linhaCom('sefaz_eventos_lotes', { ambiente: 'producao', cnpj: NOSSO, id_lote: 1n, iniciado_em: diasAtras(1), resultado });
    const ign = (svc: CaixaSefazService, k: Nome, motivo: string, texto: string | null = null, avisar = true) =>
      svc.ignorar(N[k], motivo as never, texto, QUEM, AGORA, avisar);
    const notaDe = (t: TabelasSefaz, k: Nome) => t.notas_sefaz.find((n) => n.id === N[k])!;
    /** Nada gravado: nem a nota ignorada, nem evento novo. */
    const nadaMudou = (t: TabelasSefaz, k: Nome, eventos = 0) => {
      expect(notaDe(t, k).motivo_ignorar).toBeNull();
      expect(t.sefaz_manifestacoes).toHaveLength(eventos);
    };
    const linhaDaLista = async (svc: CaixaSefazService, k: Nome) => (await svc.listar('todas', 500, AGORA)).find((l) => l.id === N[k])!;

    describe('ignorar avisando a SEFAZ: as regras, nesta ordem', () => {
      it('1. variável desligada (ausente ou "desligada"): 503 SEFAZ_RESPOSTAS_DESLIGADAS, e nada muda', async () => {
        for (const manifestacao of [undefined, 'desligada']) {
          const { svc, t } = montarR({ manifestacao });
          expect(await recusa(ign(svc, 'ok', 'nao_reconheco'))).toEqual({
            status: 503,
            code: 'SEFAZ_RESPOSTAS_DESLIGADAS',
            message: FRASE_DESLIGADAS,
          });
          nadaMudou(t, 'ok');
        }
      });

      it('2. respostas não ligadas (sem linha, ou desligadas): 409 SEFAZ_RESPOSTAS_NAO_LIGADAS', async () => {
        for (const respostas of [undefined, { ligada: false }]) {
          const { svc, t } = montarR({ respostas });
          expect(await recusa(ign(svc, 'ok', 'nao_reconheco'))).toEqual({
            status: 409,
            code: 'SEFAZ_RESPOSTAS_NAO_LIGADAS',
            message: 'As respostas à SEFAZ estão desligadas. Ligue em Configurações → Notas da SEFAZ.',
          });
          nadaMudou(t, 'ok');
        }
      });

      it('3. "Outro motivo" e o "Ciente" do cancelamento não avisam: 400 VALIDATION_ERROR', async () => {
        for (const [motivo, texto] of [
          ['outro', 'Nota de outra filial'],
          ['cancelamento_conferido', null],
        ] as const) {
          const { svc, t } = montarR();
          expect(await recusa(ign(svc, 'ok', motivo, texto))).toEqual({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'Este motivo não avisa a SEFAZ.',
          });
          nadaMudou(t, 'ok');
        }
      });

      it('4. nota de saída, cancelada, denegada, sem data ou sem tipo: 409 SEFAZ_NAO_RESPONDIVEL', async () => {
        for (const k of ['saida', 'cancelada', 'denegada', 'semBase', 'semTpNf'] as const) {
          const { svc, t } = montarR();
          expect(await recusa(ign(svc, k, 'lancada_de_outro_jeito'))).toEqual({
            status: 409,
            code: 'SEFAZ_NAO_RESPONDIVEL',
            message: 'Esta nota não aceita resposta à SEFAZ.',
          });
          nadaMudou(t, k);
        }
      });

      it('5. passou o prazo de 90 dias da autorização: 409 SEFAZ_PRAZO_PASSOU (no 90º dia exato já passou; 1 s antes, não)', async () => {
        const { svc, t } = montarR();
        expect(await recusa(ign(svc, 'velha', 'nao_reconheco'))).toEqual({
          status: 409,
          code: 'SEFAZ_PRAZO_PASSOU',
          message: 'Passou o prazo de 90 dias para responder à SEFAZ sobre esta nota.',
        });
        nadaMudou(t, 'velha');
        const base = notaDe(t, 'ok').autorizada_em!.getTime();
        expect(await recusa(svc.ignorar(N.ok, 'nao_reconheco', null, QUEM, new Date(base + 90 * D), true))).toMatchObject({
          status: 409,
          code: 'SEFAZ_PRAZO_PASSOU',
        });
        await svc.ignorar(N.ok, 'nao_reconheco', null, QUEM, new Date(base + 90 * D - 1000), true);
        expect(t.sefaz_manifestacoes).toHaveLength(1);
      });

      it('6. resposta final ativa (na fila, enviando, registrada ou falhou): 409 SEFAZ_JA_RESPONDIDA', async () => {
        for (const situacao of ['na_fila', 'enviando', 'registrada', 'falhou']) {
          const { svc, t } = montarR();
          t.sefaz_manifestacoes.push(evento('ok', '210200', { situacao, origem: 'dar_entrada' }));
          expect(await recusa(ign(svc, 'ok', 'nao_reconheco'))).toEqual({
            status: 409,
            code: 'SEFAZ_JA_RESPONDIDA',
            message: 'Esta nota já tem resposta final na SEFAZ.',
          });
          nadaMudou(t, 'ok', 1);
        }
      });

      it('7. a justificativa da "compra não aconteceu": 400 com as três frases', async () => {
        const casos: [string | null, string][] = [
          ['Pedido cancela', 'Conte o que houve com pelo menos 15 letras.'], // 14
          [null, 'Conte o que houve com pelo menos 15 letras.'],
          ['   \n  ', 'Conte o que houve com pelo menos 15 letras.'],
          ['a'.repeat(256), 'Use no máximo 255 letras.'],
          ['Devolvido 🍅 inteiro', 'Use só letras, números e pontuação comum (sem emoji).'],
        ];
        for (const [texto, message] of casos) {
          const { svc, t } = montarR();
          expect(await recusa(ign(svc, 'ok', 'compra_nao_aconteceu', texto))).toEqual({ status: 400, code: 'VALIDATION_ERROR', message });
          nadaMudou(t, 'ok');
        }
        const { svc, t } = montarR();
        await ign(svc, 'ok', 'compra_nao_aconteceu', 'Pedido cancelad'); // 15
        expect(t.sefaz_manifestacoes[0]).toMatchObject({ tp_evento: '210240', x_just: 'Pedido cancelad' });
      });

      it('"A compra não aconteceu" sem avisar a SEFAZ: 400 "Este motivo sempre avisa a SEFAZ.", mesmo com as respostas desligadas', async () => {
        for (const o of [{}, { manifestacao: undefined }]) {
          const { svc, t } = montarR(o);
          expect(await recusa(ign(svc, 'ok', 'compra_nao_aconteceu', 'Pedido cancelado pelo fornecedor', false))).toEqual({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'Este motivo sempre avisa a SEFAZ.',
          });
          nadaMudou(t, 'ok');
        }
      });

      it('a ordem: cada regra vem antes das seguintes', async () => {
        // 1 antes de 3
        expect(await recusa(ign(montarR({ manifestacao: undefined }).svc, 'saida', 'outro', 'x'))).toMatchObject({
          code: 'SEFAZ_RESPOSTAS_DESLIGADAS',
        });
        // 2 antes de 3 e 4
        expect(await recusa(ign(montarR({ respostas: { ligada: false } }).svc, 'saida', 'outro', 'x'))).toMatchObject({
          code: 'SEFAZ_RESPOSTAS_NAO_LIGADAS',
        });
        // 3 antes de 4
        expect(await recusa(ign(montarR().svc, 'saida', 'outro', 'x'))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        // 4 antes de 5: cancelada e velha
        const a = montarR();
        notaDe(a.t, 'velha').situacao_sefaz = 'cancelada';
        expect(await recusa(ign(a.svc, 'velha', 'nao_reconheco'))).toMatchObject({ code: 'SEFAZ_NAO_RESPONDIVEL' });
        // 5 antes de 6: velha com resposta final ativa
        const b = montarR();
        b.t.sefaz_manifestacoes.push(evento('velha', '210200', { situacao: 'na_fila' }));
        expect(await recusa(ign(b.svc, 'velha', 'nao_reconheco'))).toMatchObject({ code: 'SEFAZ_PRAZO_PASSOU' });
        // 6 antes de 7: resposta final ativa e justificativa curta
        const c = montarR();
        c.t.sefaz_manifestacoes.push(evento('ok', '210220', { situacao: 'registrada' }));
        expect(await recusa(ign(c.svc, 'ok', 'compra_nao_aconteceu', 'curta'))).toMatchObject({ code: 'SEFAZ_JA_RESPONDIDA' });
      });
    });

    describe('ignorar avisando a SEFAZ: o evento', () => {
      it('cada motivo pede o evento certo; sem a caixa marcada, nenhum (o Ignorar da entrega 2)', async () => {
        const casos = [
          ['lancada_de_outro_jeito', null, '210200', 'confirmacao'],
          ['nao_e_compra', null, '210200', 'confirmacao'],
          ['nao_reconheco', null, '210220', 'nao_reconheco'],
          ['compra_nao_aconteceu', 'Pedido cancelado pelo fornecedor', '210240', 'nao_aconteceu'],
        ] as const;
        for (const [motivo, texto, tp, tipo] of casos) {
          const { svc, t } = montarR();
          const r = await ign(svc, 'ok', motivo, texto);
          expect(t.sefaz_manifestacoes).toHaveLength(1);
          expect(t.sefaz_manifestacoes[0]).toMatchObject({ tp_evento: tp, x_just: tp === '210240' ? texto : null });
          expect(r).toMatchObject({ situacao: 'ignorada', ignorada: { motivo } });
          expect(r.resposta?.final).toMatchObject({ estado: 'na_fila', tipo, origem: 'admin', protocolo: null, mensagem: null });
          expect(r.resposta?.pode_responder).toBe(false);
        }
        for (const motivo of ['lancada_de_outro_jeito', 'nao_e_compra', 'nao_reconheco']) {
          const { svc, t } = montarR();
          const r = await ign(svc, 'ok', motivo, null, false);
          expect(r).toMatchObject({ situacao: 'ignorada', ignorada: { motivo } });
          expect(t.sefaz_manifestacoes).toHaveLength(0);
        }
      });

      it('o evento do admin: na fila, 60 s de espera, autoria, sem tentativas; a nota ignorada junto, sob a trava das respostas', async () => {
        const { svc, t, chavesUsadas } = montarR();
        await ign(svc, 'ok', 'nao_reconheco', '  não conheço  ');
        expect(t.sefaz_manifestacoes).toHaveLength(1);
        expect(t.sefaz_manifestacoes[0]).toMatchObject({
          nota_sefaz_id: N.ok,
          ambiente: 'producao',
          cnpj: NOSSO,
          chave: CH.ok,
          tp_evento: '210220',
          n_seq: 1,
          x_just: null,
          origem: 'admin',
          pedida_por: QUEM.id,
          pedida_por_nome: 'Ana',
          pedida_em: AGORA,
          enviar_apos: MAIS60S,
          situacao: 'na_fila',
          tentativas: 0,
          lote_id: null,
          xml_evento: null,
        });
        expect(notaDe(t, 'ok')).toMatchObject({
          ignorada_em: AGORA,
          ignorada_por: QUEM.id,
          ignorada_por_nome: 'Ana',
          motivo_ignorar: 'nao_reconheco',
          motivo_texto: 'não conheço',
        });
        expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS]);
        expect(JSON.parse(logs.find((l) => l.includes('"acao":"ignorar"'))!)).toEqual({
          evento: 'sefaz.caixa',
          acao: 'ignorar',
          id: N.ok,
          motivo: 'nao_reconheco',
          tp_evento: '210220',
          usuario_id: QUEM.id,
        });
      });

      it('a ciência na fila que nunca saiu vira cancelada; a que já saiu (tentativa ou lote que chegou lá) e a registrada ficam', async () => {
        const casos: [Record<string, unknown>, string | null, string][] = [
          [{ situacao: 'na_fila' }, null, 'cancelada'],
          [{ situacao: 'na_fila' }, 'falha_antes_de_enviar', 'cancelada'],
          [{ situacao: 'na_fila', tentativas: 1 }, null, 'na_fila'],
          [{ situacao: 'na_fila' }, 'respondida', 'na_fila'],
          [{ situacao: 'na_fila' }, 'interrompida', 'na_fila'],
          [{ situacao: 'registrada', n_prot: NPROT, c_stat: 135 }, null, 'registrada'],
        ];
        for (const [x, resultado, fica] of casos) {
          const { svc, t } = montarR();
          const l = resultado ? lote(resultado) : null;
          if (l) t.sefaz_eventos_lotes.push(l);
          t.sefaz_manifestacoes.push(evento('ok', '210210', { ...x, lote_id: l?.id ?? null }));
          await ign(svc, 'ok', 'lancada_de_outro_jeito');
          expect([t.sefaz_manifestacoes[0]!.tp_evento, t.sefaz_manifestacoes[0]!.situacao]).toEqual(['210210', fica]);
          expect(t.sefaz_manifestacoes[1]).toMatchObject({ tp_evento: '210200', situacao: 'na_fila' });
        }
      });

      it('Review Focus 3: o 2º ignorar com aviso (outra aba) é 409 SEFAZ_JA_RESPONDIDA e não cria outro evento', async () => {
        const { svc, t } = montarR();
        await ign(svc, 'ok', 'nao_reconheco');
        expect(await recusa(ign(svc, 'ok', 'lancada_de_outro_jeito'))).toEqual({
          status: 409,
          code: 'SEFAZ_JA_RESPONDIDA',
          message: 'Esta nota já tem resposta final na SEFAZ.',
        });
        expect(t.sefaz_manifestacoes).toHaveLength(1);
        expect(notaDe(t, 'ok').motivo_ignorar).toBe('nao_reconheco');
      });

      it('nota e evento juntos: o INSERT do evento falha → a nota não fica ignorada e a ciência continua na fila', async () => {
        const { svc, t, prisma } = montarR();
        t.sefaz_manifestacoes.push(evento('ok', '210210', { situacao: 'na_fila' }));
        jest.spyOn(prisma.sefaz_manifestacoes, 'create').mockRejectedValueOnce(new Error('falha no banco'));
        await expect(ign(svc, 'ok', 'nao_reconheco')).rejects.toThrow('falha no banco');
        expect(notaDe(t, 'ok')).toMatchObject({ ignorada_em: null, motivo_ignorar: null });
        expect(t.sefaz_manifestacoes.map((e) => [e.tp_evento, e.situacao])).toEqual([['210210', 'na_fila']]);
      });

      it('o índice de uma resposta final por chave recusa (corrida entre duas abas): 409 SEFAZ_JA_RESPONDIDA, nada gravado', async () => {
        const { svc, t, prisma } = montarR();
        jest
          .spyOn(prisma.sefaz_manifestacoes, 'create')
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('sefaz_manifestacoes_uma_final', { code: 'P2002', clientVersion: 'x' }),
          );
        expect(await recusa(ign(svc, 'ok', 'nao_reconheco'))).toEqual({
          status: 409,
          code: 'SEFAZ_JA_RESPONDIDA',
          message: 'Esta nota já tem resposta final na SEFAZ.',
        });
        nadaMudou(t, 'ok');
      });

      it('resposta do mesmo tipo recusada pela SEFAZ ainda ocupa a vaga do evento: 409 SEFAZ_NAO_RESPONDIVEL; outro tipo segue', async () => {
        const { svc, t } = montarR();
        t.sefaz_manifestacoes.push(evento('ok', '210220', { situacao: 'recusada', c_stat: 1234 }));
        expect(await recusa(ign(svc, 'ok', 'nao_reconheco'))).toEqual({
          status: 409,
          code: 'SEFAZ_NAO_RESPONDIVEL',
          message: 'Esta nota não aceita resposta à SEFAZ.',
        });
        nadaMudou(t, 'ok', 1);
        await ign(svc, 'ok', 'lancada_de_outro_jeito');
        expect(t.sefaz_manifestacoes.map((e) => [e.tp_evento, e.situacao])).toEqual([
          ['210220', 'recusada'],
          ['210200', 'na_fila'],
        ]);
      });

      it('Review Focus 4: a justificativa digitada no celular é gravada normalizada, no evento e na nota', async () => {
        const casos = [
          ['Mercadoria devolvida — “recusada” na porta’', 'Mercadoria devolvida - "recusada" na porta\''],
          ['  pedido\ncancelado pelo fornecedor  ', 'pedido cancelado pelo fornecedor'],
          ['pedido\u0085cancelado pelo fornecedor', 'pedido cancelado pelo fornecedor'],
        ];
        for (const [digitado, gravado] of casos) {
          const { svc, t } = montarR();
          const r = await ign(svc, 'ok', 'compra_nao_aconteceu', digitado);
          expect(t.sefaz_manifestacoes[0]!.x_just).toBe(gravado);
          expect(notaDe(t, 'ok').motivo_texto).toBe(gravado);
          expect(r.ignorada?.texto).toBe(gravado);
        }
      });
    });

    describe('reabrir', () => {
      it('Review Focus 2: cancela o evento do admin ainda na fila; o enviando e o registrado ficam; sob a trava das respostas', async () => {
        const { svc, t, chavesUsadas } = montarR();
        const l = lote(null);
        t.sefaz_eventos_lotes.push(l);
        t.sefaz_manifestacoes.push(
          evento('ok', '210220', { situacao: 'na_fila', enviar_apos: MAIS60S }),
          evento('perto', '210220', { situacao: 'enviando', tentativas: 1, lote_id: l.id }),
          evento('perto2', '210220', { situacao: 'registrada', n_prot: NPROT, c_stat: 135 }),
        );
        for (const k of ['ok', 'perto', 'perto2'] as const) {
          notaDe(t, k).ignorada_em = AGORA;
          notaDe(t, k).motivo_ignorar = 'nao_reconheco';
        }
        const r = await svc.reabrir(N.ok, QUEM, AGORA);
        expect(r).toMatchObject({ situacao: 'falta_lancar', ignorada: null, resposta: { final: null, pode_responder: true } });
        await svc.reabrir(N.perto, QUEM, AGORA);
        await svc.reabrir(N.perto2, QUEM, AGORA);
        expect(t.sefaz_manifestacoes.map((e) => e.situacao)).toEqual(['cancelada', 'enviando', 'registrada']);
        expect(t.sefaz_manifestacoes[0]!.atualizada_em).toEqual(AGORA);
        expect(notaDe(t, 'perto').motivo_ignorar).toBeNull();
        expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS, CHAVE_TRAVA_SEFAZ_EVENTOS, CHAVE_TRAVA_SEFAZ_EVENTOS]);
      });

      it('não cancela o que já saiu nem o automático: evento do admin de volta à fila depois de enviado, confirmação do "Dar entrada" e ciência', async () => {
        const casos: [string, Record<string, unknown>][] = [
          ['210220', { situacao: 'na_fila', tentativas: 1 }],
          ['210200', { situacao: 'na_fila', origem: 'dar_entrada' }],
          ['210210', { situacao: 'na_fila' }],
        ];
        for (const [tp, x] of casos) {
          const { svc, t } = montarR();
          t.sefaz_manifestacoes.push(evento('ok', tp, x));
          await svc.reabrir(N.ok, QUEM, AGORA);
          expect(t.sefaz_manifestacoes[0]!.situacao).toBe('na_fila');
        }
      });

      it('ignorar avisando, reabrir (Desfazer) e ignorar de novo: o evento cancelado não ocupa a vaga', async () => {
        const { svc, t } = montarR();
        await ign(svc, 'ok', 'nao_reconheco');
        await svc.reabrir(N.ok, QUEM, AGORA);
        const r = await ign(svc, 'ok', 'compra_nao_aconteceu', 'Pedido cancelado pelo fornecedor');
        expect(t.sefaz_manifestacoes.map((e) => [e.tp_evento, e.situacao])).toEqual([
          ['210220', 'cancelada'],
          ['210240', 'na_fila'],
        ]);
        expect(r.resposta?.final).toMatchObject({ tipo: 'nao_aconteceu', estado: 'na_fila' });
      });
    });

    describe('responder de novo', () => {
      it('o evento que falhou mais recente volta à fila com 0 tentativas e sai já; o outro fica; sob a trava das respostas', async () => {
        const { svc, t, chavesUsadas } = montarR();
        t.sefaz_manifestacoes.push(
          evento('ok', '210210', { situacao: 'falhou', tentativas: 3, atualizada_em: diasAtras(3) }),
          evento('ok', '210220', { situacao: 'falhou', tentativas: 3, atualizada_em: diasAtras(1), x_motivo: MOTIVO_SEM_ASSINATURA }),
        );
        const r = await svc.responderDeNovo(N.ok, QUEM, AGORA);
        expect(t.sefaz_manifestacoes[1]).toMatchObject({ situacao: 'na_fila', tentativas: 0, enviar_apos: AGORA, atualizada_em: AGORA });
        expect(t.sefaz_manifestacoes[0]).toMatchObject({ situacao: 'falhou', tentativas: 3 });
        expect(r.resposta?.final).toMatchObject({ tipo: 'nao_reconheco', estado: 'na_fila', mensagem: null });
        expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS]);
        expect(JSON.parse(logs.find((l) => l.includes('"acao":"responder_de_novo"'))!)).toMatchObject({ id: N.ok, usuario_id: QUEM.id });
      });

      it('sem evento que falhou: 409 SEFAZ_NADA_A_REENVIAR, e nada muda', async () => {
        const { svc, t } = montarR();
        t.sefaz_manifestacoes.push(
          evento('ok', '210210', { situacao: 'registrada', n_prot: NPROT, c_stat: 135 }),
          evento('ok', '210220', { situacao: 'recusada', c_stat: 650 }),
        );
        const antes = t.sefaz_manifestacoes.map((e) => ({ ...e }));
        expect(await recusa(svc.responderDeNovo(N.ok, QUEM, AGORA))).toEqual({
          status: 409,
          code: 'SEFAZ_NADA_A_REENVIAR',
          message: 'Não há resposta para enviar de novo nesta nota.',
        });
        expect(t.sefaz_manifestacoes).toEqual(antes);
      });

      it('id desconhecido ou de outro CNPJ: 404; servidor sem a busca: 503 SEFAZ_DESLIGADA', async () => {
        const { svc, t } = montarR();
        expect(await recusa(svc.responderDeNovo(ID_FORA, QUEM, AGORA))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
        notaDe(t, 'ok').cnpj_destinatario = '99888777000100';
        expect(await recusa(svc.responderDeNovo(N.ok, QUEM, AGORA))).toMatchObject({ status: 404 });
        expect(await recusa(montar({ ambiente: 'desligado' }).svc.responderDeNovo(N.ok, QUEM, AGORA))).toMatchObject({
          status: 503,
          code: 'SEFAZ_DESLIGADA',
        });
      });
    });

    describe('ligar e desligar as respostas', () => {
      it('variável desligada (ou a busca desligada no servidor): 503 SEFAZ_RESPOSTAS_DESLIGADAS, e nada gravado', async () => {
        for (const o of [{ manifestacao: undefined }, { ambiente: 'desligado' }]) {
          const { svc, t } = montar({ ...o, linha: null });
          for (const ligar of [true, false]) {
            expect(await recusa(svc.configurarRespostas(ligar, QUEM, AGORA))).toEqual({
              status: 503,
              code: 'SEFAZ_RESPOSTAS_DESLIGADAS',
              message: FRASE_DESLIGADAS,
            });
          }
          expect(t.sefaz_manifestacao).toHaveLength(0);
          expect(t.sefaz_distribuicao_historico).toHaveLength(0);
        }
      });

      it('as conferências e as frases de "Ligar a busca": sem certificado, sem CNPJ, outra raiz; nada gravado', async () => {
        const casos: [Opcoes, { status: number; code: string }][] = [
          [
            { certErro: new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO') },
            { status: 503, code: 'CERTIFICADO_NAO_CADASTRADO' },
          ],
          [{ cnpjEmpresa: '' }, { status: 422, code: 'SEFAZ_SEM_CNPJ' }],
          [{ certCnpj: '99888777000100' }, { status: 422, code: 'SEFAZ_CERTIFICADO_OUTRA_EMPRESA' }],
        ];
        for (const [o, esperado] of casos) {
          const { svc, t } = montar({ manifestacao: 'ligada', linha: null, ...o });
          expect(await recusa(svc.configurarRespostas(true, QUEM, AGORA))).toMatchObject(esperado);
          expect(t.sefaz_manifestacao).toHaveLength(0);
          expect(t.sefaz_distribuicao_historico).toHaveLength(0);
        }
        const { svc } = montar({
          manifestacao: 'ligada',
          linha: null,
          certErro: new CertificadoErro(MSG_USO.naoCadastrado, 503, 'CERTIFICADO_NAO_CADASTRADO'),
        });
        expect((await recusa(svc.configurarRespostas(true, QUEM, AGORA))).message).toBe(MSG_USO.naoCadastrado);
      });

      it('ligar: linha ligada, ok, sem frase, falhas zeradas, ligada_em e autoria; histórico respostas_ligadas; só a trava das respostas', async () => {
        const { svc, t, chavesUsadas } = montar({ manifestacao: 'ligada', linha: null });
        const s = await svc.configurarRespostas(true, QUEM, AGORA);
        expect(t.sefaz_manifestacao).toHaveLength(1);
        expect(t.sefaz_manifestacao[0]).toMatchObject({
          ambiente: 'producao',
          cnpj: NOSSO,
          ligada: true,
          situacao: 'ok',
          mensagem: null,
          falhas_seguidas: 0,
          pausa_ate: null,
          ligada_em: AGORA,
          alterada_por: QUEM.id,
          alterada_por_nome: 'Ana',
          alterada_em: AGORA,
        });
        expect(t.sefaz_distribuicao_historico).toHaveLength(1);
        expect(t.sefaz_distribuicao_historico[0]).toMatchObject({
          ambiente: 'producao',
          cnpj: NOSSO,
          evento: 'respostas_ligadas',
          situacao: 'ok',
          feito_por: QUEM.id,
          feito_por_nome: 'Ana',
          feito_em: AGORA,
        });
        expect(chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS]);
        expect(chavesUsadas).not.toContain(CHAVE_TRAVA_SEFAZ);
        if (s.ambiente === 'desligado') throw new Error('desligado');
        expect(s.respostas).toMatchObject({
          disponivel: true,
          ligadas: true,
          situacao: 'ok',
          ligadas_por_nome: 'Ana',
          ligadas_em: AGORA.toISOString(),
        });
        expect(s.busca_ligada).toBe(false);
        expect(s.historico).toEqual([]); // o histórico da busca não mostra as respostas
        expect(JSON.parse(logs.find((l) => l.includes('"acao":"ligar_respostas"'))!)).toEqual({
          evento: 'sefaz.caixa',
          acao: 'ligar_respostas',
          usuario_id: QUEM.id,
        });
      });

      it('ligar de novo depois de uma parada: volta ok e zera as falhas, sem reescrever ligada_em nem a pausa; aparece quem religou', async () => {
        const antes = {
          ligada: true,
          ligada_em: diasAtras(7),
          situacao: 'parada_656',
          mensagem: 'A SEFAZ bloqueou as respostas duas vezes em 24 horas.',
          falhas_seguidas: 2,
          pausa_ate: MAIS65,
          alterada_por: '0b8f5c2e-1111-4000-8000-000000000002',
          alterada_por_nome: 'Diego',
          alterada_em: diasAtras(7),
        };
        const { svc, t } = montar({ manifestacao: 'ligada', linha: null, respostas: antes });
        const s = await svc.configurarRespostas(true, QUEM, AGORA);
        expect(t.sefaz_manifestacao[0]).toMatchObject({
          ligada: true,
          situacao: 'ok',
          mensagem: null,
          falhas_seguidas: 0,
          ligada_em: diasAtras(7),
          pausa_ate: MAIS65,
          alterada_por_nome: 'Ana',
          alterada_em: AGORA,
        });
        if (s.ambiente === 'desligado') throw new Error('desligado');
        expect(s.respostas).toMatchObject({
          ligadas: true,
          situacao: 'ok',
          mensagem: null,
          ligadas_por_nome: 'Ana',
          ligadas_em: AGORA.toISOString(),
        });
        expect(s.respostas.pausa_ate).toBe(MAIS65.toISOString());
      });

      it('ligar depois de desligadas grava ligada_em de novo (as notas lançadas enquanto desligadas não são confirmadas)', async () => {
        const { svc, t } = montar({ manifestacao: 'ligada', linha: null, respostas: { ligada: false, ligada_em: diasAtras(7) } });
        await svc.configurarRespostas(true, QUEM, AGORA);
        expect(t.sefaz_manifestacao[0]).toMatchObject({ ligada: true, ligada_em: AGORA });
      });

      it('desligar: só ligada = false, autoria e o histórico; pausa, falhas, ligada_em, situação e a fila ficam', async () => {
        const m = montarR({
          respostas: {
            ligada: true,
            ligada_em: diasAtras(7),
            situacao: 'parada_relogio',
            mensagem: 'x',
            falhas_seguidas: 1,
            pausa_ate: MAIS65,
          },
        });
        m.t.sefaz_manifestacoes.push(
          evento('ok', '210210', { situacao: 'na_fila' }),
          evento('perto', '210220', { situacao: 'na_fila', enviar_apos: MAIS60S }),
        );
        const fila = m.t.sefaz_manifestacoes.map((e) => ({ ...e }));
        const s = await m.svc.configurarRespostas(false, QUEM, AGORA);
        expect(m.t.sefaz_manifestacao[0]).toMatchObject({
          ligada: false,
          ligada_em: diasAtras(7),
          situacao: 'parada_relogio',
          mensagem: 'x',
          falhas_seguidas: 1,
          pausa_ate: MAIS65,
          alterada_por_nome: 'Ana',
          alterada_em: AGORA,
        });
        expect(m.t.sefaz_manifestacoes).toEqual(fila);
        expect(m.t.sefaz_distribuicao_historico.map((h) => [h.evento, h.situacao, h.feito_por_nome])).toEqual([
          ['respostas_desligadas', 'parada_relogio', 'Ana'],
        ]);
        expect(m.chavesUsadas).toEqual([CHAVE_TRAVA_SEFAZ_EVENTOS]);
        if (s.ambiente === 'desligado') throw new Error('desligado');
        expect(s.respostas).toMatchObject({ ligadas: false, ligadas_por_nome: null, ligadas_em: null, na_fila: 2 });
        // ligar de novo também não mexe na fila nem na pausa
        await m.svc.configurarRespostas(true, QUEM, new Date(AGORA.getTime() + 1000));
        expect(m.t.sefaz_manifestacoes).toEqual(fila);
        expect(m.t.sefaz_manifestacao[0]!.pausa_ate).toEqual(MAIS65);
      });

      it('desligar sem linha (ou sem CNPJ) não grava nada', async () => {
        for (const o of [{}, { cnpjEmpresa: '' }]) {
          const { svc, t } = montar({ manifestacao: 'ligada', linha: null, ...o });
          await svc.configurarRespostas(false, QUEM, AGORA);
          expect(t.sefaz_manifestacao).toHaveLength(0);
          expect(t.sefaz_distribuicao_historico).toHaveLength(0);
        }
      });
    });

    describe('situação e caixa com as respostas', () => {
      it('variável desligada: respostas.disponivel = false (o resto vazio) e cada linha com resposta null', async () => {
        const { svc } = montar({ semear: true, respostas: { ligada: true } });
        const s = await aberta(svc);
        expect(s.respostas).toEqual({
          disponivel: false,
          ligadas: false,
          situacao: 'ok',
          mensagem: null,
          pausa_ate: null,
          ligadas_por_nome: null,
          ligadas_em: null,
          na_fila: 0,
          falharam: 0,
          prazos_perto: [],
        });
        const r = await svc.listar('todas', 100, AGORA);
        expect(r).toHaveLength(5);
        expect(r.every((l) => l.resposta === null)).toBe(true);
      });

      it('empresa sem CNPJ: respostas disponíveis e desligadas', async () => {
        const { svc } = montar({ manifestacao: 'ligada', cnpjEmpresa: '', linha: null });
        expect((await aberta(svc)).respostas).toMatchObject({ disponivel: true, ligadas: false, na_fila: 0, prazos_perto: [] });
      });

      it('quadro das respostas: a linha, a fila, as que falharam e as notas perto do prazo (a que vence primeiro antes)', async () => {
        const m = montarR({
          respostas: {
            ligada: true,
            ligada_em: diasAtras(7),
            situacao: 'ok',
            mensagem: 'A SEFAZ pediu para esperar. As respostas saem de novo às 15h10.',
            pausa_ate: MAIS65,
            alterada_por_nome: 'Diego',
            alterada_em: diasAtras(7),
          },
        });
        m.t.sefaz_manifestacoes.push(
          evento('ok', '210210', { situacao: 'na_fila' }),
          evento('saida', '210220', { situacao: 'na_fila' }),
          evento('semTpNf', '210220', { situacao: 'falhou', tentativas: 3 }),
          evento('perto2', '210210', { situacao: 'registrada', n_prot: NPROT, c_stat: 135 }),
          evento('perto', '210210', { situacao: 'registrada', n_prot: NPROT, c_stat: 135 }),
          evento('cancelada', '210220', { situacao: 'enviando', tentativas: 1 }),
          // de outro CNPJ: não conta
          linhaCom('sefaz_manifestacoes', {
            nota_sefaz_id: randomUUID(),
            ambiente: 'producao',
            cnpj: '99888777000100',
            chave: chaveN(99),
            tp_evento: '210210',
            origem: 'ciencia_automatica',
            enviar_apos: AGORA,
            situacao: 'na_fila',
          }),
        );
        const s = await aberta(m.svc);
        expect(s.respostas).toEqual({
          disponivel: true,
          ligadas: true,
          situacao: 'ok',
          mensagem: 'A SEFAZ pediu para esperar. As respostas saem de novo às 15h10.',
          pausa_ate: MAIS65.toISOString(),
          ligadas_por_nome: 'Diego',
          ligadas_em: diasAtras(7).toISOString(),
          na_fila: 2,
          falharam: 1,
          prazos_perto: [
            {
              id: N.perto,
              numero: '106',
              serie: '1',
              emitente_nome: 'Forn perto',
              prazo_final: new Date(diasAtras(85).getTime() + 90 * D).toISOString(),
            },
            {
              id: N.perto2,
              numero: '107',
              serie: '1',
              emitente_nome: 'Forn perto2',
              prazo_final: new Date(diasAtras(82).getTime() + 90 * D).toISOString(),
            },
          ],
        });
      });

      it('linha da caixa: ciência e resposta final (a mais recente fora as canceladas), prazo em ISO e pode_responder', async () => {
        const m = montarR();
        m.t.sefaz_manifestacoes.push(
          evento('ok', '210210', {
            situacao: 'registrada',
            n_prot: NPROT,
            c_stat: 135,
            criada_em: diasAtras(2),
            atualizada_em: diasAtras(1),
          }),
          evento('ok', '210210', { situacao: 'cancelada', n_seq: 1, criada_em: AGORA, atualizada_em: AGORA }),
          evento('ok', '210220', { situacao: 'recusada', c_stat: 650, criada_em: diasAtras(2), atualizada_em: diasAtras(2) }),
          evento('ok', '210200', {
            situacao: 'registrada',
            origem: 'dar_entrada',
            n_prot: '13526000000000123',
            c_stat: 135,
            criada_em: diasAtras(1),
            atualizada_em: AGORA,
          }),
          evento('perto', '210210', { situacao: 'registrada', n_prot: NPROT, c_stat: 135 }),
          evento('perto2', '210210', { situacao: 'na_fila' }), // nunca saiu: não acende o aviso
        );
        const ok = await linhaDaLista(m.svc, 'ok');
        expect(ok.resposta).toEqual({
          ciencia: { estado: 'registrada', em: diasAtras(1).toISOString(), protocolo: NPROT, c_stat: 135, mensagem: null },
          final: {
            estado: 'registrada',
            em: AGORA.toISOString(),
            protocolo: '13526000000000123',
            c_stat: 135,
            mensagem: null,
            tipo: 'confirmacao',
            origem: 'dar_entrada',
          },
          prazo_final: new Date(diasAtras(2).getTime() + 90 * D).toISOString(),
          prazo_perto: false,
          prazo_passou: false,
          pode_responder: false,
        });
        expect((await linhaDaLista(m.svc, 'perto')).resposta).toMatchObject({
          prazo_perto: true,
          prazo_passou: false,
          pode_responder: true,
          final: null,
        });
        expect((await linhaDaLista(m.svc, 'perto2')).resposta).toMatchObject({ prazo_perto: false, pode_responder: true });
        expect((await linhaDaLista(m.svc, 'velha')).resposta).toMatchObject({
          ciencia: null,
          final: null,
          prazo_passou: true,
          pode_responder: false,
        });
        expect((await linhaDaLista(m.svc, 'semBase')).resposta).toEqual({
          ciencia: null,
          final: null,
          prazo_final: null,
          prazo_perto: false,
          prazo_passou: false,
          pode_responder: false,
        });
        for (const k of ['saida', 'cancelada', 'denegada', 'semTpNf'] as const) {
          expect((await linhaDaLista(m.svc, k)).resposta?.pode_responder).toBe(false);
        }
      });

      it('pode_responder não depende de as respostas estarem ligadas (o painel diz se estão)', async () => {
        const { svc } = montarR({ respostas: { ligada: false } });
        expect((await linhaDaLista(svc, 'ok')).resposta?.pode_responder).toBe(true);
      });

      it('mensagem: a frase da recusa pelo código; "O XML não pôde ser assinado."; nunca o texto da SEFAZ', async () => {
        const m = montarR();
        m.t.sefaz_manifestacoes.push(
          evento('ok', '210220', { situacao: 'recusada', c_stat: 650, x_motivo: 'Rejeicao: NF-e cancelada' }),
          evento('perto', '210210', { situacao: 'recusada', c_stat: 655, x_motivo: 'Rejeicao: ja existe evento' }),
          evento('perto', '210240', {
            situacao: 'recusada',
            c_stat: 1234,
            x_just: 'Pedido cancelado pelo fornecedor',
            x_motivo: 'Rejeicao: x',
          }),
          evento('perto2', '210210', { situacao: 'falhou', tentativas: 0, x_motivo: MOTIVO_SEM_ASSINATURA }),
          evento('perto2', '210220', { situacao: 'falhou', tentativas: 3, c_stat: 999, x_motivo: 'Rejeicao: erro nao catalogado' }),
          evento('semTpNf', '210210', { situacao: 'na_fila', c_stat: 656, x_motivo: 'Rejeicao: consumo indevido' }),
        );
        const ok = (await linhaDaLista(m.svc, 'ok')).resposta!;
        expect(ok.final?.mensagem).toBe('A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.');
        const perto = (await linhaDaLista(m.svc, 'perto')).resposta!;
        expect(perto.ciencia?.mensagem).toBe('Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.');
        expect(perto.final).toMatchObject({
          tipo: 'nao_aconteceu',
          mensagem: 'A SEFAZ não aceitou a resposta (código 1234). Fale com o seu contador.',
        });
        const perto2 = (await linhaDaLista(m.svc, 'perto2')).resposta!;
        expect(perto2.ciencia).toMatchObject({ estado: 'falhou', mensagem: 'O XML não pôde ser assinado.' });
        expect(perto2.final).toMatchObject({ estado: 'falhou', c_stat: 999, mensagem: null });
        expect((await linhaDaLista(m.svc, 'semTpNf')).resposta?.ciencia).toMatchObject({ estado: 'na_fila', c_stat: 656, mensagem: null });
        expect(JSON.stringify(await m.svc.listar('todas', 500, AGORA))).not.toContain('Rejeicao');
      });

      it('o histórico da busca só mostra ligada, desligada e parada automática (os 5 mais recentes delas)', async () => {
        const { svc, t } = montar({ manifestacao: 'ligada' });
        const h = (evento: string, minutos: number) =>
          linhaCom('sefaz_distribuicao_historico', {
            ambiente: 'producao',
            cnpj: NOSSO,
            evento,
            situacao: 'ok',
            feito_em: new Date(AGORA.getTime() - minutos * 60_000),
          });
        t.sefaz_distribuicao_historico.push(
          h('ligada', 60),
          h('desligada', 50),
          ...[1, 2, 3, 4, 5, 6].map((i) => h(i % 2 ? 'respostas_ligadas' : 'respostas_paradas', i)),
          h('respostas_desligadas', 7),
        );
        expect((await aberta(svc)).historico.map((x) => x.evento)).toEqual(['desligada', 'ligada']);
      });
    });
  });
});
