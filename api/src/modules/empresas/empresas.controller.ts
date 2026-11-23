import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { EmpresaDto } from './dto/empresa.dto';
import { EmpresasService } from './empresas.service';

@ApiTags('Empresas')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/empresas')
export class EmpresasController {
  constructor(private readonly svc: EmpresasService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get(':id')
  buscar(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.buscar(id);
  }

  @Post()
  criar(@Body() dto: EmpresaDto) {
    return this.svc.criar(dto);
  }

  @Put(':id')
  atualizar(@Param('id', ParseUuidPipe) id: string, @Body() dto: EmpresaDto) {
    return this.svc.atualizar(id, dto);
  }

  @HttpCode(200)
  @Post(':id/principal')
  tornarPrincipal(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.tornarPrincipal(id);
  }

  @Delete(':id')
  excluir(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluir(id);
  }
}
