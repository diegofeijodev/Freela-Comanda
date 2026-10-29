-- Regras de negócio do protótipo Lovable (drizzle/migrations 0000–0006), em SQL como lá ("a UI só chama as funções").
-- Única mudança de conteúdo: `auth.uid()` virou o parâmetro `_usuario uuid` e as checagens is_admin()/is_staff() saíram
-- daqui — quem barra é a API (guards), ANTES de chamar a função. Textos de `raise exception` iguais aos do protótipo.

-- "Hoje" do banco = Brasília (current_date das views/funções). Vale para as conexões novas.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Sao_Paulo');
END $$;
SET timezone TO 'America/Sao_Paulo';

-- ===== CHECKs que o Prisma não expressa
ALTER TABLE configuracoes ADD CONSTRAINT configuracoes_id_check CHECK (id = 1);
ALTER TABLE sazonalidade ADD CONSTRAINT sazonalidade_mes_check CHECK (mes BETWEEN 1 AND 12);
ALTER TABLE movimentacoes ADD CONSTRAINT movimentacoes_tipo_check
  CHECK (tipo IN ('inventario_inicial','entrada_compra','baixa_venda','perda','ajuste_inventario','ajuste_manual'));
ALTER TABLE inventarios ADD CONSTRAINT inventarios_status_check
  CHECK (status IN ('aberto','em_contagem','aguardando_aprovacao','fechado'));
ALTER TABLE inventario_itens ADD CONSTRAINT inventario_itens_status_check
  CHECK (status IN ('pendente','recontar','ok','recontado_ok','diferenca_confirmada'));
ALTER TABLE listas_compra ADD CONSTRAINT listas_compra_status_check
  CHECK (status IN ('gerada','enviada','recebida_parcial','recebida'));

COMMENT ON COLUMN configuracoes.nome_unidade IS 'DEPRECATED: substituído por razao_social/nome_fantasia';

-- ===== Linhas fixas (o protótipo as criava na migração; a tela lê configuracoes id=1 com .single())
INSERT INTO configuracoes (id) VALUES (1);
INSERT INTO sazonalidade (mes, fator_pct)
  SELECT m, CASE m WHEN 11 THEN 20 WHEN 12 THEN 50 ELSE 0 END FROM generate_series(1,12) m;
INSERT INTO subgrupos (nome, grupo, ordem) VALUES
('Carnes e Proteínas','Insumos',1),('Espetinhos','Insumos',2),('Congelados','Insumos',3),('Mercearia','Insumos',4),
('Frios, Laticínios e Ovos','Insumos',5),('Hortifruti','Insumos',6),('Padaria','Insumos',7),('Molhos e Sachês','Insumos',8),
('Chopp','Produtos de venda',9),('Bebidas','Produtos de venda',10);

-- ===== Fichas: resumo de custos (espelha web/src/lib/ficha.ts — manter os dois iguais)
CREATE VIEW v_fichas_resumo AS
WITH c AS (SELECT * FROM configuracoes WHERE id = 1),
ing AS (
  SELECT fi.item_cardapio_id, sum(fi.quantidade * coalesce(ie.preco_unitario,0)) AS custo_ing,
         bool_or(ie.preco_unitario IS NULL) AS tem_sem_preco, count(*) AS n_ing
  FROM ficha_ingredientes fi JOIN itens_estoque ie ON ie.id = fi.item_estoque_id
  GROUP BY fi.item_cardapio_id
)
SELECT ic.id, ic.nome, ic.categoria, ic.codigo, ic.preco_venda, coalesce(ic.mkup, c.mkup_padrao) AS mkup,
  coalesce(ing.custo_ing,0) AS custo_ingredientes,
  coalesce(ing.custo_ing,0) * c.custo_preparo_pct/100 AS custo_preparo,
  coalesce(ing.custo_ing,0) * (1 + c.custo_preparo_pct/100) AS custo_total,
  coalesce(ing.custo_ing,0) * (1 + c.custo_preparo_pct/100) * (1 + c.margem_seguranca_pct/100) AS custo_margem,
  coalesce(ing.custo_ing,0) * (1 + c.custo_preparo_pct/100) * (1 + c.margem_seguranca_pct/100) * coalesce(ic.mkup, c.mkup_padrao) AS preco_sugerido,
  coalesce(ing.n_ing,0) AS n_ingredientes, coalesce(ing.tem_sem_preco,false) AS tem_sem_preco
