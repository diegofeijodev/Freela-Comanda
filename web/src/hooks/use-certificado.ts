import { useQuery } from '@tanstack/react-query';
import { statusCertificado } from '@/lib/erp-api';

/** Chave única da consulta do certificado: o painel de Configurações e a faixa do topo compartilham o mesmo cache. */
export const CERTIFICADO_QUERY_KEY = ['certificado'] as const;

export function useCertificado(ativo: boolean) {
  return useQuery({ queryKey: CERTIFICADO_QUERY_KEY, queryFn: statusCertificado, staleTime: 5 * 60_000, enabled: ativo });
}
