import { SetMetadata } from '@nestjs/common';

/**
 * Marca de permissão — substitui as políticas RLS do Supabase. Uma por rota; a do método vale sobre a da classe
 * (`getAllAndOverride`). O `JwtAuthGuard` RECUSA rota autenticada sem marca (teste `permissoes-protecao.spec.ts`).
 *  - `admin`: administrador da empresa (ou master). O colaborador (perfil `loja`) só entra se o admin liberou uma das telas
 *    listadas em `@Modulos(...)` da rota; rota sem `@Modulos` é só do admin (usuários, chave de IA, certificado…).
 *  - `staff`: qualquer usuário da empresa (`is_staff()` do protótipo: inventário cego, listas sem preço, fichas sem custo).
 *  - `master`: só o usuário master (cadastro de empresas: vale para todas).
 */
export const PERMISSAO_KEY = 'permissao';
export type Permissao = 'admin' | 'staff' | 'master';

export const AdminOnly = () => SetMetadata(PERMISSAO_KEY, 'admin' satisfies Permissao);
export const Staff = () => SetMetadata(PERMISSAO_KEY, 'staff' satisfies Permissao);
export const MasterOnly = () => SetMetadata(PERMISSAO_KEY, 'master' satisfies Permissao);

/** Telas (módulos) que o admin da loja pode liberar ao colaborador. A chave é a mesma do menu do web (`web/src/lib/modulos.ts`). */
export const MODULOS = [
  'painel',
  'vendas',
  'cupom',
  'fichas',
  'inventario',
  'estoque',
  'objetivo',
  'compras',
  'notas',
  'contas',
  'caixa',
  'ponto',
  'dre',
  'importar',
] as const;
export type Modulo = (typeof MODULOS)[number];

/** Telas cujo uso precisa desta rota `@AdminOnly()`: o colaborador com qualquer uma delas liberada passa. */
export const MODULOS_KEY = 'modulos';
export const Modulos = (...m: Modulo[]) => SetMetadata(MODULOS_KEY, m);
