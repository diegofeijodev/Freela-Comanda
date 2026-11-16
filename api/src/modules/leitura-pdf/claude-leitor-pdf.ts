import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { ArquivoLeitura, LeitorPdf, LeituraPdfErro, MSG, PedidoLeitura, pdfIlegivel } from './leitor-pdf.port';

/** Blocos de conteúdo da Anthropic para os arquivos: PDF = `document`, imagem = `image` (mesma ordem da lista). */
export function blocosClaude(arquivos: ArquivoLeitura[]): unknown[] {
  return arquivos.map((a) =>
    a.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 }, title: a.nome }
      : { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.base64 } },
  );
}

/**
 * Leitura de PDF pela API da Anthropic (o protótipo usava o gateway de IA da Lovable): PDF em base64 como bloco `document`
 * e resposta restrita ao JSON Schema do protótipo (`output_config.format`). Esforço baixo, como o `reasoning.effort: "low"`
 * de lá. `fallbacks: 'default'`: se o modelo recusar por política, a própria API refaz o pedido no modelo recomendado.
 */
export class ClaudeLeitorPdf implements LeitorPdf {
  private readonly logger = new Logger(ClaudeLeitorPdf.name);
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 120_000 }) : null;
  }

  configurado(): boolean {
    return this.client !== null;
  }

  async ler(p: PedidoLeitura): Promise<unknown> {
    if (!this.client) throw new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO');
    let resposta: Anthropic.Beta.Messages.BetaMessage;
    try {
      resposta = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: p.instrucoes,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: p.schema } },
        messages: [
          {
            role: 'user',
            content: [
              ...blocosClaude(p.arquivos),
              { type: 'text', text: p.pedido },
            ] as Anthropic.Beta.Messages.BetaContentBlockParam[],
          },
        ],
      });
    } catch (e) {
      throw this.traduzir(e);
    }
    if (resposta.stop_reason === 'refusal' || resposta.stop_reason === 'max_tokens') {
      this.logger.warn(`leitura de PDF sem resposta útil: stop_reason=${resposta.stop_reason}`);
      throw pdfIlegivel();
    }
    const texto = resposta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw pdfIlegivel();
    }
  }

  private traduzir(e: unknown): LeituraPdfErro {
    if (e instanceof Anthropic.RateLimitError) return new LeituraPdfErro(MSG.muitas, 429, 'PDF_LIMITE');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      this.logger.error(`chave da Anthropic recusada (${e.status})`);
      return new LeituraPdfErro(MSG.chaveRecusada, 503, 'PDF_CHAVE_RECUSADA');
    }
    if (e instanceof Anthropic.NotFoundError) return new LeituraPdfErro(MSG.modelo, 503, 'PDF_MODELO');
    if (e instanceof Anthropic.APIError && /credit balance|billing/i.test(e.message)) return new LeituraPdfErro(MSG.semCredito, 503, 'PDF_SEM_CREDITO');
    if (e instanceof Anthropic.APIError) {
      this.logger.error(`leitura de PDF falhou: ${e.status} ${e.message}`);
      return new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
    }
    this.logger.error(`leitura de PDF falhou: ${e instanceof Error ? e.message : String(e)}`);
    return new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
  }
}
