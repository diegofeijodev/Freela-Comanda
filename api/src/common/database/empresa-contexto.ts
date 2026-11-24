import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Multiempresa: cada empresa tem um schema próprio no Postgres (cópia inteira das tabelas, views e funções — as regras em SQL
 * não mudam). O guard decide a empresa da requisição e o `EmpresaInterceptor` roda o handler dentro deste contexto; o
 * `PrismaService` lê daqui qual cliente (schema) usar. Fora de requisição (agendador, scripts) vale `public`, a menos que o
 * código rode em `rodarNaEmpresa`.
 */
export interface EmpresaContexto {
  /** Schema do Postgres (`public` = a empresa que já existia antes do multiempresa). */
  schema: string;
  /** Id da empresa no cadastro (`public.empresas`); null = schema `public` sem empresa cadastrada (instalação nova). */
  empresaId: string | null;
}

export const SCHEMA_PADRAO = 'public';
export const NOME_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

const als = new AsyncLocalStorage<EmpresaContexto>();

export function empresaAtual(): EmpresaContexto {
  return als.getStore() ?? { schema: SCHEMA_PADRAO, empresaId: null };
}

export function rodarNaEmpresa<T>(ctx: EmpresaContexto, fn: () => T): T {
  if (!NOME_SCHEMA.test(ctx.schema)) throw new Error('schema de empresa inválido');
  return als.run(ctx, fn);
}

/** Nome do schema de uma empresa nova: `empresa_` + 12 hex do id (estável e válido como identificador). */
export const schemaDaEmpresa = (id: string) => `empresa_${id.replace(/-/g, '').slice(0, 12).toLowerCase()}`;
