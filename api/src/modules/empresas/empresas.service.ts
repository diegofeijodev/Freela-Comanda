import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import type { EmpresaDto } from './dto/empresa.dto';
import { dadosEmpresa, enderecoEmUmaLinha } from './normaliza-empresa';

type Tx = Prisma.TransactionClient;
type Empresa = Prisma.empresasGetPayload<object>;

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.empresas.findMany({
      orderBy: [{ principal: 'desc' }, { ativo: 'desc' }, { razao_social: 'asc' }],
      include: { _count: { select: { colaboradores: true } } },
    });
  }

  async buscar(id: string) {
    const e = await this.prisma.empresas.findUnique({ where: { id } });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return e;
  }

  /** A primeira empresa cadastrada já nasce principal. */
  async criar(dto: EmpresaDto) {
    const dados = dadosEmpresa(dto);
    return this.comCnpjUnico(() =>
      this.prisma.$transaction(async (tx) => {
        const principal = (await tx.empresas.count({ where: { principal: true } })) === 0 && dados.ativo;
        const e = await tx.empresas.create({ data: { ...dados, principal } });
        if (principal) await this.espelharNaConfiguracao(tx, e);
        return e;
      }),
    );
  }

  async atualizar(id: string, dto: EmpresaDto) {
    const atual = await this.buscar(id);
    const dados = dadosEmpresa(dto);
    if (atual.principal && !dados.ativo) throw new ConflictException({ code: 'PRINCIPAL', message: 'A empresa principal não pode ser desativada. Escolha outra principal antes.' });
    return this.comCnpjUnico(() =>
      this.prisma.$transaction(async (tx) => {
        const e = await tx.empresas.update({ where: { id }, data: { ...dados, updated_at: new Date() } });
        if (e.principal) await this.espelharNaConfiguracao(tx, e);
        return e;
      }),
    );
  }

  async tornarPrincipal(id: string) {
    const e = await this.buscar(id);
    if (!e.ativo) throw new ConflictException({ code: 'INATIVA', message: 'Ative a empresa antes de torná-la principal' });
    return this.prisma.$transaction(async (tx) => {
      await tx.empresas.updateMany({ where: { principal: true, NOT: { id } }, data: { principal: false } });
      const nova = await tx.empresas.update({ where: { id }, data: { principal: true, updated_at: new Date() } });
      await this.espelharNaConfiguracao(tx, nova);
      return nova;
    });
  }

  async excluir(id: string) {
    const e = await this.buscar(id);
    if (e.principal) throw new ConflictException({ code: 'PRINCIPAL', message: 'A empresa principal não pode ser excluída. Escolha outra principal antes.' });
    const colaboradores = await this.prisma.ponto_colaboradores.count({ where: { empresa_id: id } });
    if (colaboradores > 0) throw new ConflictException({ code: 'EM_USO', message: 'Há colaboradores nesta empresa. Troque a empresa deles ou desative o cadastro.' });
    await this.prisma.empresas.delete({ where: { id } });
    return { ok: true };
  }

  /** A principal é a "empresa do sistema": o resto (telas, SEFAZ, cupom) lê razão social, fantasia, CNPJ e endereço de `configuracoes`. */
  private espelharNaConfiguracao(tx: Tx, e: Empresa) {
    return tx.configuracoes.update({
      where: { id: 1 },
      data: { razao_social: e.razao_social, nome_fantasia: e.nome_fantasia ?? '', cnpj: e.cnpj, endereco: enderecoEmUmaLinha(e) },
    });
  }

  private async comCnpjUnico<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException({ code: 'DUPLICADO', message: 'Já existe empresa cadastrada com este CNPJ' });
      throw e;
    }
  }
}
