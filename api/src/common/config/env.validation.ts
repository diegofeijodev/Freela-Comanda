import { z } from 'zod';

/** Vazio conta como ausente: o compose declara `VAR: ${VAR:-}` e o padrão sai do zod. */
const vazioComoAusente = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
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

  SWAGGER_ENABLED: z.string().optional(),

  /**
   * `true` faz o Fastify confiar em `X-Forwarded-For` (o IP do throttle passa a ser o de quem pediu, não o do nginx).
   * Fica `false` por padrão: sem proxy na frente, qualquer um forjaria o próprio IP. Atrás de nginx, ligue.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) throw new Error(`Configuração de ambiente inválida: ${parsed.error.message}`);
  return parsed.data;
}
