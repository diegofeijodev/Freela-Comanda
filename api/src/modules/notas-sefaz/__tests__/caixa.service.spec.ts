import { randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { sefaz_distribuicao } from '@prisma/client';
import { CertificadoErro, MSG_USO, type CertificadoEmUso } from '../../certificado-digital/certificado-digital.port';
import type { NotaLancada, NotasService } from '../../notas/notas.service';
import { SefazDfeFalso } from '../../sefaz/__tests__/sefaz-dfe.falso';
import { CaixaSefazService } from '../caixa.service';
import { CicloSefazService } from '../ciclo.service';
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
  cnpjEmpresa?: string;
  certErro?: CertificadoErro;
  certCnpj?: string;
  keyUsage?: string[] | undefined;
  linha?: Partial<sefaz_distribuicao> | null;
  lancadas?: NotaLancada[];
  semear?: boolean;
};

function montar(o: Opcoes = {}) {
  const ambiente = o.ambiente ?? 'producao';
  const { prisma, t } = montarPrismaSefaz({ cnpjEmpresa: o.cnpjEmpresa });
  if (o.linha !== null && o.linha !== undefined) {
    t.sefaz_distribuicao.push(linhaCom('sefaz_distribuicao', { ambiente, cnpj: NOSSO, busca_ligada: true, ult_nsu: 100n, ...o.linha }));
  }
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
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const ciclo = new CicloSefazService(prisma, config, certificados, new SefazDfeFalso());
  const lancadas = o.lancadas ?? [];
  const notas = { notasLancadas: jest.fn(async () => lancadas) } as unknown as NotasService;
  const svc = new CaixaSefazService(prisma, ciclo, notas, certificados);
  if (o.semear) semear(t, ambiente);
  return { svc, t, certificados, notas: notas as unknown as { notasLancadas: jest.Mock }, ciclo };
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
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
  });
  afterEach(() => jest.restoreAllMocks());

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
});
