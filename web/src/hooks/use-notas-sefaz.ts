import { useQuery } from '@tanstack/react-query';
import { situacaoSefaz } from '@/lib/erp-api';

/** Chave única da situação da busca na SEFAZ: o painel de Configurações e a Entrada de Notas compartilham o mesmo cache. */
export const SITUACAO_SEFAZ_KEY = ['notas-sefaz', 'situacao'] as const;

/** Relê a cada 3 s enquanto uma busca está em andamento; fora disso vale 30 s. */
export function useSituacaoSefaz(ativo: boolean) {
  return useQuery({
    queryKey: SITUACAO_SEFAZ_KEY,
    queryFn: situacaoSefaz,
    enabled: ativo,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.ambiente !== 'desligado' && d.em_andamento ? 3_000 : false;
    },
  });
}
