/* eslint-disable @typescript-eslint/no-explicit-any -- respostas falsas dos provedores, em formato livre */
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../common/database/prisma.service';
import { cifrar, decifrar, dicaDa } from '../ia/cripto';
import { GeminiLeitorPdf, paraSchemaGemini } from '../ia/gemini-leitor-pdf';
import type { HttpIa } from '../ia/http-ia';
import { IaChaveService, LeitorPorIa } from '../ia/ia-chave.service';
import { OpenAiLeitorPdf } from '../ia/openai-leitor-pdf';
import { pdfDeTeste, SCHEMA_TESTE } from '../ia/pdf-teste';
import { MSG, type PedidoLeitura } from '../leitor-pdf.port';
import { SCHEMA_NOTA } from '../schemas';

const SEGREDO = 'segredo-de-teste-com-mais-de-16';
const CHAVE_OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234';

/** HTTP falso: guarda os pedidos e devolve as respostas na ordem (nenhum teste faz rede). */
function httpFalso(...respostas: { status: number; corpo: unknown }[]) {
  const pedidos: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const http: HttpIa = async (url, init) => {
    pedidos.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const r = respostas.shift() ?? { status: 500, corpo: 'sem resposta' };
    return { ok: r.status < 300, status: r.status, text: async () => (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)) };
  };
  return { http, pedidos };
}

const pedido: PedidoLeitura = { pdfBase64: 'JVBERi0=', nomeArquivo: 'nf.pdf', instrucoes: 'leia', pedido: 'extraia', schema: SCHEMA_NOTA };
const openaiOk = (conteudo: unknown, finish = 'stop') => ({
  status: 200,
  corpo: { choices: [{ finish_reason: finish, message: { content: JSON.stringify(conteudo), refusal: null } }] },
});
const geminiOk = (conteudo: unknown, finish = 'STOP') => ({
  status: 200,
  corpo: { candidates: [{ finishReason: finish, content: { parts: [{ text: JSON.stringify(conteudo) }] } }] },
});

describe('cifra da chave de IA', () => {
  it('ida e volta; segredo errado ou conteúdo mexido = null; a dica só mostra o fim', () => {
    const c = cifrar(CHAVE_OPENAI, SEGREDO);
    expect(c).not.toContain('abcdefghij');
    expect(c).not.toBe(cifrar(CHAVE_OPENAI, SEGREDO)); // iv novo a cada vez
    expect(decifrar(c, SEGREDO)).toBe(CHAVE_OPENAI);
    expect(decifrar(c, 'outro-segredo-com-mais-de-16-xx')).toBeNull();
    const [v, iv, tag, ct] = c.split('.');
    expect(decifrar([v, iv, tag, `A${ct!.slice(1)}`].join('.'), SEGREDO)).toBeNull();
    expect(decifrar('lixo', SEGREDO)).toBeNull();
    expect(dicaDa(CHAVE_OPENAI)).toBe('••••1234');
  });
});

describe('esquema para o Gemini', () => {
  it('nulo vira nullable, tipos em maiúsculas, sem additionalProperties, mantém enum/required/description', () => {
    const g = paraSchemaGemini(SCHEMA_NOTA) as Record<string, any>;
    expect(JSON.stringify(g)).not.toContain('additionalProperties');
    expect(JSON.stringify(g)).not.toContain('"null"');
    expect(g.type).toBe('OBJECT');
    expect(g.required).toEqual(SCHEMA_NOTA.required);
    expect(g.properties.chave).toEqual({ type: 'STRING', nullable: true, description: 'Chave de acesso de 44 dígitos, só números' });
    expect(g.properties.forma_pagamento.type).toBe('STRING');
    expect(g.properties.forma_pagamento.enum).toContain('boleto');
    expect(g.properties.itens.items.properties.quantidade).toEqual({ type: 'NUMBER' });
    expect(g.properties.itens.items.properties.codigo).toEqual({ type: 'STRING', nullable: true });
  });
});

