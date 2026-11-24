import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminOnly, Modulos } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { ContasService } from './contas.service';
import { LiquidarDto, NovaContaDto } from './dto/contas.dto';

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@ApiTags('Contas a pagar')
@ApiBearerAuth()
@AdminOnly()
@Modulos('contas', 'dre', 'caixa')
@Controller('v1')
export class ContasController {
  constructor(private readonly svc: ContasService) {}

  @Get('contas-pagar')
  listar() {
    return this.svc.listar();
  }

  @Post('contas-pagar')
  criar(@Body() dto: NovaContaDto) {
    return this.svc.criar(dto);
  }

  @HttpCode(200)
  @Post('contas-pagar/liquidar')
  liquidar(@Body() dto: LiquidarDto) {
    return this.svc.liquidar(dto);
  }

  @HttpCode(200)
  @Post('contas-pagar/:id/reabrir')
  reabrir(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.reabrir(id);
  }

  @Delete('contas-pagar/:id')
  excluir(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluir(id);
  }

  @Get('dre/pagos')
  pagos(@Query('mes') mes: string) {
    if (!MES_RE.test(mes ?? '')) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'mes deve ser AAAA-MM' });
    return this.svc.pagosNoMes(mes);
  }
}
