import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { CaixaSefazService } from './caixa.service';
import { CicloSefazService } from './ciclo.service';
import { ConfigurarBuscaDto, ConfigurarRespostasDto, IgnorarNotaSefazDto } from './notas-sefaz.dto';

/**
 * Notas da SEFAZ: caixa, situação da busca e das respostas, ligar/desligar cada uma, "Buscar agora", conferência do XML, Ignorar (que pode
 * avisar a SEFAZ), reabrir e "Tentar de novo". Só admin. Nenhuma rota fala com a SEFAZ: as respostas só saem pelo tique do agendador.
 */
@ApiTags('Notas da SEFAZ')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/notas-sefaz')
export class NotasSefazController {
  constructor(
    private readonly caixa: CaixaSefazService,
    private readonly ciclo: CicloSefazService,
  ) {}

  @Get('situacao')
  situacao() {
    return this.caixa.situacao();
  }

  @Put('configuracao')
  configurar(@CurrentUser() eu: AuthUser, @Body() dto: ConfigurarBuscaDto) {
    return this.caixa.configurar(dto.busca_ligada, { id: eu.id, nome: eu.nome });
  }

  /** "Ligar as respostas" / "Desligar as respostas" → a situação. 503 sem `SEFAZ_MANIFESTACAO=ligada`; ligar confere como a busca. */
  @Put('respostas')
  configurarRespostas(@CurrentUser() eu: AuthUser, @Body() dto: ConfigurarRespostasDto) {
    return this.caixa.configurarRespostas(dto.ligadas, { id: eu.id, nome: eu.nome });
  }

  /** Confere e reserva síncrono (recusa = 409/422/503); a consulta à SEFAZ roda em segundo plano. */
  @Post('buscar')
  @HttpCode(202)
  async buscar(@CurrentUser() eu: AuthUser) {
    await this.ciclo.buscarAgora({ id: eu.id, nome: eu.nome });
    return { iniciada: true };
  }

  @Get()
  listar(@Query('filtro') filtro?: string, @Query('limite') limite?: string) {
    if (filtro !== undefined && filtro !== 'a_conferir' && filtro !== 'todas') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Filtro inválido.' });
    }
    return this.caixa.listar(filtro ?? 'a_conferir', Number(limite) || 100);
  }

  /**
   * O `procNFe` em `text/xml`. O cabeçalho só vai DEPOIS de o XML existir: com `@Header` ele ficaria também nas respostas de erro
   * (JSON), e o Fastify recusa objeto com content-type de texto (500 no lugar do 409/404).
   */
  @Get(':id/xml')
  async xml(@Param('id', ParseUuidPipe) id: string, @Res({ passthrough: true }) res: FastifyReply): Promise<string> {
    const xml = await this.caixa.xml(id);
    void res.header('content-type', 'text/xml; charset=utf-8');
    return xml;
  }

  @Post(':id/ignorar')
  @HttpCode(200)
  ignorar(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: IgnorarNotaSefazDto) {
    return this.caixa.ignorar(id, dto.motivo, dto.texto ?? null, { id: eu.id, nome: eu.nome }, new Date(), dto.avisar_sefaz === true);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  reabrir(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.caixa.reabrir(id, { id: eu.id, nome: eu.nome });
  }

  /** "Tentar de novo": a resposta que falhou volta à fila (409 SEFAZ_NADA_A_REENVIAR sem nenhuma). */
  @Post(':id/responder-de-novo')
  @HttpCode(200)
  responderDeNovo(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.caixa.responderDeNovo(id, { id: eu.id, nome: eu.nome });
  }
}
