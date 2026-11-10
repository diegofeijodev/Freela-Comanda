import { nomePadrao } from '../../modules/auth/auth.service';
import { Linha } from './exportacao';

/** Hash do GoTrue (Supabase) = bcrypt `$2a$10$…`; o `bcryptjs` do nosso login confere `$2a$`/`$2b$`/`$2y$`. */
export const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export type Perfil = 'admin' | 'loja';
export type ContaNova = {
  id: string;
  email: string;
  nome: string;
  password_hash: string;
  perfil: Perfil;
  created_at: string;
  /** Sem senha utilizável no Lovable (com --importar-sem-senha): hash de uma senha aleatória que ninguém conhece. */
  senha_travada: boolean;
  ultimo_acesso: string | null;
  dois_papeis: boolean;
};
export type ContaFora = { id: string; email: string; motivo: string };
export type PlanoContas = { total: number; entram: ContaNova[]; fora: ContaFora[] };
export type OpcoesContas = { importarSemSenha: boolean; pularSemPapel: boolean; hashTravado: string };

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
 * - senha: o hash bcrypt do Lovable, como está (a pessoa mantém a senha); sem hash bcrypt = aborta, salvo --importar-sem-senha
 *   (entra com senha travada e o admin define uma nova em Usuários → Redefinir senha);
 * - sem NENHUM admin com senha de verdade = aborta SEMPRE (o "Primeiro acesso" ficaria aberto para qualquer um criar um admin).
 */
export function planejarContas(usuarios: Linha[], profiles: Linha[], roles: Linha[], op: OpcoesContas): PlanoContas {
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
  const semSenha: { id: string; email: string }[] = [];

  for (const u of usuarios) {
    const id = str(u.id) ?? '';
    const email = (str(u.email) ?? '').trim().toLowerCase();
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
      plano.fora.push({ id, email, motivo });
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
      if (op.pularSemPapel) plano.fora.push({ id, email, motivo: 'sem papel no Lovable (entrava mas não via nada) — pulada por --pular-sem-papel' });
      else semPapel.push({ id, email });
      continue;
    }
    const hash = str(u.encrypted_password);
    const temSenha = hash != null && BCRYPT.test(hash);
    if (!temSenha && !op.importarSemSenha) {
      semSenha.push({ id, email });
      continue;
    }
    plano.entram.push({
      id,
      email,
      nome: nomePadrao(nomes.get(id), email),
      password_hash: temSenha ? hash : op.hashTravado,
      perfil: ps.has('admin') ? 'admin' : 'loja',
      created_at: str(u.created_at) ?? '',
      senha_travada: !temSenha,
      ultimo_acesso: str(u.ultimo_acesso),
      dois_papeis: ps.size > 1,
    });
  }

  const problemas: string[] = [];
  if (semEmail.length) problemas.push(`${semEmail.length} conta(s) sem e-mail (o login aqui é por e-mail): ${semEmail.join(', ')} — corrija no Lovable`);
  if (papelEstranho.length) problemas.push(`papel desconhecido (só existem admin e loja): ${papelEstranho.join(', ')}`);
  if (semPapel.length) {
    problemas.push(`${semPapel.length} conta(s) sem papel (admin/loja) no Lovable: ${ids(semPapel)}. No Lovable elas entravam mas não viam nada; para seguir SEM elas, rode com --pular-sem-papel`);
  }
  if (semSenha.length) {
    problemas.push(
      `${semSenha.length} conta(s) sem senha utilizável (só login social, hash vazio ou fora do bcrypt): ${ids(semSenha)}. Para importá-las com a senha ` +
        'travada (o admin define uma nova em Usuários → Redefinir senha), rode com --importar-sem-senha',
    );
  }
  const porEmail = new Map<string, string[]>();
  for (const c of plano.entram) porEmail.set(c.email, [...(porEmail.get(c.email) ?? []), c.id]);
  const repetidos = [...porEmail].filter(([, xs]) => xs.length > 1);
  if (repetidos.length) {
    problemas.push(`e-mails repetidos depois de passar para minúsculas: ${repetidos.map(([e, xs]) => `${mascararEmail(e)} → ${xs.join(' + ')}`).join('; ')} — junte as contas no Lovable`);
  }
  if (!plano.entram.some((c) => c.perfil === 'admin' && !c.senha_travada)) {
    problemas.push(
      'nenhuma conta de ADMINISTRADOR entra com senha de verdade. Sem isso o sistema novo abriria o "Primeiro acesso" para qualquer um criar um admin. ' +
        'Não há opção que pule esta trava: corrija no Lovable (um admin com senha) e refaça o pull',
    );
  }
  if (problemas.length) throw new ContasError(problemas);
  return plano;
}
