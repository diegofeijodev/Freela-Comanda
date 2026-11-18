import { Logger, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter, postgresError, restricaoDoBanco } from '../filters/http-exception.filter';

const erro = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '5.22.0', meta });

describe('erros do banco que viram mensagem de tela', () => {
  it('raise exception das funções de regra → 400 REGRA com o texto do protótipo', () => {
    expect(postgresError(erro('P2010', { code: 'P0001', message: 'ERROR: Já existe um inventário em andamento' }))).toEqual({
      status: 400,
      code: 'REGRA',
      message: 'Já existe um inventário em andamento',
    });
  });
  it('unique e chave estrangeira → 409', () => {
    expect(postgresError(erro('P2002'))?.status).toBe(409);
    expect(postgresError(erro('P2003'))?.code).toBe('EM_USO');
    expect(postgresError(erro('P2010', { code: '23505', message: 'dup' }))?.code).toBe('DUPLICADO');
  });
  it('erro desconhecido continua 500 (null aqui)', () => {
    expect(postgresError(new Error('x'))).toBeNull();
    expect(postgresError(erro('P2010', { code: '42P01', message: 'relation does not exist' }))).toBeNull();
  });
});

// Leva pré-final do cupom fiscal, item 8: a violação de CHECK/restrição do banco traz a linha recusada na mensagem crua do driver
// ("Failing row contains (...)", com o CPF do consumidor no cupom); nem a resposta nem o log a levam.
describe('violação de restrição do banco: a mensagem crua do driver não sai', () => {
  const CPF = '52998224725';
  const cruaPrisma = new Prisma.PrismaClientUnknownRequestError(
    'Invalid `prisma.nfce_cupons.create()` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { ' +
      'user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "new row for relation \\"nfce_cupons\\" ' +
      `violates check constraint \\"nfce_cupons_consumidor_doc\\"", severity: "ERROR", detail: Some("Failing row contains (${CPF}, 2)."), ` +
      'column: None, hint: None }), transient: false })',
    { clientVersion: '5.22.0' },
  );
  const cruaRaw = erro('P2010', {
    code: '23514',
    message: `ERROR: new row for relation "nfce_cupons" violates check constraint "nfce_cupons_lanca_venda"\nDETAIL: Failing row contains (${CPF}).`,
  });

  function rodar(e: unknown) {
    const enviado: unknown[] = [];
    type Reply = { status: jest.Mock<Reply, [number]>; send: jest.Mock<void, [unknown]> };
    const reply: Reply = { status: jest.fn((_s: number) => reply), send: jest.fn((b: unknown) => void enviado.push(b)) };
    const host = { switchToHttp: () => ({ getResponse: () => reply }) } as unknown as ArgumentsHost;
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      new HttpExceptionFilter().catch(e, host);
      return { status: reply.status.mock.calls[0], enviado, log: JSON.stringify(log.mock.calls) };
    } finally {
      log.mockRestore();
    }
  }

  it.each([
    ['Prisma (create/update)', cruaPrisma, 'nfce_cupons_consumidor_doc'],
    ['$queryRaw (P2010)', cruaRaw, 'nfce_cupons_lanca_venda'],
  ])('%s: 500 com a frase fixa; o log leva só o SQLSTATE e o nome da restrição', (_n, e, restricao) => {
    const r = rodar(e);
    expect(r.status).toEqual([500]);
    expect(r.enviado).toEqual([{ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } }]);
    expect(r.log).not.toContain(CPF);
    expect(r.log).not.toContain('Failing row');
    expect(r.log).toContain('23514');
    expect(r.log).toContain(restricao);
    expect(restricaoDoBanco(e)).toEqual({ sqlstate: '23514', restricao });
  });

  it('o REGRA do raise exception e o erro comum seguem como antes', () => {
    expect(restricaoDoBanco(erro('P2010', { code: 'P0001', message: 'ERROR: Já existe um inventário em andamento' }))).toBeNull();
    expect(restricaoDoBanco(new Error('boom'))).toBeNull();
    const r = rodar(new Error('boom'));
    expect(r.log).toContain('boom');
  });
});
