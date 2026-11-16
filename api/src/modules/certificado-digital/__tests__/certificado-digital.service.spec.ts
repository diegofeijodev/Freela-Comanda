/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória, formato livre */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../../../common/database/prisma.service';
import { decifrar } from '../../../common/cripto/cripto';
import type { CadeiaIcp } from '../cadeia';
import { CertificadoDigitalService, ROTULO_CERTIFICADO } from '../certificado-digital.service';
import * as adapter from '../pkcs12.adapter';

const fx = (nome: string): Buffer => readFileSync(join(__dirname, 'fixtures', nome));
const b64 = (nome: string) => fx(nome).toString('base64');
const SENHA = 'senha-de-teste';
const SEGREDO = 'segredo-do-certificado-de-teste-0123456789';
const AGORA = new Date('2027-06-01T12:00:00Z');
const ICP: CadeiaIcp = { ancoras: [new X509Certificate(fx('raiz-teste.pem'))], pacote: [] };
const QUEM = { id: 'u1', nome: 'Ana' };

function montar(env: Record<string, string> = { CERTIFICADO_SECRET: SEGREDO }, cnpj = '12.345.678/0001-95') {
  const est: { linha: any; hist: any[]; cnpj: string } = { linha: null, hist: [], cnpj };
  const topo = { upsertChamado: 0, createChamado: 0 };
  const ordem: string[] = [];
  const tx = {
    $executeRaw: async () => void ordem.push('trava'),
    certificado_digital: {
      findUnique: async () => (ordem.push('leitura'), est.linha),
      upsert: async ({ create, update }: any) => (est.linha = est.linha ? { ...est.linha, ...update } : create),
      deleteMany: async () => ((est.linha = null), { count: 1 }),
    },
    certificado_digital_historico: { create: async ({ data }: any) => void est.hist.push(data) },
  };
  const falha = { create: false };
  const prisma = {
    certificado_digital: {
      findUnique: async () => est.linha,
      upsert: async () => void topo.upsertChamado++,
    },
    certificado_digital_historico: {
      findMany: async ({ take }: any) => [...est.hist].reverse().slice(0, take),
      create: async () => void topo.createChamado++,
    },
    configuracoes: { findUnique: async () => ({ cnpj: est.cnpj }) },
    $transaction: async (cb: any) => {
      const snap = { linha: est.linha, hist: [...est.hist] };
      const txUsado = falha.create
        ? { ...tx, certificado_digital_historico: { create: async () => Promise.reject(new Error('falha no histórico')) } }
        : tx;
      try {
        return await cb(txUsado);
      } catch (e) {
        est.linha = snap.linha;
        est.hist = snap.hist;
        throw e;
      }
    },
  } as unknown as PrismaService;
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return { svc: new CertificadoDigitalService(prisma, config, ICP), est, topo, falha, ordem };
}

const recusa = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as any).getResponse() as { code: string; message: string };
  }
  throw new Error('não recusou');
};

