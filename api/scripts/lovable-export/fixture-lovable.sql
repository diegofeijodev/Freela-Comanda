-- Transforma um banco local (nossas migrações + prisma/seed.ts) num "Lovable falso" para o teste ponta a ponta da migração:
-- esquema auth + profiles + user_roles como no Supabase, dados gerados pelas MESMAS funções de negócio (inventários, nota, lista),
-- casos difíceis (decimal longo, texto com aspas/barra/quebra de linha, conta excluída referenciada) e sem as tabelas que só nós temos.
-- Só para teste: e-mails, senhas e ids inventados.
\set ON_ERROR_STOP 1
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Contas como no Supabase (auth.users + profiles + user_roles)
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY, email text, encrypted_password text, created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false, raw_user_meta_data jsonb
);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, nome text NOT NULL DEFAULT '', email text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL, UNIQUE (user_id, role));
-- auth.uid() do Supabase lê a claim `sub` do JWT que o PostgREST põe em request.jwt.claim(s); has_role/is_admin iguais ao protótipo
-- (.prototype/drizzle/migrations/0000_migration.sql).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

INSERT INTO auth.users (id, email, encrypted_password, created_at, last_sign_in_at, email_confirmed_at, deleted_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Dono.Teste@Exemplo.COM', crypt('Senha-Admin 1', gen_salt('bf', 10)), '2026-09-01 10:00:00.123456+00', now(), '2026-09-01 10:01:00+00', NULL),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'loja@exemplo.com', crypt('Senha-Loja 2', gen_salt('bf', 10)), '2026-09-02 10:00:00+00', now() - interval '2 days', '2026-09-02 10:00:00+00', NULL),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'estranho@exemplo.com', crypt('qualquer', gen_salt('bf', 10)), '2026-10-20 03:00:00+00', NULL, NULL, NULL),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'saiu@exemplo.com', crypt('qualquer', gen_salt('bf', 10)), '2026-09-03 10:00:00+00', NULL, '2026-09-03 10:00:00+00', now() - interval '5 days');
INSERT INTO public.profiles (id, nome, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Dono Teste', 'dono.teste@exemplo.com'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '', 'loja@exemplo.com');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin'), ('aaaaaaaa-0000-4000-8000-000000000001', 'loja'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'loja'), ('aaaaaaaa-0000-4000-8000-000000000003', 'loja'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'loja');

-- ===== Configurações, sazonalidade e subgrupos diferentes dos seeds (a carga tem de trocar os seeds por estes)
UPDATE configuracoes SET tolerancia_pct = 2.5, mkup_padrao = 3.25, loja_pode_abrir = true WHERE id = 1;
UPDATE sazonalidade SET fator_pct = 12.5 WHERE mes = 7;
INSERT INTO subgrupos (nome, grupo, ordem) VALUES ('Descartáveis', 'Insumos', 11);

-- ===== Importação ligada às vendas antigas (o UPDATE não mexe nas baixas: item/quantidade/data iguais)
INSERT INTO importacoes (id, tipo, arquivo, linhas, erros, usuario_id) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'vendas', 'vendas "outubro".csv', 120, 2, 'aaaaaaaa-0000-4000-8000-000000000001');
UPDATE vendas SET importacao_id = 'cccccccc-0000-4000-8000-000000000001' WHERE data < current_date - 20;

-- ===== Inventário inicial (21 dias atrás), nota com fator 3 (decimal longo), segundo inventário (7 dias atrás), recebimento de lista
DO $$
DECLARE inv uuid; it record; r text; n int; nota uuid := 'bbbbbbbb-0000-4000-8000-000000000001'; lista uuid;
  adm uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; loja uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
BEGIN
  inv := abrir_inventario(current_date - 21, 'semanal', adm);
  FOR it IN SELECT id FROM inventario_itens WHERE inventario_id = inv LOOP PERFORM registrar_contagem(it.id, 10, loja); END LOOP;
  PERFORM fechar_inventario(inv, adm);

  INSERT INTO notas_entrada (id, chave, numero, serie, fornecedor_nome, fornecedor_cnpj, data_emissao, data_entrada, valor_total, forma_pagamento, origem, usuario_id)
  VALUES (nota, '35261012345678000199550010000012341000012345', '1234', '1', 'Frigorífico Boa Carne', '12345678000199', current_date - 11, current_date - 10, 693.94, 'boleto', 'xml', adm);
  INSERT INTO notas_entrada_itens (nota_id, codigo_fornecedor, descricao, unidade, quantidade, valor_unitario, valor_total, item_estoque_id, fator, ordem)
  SELECT nota, 'P01', 'PICANHA CX 3 PEÇAS', 'CX', 3.5, 65.90, 230.65, id, 3, 1 FROM itens_estoque WHERE nome = 'Picanha'
  UNION ALL SELECT nota, 'A02', 'ALCATRA KG', 'KG', 10.5, 44.123, 463.29, id, 1, 2 FROM itens_estoque WHERE nome = 'Alcatra'
  UNION ALL SELECT nota, NULL, 'SACOLA', 'UN', 1, 0, 0, NULL, 1, 3;
  PERFORM lancar_nota(nota, true, adm);
  INSERT INTO contas_pagar (descricao, fornecedor_nome, nota_id, parcela, valor, vencimento, forma_pagamento, status, pago_em, valor_pago,
                            plano_conta_id, centro_custo_id)
  SELECT 'NF 1234 Frigorífico Boa Carne', 'Frigorífico Boa Carne', nota, '1/2', 346.97, current_date - 1, 'boleto', 'paga', current_date - 1, 346.97,
         (SELECT id FROM plano_contas WHERE conta = 'COMPRA DE CARNES'), (SELECT id FROM centros_custo ORDER BY nome LIMIT 1)
  UNION ALL SELECT 'NF 1234 Frigorífico Boa Carne', 'Frigorífico Boa Carne', nota, '2/2', 346.97, current_date + 29, 'boleto', 'aberta', NULL, NULL, NULL, NULL;

  inv := abrir_inventario(current_date - 7, 'semanal', loja);
  FOR it IN SELECT id FROM inventario_itens WHERE inventario_id = inv LOOP
    n := 0;
    LOOP r := registrar_contagem(it.id, 4, loja); n := n + 1; EXIT WHEN r = 'ok' OR n >= 3; END LOOP;
  END LOOP;
  UPDATE inventario_itens SET justificativa = E'conferido no freezer; "caixa" \\ 2\nsegunda linha' WHERE inventario_id = inv AND status = 'diferenca_confirmada';
  lista := fechar_inventario(inv, adm);

  UPDATE listas_compra_itens SET qtd_recebida = pedido / 2, preco_pago = coalesce(preco_unitario, 1) * 1.05 WHERE lista_id = lista;
  PERFORM receber_lista(lista, false, adm);
  UPDATE listas_compra SET status = 'enviada' WHERE id <> lista;
END $$;

-- ===== Movimentação manual de uma conta que depois foi excluída (a referência fica, sem FK)
INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, usuario_id, observacao)
SELECT current_date - 3, id, 'perda', -0.375, preco_unitario, 'manual', 'aaaaaaaa-0000-4000-8000-000000000004', E'quebra: "caixa" \\ 2\nacento ção'
FROM itens_estoque WHERE nome = 'Picanha';

-- ===== Só o que o Lovable tem: sem as tabelas que são só nossas
DROP TABLE public.users;
DROP TABLE public._prisma_migrations;
