-- Função TEMPORÁRIA de exportação (mudança do Freela ERP para o servidor próprio, Freela Comanda). SÓ LEITURA (STABLE).
-- Só um ADMINISTRADOR logado consegue chamar (public.is_admin(), a mesma checagem das políticas); não exporta senha nem hash de senha.
-- Apagar depois da mudança (limpeza_erpfreela.sql): DROP FUNCTION public.export_erpfreela(text, text, integer, integer);
--
-- Ações (todas devolvem jsonb; páginas de até 2000 linhas):
--   resumo   → meta (agora, hoje, semana de referência, fuso, versão), e para CADA tabela base de public: colunas (nome, tipo, aceita
--              nulo), linhas e a soma de cada coluna numeric (como texto exato); linhas de cada view; nº de contas; movimentações por tipo.
--   tabela   → página de uma tabela base de public (p_name), na ordem da chave primária.
--   usuarios → página das contas (auth.users): só id, e-mail, data de criação, dia do último acesso e situação. SEM senha.
--   view     → página de v_saldo_teorico | v_fichas_resumo | v_cmv_periodo | v_consumo_semanal (resultados, para conferência).
-- Todo número sai como TEXTO exato (o JSON.parse do Node arredondaria numeric longo para double).
CREATE OR REPLACE FUNCTION public.export_erpfreela(
  p_action text,
  p_name text DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_linha constant text := '(SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = ''number'' '
    || 'THEN to_jsonb(e.value #>> ''{}'') ELSE e.value END) FROM jsonb_each(to_jsonb(x)) e)';
  v_tabelas jsonb := '{}'::jsonb;
  v_views jsonb := '{}'::jsonb;
  v_info jsonb;
  v_cols jsonb;
  v_mov jsonb;
  v_rows jsonb;
  v_sql text;
  v_order text;
  v_n bigint;
  t text;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Acesso negado: só um administrador logado pode exportar' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'resumo' THEN
    FOR t IN SELECT table_name::text FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1 LOOP
      SELECT coalesce(jsonb_agg(jsonb_build_object('nome', column_name::text, 'tipo', data_type::text, 'nulo', is_nullable::text = 'YES')
                                ORDER BY ordinal_position), '[]'::jsonb),
             'SELECT jsonb_build_object(''linhas'', count(*), ''somas'', jsonb_build_object('
               || coalesce(string_agg(format('%L, sum(%I)::text', column_name::text, column_name::text), ', ' ORDER BY ordinal_position)
                           FILTER (WHERE data_type::text = 'numeric'), '')
               || ')) FROM public.' || quote_ident(t)
        INTO v_cols, v_sql
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name::text = t;
      EXECUTE v_sql INTO v_info;
      v_tabelas := v_tabelas || jsonb_build_object(t, v_info || jsonb_build_object('colunas', v_cols));
    END LOOP;
    FOREACH t IN ARRAY ARRAY['v_saldo_teorico', 'v_fichas_resumo', 'v_cmv_periodo', 'v_consumo_semanal'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
        v_views := v_views || jsonb_build_object(t, v_n);
      END IF;
    END LOOP;
    SELECT coalesce(jsonb_object_agg(s.tipo, jsonb_build_object('linhas', s.n, 'quantidade', s.q)), '{}'::jsonb) INTO v_mov
      FROM (SELECT m.tipo, count(*) AS n, sum(m.quantidade)::text AS q FROM public.movimentacoes m GROUP BY m.tipo) s;
    RETURN jsonb_build_object(
      'meta', jsonb_build_object('agora', now(), 'hoje', current_date, 'semana_ref', date_trunc('week', current_date)::date,
                                 'fuso', current_setting('TimeZone'), 'versao_pg', current_setting('server_version')),
      'tabelas', v_tabelas,
      'views', v_views,
      'usuarios', (SELECT count(*) FROM auth.users),
      'movimentacoes_por_tipo', v_mov);
  END IF;

  IF p_action = 'tabela' THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name::text = p_name) THEN
      RAISE EXCEPTION 'tabela não permitida: %', p_name;
    END IF;
    SELECT string_agg(format('x.%I', a.attname), ', ' ORDER BY k.ord) INTO v_order
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = format('public.%I', p_name)::regclass AND i.indisprimary;
    EXECUTE format('SELECT coalesce(jsonb_agg(r), ''[]''::jsonb) FROM (SELECT %s AS r FROM public.%I x ORDER BY %s LIMIT %s OFFSET %s) s',
                   v_linha, p_name, coalesce(v_order, 'x::text'), v_lim, v_off) INTO v_rows;
    RETURN jsonb_build_object('linhas', v_rows);
  END IF;

  IF p_action = 'usuarios' THEN
    SELECT coalesce(jsonb_agg(s.r), '[]'::jsonb) INTO v_rows FROM (
      SELECT jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'created_at', u.created_at,
        'ultimo_acesso', ((to_jsonb(u) ->> 'last_sign_in_at')::timestamptz)::date,
        'confirmada', (to_jsonb(u) ->> 'email_confirmed_at') IS NOT NULL,
        'apagada', (to_jsonb(u) ->> 'deleted_at') IS NOT NULL,
        'banida', coalesce((to_jsonb(u) ->> 'banned_until')::timestamptz > now(), false),
        'anonima', coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false)) AS r
      FROM auth.users u ORDER BY u.id LIMIT v_lim OFFSET v_off) s;
    RETURN jsonb_build_object('linhas', v_rows);
  END IF;

  IF p_action = 'view' THEN
    v_order := CASE p_name
      WHEN 'v_saldo_teorico' THEN 'x.item_estoque_id'
      WHEN 'v_consumo_semanal' THEN 'x.item_estoque_id'
      WHEN 'v_fichas_resumo' THEN 'x.id'
      WHEN 'v_cmv_periodo' THEN 'x.inventario_id, x.item_estoque_id'
    END;
    IF v_order IS NULL THEN RAISE EXCEPTION 'view não permitida: %', p_name; END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(r), ''[]''::jsonb) FROM (SELECT %s AS r FROM public.%I x ORDER BY %s LIMIT %s OFFSET %s) s',
                   v_linha, p_name, v_order, v_lim, v_off) INTO v_rows;
    RETURN jsonb_build_object('linhas', v_rows);
  END IF;

  RAISE EXCEPTION 'ação inválida (resumo | tabela | usuarios | view)';
END;
$$;

REVOKE ALL ON FUNCTION public.export_erpfreela(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.export_erpfreela(text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_erpfreela(text, text, integer, integer) TO authenticated;
