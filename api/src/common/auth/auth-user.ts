export type Perfil = 'admin' | 'loja';

/** Usuário autenticado, resolvido pelo guard a cada request (perfil lido do banco) e anexado a `request.user`. */
export interface AuthUser {
  id: string;
  email: string;
  nome: string;
  /** Perfil NA EMPRESA: `admin` cadastra tudo; `loja` = colaborador (vê o que o admin liberou em `modulos`). Master é sempre admin. */
  perfil: Perfil;
  master: boolean;
  modulos: string[];
  /** Empresa da requisição (a escolhida pelo master, ou a do usuário); null = schema `public` sem empresa cadastrada. */
  empresaId: string | null;
}
