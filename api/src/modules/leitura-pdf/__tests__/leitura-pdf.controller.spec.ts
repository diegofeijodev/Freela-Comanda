import type { FastifyRequest } from 'fastify';
import { LeituraPdfErro } from '../leitor-pdf.port';
import { LeituraPdfController } from '../leitura-pdf.controller';
import type { LeituraPdfService } from '../leitura-pdf.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const req = {
  isMultipart: () => true,
  files: async function* () {
    yield { filename: 'a.jpg', toBuffer: async () => JPEG, file: { truncated: false } };
  },
} as unknown as FastifyRequest;
const ctl = (e: unknown) => new LeituraPdfController({ lerNota: async () => Promise.reject(e) } as unknown as LeituraPdfService);

describe('ler-foto: frases de falha', () => {
  it('PDF_INDISPONIVEL vira a frase da foto (mesmo status e code)', async () => {
    await expect(ctl(new LeituraPdfErro('Não foi possível ler o PDF agora.', 502, 'PDF_INDISPONIVEL')).lerFoto(req)).rejects.toMatchObject({
      status: 502,
      response: { code: 'PDF_INDISPONIVEL', message: 'Não foi possível ler a foto agora.' },
    });
  });
  it('PDF_NAO_CONFIGURADO segue com a frase de nota', async () => {
    await expect(ctl(new LeituraPdfErro('x', 503, 'PDF_NAO_CONFIGURADO')).lerFoto(req)).rejects.toMatchObject({
      status: 503,
      response: { code: 'PDF_NAO_CONFIGURADO', message: expect.stringContaining('Leitura de nota não configurada') },
    });
  });
  it('a rota de PDF mantém a frase de PDF', async () => {
    const pdfReq = {
      isMultipart: () => true,
      file: async () => ({ filename: 'a.pdf', toBuffer: async () => Buffer.from('%PDF-1.4'), file: { truncated: false } }),
    } as unknown as FastifyRequest;
    await expect(ctl(new LeituraPdfErro('Não foi possível ler o PDF agora.', 502, 'PDF_INDISPONIVEL')).lerNota(pdfReq)).rejects.toMatchObject({
      response: { message: 'Não foi possível ler o PDF agora.' },
    });
  });
});
