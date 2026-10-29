-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('admin', 'loja');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT '',
    "password_hash" TEXT NOT NULL,
    "perfil" "app_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nome_unidade" TEXT NOT NULL DEFAULT 'Chopp & Espeto Valinhos',
    "dia_inventario" INTEGER NOT NULL DEFAULT 1,
    "tolerancia_pct" DECIMAL NOT NULL DEFAULT 2,
    "tolerancia_abs_kg" DECIMAL NOT NULL DEFAULT 0.05,
    "tolerancia_abs_un" DECIMAL NOT NULL DEFAULT 0,
    "max_recontagens" INTEGER NOT NULL DEFAULT 2,
    "custo_preparo_pct" DECIMAL NOT NULL DEFAULT 10,
    "margem_seguranca_pct" DECIMAL NOT NULL DEFAULT 10,
    "mkup_padrao" DECIMAL NOT NULL DEFAULT 3.10,
    "estoque_seguranca_pct" DECIMAL NOT NULL DEFAULT 20,
    "semanas_media" INTEGER NOT NULL DEFAULT 8,
    "loja_pode_abrir" BOOLEAN NOT NULL DEFAULT false,
    "razao_social" TEXT NOT NULL DEFAULT '',
    "nome_fantasia" TEXT NOT NULL DEFAULT '',
    "cnpj" TEXT NOT NULL DEFAULT '',
    "endereco" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sazonalidade" (
    "mes" INTEGER NOT NULL,
    "fator_pct" DECIMAL NOT NULL DEFAULT 0,

    CONSTRAINT "sazonalidade_pkey" PRIMARY KEY ("mes")
);

-- CreateTable
CREATE TABLE "subgrupos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "grupo" TEXT NOT NULL DEFAULT 'Insumos',
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subgrupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "contato" TEXT,
    "telefone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cnpj" TEXT,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_estoque" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'Insumo',
    "subgrupo" TEXT NOT NULL DEFAULT 'Mercearia',
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "preco_unitario" DECIMAL,
    "embalagem_compra" TEXT,
    "qtd_por_embalagem" DECIMAL NOT NULL DEFAULT 1,
    "fornecedor" TEXT,
    "consumo_semanal_manual" DECIMAL,
    "usar_manual" BOOLEAN NOT NULL DEFAULT false,
    "estoque_seguranca_pct" DECIMAL,
    "objetivo_manual" DECIMAL,
    "tolerancia_pct" DECIMAL,
    "tolerancia_abs" DECIMAL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_cardapio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Pratos',
    "grupo" TEXT NOT NULL DEFAULT 'Alimentos',
    "unidade_venda" TEXT NOT NULL DEFAULT 'UN',
    "preco_venda" DECIMAL,
    "mkup" DECIMAL,
    "ncm" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "aliquota" DECIMAL,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_cardapio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ficha_ingredientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_cardapio_id" UUID NOT NULL,
    "item_estoque_id" UUID NOT NULL,
    "quantidade" DECIMAL NOT NULL DEFAULT 0,
    "unidade" TEXT,
    "rendimento" DECIMAL,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ficha_ingredientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "de_para_produtos" (
    "produto_relatorio" TEXT NOT NULL,
    "item_cardapio_id" UUID,
    "ignorar" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "de_para_produtos_pkey" PRIMARY KEY ("produto_relatorio")
);

