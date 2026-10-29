import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { dayToDb, monthRange } from '../../common/time/dates';
import type { LiquidarDto, NovaContaDto } from './dto/contas.dto';

@Injectable()
export class ContasService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.contas_pagar.findMany({ orderBy: [{ vencimento: 'asc' }, { created_at: 'asc' }] });
  }

  criar(dto: NovaContaDto) {
    if (!dto.valor) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Preencha descrição, valor e vencimento' });
    return this.prisma.contas_pagar.create({
      data: {
        descricao: dto.descricao,
        fornecedor_nome: dto.fornecedor_nome || null,
        valor: dto.valor,
        vencimento: dayToDb(dto.vencimento),
        forma_pagamento: dto.forma_pagamento || 'boleto',
        categoria: dto.categoria || 'Fornecedores',
        linha_digitavel: dto.linha_digitavel || null,
        origem_dda: dto.origem_dda ?? false,
      },
    });
  }

  /** Liquidação (botão Pagar e "Liquidar selecionados" do DDA): pago pelo valor da conta, com classe e centro de custo. */
  async liquidar(dto: LiquidarDto) {
    const [plano, centro] = await Promise.all([
      this.prisma.plano_contas.findUnique({ where: { id: dto.plano_conta_id }, select: { id: true } }),
      this.prisma.centros_custo.findUnique({ where: { id: dto.centro_custo_id }, select: { id: true } }),
    ]);
    if (!plano || !centro) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Escolha a classe e o centro de custo' });
    const n = await this.prisma.$executeRaw`
      UPDATE contas_pagar SET status = 'paga', pago_em = ${dto.pago_em}::date, valor_pago = valor,
        plano_conta_id = ${dto.plano_conta_id}::uuid, centro_custo_id = ${dto.centro_custo_id}::uuid
      WHERE id = ANY(${dto.ids}::uuid[])`;
    return { liquidadas: n };
  }

  async reabrir(id: string) {
    await this.existe(id);
    return this.prisma.contas_pagar.update({
      where: { id },
      data: { status: 'aberta', pago_em: null, valor_pago: null, plano_conta_id: null, centro_custo_id: null },
    });
  }

  /** A tela só oferece Excluir para conta sem nota; aqui vira regra (as parcelas da NF saem com a nota). */
  async excluir(id: string) {
    const c = await this.existe(id);
    if (c.nota_id) throw new ConflictException({ code: 'EM_USO', message: 'Conta de nota fiscal não pode ser excluída aqui.' });
    await this.prisma.contas_pagar.delete({ where: { id } });
    return { ok: true };
  }

  /** Despesas do DRE: contas pagas no mês (pago_em). */
  pagosNoMes(mes: string) {
    const { from, to } = monthRange(mes);
    return this.prisma.contas_pagar.findMany({
      where: { status: 'paga', pago_em: { gte: dayToDb(from), lte: dayToDb(to) } },
      select: { plano_conta_id: true, valor: true, valor_pago: true },
    });
  }

  private async existe(id: string) {
    const c = await this.prisma.contas_pagar.findUnique({ where: { id }, select: { id: true, nota_id: true } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conta não encontrada' });
    return c;
  }
}