describe('leitor OpenAI', () => {
  it('manda o PDF como parte file (data URL) com o esquema estrito e devolve o JSON', async () => {
    const { http, pedidos } = httpFalso(openaiOk({ itens: [] }));
    expect(await new OpenAiLeitorPdf(CHAVE_OPENAI, 'gpt-5-mini', http).ler(pedido)).toEqual({ itens: [] });
    const p = pedidos[0]!;
    expect(p.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(p.headers.Authorization).toBe(`Bearer ${CHAVE_OPENAI}`);
    expect(p.body.model).toBe('gpt-5-mini');
    const msgs = p.body.messages as any[];
    expect(msgs[0]).toEqual({ role: 'system', content: 'leia' });
    expect(msgs[1].content[0]).toEqual({ type: 'file', file: { filename: 'nf.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } });
    expect(msgs[1].content[1]).toEqual({ type: 'text', text: 'extraia' });
    expect(p.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'leitura', strict: true, schema: SCHEMA_NOTA } });
  });

  it('erros do provedor viram a frase de tela', async () => {
    const ler = (status: number, corpo: unknown) => new OpenAiLeitorPdf(CHAVE_OPENAI, 'm', httpFalso({ status, corpo }).http).ler(pedido);
    await expect(ler(401, { error: { code: 'invalid_api_key' } })).rejects.toMatchObject({ message: MSG.chaveRecusada, code: 'PDF_CHAVE_RECUSADA' });
    await expect(ler(429, { error: { code: 'insufficient_quota' } })).rejects.toMatchObject({ code: 'PDF_SEM_CREDITO' });
    await expect(ler(429, { error: { code: 'rate_limit_exceeded' } })).rejects.toMatchObject({ code: 'PDF_LIMITE', status: 429 });
    await expect(ler(404, { error: { code: 'model_not_found' } })).rejects.toMatchObject({ code: 'PDF_MODELO' });
    await expect(ler(500, 'x')).rejects.toMatchObject({ code: 'PDF_INDISPONIVEL' });
  });

  it('resposta cortada ou recusada = PDF ilegível', async () => {
    const cortada = new OpenAiLeitorPdf(CHAVE_OPENAI, 'm', httpFalso(openaiOk({}, 'length')).http);
    await expect(cortada.ler(pedido)).rejects.toMatchObject({ code: 'PDF_ILEGIVEL' });
    const recusa = { status: 200, corpo: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'não' } }] } };
    await expect(new OpenAiLeitorPdf(CHAVE_OPENAI, 'm', httpFalso(recusa).http).ler(pedido)).rejects.toMatchObject({ code: 'PDF_ILEGIVEL' });
  });
});

describe('leitor Gemini', () => {
  it('manda o PDF em inlineData com o esquema convertido e devolve o JSON', async () => {
    const { http, pedidos } = httpFalso(geminiOk({ itens: [] }));
    expect(await new GeminiLeitorPdf('AIzaChaveDoGoogle0123456789', 'gemini-flash-latest', http).ler(pedido)).toEqual({ itens: [] });
    const p = pedidos[0]!;
    expect(p.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    expect(p.headers['x-goog-api-key']).toBe('AIzaChaveDoGoogle0123456789');
    expect(p.body.systemInstruction).toEqual({ parts: [{ text: 'leia' }] });
    expect((p.body.contents as any[])[0].parts).toEqual([{ inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } }, { text: 'extraia' }]);
    expect(p.body.generationConfig).toEqual({ responseMimeType: 'application/json', responseSchema: paraSchemaGemini(SCHEMA_NOTA) });
  });

  it('chave inválida (400 do Google), bloqueio e resposta cortada', async () => {
    const ler = (...r: { status: number; corpo: unknown }[]) => new GeminiLeitorPdf('k', 'm', httpFalso(...r).http).ler(pedido);
    await expect(ler({ status: 400, corpo: { error: { message: 'API key not valid. Please pass a valid API key.' } } })).rejects.toMatchObject({
      code: 'PDF_CHAVE_RECUSADA',
    });
    await expect(ler({ status: 200, corpo: { promptFeedback: { blockReason: 'SAFETY' } } })).rejects.toMatchObject({ code: 'PDF_ILEGIVEL' });
    await expect(ler(geminiOk({}, 'MAX_TOKENS'))).rejects.toMatchObject({ code: 'PDF_ILEGIVEL' });
  });
});

