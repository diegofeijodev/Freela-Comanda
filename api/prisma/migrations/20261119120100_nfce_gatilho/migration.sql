-- Leva pré-final do cupom fiscal (antes da Tarefa 17): dois ajustes nas regras do banco da 20261119120000_nfce, que não muda.
--
-- 1. Itens e pagamentos do cupom (§5.1; Minor 1 da revisão da Tarefa 3). A passagem do ON DELETE SET NULL do cardápio deixava passar mais
--    do que a cascata: um UPDATE direto `SET item_cardapio_id = NULL` num cupom autorizado, e, nos pagamentos (que não têm a coluna),
--    qualquer UPDATE que não mudasse nada. Agora a passagem vale só em nfce_cupom_itens, só de um item do cardápio para nulo, sem mexer em
--    mais nada, e só quando o item do cardápio já não existe: a ação do ON DELETE roda depois de a linha-mãe sair; o UPDATE direto ainda
--    acha a linha-mãe. As colunas são lidas por to_jsonb (a função serve às duas tabelas, e só uma tem a coluna).
CREATE OR REPLACE FUNCTION nfce_filhos_imutaveis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF tg_op = 'UPDATE' AND tg_table_name = 'nfce_cupom_itens' THEN
    IF (to_jsonb(old) ->> 'item_cardapio_id') IS NOT NULL
       AND (to_jsonb(new) ->> 'item_cardapio_id') IS NULL
       AND (to_jsonb(new) - 'item_cardapio_id') = (to_jsonb(old) - 'item_cardapio_id')
       AND NOT EXISTS (SELECT 1 FROM itens_cardapio i WHERE i.id = (to_jsonb(old) ->> 'item_cardapio_id')::uuid) THEN
      RETURN new;
    END IF;
  END IF;
  IF tg_op IN ('UPDATE', 'DELETE') THEN
    SELECT c.situacao INTO s FROM nfce_cupons c WHERE c.id = old.cupom_id FOR SHARE;
    IF s IN ('autorizado', 'cancelando', 'denegado', 'cancelado') THEN
      RAISE EXCEPTION 'Cupom fiscal %: itens e pagamentos não mudam.', s;
    END IF;
  END IF;
  IF tg_op IN ('INSERT', 'UPDATE') THEN
    SELECT c.situacao INTO s FROM nfce_cupons c WHERE c.id = new.cupom_id FOR SHARE;
    IF s IN ('autorizado', 'cancelando', 'denegado', 'cancelado') THEN
      RAISE EXCEPTION 'Cupom fiscal %: itens e pagamentos não mudam.', s;
    END IF;
    RETURN new;
  END IF;
  RETURN old;
END $$;

-- 2. Desfazer a venda (§3.3; Minor 3 da revisão da Tarefa 3): o cupom com `lanca_venda` falso nunca lançou venda (o lançar recusa o mesmo
--    caso), então o desfazer não grava `venda_desfeita_em` nele: as duas funções ficam simétricas. O resto é o da 20261119120000_nfce.
CREATE OR REPLACE FUNCTION nfce_desfazer_venda(_cupom uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  c nfce_cupons%ROWTYPE;
  n int;
BEGIN
  SELECT * INTO c FROM nfce_cupons WHERE id = _cupom FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cupom fiscal não encontrado.'; END IF;
  IF c.situacao <> 'cancelado' THEN RAISE EXCEPTION 'Só o cupom cancelado desfaz a venda no estoque (este está %).', c.situacao; END IF;
  DELETE FROM vendas WHERE nfce_cupom_id = _cupom;
  GET DIAGNOSTICS n = row_count;
  IF c.lanca_venda THEN
    UPDATE nfce_cupons SET venda_desfeita_em = coalesce(venda_desfeita_em, now()), venda_erro = NULL WHERE id = _cupom;
  END IF;
  RETURN n;
END $$;
