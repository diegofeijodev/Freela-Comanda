import { nomePadrao } from '../../modules/auth/auth.service';
import { Linha } from './exportacao';

export type Perfil = 'admin' | 'loja';
export type ContaNova = {
  id: string;
  email: string;
  nome: string;
  password_hash: string;
  perfil: Perfil;
  created_at: string;
  /**
   * Sempre true no formato 2: o Lovable não exporta senha, então toda conta entra com o hash de uma senha aleatória que ninguém
   * conhece. O admin define a dele com `definir-senha` (terminal do dono) e as dos outros em Usuários → nova senha.
   */
  senha_travada: boolean;
  ultimo_acesso: string | null;
  dois_papeis: boolean;
};
export type ContaFora = { id: string; email: string; motivo: string; ultimo_acesso: string | null };
export type PlanoContas = { total: number; entram: ContaNova[]; fora: ContaFora[] };
export type OpcoesContas = { pularSemPapel: boolean; hashTravado: string };

export class ContasError extends Error {
  constructor(readonly problemas: string[]) {
    super(`contas do Lovable com pendência — nada foi gravado:\n${problemas.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** "dono.teste@exemplo.com" → "do***@exemplo.com" (o relatório pode acabar colado num chat). */
export function mascararEmail(email: string): string {
  const [local = '', dominio = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ids = (xs: { id: string; email?: string }[]) => xs.map((x) => (x.email ? `${x.id} (${mascararEmail(x.email)})` : x.id)).join(', ');

/**
 * `auth.users` + `profiles` + `user_roles` do Lovable → a nossa `users`, MESMO id. Regras (docs/migracao-lovable.md § Contas):
 * - apagada, banida, anônima ou com e-mail nunca confirmado: fica de fora (não entrava no Lovable) e vai para o relatório;
 * - e-mail em minúsculas; repetido depois disso = aborta;
 * - papel: admin (se tiver os dois, admin) ou loja; sem papel = aborta, salvo --pular-sem-papel (no Lovable ela não via nada);
 * - senha: TODAS entram com `hashTravado` (senha aleatória que ninguém conhece) — o formato 2 não traz senha;
 * - nenhuma conta ADMIN importada = aborta SEMPRE: sem admin, o "Primeiro acesso" deixaria qualquer um criar um.
 */
export function planejarContas(usuarios: Linha[], profiles: Linha[], roles: Linha[], op: OpcoesContas): PlanoContas {
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(op.hashTravado)) throw new Error('hashTravado precisa ser um hash bcrypt');
  const papeis = new Map<string, Set<string>>();
  for (const r of roles) {
    const id = str(r.user_id) ?? '';
    papeis.set(id, (papeis.get(id) ?? new Set()).add(String(r.role)));
  }
  const nomes = new Map(profiles.map((p) => [str(p.id) ?? '', str(p.nome) ?? undefined]));
  const plano: PlanoContas = { total: usuarios.length, entram: [], fora: [] };
  const semEmail: string[] = [];
  const papelEstranho: string[] = [];
  const semPapel: { id: string; email: string }[] = [];

  for (const u of usuarios) {
    const id = str(u.id) ?? '';
    const email = (str(u.email) ?? '').trim().toLowerCase();
    const ultimo_acesso = str(u.ultimo_acesso);
    const motivo = u.apagada
      ? 'apagada no Lovable'
      : u.banida
        ? 'bloqueada (banida) no Lovable'
        : u.anonima
          ? 'conta anônima'
          : !u.confirmada
            ? 'e-mail nunca confirmado (não entrava no Lovable)'
            : null;
    if (motivo) {
      plano.fora.push({ id, email, motivo, ultimo_acesso });
      continue;
    }
    if (!email) {
      semEmail.push(id);
      continue;
    }
    const ps = papeis.get(id) ?? new Set<string>();
    const estranhos = [...ps].filter((p) => p !== 'admin' && p !== 'loja');
    if (estranhos.length) {
      papelEstranho.push(`${id} (${estranhos.join(', ')})`);
      continue;
    }
    if (ps.size === 0) {
      if (op.pularSemPapel) {
        plano.fora.push({ id, email, ultimo_acesso, motivo: 'sem papel no Lovable (entrava mas não via nada) — pulada por --pular-sem-papel' });
      } else semPapel.push({ id, email });
      continue;
    }
    plano.entram.push({
      id,
      email,
      nome: nomePadrao(nomes.get(id), email),
      password_hash: op.hashTravado,
      perfil: ps.has('admin') ? 'admin' : 'loja',
      created_at: str(u.created_at) ?? '',
      senha_travada: true,
      ultimo_acesso,
      dois_papeis: ps.size > 1,
    });
  }

  const problemas: string[] = [];
  if (semEmail.length) problemas.push(`${semEmail.length} conta(s) sem e-mail (o login aqui é por e-mail): ${semEmail.join(', ')} — corrija no Lovable`);
  if (papelEstranho.length) problemas.push(`papel desconhecido (só existem admin e loja): ${papelEstranho.join(', ')}`);
  if (semPapel.length) {
    problemas.push(
      `${semPapel.length} conta(s) sem papel (admin/loja) no Lovable: ${ids(semPapel)}. No Lovable elas entravam mas não viam nada; ` +
        'para seguir SEM elas, rode com --pular-sem-papel',
    );
  }
  const porEmail = new Map<string, string[]>();
  for (const c of plano.entram) porEmail.set(c.email, [...(porEmail.get(c.email) ?? []), c.id]);
  const repetidos = [...porEmail].filter(([, xs]) => xs.length > 1);
  if (repetidos.length) {
    problemas.push(
      `e-mails repetidos depois de passar para minúsculas: ${repetidos.map(([e, xs]) => `${mascararEmail(e)} → ${xs.join(' + ')}`).join('; ')} — junte as contas no Lovable`,
    );
  }
  if (!plano.entram.some((c) => c.perfil === 'admin')) {
    problemas.push(
      'nenhuma conta de ADMINISTRADOR seria importada. Sem admin, o "Primeiro acesso" do sistema novo deixaria qualquer um criar um. ' +
        'Não há opção que pule esta trava: corrija no Lovable (um admin ativo e confirmado) e refaça o pull',
    );
  }
  if (problemas.length) throw new ContasError(problemas);
  return plano;
}
