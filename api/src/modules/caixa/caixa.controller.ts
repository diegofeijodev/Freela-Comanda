import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/database/prisma.service';
import { AdminOnly, Modulos } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { dayToDb, monthRange } from '../../common/time/dates';
import { CaixaDto } from './dto/caixa.dto';

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Conciliação de caixa. O protótipo filtrava o mês com `<= 'AAAA-MM-31'` (quebra em meses de 30 dias); aqui `mes=AAAA-MM`
 * vira o intervalo certo. Sem `mes` = todos os dias (apuração do CMV no Inventário).
 */
@ApiTags('Caixa')
@ApiBearerAuth()
@AdminOnly()
@Modulos('caixa')
@Controller('v1/caixa')
export class CaixaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  listar(@Query('mes') mes?: string) {
    if (mes === undefined) return this.prisma.caixa_fechamentos.findMany({ orderBy: { data: 'asc' } });
    if (!MES_RE.test(mes)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'mes deve ser AAAA-MM' });
    const { from, to } = monthRange(mes);
    return this.prisma.caixa_fechamentos.findMany({ where: { data: { gte: dayToDb(from), lte: dayToDb(to) } }, orderBy: { data: 'asc' } });
  }

  @Put()
  salvar(@Body() dto: CaixaDto) {
    const { data, ...valores } = dto;
    return this.prisma.caixa_fechamentos.upsert({
      where: { data: dayToDb(data) },
      create: { data: dayToDb(data), ...valores },
      update: valores,
    });
  }

  @Delete(':id')
  async excluir(@Param('id', ParseUuidPipe) id: string) {
    await this.prisma.caixa_fechamentos.delete({ where: { id } });
    return { ok: true };
  }
}
