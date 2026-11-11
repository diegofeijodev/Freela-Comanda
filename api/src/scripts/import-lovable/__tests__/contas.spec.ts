import { ContasError, mascararEmail, planejarContas } from '../contas';

const ADM = '11111111-1111-4111-8111-000000000001';
const LOJA = '11111111-1111-4111-8111-000000000002';
const TRAVADO = '$2a$10$' + 'x'.repeat(53);

/** Conta no formato 2 da exportação: sem nenhum campo de senha. */
const conta = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  email,
  created_at: '2026-10-01T12:00:00.123456+00:00',
  ultimo_acesso: '2026-11-09',
  confirmada: true,
  apagada: false,
  banida: false,
  anonima: false,
  ...extra,
});
const op = { pularSemPapel: false, hashTravado: TRAVADO };
const problemas = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ContasError) return e.problemas;
    throw e;
  }
  return [];
};

describe('planejarContas (formato 2, sem senha)', () => {
  const roles = [
    { user_id: ADM, role: 'admin' },
    { user_id: ADM, role: 'loja' },
    { user_id: LOJA, role: 'loja' },
  ];
  const profiles = [
    { id: ADM, nome: 'Dono Teste' },
    { id: LOJA, nome: '' },
  ];

  it('mesmo id, e-mail em minúsculas, dois papéis → admin, nome do profile (vazio = parte antes do @), TODAS com senha travada', () => {
    const p = planejarContas([conta(ADM, ' Dono.Teste@Exemplo.COM '), conta(LOJA, 'loja@exemplo.com')], profiles, roles, op);
    expect(p.entram).toEqual([
      expect.objectContaining({ id: ADM, email: 'dono.teste@exemplo.com', perfil: 'admin', nome: 'Dono Teste', dois_papeis: true }),
      expect.objectContaining({ id: LOJA, email: 'loja@exemplo.com', perfil: 'loja', nome: 'loja' }),
    ]);
    expect(p.entram.every((c) => c.senha_travada && c.password_hash === TRAVADO)).toBe(true);
  });

  it('o hash travado tem de ser bcrypt (nunca grava senha vazia)', () => {
    expect(() => planejarContas([conta(ADM, 'a@x.com')], [], roles, { ...op, hashTravado: '' })).toThrow('hashTravado');
  });

  it('apagada, banida, anônima e não confirmada ficam de fora com o motivo e o último acesso', () => {
    const p = planejarContas(
      [
        conta(ADM, 'a@x.com'),
        conta('a1', 'b@x.com', { apagada: true }),
        conta('a2', 'c@x.com', { banida: true }),
        conta('a3', 'd@x.com', { anonima: true }),
        conta('a4', 'e@x.com', { confirmada: false, ultimo_acesso: null }),
      ],
      [],
      [{ user_id: ADM, role: 'admin' }],
      op,
    );
    expect(p.entram.map((c) => c.id)).toEqual([ADM]);
    expect(p.fora.map((f) => [f.motivo, f.ultimo_acesso])).toEqual([
      ['apagada no Lovable', '2026-11-09'],
      ['bloqueada (banida) no Lovable', '2026-11-09'],
      ['conta anônima', '2026-11-09'],
      ['e-mail nunca confirmado (não entrava no Lovable)', null],
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

  it('nenhuma conta ADMIN importada aborta SEMPRE (só loja, ou o único admin ficou de fora)', () => {
    const tudo = { ...op, pularSemPapel: true };
    expect(problemas(() => planejarContas([conta(LOJA, 'b@x.com')], [], roles, tudo))).toEqual([expect.stringContaining('ADMINISTRADOR')]);
    const adminNaoConfirmado = [conta(ADM, 'a@x.com', { confirmada: false }), conta(LOJA, 'b@x.com')];
    expect(problemas(() => planejarContas(adminNaoConfirmado, [], roles, tudo))).toEqual([expect.stringContaining('nenhuma conta de ADMINISTRADOR')]);
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
