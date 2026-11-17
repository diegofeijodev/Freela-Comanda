-- CNPJ alfanumérico (RFB): maiúsculas e só [0-9A-Z]. Os dados que já eram só dígitos ficam iguais, então a migração
-- é idempotente e não cria duplicata em coluna única. `vinculos_produto` fica de fora (desenho).
UPDATE "configuracoes"
SET "cnpj" = upper(regexp_replace("cnpj", '[^0-9A-Za-z]', '', 'g'))
WHERE "cnpj" IS NOT NULL;

UPDATE "fornecedores"
SET "cnpj" = nullif(upper(regexp_replace("cnpj", '[^0-9A-Za-z]', '', 'g')), '')
WHERE "cnpj" IS NOT NULL;

UPDATE "notas_entrada"
SET "fornecedor_cnpj" = nullif(upper(regexp_replace("fornecedor_cnpj", '[^0-9A-Za-z]', '', 'g')), '')
WHERE "fornecedor_cnpj" IS NOT NULL;
