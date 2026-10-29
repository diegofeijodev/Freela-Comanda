import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { dayToDb } from '../../common/time/dates';
import type { ItemEstoqueDto, MovimentacaoDto } from './dto/estoque.dto';

@Injectable()
export class EstoqueService {
  constructor(private readonly prisma: PrismaService) {}

  itens(somenteAtivos: boolean, ordem: 'nome' | 'subgrupo') {
    return this.prisma.itens_estoque.findMany({
      where: somenteAtivos ? { ativo: true } : {},
      orderBy: ordem === 'subgrupo' ? [{ subgrupo: 'asc' }, { nome: 'asc' }] : { nome: 'asc' },
    });
  }

  criar(nome: string) {
    return this.prisma.itens_estoque.create({ data: { nome: nome.trim() } });
  }

  async atualizar(id: string, dto: ItemEstoqueDto) {
    await this.existe(id);
    const data: Prisma.itens_estoqueUpdateInput = { ...dto };
    if (dto.unidade) data.unidade = dto.unidade.toUpperCase();
    return this.prisma.itens_estoque.update({ where: { id }, data });
  }

  /** Ficha técnica usa o item (FK RESTRICT): mesma mensagem que a tela do protótipo mostrava. */
  async excluir(id: string) {
    await this.existe(id);
    try {
      await this.prisma.itens_estoque.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException({ code: 'EM_USO', message: 'Item em uso por fichas técnicas. Desative-o.' });
      }
      throw e;
    }
    return { ok: true };
  }

  saldos() {
    return this.prisma.$queryRaw<{ item_estoque_id: string; saldo: Prisma.Decimal; data_ultimo_inventario: Date | null }[]>`
      SELECT item_estoque_id, saldo, data_ultimo_inventario FROM v_saldo_teorico`;
  }

  consumoSemanal() {
    return this.prisma.$queryRaw<{ item_estoque_id: string; consumo_calc: Prisma.Decimal }[]>`
      SELECT item_estoque_id, consumo_calc FROM v_consumo_semanal`;
  }

  objetivo(mes: number) {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'mes deve ser de 1 a 12' });
    }
    return this.prisma.$queryRaw<{ item_estoque_id: string; consumo_base: Prisma.Decimal | null; objetivo: Prisma.Decimal | null }[]>`
      SELECT item_estoque_id, consumo_base, objetivo FROM estoque_objetivo(${mes}::int)`;
  }

  movimentacoes(itemId: string) {
    return this.prisma.movimentacoes.findMany({
      where: { item_estoque_id: itemId },
      orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    });
  }

  async lancar(dto: MovimentacaoDto, usuarioId: string) {
    if (!dto.quantidade) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Informe a quantidade' });
    const item = await this.prisma.itens_estoque.findUnique({ where: { id: dto.item_estoque_id }, select: { preco_unitario: true } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado' });
    return this.prisma.movimentacoes.create({
      data: {
        item_estoque_id: dto.item_estoque_id,
        tipo: dto.tipo,
        data: dayToDb(dto.data),
        quantidade: dto.tipo === 'perda' ? -Math.abs(dto.quantidade) : dto.quantidade,
        custo_unitario: item.preco_unitario,
        observacao: dto.observacao || null,
        usuario_id: usuarioId,
        referencia: 'manual',
      },
    });
  }

  private async existe(id: string) {
    if (!(await this.prisma.itens_estoque.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado' });
    }
  }
}
