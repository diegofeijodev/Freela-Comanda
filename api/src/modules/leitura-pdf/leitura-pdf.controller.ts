import { BadRequestException, Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { LeituraPdfErro, type ArquivoLeitura, type MimeArquivo } from './leitor-pdf.port';
import { LeituraPdfService } from './leitura-pdf.service';
import { SugerirInsumosDto } from './sugerir-insumos.dto';

type Parte = { filename: string; toBuffer: () => Promise<Buffer>; file: { truncated: boolean } };
type Multipart = { files: () => AsyncIterableIterator<Parte>; file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer>; file: { truncated: boolean } } | undefined> };

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

const MAX_FOTOS = 4;
const muitasFotos = () => new BadRequestException({ code: 'ARQUIVO_INVALIDO', message: `Envie até ${MAX_FOTOS} fotos da mesma nota.` });

/** Tipo da imagem pelos primeiros bytes (JPEG, PNG ou WebP); null se for outra coisa. */
function mimeImagem(b: Buffer): MimeArquivo | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Lê de 1 a 4 imagens do multipart (o limite de 10 MB por arquivo e de 4 arquivos é do registro do multipart no main.ts). */
async function lerImagens(req: FastifyRequest): Promise<ArquivoLeitura[]> {
  const r = req as unknown as Multipart & { isMultipart?: () => boolean };
  if (!r.isMultipart?.()) throw grandeDemais();
  const out: ArquivoLeitura[] = [];
  try {
    for await (const parte of r.files()) {
      if (out.length >= MAX_FOTOS) throw muitasFotos();
      const buf = await parte.toBuffer();
      if (parte.file.truncated || !buf.length) throw grandeDemais();
      const mime = mimeImagem(buf);
      if (!mime) throw new BadRequestException({ code: 'ARQUIVO_INVALIDO', message: 'O arquivo não é uma imagem (JPG, PNG ou WebP).' });
      out.push({ base64: buf.toString('base64'), mime, nome: parte.filename || `foto-${out.length + 1}` });
    }
  } catch (e) {
    if (e instanceof HttpException) throw e;
    if ((e as { code?: string }).code === 'FST_FILES_LIMIT') throw muitasFotos();
    throw grandeDemais();
  }
  if (!out.length) throw grandeDemais();
  return out;
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
    return this.svc.lerNota([{ base64, mime: 'application/pdf', nome: nome || 'nota.pdf' }]).catch(comoHttp);
  }

  @HttpCode(200)
  @Post('notas/ler-foto')
  async lerFoto(@Req() req: FastifyRequest) {
    const arquivos = await lerImagens(req);
    return this.svc.lerNota(arquivos).catch((e: unknown) => {
      // Só a frase muda: a de PDF não serve para foto (status e code ficam).
      if (e instanceof LeituraPdfErro && e.code === 'PDF_NAO_CONFIGURADO') {
        throw new HttpException({ code: e.code, message: 'Leitura de nota não configurada: cadastre a chave de uma IA em Configurações.' }, e.status);
      }
      if (e instanceof LeituraPdfErro && e.code === 'PDF_INDISPONIVEL') {
        throw new HttpException({ code: e.code, message: 'Não foi possível ler a foto agora.' }, e.status);
      }
      return comoHttp(e);
    });
  }

  /** Sugestão de insumo por IA para as linhas sem vínculo de uma nota XML (só descrição e unidade). Sem chave de IA: 503 PDF_NAO_CONFIGURADO. */
  @HttpCode(200)
  @Post('notas/sugerir-insumos')
  sugerirInsumos(@Body() dto: SugerirInsumosDto) {
    return this.svc.sugerirInsumos(dto.itens).catch(comoHttp);
  }

  /** Relatório de vendas de outro sistema em PDF (importar vendas, contrato §20): lê pela IA e não grava nada. */
  @HttpCode(200)
  @Post('importacoes/vendas/ler-pdf')
  async lerRelatorioVendas(@Req() req: FastifyRequest) {
    const { base64, nome } = await lerPdf(req);
    return this.svc.lerRelatorioVendas(base64, nome).catch(comoHttp);
  }

  @HttpCode(200)
  @Post('dda/ler-pdf')
  async lerDDA(@Req() req: FastifyRequest) {
    const { base64, nome } = await lerPdf(req);
    return this.svc.lerDDA(base64, nome).catch(comoHttp);
  }
}
