import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { enderecoEmUmaLinha } from '../../modules/empresas/normaliza-empresa';
import { EmpresaContexto, rodarNaEmpresa, SCHEMA_PADRAO, schemaDaEmpresa } from './empresa-contexto';
import { migrarSchema } from './migrar-schema';
import { NucleoService, PrismaService } from './prisma.service';

type Empresa = Prisma.empresasGetPayload<object>;

/**
 * Liga o cadastro de empresas (`public.empresas`) aos schemas de dados. A empresa ganha o schema na criação (ou no primeiro acesso,
 * para as cadastradas antes do multiempresa): a primeira sem dono fica com o `public` (os dados que já existiam), as demais com
 * `empresa_<id>`, criado com TODAS as migrações. Dentro do schema, `empresas` guarda a cópia da própria empresa (FK do ponto,
 * espelho do PDF) e `configuracoes` espelha razão social, fantasia, CNPJ e endereço (o resto do sistema lê de lá).
 */
@Injectable()
export class EmpresasBancoService {
  private readonly logger = new Logger(EmpresasBancoService.name);
  private readonly preparando = new Map<string, Promise<string>>();

  constructor(
    private readonly nucleo: NucleoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Schema da empresa, preparando-o se ainda não existe. */
  async schemaDe(e: Pick<Empresa, 'id' | 'schema_banco'>): Promise<string> {
    if (e.schema_banco) return e.schema_banco;
    let p = this.preparando.get(e.id);
    if (!p) {
      p = this.preparar(e.id).finally(() => this.preparando.delete(e.id));
      this.preparando.set(e.id, p);
    }
    return p;
  }

  async contextoDe(e: Pick<Empresa, 'id' | 'schema_banco'>): Promise<EmpresaContexto> {
    return { schema: await this.schemaDe(e), empresaId: e.id };
  }

  /** Todos os schemas com dados (o `public` sempre), para o que roda fora de requisição (agendador da SEFAZ). */
  async contextosAtivos(): Promise<EmpresaContexto[]> {
    const es = await this.nucleo.empresas.findMany({ where: { schema_banco: { not: null } }, select: { id: true, schema_banco: true } });
    const out: EmpresaContexto[] = es.map((e) => ({ schema: e.schema_banco!, empresaId: e.id }));
    if (!out.some((c) => c.schema === SCHEMA_PADRAO)) out.unshift({ schema: SCHEMA_PADRAO, empresaId: null });
    return out;
  }

  /** Grava a cópia da empresa dentro do schema dela e espelha os dados fiscais em `configuracoes`. */
  async sincronizar(e: Empresa): Promise<void> {
    if (!e.schema_banco) return;
    await rodarNaEmpresa({ schema: e.schema_banco, empresaId: e.id }, () =>
      this.prisma.$transaction(async (tx) => {
        if (e.schema_banco !== SCHEMA_PADRAO) {
          const { id, created_at: _c, ...dados } = e;
          await tx.empresas.upsert({ where: { id }, create: { ...e, principal: true }, update: { ...dados, principal: true } });
        }
        await espelharNaConfiguracao(tx, e);
      }),
    );
  }

  private async preparar(id: string): Promise<string> {
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('DATABASE_URL ausente');
    // Quem fica com o `public` é decidido numa transação com trinco (dois cadastros ao mesmo tempo não disputam o schema).
    const escolhido = await this.nucleo.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('erp-schema-empresa'))`;
      const e = await tx.empresas.findUniqueOrThrow({ where: { id }, select: { schema_banco: true } });
      if (e.schema_banco) return { schema: e.schema_banco, novo: false };
      const publicoLivre = (await tx.empresas.count({ where: { schema_banco: SCHEMA_PADRAO } })) === 0;
      if (publicoLivre) {
        await tx.empresas.update({ where: { id }, data: { schema_banco: SCHEMA_PADRAO, principal: true } });
        // Usuários comuns de antes de existir empresa trabalhavam nos dados do `public`: passam a ser desta empresa.
        await tx.users.updateMany({ where: { master: false, empresa_id: null }, data: { empresa_id: id } });
        return { schema: SCHEMA_PADRAO, novo: true };
      }
      return { schema: schemaDaEmpresa(id), novo: true };
    });
    if (!escolhido.novo) return escolhido.schema;
    if (escolhido.schema !== SCHEMA_PADRAO) {
      this.logger.log(`preparando o schema ${escolhido.schema}`);
      try {
        await migrarSchema(base, escolhido.schema);
      } catch (erro) {
        this.logger.error(String(erro));
        throw new ServiceUnavailableException({ code: 'EMPRESA_PREPARO', message: 'Não foi possível preparar os dados da empresa. Tente de novo em instantes.' });
      }
      await this.nucleo.empresas.update({ where: { id }, data: { schema_banco: escolhido.schema } });
    }
    await this.sincronizar(await this.nucleo.empresas.findUniqueOrThrow({ where: { id } }));
    return escolhido.schema;
  }
}

/** O resto do sistema (telas, SEFAZ, cupom) lê razão social, fantasia, CNPJ e endereço de `configuracoes` do schema. */
export function espelharNaConfiguracao(tx: Prisma.TransactionClient | PrismaClient, e: Empresa) {
  return tx.configuracoes.update({
    where: { id: 1 },
    data: { razao_social: e.razao_social, nome_fantasia: e.nome_fantasia ?? '', cnpj: e.cnpj, endereco: enderecoEmUmaLinha(e) },
  });
}
