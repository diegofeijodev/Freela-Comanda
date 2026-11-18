import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FastifyReply } from 'fastify';

/**
 * Normaliza TODA resposta de erro para { error: { code, message } } (contrato §1).
 *
 * Erros do Postgres que o protótipo mostrava na tela (o Supabase repassava a mensagem) chegam aqui como erros do Prisma:
 *  - `raise exception` das funções de regra (SQLSTATE P0001) → 400 `REGRA` com o MESMO texto ("Já existe um inventário em
 *    andamento", "Há itens sem quantidade final"...);
 *  - unique (P2002 / 23505) → 409 `DUPLICADO`; chave estrangeira (P2003 / 23503) → 409 `EM_USO`;
 *  - outra violação de restrição (CHECK, NOT NULL…) → 500 genérico, e o log leva só o SQLSTATE e o nome da restrição, nunca a
 *    mensagem do banco (a linha recusada pode ter o CPF do consumidor do cupom fiscal: `restricaoDoBanco`).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, code, message } = this.resolve(exception);
    reply.status(status).send({ error: { code, message } });
  }

  private resolve(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') return { status, code: HttpStatus[status] ?? 'ERROR', message: body };
      const b = body as Record<string, unknown>;
      let message = (b.message as string) ?? exception.message;
      if (Array.isArray(b.message)) message = (b.message as string[]).join(' | ');
      const code = (b.code as string) ?? (b.error as string)?.toUpperCase()?.replace(/\s+/g, '_') ?? 'ERROR';
      return { status, code, message };
    }
    const pg = postgresError(exception);
    if (pg) return pg;
    const r = restricaoDoBanco(exception);
    if (r) {
      // nem a mensagem nem a pilha (a 1ª linha da pilha repete a mensagem): a linha recusada pode trazer o CPF do consumidor
      this.logger.error(
        `Violação de restrição do banco (SQLSTATE ${r.sqlstate}${r.restricao ? `, ${r.restricao}` : ''}); a mensagem do banco não vai para o log.`,
      );
    } else if (exception instanceof Error) this.logger.error(exception.message, exception.stack);
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' };
  }
}

/** Mapeia erros do banco que viram mensagem de tela. `null` = erro de verdade (500). */
export function postgresError(exception: unknown): { status: number; code: string; message: string } | null {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return { status: 409, code: 'DUPLICADO', message: 'Já existe um registro com esses dados.' };
    if (exception.code === 'P2003') return { status: 409, code: 'EM_USO', message: 'Registro em uso por outros dados.' };
    if (exception.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Não encontrado.' };
    // $queryRaw/$executeRaw: o erro do Postgres vem em meta.code / meta.message.
    if (exception.code === 'P2010') {
      const meta = (exception.meta ?? {}) as { code?: string; message?: string };
      return fromSqlState(meta.code, meta.message);
    }
  }
  return null;
}

const SQLSTATE_23 = /(?:code: "|Code: `)(23[0-9A-Z]{3})\b/;
const RESTRICAO = /constraint \\?"([A-Za-z0-9_]+)\\?"/;

/**
 * Violação de restrição do banco que não virou mensagem de tela (SQLSTATE da classe 23: CHECK, NOT NULL, FK, UNIQUE, EXCLUDE; os serviços
 * validam antes de gravar, então é defeito): a mensagem crua do driver traz a linha recusada ("Failing row contains (...)"), e no cupom
 * fiscal ela tem o CPF do consumidor. Devolve só o SQLSTATE e o nome da restrição (o que o log pode levar); null = outro erro.
 */
export function restricaoDoBanco(exception: unknown): { sqlstate: string; restricao: string | null } | null {
  if (!(exception instanceof Error)) return null;
  const known = exception instanceof Prisma.PrismaClientKnownRequestError ? exception : null;
  const meta = (known?.meta ?? {}) as { code?: unknown; message?: unknown };
  const texto = `${exception.message}\n${typeof meta.message === 'string' ? meta.message : ''}`;
  const sqlstate =
    (typeof meta.code === 'string' && /^23[0-9A-Z]{3}$/.test(meta.code) ? meta.code : null) ??
    SQLSTATE_23.exec(texto)?.[1] ??
    (known && (known.code === 'P2004' || known.code === 'P2011') ? '23000' : null) ??
    (/Failing row contains|violates [a-z -]*constraint/i.test(texto) ? '23000' : null);
  if (sqlstate === null) return null;
  return { sqlstate, restricao: RESTRICAO.exec(texto)?.[1] ?? null };
}

function fromSqlState(sqlState: string | undefined, raw: string | undefined): { status: number; code: string; message: string } | null {
  const message =
    (raw ?? '')
      .replace(/^ERROR:\s*/, '')
      .split('\n')[0]
      ?.trim() ?? '';
  if (sqlState === 'P0001') return { status: 400, code: 'REGRA', message };
  if (sqlState === '23505') return { status: 409, code: 'DUPLICADO', message: 'Já existe um registro com esses dados.' };
  if (sqlState === '23503') return { status: 409, code: 'EM_USO', message: 'Registro em uso por outros dados.' };
  return null;
}
