import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Staff, Modulos } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { AbrirInventarioDto, ContagemDto, FinalDto } from './dto/inventarios.dto';
import { InventariosService } from './inventarios.service';

@ApiTags('Inventário')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class InventariosController {
  constructor(private readonly svc: InventariosService) {}

  @Staff()
  @Get('inventarios')
  listar() {
    return this.svc.listar();
  }

  @Staff()
  @Get('inventarios/atual')
  atual() {
    return this.svc.atual();
  }

  @Modulos('dre')
  @Get('inventarios/historico')
  historico() {
    return this.svc.historico();
  }

  @Modulos('dre')
  @Get('inventarios/cmv')
  cmv() {
    return this.svc.cmv();
  }

  @Staff()
  @Post('inventarios')
  abrir(@CurrentUser() user: AuthUser, @Body() dto: AbrirInventarioDto) {
    return this.svc.abrir(user, dto.data, dto.periodicidade);
  }

  @Staff()
  @Get('inventarios/:id')
  um(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.um(id);
  }

  @Staff()
  @Get('inventarios/:id/contagem')
  contagem(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.contagem(id);
  }

  @Get('inventarios/:id/itens')
  itensAdmin(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.itensAdmin(id);
  }

  @HttpCode(200)
  @Post('inventarios/:id/fechar')
  fechar(@CurrentUser() user: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.svc.fechar(id, user.id);
  }

  @Staff()
  @HttpCode(200)
  @Post('inventario-itens/:id/contagem')
  registrar(@CurrentUser() user: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: ContagemDto) {
    return this.svc.registrar(id, dto.quantidade, user.id);
  }

  @Patch('inventario-itens/:id/final')
  definirFinal(@Param('id', ParseUuidPipe) id: string, @Body() dto: FinalDto) {
    return this.svc.definirFinal(id, dto.final, dto.justificativa);
  }
}
