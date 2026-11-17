/* eslint-disable @typescript-eslint/no-explicit-any -- pedidos falsos dos provedores, em formato livre */
import { blocosClaude } from '../claude-leitor-pdf';
import { GeminiLeitorPdf } from '../ia/gemini-leitor-pdf';
import type { HttpIa } from '../ia/http-ia';
import { OpenAiLeitorPdf } from '../ia/openai-leitor-pdf';
import type { ArquivoLeitura, PedidoLeitura } from '../leitor-pdf.port';
import { SCHEMA_NOTA } from '../schemas';

const jpeg: ArquivoLeitura = { base64: 'AAAA', mime: 'image/jpeg', nome: 'foto1.jpg' };
const png: ArquivoLeitura = { base64: 'BBBB', mime: 'image/png', nome: 'foto2.png' };
const webp: ArquivoLeitura = { base64: 'CCCC', mime: 'image/webp', nome: 'foto3.webp' };
const pdf: ArquivoLeitura = { base64: 'JVBERi0=', mime: 'application/pdf', nome: 'nf.pdf' };
const pedido = (arquivos: ArquivoLeitura[]): PedidoLeitura => ({ arquivos, instrucoes: 'leia', pedido: 'extraia', schema: SCHEMA_NOTA });

/** HTTP falso: guarda o corpo enviado e devolve uma resposta útil (nenhum teste faz rede). */
function httpFalso(corpo: unknown) {
  const pedidos: Record<string, any>[] = [];
  const http: HttpIa = async (_url, init) => {
    pedidos.push(JSON.parse(init.body) as Record<string, any>);
    return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
  };
  return { http, pedidos };
}

describe('blocosClaude', () => {
  it('imagem vira bloco image; PDF continua document com o título', () => {
    expect(blocosClaude([jpeg])).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }]);
    expect(blocosClaude([pdf])).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' }, title: 'nf.pdf' },
    ]);
  });

  it('sem arquivo (pedido só de texto) não gera bloco', () => {
    expect(blocosClaude([])).toEqual([]);
  });

  it('várias imagens mantêm a ordem da lista', () => {
    expect(blocosClaude([jpeg, png, webp]).map((b: any) => b.source.media_type)).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('OpenAI com imagens', () => {
  const ok = { choices: [{ finish_reason: 'stop', message: { content: '{"a":1}', refusal: null } }] };

  it('2 imagens = 2 partes image_url (data URL) e a parte de texto por último', async () => {
    const { http, pedidos } = httpFalso(ok);
    await new OpenAiLeitorPdf('sk-x', 'gpt-4o', http).ler(pedido([jpeg, png]));
    expect(pedidos[0]!.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } },
      { type: 'text', text: 'extraia' },
    ]);
  });

  it('sem arquivo, só a parte de texto', async () => {
    const { http, pedidos } = httpFalso(ok);
    await new OpenAiLeitorPdf('sk-x', 'gpt-4o', http).ler(pedido([]));
    expect(pedidos[0]!.messages[1].content).toEqual([{ type: 'text', text: 'extraia' }]);
  });

  it('PDF continua parte file', async () => {
    const { http, pedidos } = httpFalso(ok);
    await new OpenAiLeitorPdf('sk-x', 'gpt-4o', http).ler(pedido([pdf]));
    expect(pedidos[0]!.messages[1].content[0]).toEqual({ type: 'file', file: { filename: 'nf.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } });
  });
});

describe('Gemini com imagens', () => {
  it('imagem vira inlineData com o mime dela; o texto vem por último', async () => {
    const { http, pedidos } = httpFalso({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }] });
    await new GeminiLeitorPdf('chave', 'gemini-2.5-flash', http).ler(pedido([webp]));
    expect(pedidos[0]!.contents[0].parts[0].inlineData.mimeType).toBe('image/webp');
    expect(pedidos[0]!.contents[0].parts).toEqual([{ inlineData: { mimeType: 'image/webp', data: 'CCCC' } }, { text: 'extraia' }]);
  });

  it('sem arquivo, só a parte de texto', async () => {
    const { http, pedidos } = httpFalso({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }] });
    await new GeminiLeitorPdf('chave', 'gemini-2.5-flash', http).ler(pedido([]));
    expect(pedidos[0]!.contents[0].parts).toEqual([{ text: 'extraia' }]);
  });
});
