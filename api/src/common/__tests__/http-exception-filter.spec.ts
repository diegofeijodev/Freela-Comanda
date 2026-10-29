import { Prisma } from '@prisma/client';
import { postgresError } from '../filters/http-exception.filter';

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
