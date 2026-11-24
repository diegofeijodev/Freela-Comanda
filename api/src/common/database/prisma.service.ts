import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { empresaAtual, SCHEMA_PADRAO } from './empresa-contexto';
import { urlDoSchema } from './migrar-schema';

/**
 * Cliente do schema `public`: cadastro de empresas, usuários e os dados da empresa que já existia antes do multiempresa.
 * Use-o (e não o `PrismaService`) para ler/gravar `users` e o cadastro de `empresas` — o que vale para todas as empresas.
 */
@Injectable()
export class NucleoService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Conexões por schema de empresa (o `public` usa o próprio núcleo). Poucas por empresa: a máquina é dividida. */
const CONEXOES_POR_EMPRESA = 3;

// Declaração mesclada: para o TypeScript o PrismaService É um PrismaClient (os serviços continuam `this.prisma.x`).
export interface PrismaService extends PrismaClient {}

/**
 * Cliente das regras de negócio, já na empresa da requisição: cada acesso (`this.prisma.vendas`, `$transaction`, `$queryRaw`…)
 * vai para o cliente do schema escolhido pelo guard (`empresaAtual()`). Sem contexto (agendador, scripts) = `public`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger('PrismaService');
  private readonly clientes = new Map<string, PrismaClient>();

  constructor(readonly nucleo: NucleoService) {
    return new Proxy(this, {
      get(alvo, prop, receptor) {
        if (prop in alvo) return Reflect.get(alvo, prop, receptor);
        const c = alvo.cliente(empresaAtual().schema);
        const v = Reflect.get(c, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
      },
    });
  }

  /** Cliente de um schema (criado na primeira vez; conecta sob demanda). */
  cliente(schema: string): PrismaClient {
    if (schema === SCHEMA_PADRAO) return this.nucleo;
    let c = this.clientes.get(schema);
    if (!c) {
      const base = process.env.DATABASE_URL;
      if (!base) throw new Error('DATABASE_URL ausente');
      c = new PrismaClient({ datasources: { db: { url: urlDoSchema(base, schema, CONEXOES_POR_EMPRESA) } } });
      this.clientes.set(schema, c);
    }
    return c;
  }

  /** Fecha (e esquece) o cliente de um schema — usado quando a empresa é excluída. */
  async esquecer(schema: string): Promise<void> {
    const c = this.clientes.get(schema);
    this.clientes.delete(schema);
    await c?.$disconnect().catch(() => undefined);
  }

  async onModuleDestroy() {
    for (const [schema, c] of this.clientes) {
      await c.$disconnect().catch((e: unknown) => this.logger.warn(`desconectar ${schema}: ${String(e)}`));
    }
    this.clientes.clear();
  }
}