-- CreateTable
CREATE TABLE "importacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "arquivo" TEXT,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "erros" INTEGER NOT NULL DEFAULT 0,
    "usuario_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "hora" TIME(6),
    "produto_relatorio" TEXT NOT NULL,
    "item_cardapio_id" UUID,
    "preco_unitario" DECIMAL NOT NULL DEFAULT 0,
    "quantidade" DECIMAL NOT NULL DEFAULT 0,
    "desconto" DECIMAL NOT NULL DEFAULT 0,
    "taxa" DECIMAL NOT NULL DEFAULT 0,
    "frete" DECIMAL NOT NULL DEFAULT 0,
    "valor_total" DECIMAL NOT NULL DEFAULT 0,
    "importacao_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "data" DATE NOT NULL DEFAULT CURRENT_DATE,
    "item_estoque_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" DECIMAL NOT NULL,
    "custo_unitario" DECIMAL,
    "referencia" TEXT,
    "venda_id" UUID,
    "usuario_id" UUID,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "data" DATE NOT NULL DEFAULT CURRENT_DATE,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "inicial" BOOLEAN NOT NULL DEFAULT false,
    "aberto_por" UUID,
    "fechado_por" UUID,
    "fechado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodicidade" TEXT NOT NULL DEFAULT 'semanal',

    CONSTRAINT "inventarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_itens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventario_id" UUID NOT NULL,
    "item_estoque_id" UUID NOT NULL,
    "teorico_snapshot" DECIMAL,
    "contagem_1" DECIMAL,
    "usuario_1" UUID,
    "hora_1" TIMESTAMPTZ(6),
    "contagem_2" DECIMAL,
    "usuario_2" UUID,
    "hora_2" TIMESTAMPTZ(6),
    "contagem_3" DECIMAL,
    "usuario_3" UUID,
    "hora_3" TIMESTAMPTZ(6),
    "final" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "justificativa" TEXT,

    CONSTRAINT "inventario_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventario_id" UUID,
    "data" DATE NOT NULL DEFAULT CURRENT_DATE,
    "mes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'gerada',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listas_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_compra_itens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lista_id" UUID NOT NULL,
    "item_estoque_id" UUID,
    "descricao" TEXT NOT NULL,
    "subgrupo" TEXT,
    "fornecedor" TEXT,
    "unidade" TEXT,
    "embalagem" TEXT,
    "qtd_por_embalagem" DECIMAL NOT NULL DEFAULT 1,
    "estoque_contado" DECIMAL,
    "objetivo" DECIMAL,
    "pedido" DECIMAL NOT NULL DEFAULT 0,
    "embalagens" DECIMAL NOT NULL DEFAULT 0,
    "preco_unitario" DECIMAL,
    "qtd_recebida" DECIMAL,
    "preco_pago" DECIMAL,
    "recebido" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "listas_compra_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_entrada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chave" TEXT,
    "numero" TEXT,
    "serie" TEXT,
    "fornecedor_nome" TEXT NOT NULL DEFAULT '',
    "fornecedor_cnpj" TEXT,
    "data_emissao" DATE NOT NULL DEFAULT CURRENT_DATE,
    "data_entrada" DATE NOT NULL DEFAULT CURRENT_DATE,
    "valor_total" DECIMAL NOT NULL DEFAULT 0,
    "forma_pagamento" TEXT NOT NULL DEFAULT 'outros',
    "origem" TEXT NOT NULL DEFAULT 'xml',
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "observacao" TEXT,
    "usuario_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_entrada_itens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nota_id" UUID NOT NULL,
    "codigo_fornecedor" TEXT,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "quantidade" DECIMAL NOT NULL DEFAULT 0,
    "valor_unitario" DECIMAL NOT NULL DEFAULT 0,
    "valor_total" DECIMAL NOT NULL DEFAULT 0,
    "item_estoque_id" UUID,
    "fator" DECIMAL NOT NULL DEFAULT 1,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notas_entrada_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculos_produto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fornecedor_cnpj" TEXT NOT NULL DEFAULT '',
    "codigo_fornecedor" TEXT NOT NULL,
    "descricao" TEXT,
    "item_estoque_id" UUID NOT NULL,
    "fator" DECIMAL NOT NULL DEFAULT 1,

    CONSTRAINT "vinculos_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_contas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grupo" TEXT NOT NULL,
    "subgrupo" TEXT NOT NULL DEFAULT '',
    "conta" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plano_contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centros_custo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centros_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_pagar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "descricao" TEXT NOT NULL,
    "fornecedor_nome" TEXT,
    "nota_id" UUID,
    "parcela" TEXT,
    "valor" DECIMAL NOT NULL DEFAULT 0,
    "vencimento" DATE NOT NULL,
    "forma_pagamento" TEXT NOT NULL DEFAULT 'boleto',
    "categoria" TEXT NOT NULL DEFAULT 'Fornecedores',
    "status" TEXT NOT NULL DEFAULT 'aberta',
    "pago_em" DATE,
    "valor_pago" DECIMAL,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plano_conta_id" UUID,
    "centro_custo_id" UUID,
    "linha_digitavel" TEXT,
    "origem_dda" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contas_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dre_subgrupos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "sigla" TEXT NOT NULL DEFAULT '',
    "meta_pct" DECIMAL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "is_cmv" BOOLEAN NOT NULL DEFAULT false,
    "is_imposto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dre_subgrupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_fechamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "data" DATE NOT NULL,
    "dinheiro" DECIMAL NOT NULL DEFAULT 0,
    "debito" DECIMAL NOT NULL DEFAULT 0,
    "credito" DECIMAL NOT NULL DEFAULT 0,
    "pix" DECIMAL NOT NULL DEFAULT 0,
    "ifood" DECIMAL NOT NULL DEFAULT 0,
    "delivery_proprio" DECIMAL NOT NULL DEFAULT 0,
    "cartao_alimentacao" DECIMAL NOT NULL DEFAULT 0,
    "sangria" DECIMAL NOT NULL DEFAULT 0,
    "sangria_cofre" DECIMAL NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caixa_fechamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subgrupos_nome_key" ON "subgrupos"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_nome_key" ON "fornecedores"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "itens_estoque_codigo_key" ON "itens_estoque"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "itens_estoque_nome_key" ON "itens_estoque"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "itens_cardapio_nome_key" ON "itens_cardapio"("nome");

