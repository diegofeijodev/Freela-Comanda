-- Depois da mudança: apaga a função temporária de exportação (a assinatura TEM de ser esta, senão o DROP ... IF EXISTS não faz nada).
DROP FUNCTION IF EXISTS public.export_erpfreela(text, text, integer, integer);
