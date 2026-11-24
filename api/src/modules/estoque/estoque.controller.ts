import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Modulos } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { ItemEstoqueDto, MovimentacaoDto, NovoItemEstoqueDto } from './dto/estoque.dto';
import { EstoqueService } from './estoque.service';

/** Tudo de estoque é só do admin: a loja nunca vê saldo teórico (contagem cega). */
@ApiTags('Estoque')
@ApiBearerAuth()
@AdminOnly()
@Modulos('estoque', 'objetivo', 'notas', 'importar', 'cupom')
@Controller('v1')
export class EstoqueController {
  constructor(private readonly svc: EstoqueService) {}

  @Get('itens-estoque')
  itens(@Query('ativo') ativo?: string, @Query('ordem') ordem?: string) {
    return this.svc.itens(ativo === 'true', ordem === 'subgrupo' ? 'subgrupo' : 'nome');
  }

  @Post('itens-estoque')
  criar(@Body() dto: NovoItemEstoqueDto) {
    return this.svc.criar(dto.nome);
  }

  @Patch('itens-estoque/:id')
  atualizar(@Param('id', ParseUuidPipe) id: string, @Body() dto: ItemEstoqueDto) {
    return this.svc.atualizar(id, dto);
  }

  @Delete('itens-estoque/:id')
  excluir(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluir(id);
  }

  @Get('estoque/saldos')
  saldos() {
    return this.svc.saldos();
  }

  @Get('estoque/consumo-semanal')
  consumoSemanal() {
    return this.svc.consumoSemanal();
  }

  @Get('estoque/objetivo')
  objetivo(@Query('mes', ParseIntPipe) mes: number) {
    return this.svc.objetivo(mes);
  }

  @Get('movimentacoes')
  movimentacoes(@Query('item_estoque_id', ParseUuidPipe) itemId: string) {
    return this.svc.movimentacoes(itemId);
  }

  @Post('movimentacoes')
  lancar(@CurrentUser() user: AuthUser, @Body() dto: MovimentacaoDto) {
    return this.svc.lancar(dto, user.id);
  }
}
