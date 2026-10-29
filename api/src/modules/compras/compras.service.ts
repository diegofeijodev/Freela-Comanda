import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/database/prisma.service';
import type { ItemListaDto } from './dto/compras.dto';

const naoEncontrada = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Lista não encontrada' });

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.listas_compra.findMany({ orderBy: { created_at: 'desc' } });
  }

  async uma(id: string) {
    const l = await this.prisma.listas_compra.findUnique({ where: { id } });
    if (!l) throw naoEncontrada();
    return l;
  }

  /** "Gerar lista agora": objetivo do mês corrente − saldo teórico (gerar_lista_compras sem inventário). */
  async gerar() {
    const [r] = await this.prisma.$queryRaw<{ id: string }[]>`SELECT gerar_lista_compras(NULL) AS id`;
    return { id: r!.id };
  }

  /** Admin vê contado/objetivo/preço; a loja só a projeção sem valores (loja_lista_itens). */
  async itens(id: string, user: AuthUser) {
    await this.uma(id);
    if (user.perfil === 'admin') return this.prisma.listas_compra_itens.findMany({ where: { lista_id: id }, orderBy: { descricao: 'asc' } });
    return this.prisma.$queryRaw<unknown[]>`SELECT * FROM loja_lista_itens(${id}::uuid)`;
  }

  async atualizarItem(itemId: string, dto: ItemListaDto) {
    const item = await this.prisma.listas_compra_itens.findUnique({ where: { id: itemId }, select: { recebido: true } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item não encontrado' });
    return this.prisma.listas_compra_itens.update({ where: { id: itemId }, data: dto });
  }

  async removerItem(itemId: string) {
    await this.prisma.listas_compra_itens.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async avulso(id: string, descricao: string, quantidade: number) {
    const l = await this.uma(id);
    if (l.status !== 'gerada') throw new BadRequestException({ code: 'REGRA', message: 'A lista já foi enviada' });
    return this.prisma.listas_compra_itens.create({
      data: { lista_id: id, descricao, pedido: quantidade, embalagens: quantidade, qtd_por_embalagem: 1, fornecedor: 'Avulso', subgrupo: 'Avulso', unidade: 'UN' },
    });
  }

  async marcarEnviada(id: string) {
    await this.uma(id);
    return this.prisma.listas_compra.update({ where: { id }, data: { status: 'enviada' } });
  }

  async receber(id: string, atualizarPreco: boolean, usuarioId: string) {
    await this.uma(id);
    await this.prisma.$executeRaw`SELECT receber_lista(${id}::uuid, ${atualizarPreco}::boolean, ${usuarioId}::uuid)`;
    return this.uma(id);
  }
}