describe('CertificadoDigitalService', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'warn', 'error'] as const)
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  });
  afterEach(() => jest.restoreAllMocks());

  it('sem segredo: status = sem_segredo e enviar = 503 sem gravar nada', async () => {
    const { svc, est } = montar({});
    expect((await svc.status(AGORA)).situacao).toBe('sem_segredo');
    const r = await recusa(svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA));
    expect(r.code).toBe('CERTIFICADO_SEM_SEGREDO');
    expect(est.linha).toBeNull();
    expect(est.hist).toEqual([]);
  });

  it('enviar o válido: resposta, linha cifrada e escrita só pela transação', async () => {
    const { svc, est, topo } = montar();
    const r = await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    expect(r).toMatchObject({ situacao: 'valido', cadeia_conferida: true, enviado_por_nome: 'Ana', cnpj: '12345678000195', cnpj_confere: 'igual' });
    expect(r.historico[0]).toMatchObject({ evento: 'enviado', feito_por_nome: 'Ana' });
    expect(est.linha.material_cifrado).not.toContain('BEGIN');
    const m = JSON.parse(decifrar(est.linha.material_cifrado, SEGREDO, ROTULO_CERTIFICADO)!);
    expect(m.cadeia_pem).toHaveLength(1);
    expect(m.chave_pkcs8_pem).toContain('BEGIN PRIVATE KEY');
    expect(topo).toEqual({ upsertChamado: 0, createChamado: 0 });
    expect(logs.some((l) => l.includes(est.linha.impressao_digital))).toBe(true);
  });

  it('não vaza nada: respostas, recusas e logs sem BEGIN, senha nem trecho do arquivo', async () => {
    const { svc } = montar();
    const arq = b64('valido.pfx');
    const textos: string[] = [JSON.stringify(await svc.enviar(arq, SENHA, QUEM, AGORA)), JSON.stringify(await svc.status(AGORA))];
    textos.push(JSON.stringify(await recusa(svc.enviar(arq, 'errada', QUEM, AGORA))));
    textos.push(JSON.stringify(await recusa(svc.enviar(b64('outro-cnpj.pfx'), SENHA, QUEM, AGORA))));
    textos.push(JSON.stringify(await recusa(svc.enviar(Buffer.from('texto qualquer').toString('base64'), SENHA, QUEM, AGORA))));
    for (const t of [...textos, ...logs]) {
      for (const proibido of ['BEGIN', 'PRIVATE', 'senha-de-teste', 'errada', arq.slice(100, 140)]) expect(t).not.toContain(proibido);
    }
    expect(logs.length).toBeGreaterThan(0);
  });

  it('erro inesperado vira CERTIFICADO_FORMATO e não vai para o log', async () => {
    const { svc } = montar();
    jest.spyOn(adapter, 'abrirPfx').mockImplementation(() => {
      throw new Error('falhou com senha-de-teste');
    });
    const r = await recusa(svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA));
    expect(r.code).toBe('CERTIFICADO_FORMATO');
    expect(JSON.stringify(r)).not.toContain('senha-de-teste');
    expect(logs.join('\n')).not.toContain('senha-de-teste');
    expect(logs.join('\n')).toContain('certificado recusado: CERTIFICADO_FORMATO');
  });

  it('erro inesperado: o log leva a classe e a pilha, nunca a mensagem', async () => {
    const { svc } = montar();
    jest.spyOn(adapter, 'abrirPfx').mockImplementation(() => {
      throw new TypeError('falhou com SEGREDO-123\n    at fingido (SEGREDO-123)');
    });
    await recusa(svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA));
    const log = logs.join('\n');
    expect(log).toContain('TypeError');
    expect(log).toContain('certificado recusado: CERTIFICADO_FORMATO');
    expect(log).not.toContain('SEGREDO-123');
  });

  it('o log não leva o id de quem fez', async () => {
    const { svc } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, { id: 'ID-DO-USUARIO-9', nome: 'Ana' }, AGORA);
    await svc.remover({ id: 'ID-DO-USUARIO-9', nome: 'Ana' }, AGORA);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('ID-DO-USUARIO-9');
  });

  it('enviar e remover começam pela trava; remover grava o que foi apagado e uma única vez', async () => {
    const { svc, est, ordem } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    await svc.enviar(b64('mesma-raiz-filial.pfx'), SENHA, QUEM, AGORA);
    expect(ordem.slice(0, 2)).toEqual(['trava', 'leitura']);
    ordem.length = 0;
    await svc.remover(QUEM, AGORA);
    expect(ordem.slice(0, 2)).toEqual(['trava', 'leitura']);
    expect(est.hist.at(-1)).toMatchObject({ evento: 'removido', cnpj: '12345678000276' });
    await svc.remover(QUEM, AGORA);
    await svc.remover(QUEM, AGORA);
    expect(est.hist.filter((h) => h.evento === 'removido')).toHaveLength(1);
  });

  it('base64 inválido ou vazio = CERTIFICADO_ARQUIVO', async () => {
    const { svc } = montar();
    expect((await recusa(svc.enviar('isto não é base64!', SENHA, QUEM, AGORA))).code).toBe('CERTIFICADO_ARQUIVO');
    expect((await recusa(svc.enviar('   ', SENHA, QUEM, AGORA))).code).toBe('CERTIFICADO_ARQUIVO');
  });

  it('senha errada duas vezes: nada gravado', async () => {
    const { svc, est } = montar();
    for (let i = 0; i < 2; i++) expect((await recusa(svc.enviar(b64('valido.pfx'), 'errada', QUEM, AGORA))).code).toBe('CERTIFICADO_SENHA');
    expect(est.linha).toBeNull();
    expect((await svc.status(AGORA)).historico).toEqual([]);
  });

  it('substituição: só troca se o novo passa; histórico e rollback', async () => {
    const { svc, est, falha } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    const r = await svc.enviar(b64('mesma-raiz-filial.pfx'), SENHA, QUEM, new Date(AGORA.getTime() + 60_000));
    expect(r.cnpj_confere).toBe('mesma_raiz');
    expect(r.historico.map((h) => h.evento)).toEqual(['substituido', 'enviado']);
    const impressao = est.linha.impressao_digital;
    expect((await recusa(svc.enviar(b64('outro-cnpj.pfx'), SENHA, QUEM, AGORA))).code).toBe('CERTIFICADO_OUTRO_CNPJ');
    expect(est.linha.impressao_digital).toBe(impressao);
    expect((await svc.status(AGORA)).historico).toHaveLength(2);
    falha.create = true;
    await expect(svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA)).rejects.toThrow();
    expect(est.linha.impressao_digital).toBe(impressao);
  });

  it('segredo trocado: ilegivel (com titular e CNPJ); reenviar vira substituido', async () => {
    const a = montar();
    await a.svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    const b = montar({ CERTIFICADO_SECRET: 'outro-segredo-do-certificado-0123456789-x' });
    b.est.linha = a.est.linha;
    const s = await b.svc.status(AGORA);
    expect(s).toMatchObject({ situacao: 'ilegivel', titular: 'EMPRESA DE TESTE LTDA', cnpj: '12345678000195' });
    const r = await b.svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    expect(r.historico[0]!.evento).toBe('substituido');
    expect(r.situacao).toBe('valido');
  });

  it('CNPJ da empresa muda depois: cnpj_confere = diferente, situação segue válida', async () => {
    const { svc, est } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    est.cnpj = '99.888.777/0001-00';
    expect(await svc.status(AGORA)).toMatchObject({ cnpj_confere: 'diferente', situacao: 'valido' });
  });

  it('vencimento: por dia civil de SP e pelo instante', async () => {
    const { svc } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    expect(await svc.status(new Date('2035-12-31T02:59:59Z'))).toMatchObject({ situacao: 'vencendo', dias_restantes: 1 });
    expect(await svc.status(new Date('2035-12-31T03:00:00Z'))).toMatchObject({ situacao: 'vencendo', dias_restantes: 0 });
    expect((await svc.status(new Date('2036-01-01T00:00:00Z'))).situacao).toBe('vencido');
  });

  it('remover: com linha vira ausente + histórico; de novo não mexe no histórico', async () => {
    const { svc } = montar();
    await svc.enviar(b64('valido.pfx'), SENHA, QUEM, AGORA);
    const r = await svc.remover(QUEM, AGORA);
    expect(r.situacao).toBe('ausente');
    expect(r.historico[0]).toMatchObject({ evento: 'removido', feito_por_nome: 'Ana' });
    const n = r.historico.length;
    const r2 = await svc.remover(QUEM, AGORA);
    expect(r2.situacao).toBe('ausente');
    expect(r2.historico).toHaveLength(n);
  });

  it('histórico limitado a 5, do mais novo para o mais velho', async () => {
    const { svc } = montar();
    let r = await svc.status(AGORA);
    for (let i = 0; i < 6; i++) r = await svc.enviar(b64('valido.pfx'), SENHA, QUEM, new Date(AGORA.getTime() + i * 60_000));
    expect(r.historico).toHaveLength(5);
    expect(r.historico[0]!.evento).toBe('substituido');
    expect(r.historico[4]!.evento).toBe('substituido');
    expect(r.enviado_em).toEqual(new Date(AGORA.getTime() + 5 * 60_000));
  });
});
