import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/database/prisma.service';
import { AdminOnly, Modulos } from '../../common/decorators/permissao.decorator';
import { dayToDb, isDateString } from '../../common/time/dates';

/** Vendas do período (painel e tela Vendas). Os gráficos são montados no navegador, como no protótipo. */
@ApiTags('Vendas')
@ApiBearerAuth()
@AdminOnly()
@Modulos('vendas', 'dre', 'caixa', 'cupom')
@Controller('v1/vendas')
export class VendasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  listar(@Query('ini') ini: string, @Query('fim') fim: string) {
    if (!isDateString(ini) || !isDateString(fim)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'ini e fim devem ser datas AAAA-MM-DD' });
    }
    return this.prisma.vendas.findMany({
      where: { data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
      select: {
        pedido: true,
        data: true,
        hora: true,
        produto_relatorio: true,
        item_cardapio_id: true,
        quantidade: true,
        valor_total: true,
        preco_unitario: true,
      },
      orderBy: { data: 'asc' },
    });
  }
}
