-- Chave de IA da empresa para a leitura de PDF (Configurações → Leitura de PDF por IA). Tabela própria: não existe no Lovable,
-- e fora de `configuracoes` porque a loja lê as configurações e a chave nunca pode sair do servidor.
CREATE TABLE "ia_chave" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provedor" TEXT NOT NULL,
    "chave_cifrada" TEXT NOT NULL,
    "dica" TEXT NOT NULL,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por" UUID,
    CONSTRAINT "ia_chave_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ia_chave_uma_linha" CHECK ("id" = 1),
    CONSTRAINT "ia_chave_provedor" CHECK ("provedor" IN ('anthropic', 'openai', 'gemini'))
);
