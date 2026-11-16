/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória, formato livre */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { X509Certificate, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { CadeiaIcp } from '../cadeia';
import { CertificadoDigitalController } from '../certificado-digital.controller';
import { CertificadoDigitalModule } from '../certificado-digital.module';
import { CERTIFICADO_DIGITAL, CertificadoErro } from '../certificado-digital.port';
import { CertificadoDigitalService } from '../certificado-digital.service';

const fx = (nome: string): Buffer => readFileSync(join(__dirname, 'fixtures', nome));
const SENHA = 'senha-de-teste';
const SEGREDO = 'segredo-do-certificado-de-teste-0123456789';
const AGORA = new Date('2027-06-01T12:00:00Z');
const ICP: CadeiaIcp = { ancoras: [new X509Certificate(fx('raiz-teste.pem'))], pacote: [] };
const QUEM = { id: 'u1', nome: 'Ana' };

function montar(env: Record<string, string> = { CERTIFICADO_SECRET: SEGREDO }, cnpj = '12.345.678/0001-95') {
  const est: { linha: any; hist: any[]; cnpj: string } = { linha: null, hist: [], cnpj };
  const tx = {
    $executeRaw: async () => undefined,
    certificado_digital: {
      findUnique: async () => est.linha,
      upsert: async ({ create, update }: any) => (est.linha = est.linha ? { ...est.linha, ...update } : create),
      deleteMany: async () => ((est.linha = null), { count: 1 }),
    },
    certificado_digital_historico: { create: async ({ data }: any) => void est.hist.push(data) },
  };
  const prisma = {
    certificado_digital: { findUnique: async () => est.linha },
    certificado_digital_historico: { findMany: async ({ take }: any) => [...est.hist].reverse().slice(0, take) },
    configuracoes: { findUnique: async () => ({ cnpj: est.cnpj }) },
    $transaction: async (cb: any) => cb(tx),
  } as unknown as PrismaService;
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return { svc: new CertificadoDigitalService(prisma, config, ICP), est };
}

const cadastrado = async (cnpj?: string) => {
  const m = montar(undefined, cnpj);
  await m.svc.enviar(fx('valido.pfx').toString('base64'), SENHA, QUEM, AGORA);
  return m;
};

const erro = async (p: Promise<unknown>): Promise<CertificadoErro> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CertificadoErro);
    return e as CertificadoErro;
  }
  throw new Error('não recusou');
};

