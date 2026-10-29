import { BadRequestException, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { LeituraPdfErro } from './leitor-pdf.port';
import { LeituraPdfService } from './leitura-pdf.service';

type Multipart = { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer>; file: { truncated: boolean } } | undefined> };

const grandeDemais = () => new BadRequestException({ code: 'ARQUIVO_INVALIDO', message: 'Arquivo vazio ou grande demais (máx. 10 MB)' });

/** Lê o único arquivo do multipart e confere que é PDF (o limite de 10 MB é do registro do multipart no main.ts). */
async function lerPdf(req: FastifyRequest): Promise<{ base64: string; nome: string }> {
  const r = req as unknown as Multipart & { isMultipart?: () => boolean };
  if (!r.isMultipart?.()) throw grandeDemais();
  let buf: Buffer;
  let nome = '';
  try {
    const parte = await r.file();
    if (!parte) throw grandeDemais();
    nome = parte.filename;
    buf = await parte.toBuffer();
    if (parte.file.truncated) throw grandeDemais();
  } catch (e) {
    if (e instanceof HttpException) throw e;
    throw grandeDemais();
  }
  if (!buf.length) throw grandeDemais();
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new BadRequestException({ code: 'ARQUIVO_INVALIDO', message: 'O arquivo não é um PDF.' });
  }
  return { base64: buf.toString('base64'), nome };
}

function comoHttp(e: unknown): never {
  if (e instanceof LeituraPdfErro) throw new HttpException({ code: e.code, message: e.message }, e.status);
  throw e;
}

@ApiTags('Leitura de PDF (IA)')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class LeituraPdfController {
  constructor(private readonly svc: LeituraPdfService) {}

  @HttpCode(200)
  @Post('notas/ler-pdf')
  async lerNota(@Req() req: FastifyRequest) {
    const { base64, nome } = await lerPdf(req);
    return this.svc.lerNota(base64, nome).catch(comoHttp);
  }

  @HttpCode(200)
  @Post('dda/ler-pdf')
  async lerDDA(@Req() req: FastifyRequest) {
    const { base64, nome } = await lerPdf(req);
    return this.svc.lerDDA(base64, nome).catch(comoHttp);
  }
}
