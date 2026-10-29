import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminOnly, Staff } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { CardapioService } from './cardapio.service';
import { IngredienteDto, ItemCardapioDto, NovoIngredienteDto, NovoItemCardapioDto } from './dto/cardapio.dto';

@ApiTags('Fichas técnicas')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class CardapioController {
  constructor(private readonly svc: CardapioService) {}

  @Get('fichas/resumo')
  resumo(@Query('ativos') ativos?: string) {
    return this.svc.resumo(ativos === 'true');
  }

  /** Modo consulta da loja: sem custos, sem preço (loja_fichas). */
  @Staff()
  @Get('fichas/loja')
  loja() {
    return this.svc.loja();
  }

  @Get('itens-cardapio')
  itens() {
    return this.svc.itens();
  }

  @Get('itens-cardapio/:id')
  item(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.item(id);
  }

  @Post('itens-cardapio')
  criar(@Body() dto: NovoItemCardapioDto) {
    return this.svc.criar(dto.nome);
  }

  @Patch('itens-cardapio/:id')
  atualizar(@Param('id', ParseUuidPipe) id: string, @Body() dto: ItemCardapioDto) {
    return this.svc.atualizar(id, dto);
  }

  @Delete('itens-cardapio/:id')
  excluir(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluir(id);
  }

  @Post('itens-cardapio/:id/duplicar')
  duplicar(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.duplicar(id);
  }

  @Get('itens-cardapio/:id/ingredientes')
  ingredientes(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.ingredientes(id);
  }

  @Post('itens-cardapio/:id/ingredientes')
  adicionarIngrediente(@Param('id', ParseUuidPipe) id: string, @Body() dto: NovoIngredienteDto) {
    return this.svc.adicionarIngrediente(id, dto);
  }

  @Patch('ficha-ingredientes/:id')
  atualizarIngrediente(@Param('id', ParseUuidPipe) id: string, @Body() dto: IngredienteDto) {
    return this.svc.atualizarIngrediente(id, dto);
  }

  @Delete('ficha-ingredientes/:id')
  removerIngrediente(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.removerIngrediente(id);
  }
}