describe('porta CERTIFICADO_DIGITAL (emUso)', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'warn', 'error'] as const)
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  });
  afterEach(() => jest.restoreAllMocks());

  it('sem linha: 503 CERTIFICADO_NAO_CADASTRADO', async () => {
    const { svc } = montar();
    const e = await erro(svc.emUso(AGORA));
    expect(e).toMatchObject({ status: 503, code: 'CERTIFICADO_NAO_CADASTRADO', message: 'Cadastre o certificado digital em Configurações.' });
  });

  it('segredo trocado: 503 CERTIFICADO_ILEGIVEL', async () => {
    const a = await cadastrado();
    const b = montar({ CERTIFICADO_SECRET: 'outro-segredo-do-certificado-0123456789-x' });
    b.est.linha = a.est.linha;
    const e = await erro(b.svc.emUso(AGORA));
    expect(e).toMatchObject({
      status: 503,
      code: 'CERTIFICADO_ILEGIVEL',
      message: 'O certificado salvo não pode ser lido (a chave do servidor mudou). Envie o .pfx de novo em Configurações.',
    });
  });

  it('linha sem segredo no servidor: 503 CERTIFICADO_ILEGIVEL', async () => {
    const a = await cadastrado();
    const b = montar({});
    b.est.linha = a.est.linha;
    expect(await erro(b.svc.emUso(AGORA))).toMatchObject({ status: 503, code: 'CERTIFICADO_ILEGIVEL' });
  });

  it('material cifrado que não é o esperado: 503 CERTIFICADO_ILEGIVEL, sem texto de biblioteca', async () => {
    const a = await cadastrado();
    a.est.linha = { ...a.est.linha, material_cifrado: 'lixo' };
    const e = await erro(a.svc.emUso(AGORA));
    expect(e.code).toBe('CERTIFICADO_ILEGIVEL');
  });

  it('vencido: 422 com a data do vencimento', async () => {
    const { svc } = await cadastrado();
    const e = await erro(svc.emUso(new Date('2036-06-01T12:00:00Z')));
    expect(e).toMatchObject({
      status: 422,
      code: 'CERTIFICADO_VENCIDO',
      message: 'O certificado digital venceu em 31/12/2035. Envie o renovado em Configurações.',
    });
  });

  it('empresa mudou para outra raiz de CNPJ: 422 CERTIFICADO_OUTRO_CNPJ', async () => {
    const { svc, est } = await cadastrado();
    est.cnpj = '99.888.777/0001-00';
    const e = await erro(svc.emUso(AGORA));
    expect(e).toMatchObject({ status: 422, code: 'CERTIFICADO_OUTRO_CNPJ' });
    expect(e.message).toContain('12.345.678/0001-95');
    expect(e.message).toContain('99.888.777/0001-00');
  });

  it('CNPJ da filial (mesma raiz) passa; empresa sem CNPJ também', async () => {
    const { svc, est } = await cadastrado('12.345.678/0002-76');
    expect((await svc.emUso(AGORA)).cnpj).toBe('12345678000195');
    est.cnpj = '';
    expect((await svc.emUso(AGORA)).cnpj).toBe('12345678000195');
  });

  it('certificado em uso: chave RSA, CNPJ, impressão digital e assinatura que confere', async () => {
    const { svc, est } = await cadastrado();
    const r = await svc.emUso(AGORA);
    expect(r.chavePrivada.asymmetricKeyType).toBe('rsa');
    expect(r.cnpj).toBe('12345678000195');
    expect(r.impressaoDigital).toBe(est.linha.impressao_digital);
    expect(r.validoAte).toEqual(est.linha.valido_ate);
    expect(r.certificado).toBeInstanceOf(X509Certificate);
    expect(r.cadeia).toHaveLength(1);
    const assinatura = sign('sha256', Buffer.from('x'), r.chavePrivada);
    expect(verify('sha256', Buffer.from('x'), r.certificado.publicKey, assinatura)).toBe(true);
  });

  it('decifra a cada chamada (sem cache): objetos novos e troca de segredo vale na hora', async () => {
    const { svc, est } = await cadastrado();
    const a = await svc.emUso(AGORA);
    const b = await svc.emUso(AGORA);
    expect(a.chavePrivada).not.toBe(b.chavePrivada);
    est.linha = { ...est.linha, material_cifrado: 'lixo' };
    await erro(svc.emUso(AGORA));
  });

  it('sem "agora": usa o relógio de verdade (o certificado de teste ainda vale)', async () => {
    const { svc } = await cadastrado();
    await expect(svc.emUso()).resolves.toBeDefined();
  });

  it('vazamento: JSON, inspect, erros e logs sem PRIVATE', async () => {
    const { svc, est } = await cadastrado();
    const r = await svc.emUso(AGORA);
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
    expect(inspect(r, { depth: 5 })).not.toContain('PRIVATE');
    est.cnpj = '99.888.777/0001-00';
    const textos = [(await erro(svc.emUso(AGORA))).message, (await erro(svc.emUso(new Date('2036-06-01T12:00:00Z')))).message, ...logs];
    for (const t of textos) expect(t).not.toMatch(/PRIVATE|BEGIN/);
  });

  it('não é rota HTTP: o módulo exporta a porta e nenhum método dela tem rota (a lista exata fica no permissoes-protecao.spec)', () => {
    expect(Reflect.getMetadata('exports', CertificadoDigitalModule)).toContain(CERTIFICADO_DIGITAL);
    const proto = CertificadoDigitalController.prototype as unknown as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(proto)).not.toContain('emUso');
    expect(Reflect.getMetadata(PATH_METADATA, CertificadoDigitalService.prototype.emUso)).toBeUndefined();
  });
});

describe('rastroSeguro (via enviar)', () => {
  it('mensagem trocada depois de a pilha ser lida: nenhum pedaço da pilha no log', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const)
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    const adapter = await import('../pkcs12.adapter');
    jest.spyOn(adapter, 'abrirPfx').mockImplementation(() => {
      const e = new TypeError('original');
      e.stack = 'TypeError: original\n    at SEGREDO-123 (arquivo.ts:1:1)';
      e.message = 'trocada';
      throw e;
    });
    const { svc } = montar();
    await expect(svc.enviar(fx('valido.pfx').toString('base64'), SENHA, QUEM, AGORA)).rejects.toThrow();
    const log = logs.join('\n');
    expect(log).toContain('TypeError');
    expect(log).not.toContain('SEGREDO-123');
    jest.restoreAllMocks();
  });
});