describe('PDF de teste', () => {
  it('é um PDF com a tabela xref apontando para cada objeto', () => {
    const pdf = Buffer.from(pdfDeTeste(), 'base64').toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
});

describe('chave de IA da empresa', () => {
  type Linha = { id: number; provedor: string; chave_cifrada: string; dica: string; atualizado_em: Date; atualizado_por: string | null };
  function montar(env: Record<string, string>, ...respostas: { status: number; corpo: unknown }[]) {
    let linha: Linha | null = null;
    const prisma = {
      ia_chave: {
        findUnique: async () => linha,
        upsert: async ({ create, update }: { create: Linha; update: Omit<Linha, 'id'> }) => (linha = linha ? { ...linha, ...update } : create),
        deleteMany: async () => ((linha = null), { count: 1 }),
      },
    } as unknown as PrismaService;
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    const h = httpFalso(...respostas);
    return { svc: new IaChaveService(prisma, config, h.http), pedidos: h.pedidos, linha: () => linha };
  }
  const ENV = { JWT_SECRET: SEGREDO };

  it('sem chave nenhuma: status vazio e a leitura diz "não configurada"', async () => {
    const { svc } = montar(ENV);
    expect(await svc.status()).toMatchObject({ origem: null, provedor: null });
    await expect(new LeitorPorIa(svc).ler(pedido)).rejects.toMatchObject({ message: MSG.naoConfigurada, code: 'PDF_NAO_CONFIGURADO' });
  });

  it('sem chave na tela, usa a ANTHROPIC_API_KEY do servidor', async () => {
    const { svc } = montar({ ...ENV, ANTHROPIC_API_KEY: 'sk-ant-do-servidor' });
    expect(await svc.status()).toMatchObject({ origem: 'servidor', provedor: 'anthropic', dica: null });
    expect(await svc.resolver()).toEqual({ provedor: 'anthropic', chave: 'sk-ant-do-servidor' });
  });

  it('salvar testa com uma leitura real do PDF de teste e grava CIFRADO; a tela só vê a dica', async () => {
    const { svc, pedidos, linha } = montar(ENV, openaiOk({ texto: 'Freela Comanda teste 4321', numero: '4321' }));
    const st = await svc.salvar('openai', `  ${CHAVE_OPENAI}  `, 'u1');
    expect(st).toMatchObject({ origem: 'configuracoes', provedor: 'openai', nome: 'ChatGPT (OpenAI)', dica: '••••1234', modelo: 'gpt-5-mini' });
    expect(JSON.stringify(st)).not.toContain('abcdefghij');
    const msg = (pedidos[0]!.body.messages as any[])[1].content[0].file.file_data as string;
    expect(Buffer.from(msg.split(',')[1]!, 'base64').toString('latin1')).toContain('%PDF-');
    expect((pedidos[0]!.body.response_format as any).json_schema.schema).toEqual(SCHEMA_TESTE);
    expect(linha()!.chave_cifrada).not.toContain('abcdefghij');
    expect(linha()!.atualizado_por).toBe('u1');
    expect(await svc.resolver()).toEqual({ provedor: 'openai', chave: CHAVE_OPENAI });
  });

  it('chave recusada no teste NÃO é gravada e volta 400 com o motivo', async () => {
    const { svc, linha } = montar(ENV, { status: 401, corpo: { error: { code: 'invalid_api_key' } } });
    const e = await svc.salvar('openai', CHAVE_OPENAI, 'u1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toEqual({ code: 'CHAVE_IA_INVALIDA', message: 'A IA recusou esta chave. Confira se copiou a chave inteira.' });
    expect(linha()).toBeNull();
  });

  it('resposta sem o texto do PDF de teste também não grava', async () => {
    const { svc, linha } = montar(ENV, geminiOk({ outra: 1 }));
    await expect(svc.salvar('gemini', 'AIzaChaveDoGoogle0123456789', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(linha()).toBeNull();
  });

  it('a leitura usa a chave da tela (Gemini) no lugar da do servidor; remover volta para a do servidor', async () => {
    const { svc, pedidos } = montar({ ...ENV, ANTHROPIC_API_KEY: 'sk-ant-do-servidor' }, geminiOk({ texto: 'x', numero: null }), geminiOk({ itens: [] }));
    await svc.salvar('gemini', 'AIzaChaveDoGoogle0123456789', 'u1');
    expect(await new LeitorPorIa(svc).ler(pedido)).toEqual({ itens: [] });
    expect(pedidos[1]!.headers['x-goog-api-key']).toBe('AIzaChaveDoGoogle0123456789');
    expect(await svc.remover()).toMatchObject({ origem: 'servidor' });
  });

  it('segredo do servidor trocado: a chave salva fica ilegível e a tela pede para cadastrar de novo', async () => {
    const a = montar(ENV, openaiOk({ texto: 'x', numero: null }));
    await a.svc.salvar('openai', CHAVE_OPENAI, 'u1');
    const salvo = a.linha()!;
    const b = montar({ JWT_SECRET: 'outro-segredo-com-mais-de-16-xx' });
    await (b.svc as unknown as { prisma: PrismaService }).prisma.ia_chave.upsert({ where: { id: 1 }, create: salvo, update: salvo } as never);
    await expect(b.svc.resolver()).rejects.toMatchObject({ message: MSG.chaveIlegivel });
  });

  it('IA_CHAVES_SECRET, quando existe, manda na cifra (não o JWT_SECRET)', async () => {
    const { svc, linha } = montar({ ...ENV, IA_CHAVES_SECRET: 'segredo-proprio-da-cifra-1234' }, openaiOk({ texto: 'x', numero: null }));
    await svc.salvar('openai', CHAVE_OPENAI, 'u1');
    expect(decifrar(linha()!.chave_cifrada, 'segredo-proprio-da-cifra-1234')).toBe(CHAVE_OPENAI);
    expect(decifrar(linha()!.chave_cifrada, SEGREDO)).toBeNull();
  });
});
