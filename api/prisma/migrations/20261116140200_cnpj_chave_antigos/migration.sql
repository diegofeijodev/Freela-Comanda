-- Dados do protótipo (Lovable) copiados como vieram: o CNPJ do vínculo e a chave da nota podem ter pontuação, espaços ou minúsculas.
-- Normaliza para maiúsculas e só [0-9A-Z], como normalizarCnpj/normalizarChave. As duas colunas são parte de uma restrição única,
-- então só muda a linha que NÃO colide: entre as que dariam o mesmo valor, só a primeira (por id), e só se o valor alvo ainda
-- não existir. As demais ficam como estão. Idempotente: o valor alvo já é normalizado, então a segunda rodada não acha nada.

-- vínculos: única (fornecedor_cnpj, codigo_fornecedor)
WITH cand AS (
  SELECT "id", "codigo_fornecedor", upper(regexp_replace("fornecedor_cnpj", '[^0-9A-Za-z]', '', 'g')) AS "novo"
  FROM "vinculos_produto"
  WHERE "fornecedor_cnpj" IS DISTINCT FROM upper(regexp_replace("fornecedor_cnpj", '[^0-9A-Za-z]', '', 'g'))
), alvo AS (
  SELECT "id", "codigo_fornecedor", "novo",
         row_number() OVER (PARTITION BY "novo", "codigo_fornecedor" ORDER BY "id") AS "rn"
  FROM cand
)
UPDATE "vinculos_produto" v
SET "fornecedor_cnpj" = a."novo"
FROM alvo a
WHERE v."id" = a."id" AND a."rn" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "vinculos_produto" o
    WHERE o."fornecedor_cnpj" = a."novo" AND o."codigo_fornecedor" = a."codigo_fornecedor"
  );

-- notas: única (chave); só vira chave se tiver o formato (44 posições, 6 dígitos + 12 [0-9A-Z] + 26 dígitos)
WITH cand AS (
  SELECT "id", upper(regexp_replace("chave", '[^0-9A-Za-z]', '', 'g')) AS "novo"
  FROM "notas_entrada"
  WHERE "chave" IS NOT NULL
), alvo AS (
  SELECT c."id", c."novo", row_number() OVER (PARTITION BY c."novo" ORDER BY c."id") AS "rn"
  FROM cand c
  JOIN "notas_entrada" n ON n."id" = c."id"
  WHERE n."chave" <> c."novo" AND c."novo" ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'
)
UPDATE "notas_entrada" n
SET "chave" = a."novo"
FROM alvo a
WHERE n."id" = a."id" AND a."rn" = 1
  AND NOT EXISTS (SELECT 1 FROM "notas_entrada" o WHERE o."chave" = a."novo");