FROM itens_cardapio ic CROSS JOIN c LEFT JOIN ing ON ing.item_cardapio_id = ic.id;

-- Loja: fichas sem custos
CREATE FUNCTION loja_fichas()
RETURNS TABLE (id uuid, nome text, categoria text, observacoes text, ingredientes jsonb)
LANGUAGE sql STABLE AS $$
  SELECT ic.id, ic.nome, ic.categoria, ic.observacoes,
    coalesce((SELECT jsonb_agg(jsonb_build_object('insumo', ie.nome, 'quantidade', fi.quantidade, 'unidade', coalesce(fi.unidade, ie.unidade), 'observacao', fi.observacao) ORDER BY fi.ordem, ie.nome)
      FROM ficha_ingredientes fi JOIN itens_estoque ie ON ie.id = fi.item_estoque_id WHERE fi.item_cardapio_id = ic.id), '[]'::jsonb)
  FROM itens_cardapio ic WHERE ic.ativo ORDER BY ic.categoria, ic.nome
$$;

-- ===== Vendas geram baixa de estoque pela ficha
CREATE FUNCTION vendas_baixa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF new.item_cardapio_id IS NOT DISTINCT FROM old.item_cardapio_id AND new.quantidade = old.quantidade AND new.data = old.data THEN RETURN new; END IF;
    DELETE FROM movimentacoes WHERE venda_id = new.id;
  END IF;
  IF new.item_cardapio_id IS NOT NULL THEN
    INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, venda_id)
    SELECT new.data, fi.item_estoque_id, 'baixa_venda', -(fi.quantidade * new.quantidade), ie.preco_unitario, 'pedido ' || new.pedido, new.id
    FROM ficha_ingredientes fi JOIN itens_estoque ie ON ie.id = fi.item_estoque_id
    WHERE fi.item_cardapio_id = new.item_cardapio_id;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER vendas_baixa_trg AFTER INSERT OR UPDATE ON vendas FOR EACH ROW EXECUTE FUNCTION vendas_baixa();

-- Recalcula baixas de todas as vendas (após alterar fichas)
CREATE FUNCTION recalcular_baixas() RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM movimentacoes WHERE tipo = 'baixa_venda' AND venda_id IS NOT NULL;
  INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, venda_id)
  SELECT v.data, fi.item_estoque_id, 'baixa_venda', -(fi.quantidade * v.quantidade), ie.preco_unitario, 'pedido ' || v.pedido, v.id
  FROM vendas v JOIN ficha_ingredientes fi ON fi.item_cardapio_id = v.item_cardapio_id
  JOIN itens_estoque ie ON ie.id = fi.item_estoque_id;
  GET DIAGNOSTICS n = row_count;
  RETURN n;
END $$;

-- ===== Saldo teórico: último inventário fechado + movimentações posteriores
CREATE VIEW v_saldo_teorico AS
WITH ult AS (
  SELECT DISTINCT ON (ii.item_estoque_id) ii.item_estoque_id, ii.final, i.data
  FROM inventario_itens ii JOIN inventarios i ON i.id = ii.inventario_id
  WHERE i.status = 'fechado' AND ii.final IS NOT NULL
  ORDER BY ii.item_estoque_id, i.data DESC, i.fechado_em DESC
)
SELECT ie.id AS item_estoque_id,
  coalesce(ult.final,0) + coalesce((SELECT sum(m.quantidade) FROM movimentacoes m
     WHERE m.item_estoque_id = ie.id AND m.tipo NOT IN ('inventario_inicial','ajuste_inventario')
       AND (ult.data IS NULL OR m.data > ult.data)),0) AS saldo,
  ult.data AS data_ultimo_inventario
FROM itens_estoque ie LEFT JOIN ult ON ult.item_estoque_id = ie.id;

