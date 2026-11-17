import { z } from 'zod';

/** Vazio conta como ausente: o compose declara `VAR: ${VAR:-}` e o padrão sai do zod. */
const vazioComoAusente = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3016),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16),
    JWT_EXPIRES_IN: z.string().default('12h'),
    CORS_ORIGINS: z.string().default(''),

    // Leitura de PDF (NF e DDA) — spec, decisão 6. Vazia = "Leitura de PDF não configurada" (igual ao protótipo sem a chave).
    ANTHROPIC_API_KEY: z.string().default(''),
    AI_PDF_MODEL: z.preprocess(vazioComoAusente, z.string().min(3).default('claude-opus-5-5')),
    // Chave de IA cadastrada pela tela (Configurações): modelo de cada provedor (PDF exige modelo com visão) e o segredo da cifra.
    AI_PDF_MODEL_OPENAI: z.preprocess(vazioComoAusente, z.string().min(3).default('gpt-5-mini')),
    AI_PDF_MODEL_GEMINI: z.preprocess(vazioComoAusente, z.string().min(3).default('gemini-flash-latest')),
    /** Vazio = deriva do JWT_SECRET (rótulo próprio no HKDF). Trocar o segredo usado obriga a cadastrar a chave de IA de novo. */
    IA_CHAVES_SECRET: z.preprocess(vazioComoAusente, z.string().min(16).optional()),

    /** Cifra do certificado digital A1 (HKDF próprio, sem cair no JWT_SECRET). Vazia = recurso desligado. `openssl rand -hex 32` NO servidor. */
    CERTIFICADO_SECRET: z.preprocess(vazioComoAusente, z.string().min(32).optional()),

    /**
     * Busca de notas na SEFAZ (distribuição de DF-e, só leitura). Ausente ou vazia = `desligado`: nenhum timer e nenhuma conexão.
     * `producao` só com o "eu autorizo" do dono.
     */
    SEFAZ_DFE_AMBIENTE: z.preprocess(vazioComoAusente, z.enum(['desligado', 'homologacao', 'producao']).default('desligado')),

    /**
     * Respostas à SEFAZ (ciência automática, confirmação, "Não reconheço", "A compra não aconteceu"). Ausente ou vazia = `desligada`.
     * `ligada` só depois do OK do contador e do "eu autorizo" do dono, e exige `SEFAZ_DFE_AMBIENTE` homologacao ou producao.
     */
    SEFAZ_MANIFESTACAO: z.preprocess(vazioComoAusente, z.enum(['desligada', 'ligada']).default('desligada')),

    /**
     * Cupom fiscal (NFC-e modelo 65). Ausente ou vazia = `desligado`: emitir, consultar, cancelar, testar e ligar respondem 503 e nenhuma
     * conexão sai (os cadastros e a leitura dos cupons continuam). Separada de `SEFAZ_DFE_AMBIENTE`. `producao` só com o "eu autorizo" do
     * dono; valor desconhecido derruba a subida, de propósito.
     */
    NFCE_AMBIENTE: z.preprocess(vazioComoAusente, z.enum(['desligado', 'homologacao', 'producao']).default('desligado')),

    SWAGGER_ENABLED: z.string().optional(),

    /**
     * `true` faz o Fastify confiar em `X-Forwarded-For` (o IP do throttle passa a ser o de quem pediu, não o do nginx).
     * Fica `false` por padrão: sem proxy na frente, qualquer um forjaria o próprio IP. Atrás de nginx, ligue.
     */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.SEFAZ_MANIFESTACAO === 'ligada' && env.SEFAZ_DFE_AMBIENTE === 'desligado') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEFAZ_MANIFESTACAO'],
        message: 'SEFAZ_MANIFESTACAO=ligada exige SEFAZ_DFE_AMBIENTE homologacao ou producao.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export type AmbienteServidor = Env['SEFAZ_DFE_AMBIENTE'];

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) throw new Error(`Configuração de ambiente inválida: ${parsed.error.message}`);
  return parsed.data;
}