-- CreateIndex
CREATE INDEX "ficha_ingredientes_item_cardapio_id_idx" ON "ficha_ingredientes"("item_cardapio_id");

-- CreateIndex
CREATE INDEX "vendas_data_idx" ON "vendas"("data");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_pedido_produto_relatorio_data_key" ON "vendas"("pedido", "produto_relatorio", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_item_estoque_id_data_idx" ON "movimentacoes"("item_estoque_id", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_venda_id_idx" ON "movimentacoes"("venda_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_itens_inventario_id_item_estoque_id_key" ON "inventario_itens"("inventario_id", "item_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "notas_entrada_chave_key" ON "notas_entrada"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "vinculos_produto_fornecedor_cnpj_codigo_fornecedor_key" ON "vinculos_produto"("fornecedor_cnpj", "codigo_fornecedor");

-- CreateIndex
CREATE UNIQUE INDEX "dre_subgrupos_nome_key" ON "dre_subgrupos"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "caixa_fechamentos_data_key" ON "caixa_fechamentos"("data");

-- AddForeignKey
ALTER TABLE "ficha_ingredientes" ADD CONSTRAINT "ficha_ingredientes_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ficha_ingredientes" ADD CONSTRAINT "ficha_ingredientes_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "de_para_produtos" ADD CONSTRAINT "de_para_produtos_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_item_cardapio_id_fkey" FOREIGN KEY ("item_cardapio_id") REFERENCES "itens_cardapio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_itens" ADD CONSTRAINT "inventario_itens_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_itens" ADD CONSTRAINT "inventario_itens_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_compra" ADD CONSTRAINT "listas_compra_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_compra_itens" ADD CONSTRAINT "listas_compra_itens_lista_id_fkey" FOREIGN KEY ("lista_id") REFERENCES "listas_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_compra_itens" ADD CONSTRAINT "listas_compra_itens_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_entrada_itens" ADD CONSTRAINT "notas_entrada_itens_nota_id_fkey" FOREIGN KEY ("nota_id") REFERENCES "notas_entrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_entrada_itens" ADD CONSTRAINT "notas_entrada_itens_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_produto" ADD CONSTRAINT "vinculos_produto_item_estoque_id_fkey" FOREIGN KEY ("item_estoque_id") REFERENCES "itens_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_nota_id_fkey" FOREIGN KEY ("nota_id") REFERENCES "notas_entrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_plano_conta_id_fkey" FOREIGN KEY ("plano_conta_id") REFERENCES "plano_contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

