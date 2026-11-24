-- Multiempresa: cada empresa tem um schema próprio (cópia inteira das tabelas, views e funções; as regras de negócio não mudam).
-- O cadastro de empresas e os usuários moram em `public`; a empresa que já existia (a principal) fica com os dados de `public`.
-- Esta migração roda também em cada schema de empresa (tabelas vazias): os UPDATEs abaixo não fazem nada lá.

ALTER TABLE "users" ADD COLUMN "master" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "empresa_id" UUID;
ALTER TABLE "users" ADD COLUMN "modulos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD CONSTRAINT "users_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "empresas" ADD COLUMN "schema_banco" TEXT;
CREATE UNIQUE INDEX "empresas_schema_banco_key" ON "empresas"("schema_banco");
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_schema_banco_check" CHECK ("schema_banco" IS NULL OR "schema_banco" ~ '^[a-z_][a-z0-9_]{0,62}$');

-- Dados que já existiam: são da empresa principal.
UPDATE "empresas" SET "schema_banco" = current_schema() WHERE "principal";
-- Os administradores de hoje viram master (enxergam todas as empresas).
UPDATE "users" SET "master" = true WHERE "perfil" = 'admin';
-- Usuários da loja: presos à empresa principal (se houver), com as telas que a loja já via.
UPDATE "users" SET "empresa_id" = (SELECT "id" FROM "empresas" WHERE "principal" LIMIT 1),
                   "modulos" = ARRAY['painel','fichas','inventario','compras','ponto']::TEXT[]
 WHERE "perfil" = 'loja';
