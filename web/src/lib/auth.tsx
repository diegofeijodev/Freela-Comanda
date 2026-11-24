// Mesmo caminho do protótipo: `useMe()` devolve `{ data: { id, email, nome, perfil } }`.
export { useEmpresaAtual, useMe, useMinhasEmpresas, useSair, useTrocarEmpresa, type EmpresaResumo } from '@/modules/auth/application/use-auth';
export type { Perfil } from '@/modules/auth/infrastructure/auth.storage';
