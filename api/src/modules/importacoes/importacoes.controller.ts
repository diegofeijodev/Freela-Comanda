import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Modulos } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { DeParaDto, ImportacaoDto } from './dto/importacoes.dto';
import { OrigemDto, OrigemEdicaoDto, VendasConfirmarDto, VendasImportacaoDto } from './dto/vendas-importacao.dto';
import { ImportacoesVendasService } from './importacoes-vendas.service';
import { ImportacoesService } from './importacoes.service';

@ApiTags('Importar dados')
@ApiBearerAuth()
@AdminOnly()
@Modulos('importar', 'vendas')
@Controller('v1')
export class ImportacoesController {
  constructor(
    private readonly svc: ImportacoesService,
    private readonly vendasSvc: ImportacoesVendasService,
  ) {}

  @Get('importacoes')
  recentes(@Query('limite') limite?: string) {
    return this.svc.recentes(Number(limite) || 10);
  }

  // ----- importar vendas de outros sistemas (docs/api-contract.md §20); rotas estáticas antes das com :id

  @Get('importacoes/origens')
  origens() {
    return this.vendasSvc.origens();
  }

  @Post('importacoes/origens')
  criarOrigem(@CurrentUser() user: AuthUser, @Body() dto: OrigemDto) {
    return this.vendasSvc.criarOrigem(dto, user.id);
  }

  @Put('importacoes/origens/:id')
  editarOrigem(@CurrentUser() user: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: OrigemEdicaoDto) {
    return this.vendasSvc.editarOrigem(id, dto, user.id);
  }

  @Get('importacoes/vendas/recentes')
  vendasRecentes(@Query('limite') limite?: string) {
    return this.vendasSvc.recentes(Number(limite) || 5);
  }

  /** A prévia: nunca grava. */
  @HttpCode(200)
  @Post('importacoes/vendas/previa')
  previa(@Body() dto: VendasImportacaoDto) {
    return this.vendasSvc.previa(dto);
  }

  /** 201 com o resultado; a mesma chave e o mesmo corpo de novo = 200 com o resultado guardado (`repetida: true`). */
  @Post('importacoes/vendas/confirmar')
  async confirmar(@CurrentUser() user: AuthUser, @Body() dto: VendasConfirmarDto, @Res({ passthrough: true }) res: FastifyReply) {
    const { resultado, repetida } = await this.vendasSvc.confirmar(dto, user);
    if (repetida) res.status(200);
    return { ...resultado, repetida };
  }

  @Post('importacoes/insumos')
  insumos(@CurrentUser() user: AuthUser, @Body() dto: ImportacaoDto) {
    return this.svc.insumos(dto, user.id);
  }

  @Post('importacoes/fichas')
  fichas(@CurrentUser() user: AuthUser, @Body() dto: ImportacaoDto) {
    return this.svc.fichas(dto, user.id);
  }

  /** Obsoleta (a tela nova usa previa/confirmar): continua como a "Planilha padrão do Comanda" (R4). */
  @Post('importacoes/vendas')
  vendas(@CurrentUser() user: AuthUser, @Body() dto: ImportacaoDto) {
    return this.svc.vendas(dto, user.id);
  }

  @Get('de-para')
  deParaLista() {
    return this.svc.dePara();
  }

  @Put('de-para')
  mapear(@Body() dto: DeParaDto) {
    return this.svc.mapear(dto.produto_relatorio, dto.item_cardapio_id ?? null);
  }
}
