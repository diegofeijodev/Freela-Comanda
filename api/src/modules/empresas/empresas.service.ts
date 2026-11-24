import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SCHEMA_PADRAO } from '../../common/database/empresa-contexto';
import { EmpresasBancoService } from '../../common/database/empresas-banco.service';
import { NucleoService, PrismaService } from '../../common/database/prisma.service';
import type { EmpresaDto } from './dto/empresa.dto';
import { dadosEmpresa } from './normaliza-empresa';

/**
 * Cadastro de empresas (só o master): mora em `public.empresas` e vale para todas. Cada empresa tem os dados num schema próprio
 * (`EmpresasBancoService`), com a cópia do cadastro dentro dele; a "principal" é a dona do schema `public` (a que já existia).
 */
@Injectable()
export class EmpresasService {
  constructor(
    private readonly nucleo: NucleoService,
    private readonly prisma: PrismaService,
    private readonly banco: EmpresasBancoService,
  ) {}

  listar() {
    return this.nucleo.empresas.findMany({
      orderBy: [{ principal: 'desc' }, { ativo: 'desc' }, { razao_social: 'asc' }],
      include: { _count: { select: { usuarios: true } } },
    });
  }

  async buscar(id: string) {
    const e = await this.nucleo.empresas.findUnique({ where: { id } });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return e;
  }

  /** A empresa já nasce com o banco preparado (a primeira sem dono fica com os dados que já existiam). */
  async criar(dto: EmpresaDto) {
    const dados = dadosEmpresa(dto);
    const e = await this.comCnpjUnico(() => this.nucleo.empresas.create({ data: { ...dados, principal: false } }));
    await this.banco.schemaDe(e);
    return this.buscar(e.id);
  }

  async atualizar(id: string, dto: EmpresaDto) {
    await this.buscar(id);
    const dados = dadosEmpresa(dto);
    const e = await this.comCnpjUnico(() => this.nucleo.empresas.update({ where: { id }, data: { ...dados, updated_at: new Date() } }));
    await this.banco.sincronizar(e);
    return e;
  }

  /**
   * Exclui o cadastro. Os dados NÃO são apagados: o schema é renomeado para `<schema>_excluida_<data>` (recuperável pelo banco).
   * A dona do `public` e empresa com usuários não saem.
   */
  async excluir(id: string) {
    const e = await this.buscar(id);
    if (e.schema_banco === SCHEMA_PADRAO)
      throw new ConflictException({ code: 'PRINCIPAL', message: 'A empresa principal (a dos dados originais) não pode ser excluída. Desative-a, se for o caso.' });
    if (await this.nucleo.users.count({ where: { empresa_id: id } }))
      throw new ConflictException({ code: 'EM_USO', message: 'Há usuários nesta empresa. Exclua-os ou desative a empresa.' });
    if (await this.nucleo.ponto_colaboradores.count({ where: { empresa_id: id } }))
      throw new ConflictException({ code: 'EM_USO', message: 'Há colaboradores nesta empresa. Troque a empresa deles ou desative o cadastro.' });
    await this.nucleo.$transaction(async (tx) => {
      await tx.empresas.delete({ where: { id } });
      if (e.schema_banco) {
        const carimbo = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
        await tx.$executeRawUnsafe(`ALTER SCHEMA "${e.schema_banco}" RENAME TO "${`${e.schema_banco}_excluida_${carimbo}`.slice(0, 63)}"`);
      }
    });
    if (e.schema_banco) await this.prisma.esquecer(e.schema_banco);
    return { ok: true };
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
