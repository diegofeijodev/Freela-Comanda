import { Logger } from '@nestjs/common';
import { LeitorPdf, LeituraPdfErro, MSG, PedidoLeitura, pdfIlegivel } from '../leitor-pdf.port';
import { erroDoProvedor, HttpIa, TEMPO_LEITURA_MS } from './http-ia';

type Resposta = { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] };

/**
 * Leitura de PDF pela API da OpenAI (chave do cliente). Chat Completions com o PDF como parte `file` (base64 em data URL;
 * PDF exige modelo com visão, gpt-4o em diante) e saída presa ao JSON Schema (`response_format` json_schema, `strict`).
 * Os esquemas já cumprem o modo estrito: todo campo em `required`, `additionalProperties: false`, nulo como `type: [x, 'null']`.
 */
export class OpenAiLeitorPdf implements LeitorPdf {
  private readonly logger = new Logger(OpenAiLeitorPdf.name);

  constructor(
    private readonly chave: string,
    private readonly modelo: string,
    private readonly http: HttpIa,
    private readonly base = 'https://api.openai.com/v1',
  ) {}

  async ler(p: PedidoLeitura): Promise<unknown> {
    if (!this.chave) throw new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO');
    const corpo = {
      model: this.modelo,
      messages: [
        { role: 'system', content: p.instrucoes },
        {
          role: 'user',
          content: [
            { type: 'file', file: { filename: p.nomeArquivo || 'arquivo.pdf', file_data: `data:application/pdf;base64,${p.pdfBase64}` } },
            { type: 'text', text: p.pedido },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'leitura', strict: true, schema: p.schema } },
      max_completion_tokens: 16000,
    };
    let res: Awaited<ReturnType<HttpIa>>;
    try {
      res = await this.http(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LEITURA_MS),
      });
    } catch (e) {
      this.logger.error(`leitura de PDF (OpenAI) sem resposta: ${e instanceof Error ? e.message : String(e)}`);
      throw new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
    }
    const texto = await res.text().catch(() => '');
    if (!res.ok) {
      this.logger.error(`leitura de PDF (OpenAI) falhou: ${res.status} ${texto.slice(0, 300)}`);
      throw erroDoProvedor(res.status, texto);
    }
    let r: Resposta;
    try {
      r = JSON.parse(texto) as Resposta;
    } catch {
      throw new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
    }
    const escolha = r.choices?.[0];
    if (!escolha?.message?.content || escolha.message.refusal || escolha.finish_reason === 'length') {
      this.logger.warn(`leitura de PDF (OpenAI) sem resposta útil: finish_reason=${escolha?.finish_reason ?? '-'}`);
      throw pdfIlegivel();
    }
    try {
      return JSON.parse(escolha.message.content) as unknown;
    } catch {
      throw pdfIlegivel();
    }
  }
}
