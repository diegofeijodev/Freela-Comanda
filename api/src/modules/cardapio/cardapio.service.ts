import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import type { IngredienteDto, ItemCardapioDto, NovoIngredienteDto } from './dto/cardapio.dto';

export type FichaResumo = {
  id: string;
  nome: string;
  categoria: string;
  codigo: string | null;
  preco_venda: Prisma.Decimal | null;
  mkup: Prisma.Decimal;
  custo_ingredientes: Prisma.Decimal;
  custo_preparo: Prisma.Decimal;
  custo_total: Prisma.Decimal;
  custo_margem: Prisma.Decimal;
  preco_sugerido: Prisma.Decimal;
  n_ingredientes: bigint;
  tem_sem_preco: boolean;
};

const naoEncontrado = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Item do cardápio não encontrado' });

@Injectable()
export class CardapioService {
  constructor(private readonly prisma: PrismaService) {}

  /** v_fichas_resumo. `somenteAtivos` = catálogo da tela Fichas (inativos ficam para o histórico de vendas). */
  resumo(somenteAtivos: boolean) {
    return somenteAtivos
      ? this.prisma.$queryRaw<FichaResumo[]>`
          SELECT r.* FROM v_fichas_resumo r JOIN itens_cardapio ic ON ic.id = r.id WHERE ic.ativo`
      : this.prisma.$queryRaw<FichaResumo[]>`SELECT * FROM v_fichas_resumo`;
  }

  /** Loja: fichas sem custos (loja_fichas do protótipo). */
  loja() {
    return this.prisma.$queryRaw<{ id: string; nome: string; categoria: string; observacoes: string | null; ingredientes: unknown }[]>`
      SELECT * FROM loja_fichas()`;
  }

  itens() {
    return this.prisma.itens_cardapio.findMany({ orderBy: { nome: 'asc' } });
  }

  async item(id: string) {
    const item = await this.prisma.itens_cardapio.findUnique({ where: { id } });
    if (!item) throw naoEncontrado();
    return item;
  }

  criar(nome: string) {
    return this.prisma.itens_cardapio.create({ data: { nome: nome.trim() }, select: { id: true } });
  }

  async atualizar(id: string, dto: ItemCardapioDto) {
    await this.item(id);
    return this.prisma.itens_cardapio.update({ where: { id }, data: dto });
  }

  async excluir(id: string) {
    await this.item(id);
    await this.prisma.itens_cardapio.delete({ where: { id } });
    return { ok: true };
  }

  /** Botão Duplicar: copia o cabeçalho com " (cópia)" no nome e todos os ingredientes. */
  async duplicar(id: string) {
    const item = await this.item(id);
    return this.prisma.$transaction(async (tx) => {
      const { id: _id, created_at: _c, ...resto } = item;
      const novo = await tx.itens_cardapio.create({ data: { ...resto, nome: `${item.nome} (cópia)` }, select: { id: true } });
      const ings = await tx.ficha_ingredientes.findMany({ where: { item_cardapio_id: id } });
      if (ings.length) {
        await tx.ficha_ingredientes.createMany({
          data: ings.map((i) => ({
            item_cardapio_id: novo.id,
            item_estoque_id: i.item_estoque_id,
            quantidade: i.quantidade,
            unidade: i.unidade,
            rendimento: i.rendimento,
            observacao: i.observacao,
            ordem: i.ordem,
          })),
        });
      }
      return novo;
    });
  }

  ingredientes(itemId: string) {
    return this.prisma.ficha_ingredientes.findMany({
      where: { item_cardapio_id: itemId },
      include: { itens_estoque: { select: { nome: true, unidade: true, preco_unitario: true } } },
      orderBy: { ordem: 'asc' },
    });
  }

  async adicionarIngrediente(itemId: string, dto: NovoIngredienteDto) {
    await this.item(itemId);
    if (!dto.quantidade) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Escolha o insumo e a quantidade' });
    const insumo = await this.prisma.itens_estoque.findUnique({ where: { id: dto.item_estoque_id }, select: { unidade: true } });
    if (!insumo) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Escolha o insumo e a quantidade' });
    const ordem = dto.ordem ?? (await this.prisma.ficha_ingredientes.count({ where: { item_cardapio_id: itemId } })) + 1;
    return this.prisma.ficha_ingredientes.create({
      data: { item_cardapio_id: itemId, item_estoque_id: dto.item_estoque_id, quantidade: dto.quantidade, unidade: dto.unidade ?? insumo.unidade, ordem },
    });
  }

  atualizarIngrediente(id: string, dto: IngredienteDto) {
    return this.prisma.ficha_ingredientes.update({ where: { id }, data: dto });
  }

  async removerIngrediente(id: string) {
    await this.prisma.ficha_ingredientes.delete({ where: { id } });
    return { ok: true };
  }
}
