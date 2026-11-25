-- Controle da cana: o livro também não se esvazia. Os gatilhos de 20261127120000_cana são por linha (UPDATE/DELETE) e não pegam
-- TRUNCATE; estes, por instrução, recusam esvaziar o livro de lançamentos e o histórico dos números. Roda em cada schema de empresa
-- (migrar-empresas): nada qualificado com o nome do schema. Só acrescenta.

CREATE OR REPLACE FUNCTION cana_lancamentos_sem_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lançamento da cana nunca é apagado: anule com motivo.';
END $$;
CREATE TRIGGER cana_lancamentos_sem_truncate BEFORE TRUNCATE ON cana_lancamentos FOR EACH STATEMENT EXECUTE FUNCTION cana_lancamentos_sem_truncate();

CREATE OR REPLACE FUNCTION cana_parametros_historico_sem_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico dos números da cana não muda nem sai.';
END $$;
CREATE TRIGGER cana_parametros_historico_sem_truncate BEFORE TRUNCATE ON cana_parametros_historico FOR EACH STATEMENT EXECUTE FUNCTION cana_parametros_historico_sem_truncate();
