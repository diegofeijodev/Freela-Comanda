import * as bcrypt from 'bcryptjs';
import { senhaConfere } from '../../../common/auth/senha-falsa';
import { BCRYPT, ContasError, mascararEmail, planejarContas } from '../contas';

/** Gerado por OUTRA implementação: pgcrypto `crypt('Senha-do-Lovable 123', gen_salt('bf', 10))` — mesmo formato `$2a$10$` do GoTrue. */
const VETOR_PGCRYPTO = '$2a$10$7ZA0mQqjcsZASaCsimtMguNeCA8dFQgtJgV5zYB5VluNfAznJyz4a';
const ADM = '11111111-1111-4111-8111-000000000001';
const LOJA = '11111111-1111-4111-8111-000000000002';

const conta = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  email,
  encrypted_password: VETOR_PGCRYPTO,
  created_at: '2026-10-01T12:00:00.123456+00:00',
  ultimo_acesso: '2026-11-09',
  confirmada: true,
  apagada: false,
  banida: false,
  anonima: false,
  ...extra,
});
const op = { importarSemSenha: false, pularSemPapel: false, hashTravado: '$2a$10$' + 'x'.repeat(53) };
const problemas = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ContasError) return e.problemas;
    throw e;
  }
  return [];
};

describe('senha do Lovable (bcrypt do GoTrue)', () => {
  it('o hash gerado pelo pgcrypto confere no MESMO caminho do nosso login (senhaConfere/bcryptjs)', async () => {
    expect(BCRYPT.test(VETOR_PGCRYPTO)).toBe(true);
    expect(await senhaConfere('Senha-do-Lovable 123', VETOR_PGCRYPTO)).toBe(true);
    expect(await senhaConfere('senha-do-lovable 123', VETOR_PGCRYPTO)).toBe(false);
  });
  it('aceita os prefixos $2a$, $2b$ e $2y$', async () => {
    const h = await bcrypt.hash('abc123', 4);
    for (const p of ['$2a$', '$2b$', '$2y$']) {
      const x = p + h.slice(4);
      expect(BCRYPT.test(x)).toBe(true);
      expect(await bcrypt.compare('abc123', x)).toBe(true);
    }
    expect(BCRYPT.test('')).toBe(false);
    expect(BCRYPT.test('$argon2id$v=19$m=65536,t=3,p=4$abc')).toBe(false);
  });
});

describe('planejarContas', () => {
  const roles = [
    { user_id: ADM, role: 'admin' },
    { user_id: ADM, role: 'loja' },
    { user_id: LOJA, role: 'loja' },
  ];
  const profiles = [
    { id: ADM, nome: 'Dono Teste' },
    { id: LOJA, nome: '' },
  ];

  it('mesmo id, e-mail em minúsculas, hash como está, dois papéis → admin, nome do profile (vazio = parte antes do @)', () => {
    const p = planejarContas([conta(ADM, ' Dono.Teste@Exemplo.COM '), conta(LOJA, 'loja@exemplo.com')], profiles, roles, op);
    expect(p.entram).toEqual([
      expect.objectContaining({
        id: ADM,
        email: 'dono.teste@exemplo.com',
        perfil: 'admin',
        nome: 'Dono Teste',
        password_hash: VETOR_PGCRYPTO,
        dois_papeis: true,
      }),
      expect.objectContaining({ id: LOJA, email: 'loja@exemplo.com', perfil: 'loja', nome: 'loja', senha_travada: false }),
    ]);
  });

  it('apagada, banida, anônima e não confirmada ficam de fora com o motivo', () => {
    const p = planejarContas(
      [
        conta(ADM, 'a@x.com'),
        conta('a1', 'b@x.com', { apagada: true }),
        conta('a2', 'c@x.com', { banida: true }),
        conta('a3', 'd@x.com', { anonima: true }),
        conta('a4', 'e@x.com', { confirmada: false }),
      ],
      [],
      [{ user_id: ADM, role: 'admin' }],
      op,
    );
    expect(p.entram.map((c) => c.id)).toEqual([ADM]);
    expect(p.fora.map((f) => f.motivo)).toEqual([
      'apagada no Lovable',
      'bloqueada (banida) no Lovable',
      'conta anônima',
      'e-mail nunca confirmado (não entrava no Lovable)',
    ]);
  });

  it('e-mail repetido depois de minúsculas aborta', () => {
    const r = [
      { user_id: ADM, role: 'admin' },
      { user_id: LOJA, role: 'loja' },
    ];
    expect(problemas(() => planejarContas([conta(ADM, 'Dono@x.com'), conta(LOJA, 'dono@X.com')], [], r, op))).toEqual([
      expect.stringContaining('e-mails repetidos'),
    ]);
  });

  it('sem papel: aborta pedindo --pular-sem-papel; com a opção, fica de fora', () => {
    const contas = [conta(ADM, 'a@x.com'), conta(LOJA, 'b@x.com')];
    const r = [{ user_id: ADM, role: 'admin' }];
    expect(problemas(() => planejarContas(contas, [], r, op))).toEqual([expect.stringContaining('--pular-sem-papel')]);
    const p = planejarContas(contas, [], r, { ...op, pularSemPapel: true });
    expect(p.fora).toEqual([expect.objectContaining({ id: LOJA, motivo: expect.stringContaining('sem papel') })]);
  });

  it('sem senha bcrypt: aborta pedindo --importar-sem-senha; com a opção, entra com a senha travada', () => {
    const contas = [conta(ADM, 'a@x.com'), conta(LOJA, 'b@x.com', { encrypted_password: '' })];
    expect(problemas(() => planejarContas(contas, [], roles, op))).toEqual([expect.stringContaining('--importar-sem-senha')]);
    const p = planejarContas(contas, [], roles, { ...op, importarSemSenha: true });
    expect(p.entram.find((c) => c.id === LOJA)).toEqual(expect.objectContaining({ senha_travada: true, password_hash: op.hashTravado }));
  });

  it('sem administrador com senha de verdade aborta SEMPRE, mesmo com as duas opções', () => {
    const contas = [conta(ADM, 'a@x.com', { encrypted_password: null }), conta(LOJA, 'b@x.com')];
    const tudo = { ...op, importarSemSenha: true, pularSemPapel: true };
    expect(problemas(() => planejarContas(contas, [], roles, tudo))).toEqual([expect.stringContaining('nenhuma conta de ADMINISTRADOR')]);
    expect(problemas(() => planejarContas([conta(LOJA, 'b@x.com')], [], roles, tudo))).toEqual([expect.stringContaining('ADMINISTRADOR')]);
  });

  it('sem e-mail e papel desconhecido abortam', () => {
    const r = [
      { user_id: ADM, role: 'admin' },
      { user_id: LOJA, role: 'gerente' },
    ];
    const ps = problemas(() => planejarContas([conta(ADM, 'a@x.com'), conta(LOJA, 'b@x.com'), conta('z', '')], [], r, op));
    expect(ps).toEqual([expect.stringContaining('sem e-mail'), expect.stringContaining('papel desconhecido')]);
  });

  it('máscara do e-mail no relatório', () => {
    expect(mascararEmail('dono.teste@exemplo.com')).toBe('do***@exemplo.com');
  });
});
