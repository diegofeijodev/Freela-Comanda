import { Logger } from '@nestjs/common';
import { LeitorPdf, LeituraPdfErro, MSG, PedidoLeitura, pdfIlegivel } from '../leitor-pdf.port';
import { erroDoProvedor, HttpIa, TEMPO_LEITURA_MS } from './http-ia';

type No = Record<string, unknown>;

/**
 * JSON Schema dos esquemas → o `responseSchema` do Gemini (subconjunto OpenAPI, aceito por todos os modelos):
 * `type: ['string','null']` vira `type: 'STRING', nullable: true`; `additionalProperties` sai (não é aceito);
 * `properties`, `required`, `items`, `enum` e `description` ficam.
 */
export function paraSchemaGemini(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(paraSchemaGemini);
  if (!s || typeof s !== 'object') return s;
  const o = s as No;
  const out: No = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type') {
      const tipos = (Array.isArray(v) ? v : [v]) as string[];
      const reais = tipos.filter((t) => t !== 'null');
      out.type = (reais[0] ?? 'string').toUpperCase();
      if (reais.length !== tipos.length) out.nullable = true;
    } else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as No).map(([nome, sub]) => [nome, paraSchemaGemini(sub)]));
    } else if (k === 'items') {
      out.items = paraSchemaGemini(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

type Resposta = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
};

/**
 * Leitura de PDF pela API do Google Gemini (chave do cliente): `generateContent` com o PDF em `inlineData`
 * (application/pdf) e saída JSON presa ao `responseSchema` convertido.
 */
export class GeminiLeitorPdf implements LeitorPdf {
  private readonly logger = new Logger(GeminiLeitorPdf.name);

  constructor(
    private readonly chave: string,
    private readonly modelo: string,
    private readonly http: HttpIa,
    private readonly base = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  async ler(p: PedidoLeitura): Promise<unknown> {
    if (!this.chave) throw new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO');
    const corpo = {
      systemInstruction: { parts: [{ text: p.instrucoes }] },
      contents: [{ role: 'user', parts: [...p.arquivos.map((a) => ({ inlineData: { mimeType: a.mime, data: a.base64 } })), { text: p.pedido }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: paraSchemaGemini(p.schema) },
    };
    let res: Awaited<ReturnType<HttpIa>>;
    try {
      res = await this.http(`${this.base}/models/${encodeURIComponent(this.modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.chave, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LEITURA_MS),
      });
    } catch (e) {
      this.logger.error(`leitura de PDF (Gemini) sem resposta: ${e instanceof Error ? e.message : String(e)}`);
      throw new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
    }
    const texto = await res.text().catch(() => '');
    if (!res.ok) {
      this.logger.error(`leitura de PDF (Gemini) falhou: ${res.status} ${texto.slice(0, 300)}`);
      throw erroDoProvedor(res.status, texto);
    }
    let r: Resposta;
    try {
      r = JSON.parse(texto) as Resposta;
    } catch {
      throw new LeituraPdfErro(MSG.indisponivel, 502, 'PDF_INDISPONIVEL');
    }
    const c = r.candidates?.[0];
    const saida = (c?.content?.parts ?? []).map((x) => x.text ?? '').join('');
    if (r.promptFeedback?.blockReason || !saida || (c?.finishReason && c.finishReason !== 'STOP')) {
      this.logger.warn(`leitura de PDF (Gemini) sem resposta útil: finishReason=${c?.finishReason ?? '-'} block=${r.promptFeedback?.blockReason ?? '-'}`);
      throw pdfIlegivel();
    }
    try {
      return JSON.parse(saida) as unknown;
    } catch {
      throw pdfIlegivel();
    }
  }
}
