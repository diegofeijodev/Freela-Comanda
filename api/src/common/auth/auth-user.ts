export type Perfil = 'admin' | 'loja';

/** Usuário autenticado, resolvido pelo guard a cada request (perfil lido do banco) e anexado a `request.user`. */
export interface AuthUser {
  id: string;
  email: string;
  nome: string;
  perfil: Perfil;
}
