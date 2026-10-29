import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Staff } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { ComprasService } from './compras.service';
import { ItemAvulsoDto, ItemListaDto, ReceberDto } from './dto/compras.dto';

@ApiTags('Lista de compras')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class ComprasController {
  constructor(private readonly svc: ComprasService) {}

  @Staff()
  @Get('listas-compra')
  listar() {
    return this.svc.listar();
  }

  @Post('listas-compra/gerar')
  gerar() {
    return this.svc.gerar();
  }

  @Staff()
  @Get('listas-compra/:id')
  uma(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.uma(id);
  }

  @Staff()
  @Get('listas-compra/:id/itens')
  itens(@CurrentUser() user: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.svc.itens(id, user);
  }

  @Post('listas-compra/:id/itens')
  avulso(@Param('id', ParseUuidPipe) id: string, @Body() dto: ItemAvulsoDto) {
    return this.svc.avulso(id, dto.descricao, dto.quantidade);
  }

  @HttpCode(200)
  @Post('listas-compra/:id/enviada')
  marcarEnviada(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.marcarEnviada(id);
  }

  @HttpCode(200)
  @Post('listas-compra/:id/receber')
  receber(@CurrentUser() user: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: ReceberDto) {
    return this.svc.receber(id, dto.atualizar_preco, user.id);
  }

  @Patch('listas-compra-itens/:id')
  atualizarItem(@Param('id', ParseUuidPipe) id: string, @Body() dto: ItemListaDto) {
    return this.svc.atualizarItem(id, dto);
  }

  @Delete('listas-compra-itens/:id')
  removerItem(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.removerItem(id);
  }
}
