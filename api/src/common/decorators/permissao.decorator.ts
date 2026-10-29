import { SetMetadata } from '@nestjs/common';

/**
 * Marca de permissão — substitui as políticas RLS do Supabase. Uma por rota; a do método vale sobre a da classe
 * (`getAllAndOverride`). O `JwtAuthGuard` RECUSA rota autenticada sem marca (teste `permissoes-protecao.spec.ts`).
 *  - `admin`: só administrador (as tabelas do protótipo eram `is_admin()` em quase tudo).
 *  - `staff`: admin ou loja (`is_staff()` do protótipo: inventário cego, listas sem preço, fichas sem custo, configurações).
 */
export const PERMISSAO_KEY = 'permissao';
export type Permissao = 'admin' | 'staff';

export const AdminOnly = () => SetMetadata(PERMISSAO_KEY, 'admin' satisfies Permissao);
export const Staff = () => SetMetadata(PERMISSAO_KEY, 'staff' satisfies Permissao);
