import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/database/prisma.service';

const naoEncontrado = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Inventário não encontrado' });

@Injectable()
export class InventariosService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.inventarios.findMany({ orderBy: [{ data: 'desc' }, { created_at: 'desc' }] });
  }

  async atual() {
    const inventario = await this.prisma.inventarios.findFirst({ where: { status: { not: 'fechado' } }, orderBy: { created_at: 'desc' } });
    return { inventario };
  }

  async um(id: string) {
    const inv = await this.prisma.inventarios.findUnique({ where: { id } });
    if (!inv) throw naoEncontrado();
    return inv;
  }

  /** Admin sempre; loja só com "Loja pode abrir inventário" ligado (mesma regra de abrir_inventario no protótipo). */
  async abrir(user: AuthUser, data: string, periodicidade: string) {
    if (user.perfil !== 'admin') {
      const cfg = await this.prisma.configuracoes.findUniqueOrThrow({ where: { id: 1 }, select: { loja_pode_abrir: true } });
      if (!cfg.loja_pode_abrir) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    }
    const [r] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT abrir_inventario(${data}::date, ${periodicidade}::text, ${user.id}::uuid) AS id`;
    return { id: r!.id };
  }

  /** Itens para contar, SEM teórico (loja_itens_inventario): o que a loja e a aba "Contar" do admin enxergam. */
  async contagem(id: string) {
    await this.um(id);
    return this.prisma.$queryRaw<unknown[]>`SELECT * FROM loja_itens_inventario(${id}::uuid)`;
  }

  /** Contagem cega: devolve só 'ok' ou 'recontar' (o teórico nunca sai daqui). */
  async registrar(itemId: string, quantidade: number, usuarioId: string) {
    const [r] = await this.prisma.$queryRaw<{ resultado: 'ok' | 'recontar' }[]>`
      SELECT registrar_contagem(${itemId}::uuid, ${quantidade}::numeric, ${usuarioId}::uuid) AS resultado`;
    return { resultado: r!.resultado };
  }

  /** Visão do admin: contagens, teórico e diferenças. */
  async itensAdmin(id: string) {
    await this.um(id);
    return this.prisma.inventario_itens.findMany({
      where: { inventario_id: id },
      include: { itens_estoque: { select: { nome: true, unidade: true, subgrupo: true, preco_unitario: true } } },
    });
  }

  async definirFinal(itemId: string, final: number, justificativa: string) {
    const item = await this.prisma.inventario_itens.findUnique({ where: { id: itemId }, include: { inventarios: { select: { status: true } } } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado' });
    if (item.inventarios.status === 'fechado') throw new BadRequestException({ code: 'REGRA', message: 'Inventário já fechado' });
    return this.prisma.inventario_itens.update({
      where: { id: itemId },
      data: {
        final,
        justificativa,
        status: item.status === 'pendente' || item.status === 'recontar' ? 'diferenca_confirmada' : item.status,
      },
    });
  }

  /** Aprovar e fechar: lança os ajustes, fecha e gera a lista de compras (fechar_inventario). */
  async fechar(id: string, usuarioId: string) {
    await this.um(id);
    const [r] = await this.prisma.$queryRaw<{ lista_id: string }[]>`
      SELECT fechar_inventario(${id}::uuid, ${usuarioId}::uuid) AS lista_id`;
    return { lista_id: r!.lista_id };
  }

  /** Perdas/sobras dos inventários fechados não iniciais (histórico e ranking de perdas). */
  historico() {
    return this.prisma.inventario_itens.findMany({
      where: { inventarios: { status: 'fechado', inicial: false } },
      select: {
        inventario_id: true,
        final: true,
        teorico_snapshot: true,
        itens_estoque: { select: { nome: true, preco_unitario: true } },
        inventarios: { select: { status: true, inicial: true, data: true } },
      },
    });
  }

  cmv() {
    return this.prisma.$queryRaw<
      { inventario_id: string; data: Date; data_anterior: Date | null; item_estoque_id: string; cmv_valor: Prisma.Decimal | null }[]
    >`SELECT inventario_id, data, data_anterior, item_estoque_id, cmv_valor FROM v_cmv_periodo`;
  }
}
