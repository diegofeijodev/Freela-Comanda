-- Certificado digital A1 da empresa (Configurações → Certificado digital). Tabelas próprias: não existem no Lovable.
-- `material_cifrado` = .pfx + senha cifrados no servidor; o resto são dados públicos do certificado.
CREATE TABLE "certificado_digital" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "material_cifrado" TEXT NOT NULL,
    "titular" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "tipo" TEXT NOT NULL,
    "politica_oid" TEXT,
    "emissor" TEXT NOT NULL,
    "numero_serie" TEXT NOT NULL,
    "impressao_digital" CHAR(64) NOT NULL,
    "valido_de" TIMESTAMPTZ(6) NOT NULL,
    "valido_ate" TIMESTAMPTZ(6) NOT NULL,
    "cadeia_conferida" BOOLEAN NOT NULL,
    "enviado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_por" UUID,
    "enviado_por_nome" TEXT NOT NULL,
    CONSTRAINT "certificado_digital_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "certificado_digital_uma_linha" CHECK ("id" = 1),
    CONSTRAINT "certificado_digital_cnpj" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "certificado_digital_tipo" CHECK ("tipo" IN ('A1', 'SE-S', 'outro')),
    CONSTRAINT "certificado_digital_validade" CHECK ("valido_ate" > "valido_de")
);

-- Trilha de envio, substituição e remoção (só dados públicos).
CREATE TABLE "certificado_digital_historico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evento" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "titular" TEXT NOT NULL,
    "numero_serie" TEXT NOT NULL,
    "impressao_digital" CHAR(64) NOT NULL,
    "valido_ate" TIMESTAMPTZ(6) NOT NULL,
    "feito_por" UUID,
    "feito_por_nome" TEXT NOT NULL,
    "feito_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "certificado_digital_historico_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "certificado_digital_historico_evento" CHECK ("evento" IN ('enviado', 'substituido', 'removido'))
);

CREATE INDEX "certificado_digital_historico_feito_em_idx" ON "certificado_digital_historico"("feito_em" DESC);