CREATE FUNCTION saldo_item(_item uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH ult AS (
    SELECT ii.final, i.data FROM inventario_itens ii JOIN inventarios i ON i.id = ii.inventario_id
    WHERE i.status = 'fechado' AND ii.final IS NOT NULL AND ii.item_estoque_id = _item
    ORDER BY i.data DESC, i.fechado_em DESC LIMIT 1)
  SELECT coalesce((SELECT final FROM ult),0) + coalesce((SELECT sum(m.quantidade) FROM movimentacoes m
     WHERE m.item_estoque_id = _item AND m.tipo NOT IN ('inventario_inicial','ajuste_inventario')
       AND ((SELECT data FROM ult) IS NULL OR m.data > (SELECT data FROM ult))),0)
$$;

-- Consumo semanal calculado (últimas N semanas completas)
CREATE VIEW v_consumo_semanal AS
WITH c AS (SELECT semanas_media n FROM configuracoes WHERE id=1),
lim AS (SELECT (date_trunc('week', current_date)::date) AS fim, (date_trunc('week', current_date)::date - (c.n*7)) AS ini, c.n FROM c)
SELECT ie.id AS item_estoque_id,
  coalesce((SELECT -sum(m.quantidade) FROM movimentacoes m, lim
     WHERE m.item_estoque_id = ie.id AND m.tipo = 'baixa_venda' AND m.data >= lim.ini AND m.data < lim.fim),0) / (SELECT n FROM lim) AS consumo_calc
FROM itens_estoque ie;

CREATE FUNCTION estoque_objetivo(_mes int)
RETURNS TABLE (item_estoque_id uuid, consumo_base numeric, objetivo numeric)
LANGUAGE sql STABLE AS $$
  SELECT ie.id,
    CASE WHEN ie.usar_manual AND ie.consumo_semanal_manual IS NOT NULL THEN ie.consumo_semanal_manual ELSE cs.consumo_calc END,
    coalesce(ie.objetivo_manual,
      (CASE WHEN ie.usar_manual AND ie.consumo_semanal_manual IS NOT NULL THEN ie.consumo_semanal_manual ELSE cs.consumo_calc END)
      * (1 + coalesce((SELECT fator_pct FROM sazonalidade WHERE mes=_mes),0)/100)
      * (1 + coalesce(ie.estoque_seguranca_pct, (SELECT estoque_seguranca_pct FROM configuracoes WHERE id=1))/100))
  FROM itens_estoque ie JOIN v_consumo_semanal cs ON cs.item_estoque_id = ie.id
$$;

-- ===== Listas de compra
CREATE FUNCTION loja_lista_itens(_lista uuid)
RETURNS TABLE (id uuid, descricao text, subgrupo text, fornecedor text, unidade text, embalagem text, qtd_por_embalagem numeric, pedido numeric, embalagens numeric)
LANGUAGE sql STABLE AS $$
  SELECT id, descricao, subgrupo, fornecedor, unidade, embalagem, qtd_por_embalagem, pedido, embalagens
  FROM listas_compra_itens WHERE lista_id = _lista ORDER BY subgrupo, descricao
$$;

CREATE FUNCTION gerar_lista_compras(_inventario uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _lista uuid; _data date; _mes int;
BEGIN
  IF _inventario IS NOT NULL THEN SELECT data INTO _data FROM inventarios WHERE id = _inventario; ELSE _data := current_date; END IF;
  _mes := extract(month FROM _data);
  INSERT INTO listas_compra (inventario_id, data, mes) VALUES (_inventario, _data, _mes) RETURNING id INTO _lista;
  INSERT INTO listas_compra_itens (lista_id, item_estoque_id, descricao, subgrupo, fornecedor, unidade, embalagem, qtd_por_embalagem, estoque_contado, objetivo, pedido, embalagens, preco_unitario)
  SELECT _lista, ie.id, ie.nome, ie.subgrupo, coalesce(ie.fornecedor,'Sem fornecedor'), ie.unidade, ie.embalagem_compra, ie.qtd_por_embalagem,
    s.est, o.objetivo, greatest(0, o.objetivo - s.est),
    ceil(greatest(0, o.objetivo - s.est) / nullif(ie.qtd_por_embalagem,0)), ie.preco_unitario
  FROM itens_estoque ie
  JOIN LATERAL (SELECT coalesce(
      (SELECT ii.final FROM inventario_itens ii WHERE ii.inventario_id = _inventario AND ii.item_estoque_id = ie.id),
      saldo_item(ie.id)) AS est) s ON true
  JOIN estoque_objetivo(_mes) o ON o.item_estoque_id = ie.id
  WHERE ie.ativo AND greatest(0, o.objetivo - s.est) > 0.0001;
  RETURN _lista;
END $$;

CREATE FUNCTION receber_lista(_lista uuid, _atualizar_preco boolean, _usuario uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE total int; recebidos int;
BEGIN
  INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, usuario_id)
  SELECT current_date, li.item_estoque_id, 'entrada_compra', li.qtd_recebida, coalesce(li.preco_pago, li.preco_unitario), 'lista ' || _lista, _usuario
  FROM listas_compra_itens li WHERE li.lista_id = _lista AND NOT li.recebido AND li.item_estoque_id IS NOT NULL AND coalesce(li.qtd_recebida,0) > 0;
  IF _atualizar_preco THEN
    UPDATE itens_estoque ie SET preco_unitario = li.preco_pago
    FROM listas_compra_itens li WHERE li.lista_id = _lista AND NOT li.recebido AND li.item_estoque_id = ie.id AND li.preco_pago IS NOT NULL AND coalesce(li.qtd_recebida,0) > 0;
  END IF;
  UPDATE listas_compra_itens SET recebido = true WHERE lista_id = _lista AND coalesce(qtd_recebida,0) > 0;
  SELECT count(*), count(*) FILTER (WHERE recebido) INTO total, recebidos FROM listas_compra_itens WHERE lista_id = _lista;
  UPDATE listas_compra SET status = CASE WHEN recebidos >= total THEN 'recebida' ELSE 'recebida_parcial' END WHERE id = _lista;
END $$;

-- ===== Fluxo de inventário
CREATE FUNCTION abrir_inventario(_data date, _periodicidade text, _usuario uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE _inv uuid; _inicial boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM inventarios WHERE status <> 'fechado') THEN RAISE EXCEPTION 'Já existe um inventário em andamento'; END IF;
  IF _periodicidade NOT IN ('diario','semanal','mensal') THEN RAISE EXCEPTION 'Periodicidade inválida'; END IF;
  _inicial := NOT EXISTS (SELECT 1 FROM inventarios WHERE status = 'fechado');
  INSERT INTO inventarios (data, inicial, aberto_por, periodicidade) VALUES (_data, _inicial, _usuario, _periodicidade) RETURNING id INTO _inv;
  INSERT INTO inventario_itens (inventario_id, item_estoque_id, teorico_snapshot)
  SELECT _inv, ie.id, CASE WHEN _inicial THEN NULL ELSE saldo_item(ie.id) END FROM itens_estoque ie WHERE ie.ativo;
  RETURN _inv;
END $$;

CREATE FUNCTION loja_itens_inventario(_inv uuid)
RETURNS TABLE (id uuid, nome text, unidade text, embalagem text, grupo text, subgrupo text, ordem int, situacao text, contagens int)
LANGUAGE sql STABLE AS $$
  SELECT ii.id, ie.nome, ie.unidade, ie.embalagem_compra,
    coalesce(sg.grupo, CASE WHEN ie.tipo = 'Produto de venda' THEN 'Produtos de venda' ELSE 'Insumos' END), ie.subgrupo, coalesce(sg.ordem, 99),
    CASE WHEN ii.status = 'pendente' THEN 'pendente' WHEN ii.status = 'recontar' THEN 'recontar' ELSE 'contado' END,
    (CASE WHEN ii.contagem_1 IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN ii.contagem_2 IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN ii.contagem_3 IS NOT NULL THEN 1 ELSE 0 END)
  FROM inventario_itens ii JOIN itens_estoque ie ON ie.id = ii.item_estoque_id
  LEFT JOIN subgrupos sg ON sg.nome = ie.subgrupo
  WHERE ii.inventario_id = _inv
  ORDER BY 7, ie.subgrupo, ie.nome
$$;

-- Registra contagem cega; devolve apenas 'ok' ou 'recontar'
CREATE FUNCTION registrar_contagem(_item uuid, _qtd numeric, _usuario uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r inventario_itens%rowtype; inv inventarios%rowtype; ie itens_estoque%rowtype; c configuracoes%rowtype;
  n int; tol numeric; dentro boolean; maxc int;
BEGIN
  IF _qtd IS NULL OR _qtd < 0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
  SELECT * INTO r FROM inventario_itens WHERE id = _item FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  SELECT * INTO inv FROM inventarios WHERE id = r.inventario_id;
  IF inv.status NOT IN ('aberto','em_contagem') THEN RAISE EXCEPTION 'Inventário não está em contagem'; END IF;
  IF r.status NOT IN ('pendente','recontar') THEN RETURN 'ok'; END IF;
  SELECT * INTO ie FROM itens_estoque WHERE id = r.item_estoque_id;
  SELECT * INTO c FROM configuracoes WHERE id = 1;
  maxc := c.max_recontagens + 1;
  n := CASE WHEN r.contagem_1 IS NULL THEN 1 WHEN r.contagem_2 IS NULL THEN 2 ELSE 3 END;
  IF n = 1 THEN UPDATE inventario_itens SET contagem_1=_qtd, usuario_1=_usuario, hora_1=now() WHERE id=_item;
  ELSIF n = 2 THEN UPDATE inventario_itens SET contagem_2=_qtd, usuario_2=_usuario, hora_2=now() WHERE id=_item;
  ELSE UPDATE inventario_itens SET contagem_3=_qtd, usuario_3=_usuario, hora_3=now() WHERE id=_item; END IF;

  IF inv.inicial OR r.teorico_snapshot IS NULL THEN
    dentro := true;
  ELSE
    tol := greatest(
      abs(r.teorico_snapshot) * coalesce(ie.tolerancia_pct, c.tolerancia_pct)/100,
      coalesce(ie.tolerancia_abs, CASE WHEN upper(ie.unidade) IN ('KG','L','LT') THEN c.tolerancia_abs_kg ELSE c.tolerancia_abs_un END));
    dentro := abs(_qtd - r.teorico_snapshot) <= tol + 1e-9;
  END IF;

  IF dentro THEN
    UPDATE inventario_itens SET final=_qtd, status = CASE WHEN n=1 THEN 'ok' ELSE 'recontado_ok' END WHERE id=_item;
  ELSIF n >= maxc THEN
    UPDATE inventario_itens SET final=_qtd, status='diferenca_confirmada' WHERE id=_item;
    dentro := true;
  ELSE
    UPDATE inventario_itens SET status='recontar' WHERE id=_item;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM inventario_itens WHERE inventario_id = inv.id AND status IN ('pendente','recontar')) THEN
    UPDATE inventarios SET status='aguardando_aprovacao' WHERE id = inv.id;
  ELSE
    UPDATE inventarios SET status='em_contagem' WHERE id = inv.id AND status='aberto';
  END IF;
  RETURN CASE WHEN dentro THEN 'ok' ELSE 'recontar' END;
END $$;

CREATE FUNCTION fechar_inventario(_inv uuid, _usuario uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE inv inventarios%rowtype; _lista uuid;
BEGIN
  SELECT * INTO inv FROM inventarios WHERE id = _inv;
  IF inv.status = 'fechado' THEN RAISE EXCEPTION 'Inventário já fechado'; END IF;
  IF EXISTS (SELECT 1 FROM inventario_itens WHERE inventario_id=_inv AND final IS NULL) THEN RAISE EXCEPTION 'Há itens sem quantidade final'; END IF;
  INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, usuario_id, observacao)
  SELECT inv.data, ii.item_estoque_id,
    CASE WHEN inv.inicial THEN 'inventario_inicial' ELSE 'ajuste_inventario' END,
    CASE WHEN inv.inicial THEN ii.final ELSE ii.final - saldo_item(ii.item_estoque_id) END,
    ie.preco_unitario, 'inventario ' || _inv, _usuario, ii.justificativa
  FROM inventario_itens ii JOIN itens_estoque ie ON ie.id = ii.item_estoque_id WHERE ii.inventario_id = _inv;
  UPDATE inventarios SET status='fechado', fechado_por=_usuario, fechado_em=now() WHERE id=_inv;
  _lista := gerar_lista_compras(_inv);
  RETURN _lista;
END $$;

-- ===== Entrada de notas
CREATE FUNCTION lancar_nota(_nota uuid, _atualizar_preco boolean, _usuario uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n notas_entrada;
BEGIN
  SELECT * INTO n FROM notas_entrada WHERE id = _nota FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;
  IF n.status = 'lancada' THEN RAISE EXCEPTION 'Nota já lançada'; END IF;
  INSERT INTO movimentacoes (data, item_estoque_id, tipo, quantidade, custo_unitario, referencia, usuario_id)
  SELECT n.data_entrada, it.item_estoque_id, 'entrada_compra', it.quantidade * it.fator,
         CASE WHEN it.fator > 0 THEN it.valor_unitario / it.fator ELSE it.valor_unitario END,
         'NF ' || coalesce(n.numero, '') || ' ' || n.fornecedor_nome, _usuario
  FROM notas_entrada_itens it WHERE it.nota_id = _nota AND it.item_estoque_id IS NOT NULL AND it.quantidade > 0;
  IF _atualizar_preco THEN
    UPDATE itens_estoque ie SET preco_unitario = CASE WHEN it.fator > 0 THEN it.valor_unitario / it.fator ELSE it.valor_unitario END
    FROM notas_entrada_itens it WHERE it.nota_id = _nota AND it.item_estoque_id = ie.id AND it.valor_unitario > 0;
  END IF;
  INSERT INTO vinculos_produto (fornecedor_cnpj, codigo_fornecedor, descricao, item_estoque_id, fator)
  SELECT DISTINCT ON (coalesce(it.codigo_fornecedor, it.descricao)) coalesce(n.fornecedor_cnpj, ''), coalesce(it.codigo_fornecedor, it.descricao), it.descricao, it.item_estoque_id, it.fator
  FROM notas_entrada_itens it WHERE it.nota_id = _nota AND it.item_estoque_id IS NOT NULL
  ON CONFLICT (fornecedor_cnpj, codigo_fornecedor) DO UPDATE SET item_estoque_id = excluded.item_estoque_id, fator = excluded.fator, descricao = excluded.descricao;
  UPDATE notas_entrada SET status = 'lancada' WHERE id = _nota;
END $$;

-- ===== CMV por período (entre dois inventários fechados)
CREATE VIEW v_cmv_periodo AS
WITH fechados AS (
  SELECT i.id, i.data, i.periodicidade,
    (SELECT max(p.data) FROM inventarios p WHERE p.status = 'fechado' AND p.data < i.data) AS data_anterior
  FROM inventarios i
  WHERE i.status = 'fechado' AND NOT i.inicial
), itens AS (
  SELECT f.id AS inventario_id, f.data, f.data_anterior, ii.item_estoque_id,
    ii.final AS estoque_atual,
    (SELECT pi.final FROM inventario_itens pi
      JOIN inventarios p ON p.id = pi.inventario_id
      WHERE pi.item_estoque_id = ii.item_estoque_id AND p.data = f.data_anterior AND p.status = 'fechado') AS estoque_inicial
  FROM fechados f
  JOIN inventario_itens ii ON ii.inventario_id = f.id
  WHERE f.data_anterior IS NOT NULL
), calc AS (
  SELECT t.*,
    coalesce(t.estoque_inicial, 0) AS ei,
    coalesce(t.estoque_atual, 0) AS ea,
    (SELECT coalesce(sum(m.quantidade), 0) FROM movimentacoes m
      WHERE m.item_estoque_id = t.item_estoque_id AND m.tipo = 'entrada_compra'
        AND m.data > t.data_anterior AND m.data <= t.data) AS entradas,
    (SELECT CASE WHEN sum(m.quantidade) > 0 THEN sum(m.quantidade * m.custo_unitario) / sum(m.quantidade) END
      FROM movimentacoes m
      WHERE m.item_estoque_id = t.item_estoque_id AND m.tipo = 'entrada_compra'
        AND m.data > t.data_anterior AND m.data <= t.data) AS custo_medio_entrada
  FROM itens t
)
SELECT c.inventario_id, c.data, c.data_anterior, c.item_estoque_id,
  c.ei AS estoque_inicial, c.entradas, c.ea AS estoque_atual,
  c.ei + c.entradas - c.ea AS consumo_qtd,
  coalesce(c.custo_medio_entrada, ie.preco_unitario, 0) AS custo_unit,
  (c.ei + c.entradas - c.ea) * coalesce(c.custo_medio_entrada, ie.preco_unitario, 0) AS cmv_valor
FROM calc c
JOIN itens_estoque ie ON ie.id = c.item_estoque_id;
