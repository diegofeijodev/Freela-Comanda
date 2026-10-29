import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { LancarNotaDto } from './dto/notas.dto';
import { NotasService } from './notas.service';

@ApiTags('Entrada de notas')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class NotasController {
  constructor(private readonly svc: NotasService) {}

  @Get('notas')
  recentes(@Query('limite') limite?: string) {
    return this.svc.recentes(Number(limite) || 30);
  }

  @Get('notas/existe')
  existe(@Query('chave') chave: string) {
    return this.svc.existe(String(chave ?? ''));
  }

  @Get('vinculos')
  vinculos(@Query('cnpj') cnpj?: string) {
    return this.svc.vinculos(String(cnpj ?? ''));
  }

  @Post('notas')
  lancar(@CurrentUser() user: AuthUser, @Body() dto: LancarNotaDto) {
    return this.svc.lancar(dto, user.id);
  }
}
