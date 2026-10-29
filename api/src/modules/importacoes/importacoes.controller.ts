import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { DeParaDto, ImportacaoDto } from './dto/importacoes.dto';
import { ImportacoesService } from './importacoes.service';

@ApiTags('Importar dados')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class ImportacoesController {
  constructor(private readonly svc: ImportacoesService) {}

  @Get('importacoes')
  recentes(@Query('limite') limite?: string) {
    return this.svc.recentes(Number(limite) || 10);
  }

  @Post('importacoes/insumos')
  insumos(@CurrentUser() user: AuthUser, @Body() dto: ImportacaoDto) {
    return this.svc.insumos(dto, user.id);
  }

  @Post('importacoes/fichas')
  fichas(@CurrentUser() user: AuthUser, @Body() dto: ImportacaoDto) {
    return this.svc.fichas(dto, user.id);
  }

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
