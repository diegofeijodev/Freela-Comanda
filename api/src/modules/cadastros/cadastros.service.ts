import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { cnpjValido, normalizarCnpj } from '../../common/fiscal/cnpj';
import { PrismaService } from '../../common/database/prisma.service';
import type {
  CentroCustoDto,
  ConfiguracoesDto,
  DreSubgrupoDto,
  FornecedorDto,
  PlanoContaDto,
  SubgrupoDto,
} from './dto/cadastros.dto';

const naoEncontrado = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });

@Injectable()
export class CadastrosService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- configurações (linha única id=1, criada na migração)
  config() {
    return this.prisma.configuracoes.findUniqueOrThrow({ where: { id: 1 } });
  }
  async salvarConfig(dto: ConfiguracoesDto) {
    const data: ConfiguracoesDto = { ...dto };
    if (dto.cnpj !== undefined) {
      const cnpj = normalizarCnpj(dto.cnpj ?? '');
      if (cnpj !== '' && !cnpjValido(cnpj)) {
        throw new BadRequestException({ code: 'CNPJ_INVALIDO', message: 'CNPJ inválido. Confira os 14 caracteres (pode ter letras).' });
      }
      data.cnpj = cnpj;
    }
    return this.prisma.configuracoes.update({ where: { id: 1 }, data });
  }

  // ----- sazonalidade
  sazonalidade() {
    return this.prisma.sazonalidade.findMany({ orderBy: { mes: 'asc' } });
  }
  async salvarSazonalidade(mes: number, fator: number) {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw naoEncontrado();
    return this.prisma.sazonalidade.update({ where: { mes }, data: { fator_pct: fator } });
  }

  // ----- subgrupos de estoque
  subgrupos() {
    return this.prisma.subgrupos.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
  }
  async criarSubgrupo(dto: SubgrupoDto) {
    const ordem = dto.ordem ?? (await this.prisma.subgrupos.count()) + 1;
    return this.prisma.subgrupos.create({ data: { nome: dto.nome.trim(), grupo: dto.grupo, ordem } });
  }
  excluirSubgrupo(id: string) {
    return this.prisma.subgrupos.delete({ where: { id } });
  }

  // ----- fornecedores
  fornecedores() {
    return this.prisma.fornecedores.findMany({ orderBy: { nome: 'asc' } });
  }
  criarFornecedor(dto: FornecedorDto) {
    return this.prisma.fornecedores.create({
      data: { nome: dto.nome.trim(), telefone: dto.telefone || null, contato: dto.contato || null, cnpj: normalizarCnpj(dto.cnpj ?? '') || null },
    });
  }
  excluirFornecedor(id: string) {
    return this.prisma.fornecedores.delete({ where: { id } });
  }

  // ----- plano de contas de despesas
  planoContas(somenteAtivos: boolean) {
    return this.prisma.plano_contas.findMany({
      where: somenteAtivos ? { ativo: true } : {},
      orderBy: [{ grupo: 'asc' }, { subgrupo: 'asc' }, { conta: 'asc' }],
    });
  }
  criarPlanoConta(dto: PlanoContaDto) {
    return this.prisma.plano_contas.create({ data: { grupo: dto.grupo, subgrupo: dto.subgrupo ?? '', conta: dto.conta } });
  }
  async importarPlanoContas(linhas: PlanoContaDto[]) {
    const r = await this.prisma.plano_contas.createMany({
      data: linhas.map((l) => ({ grupo: l.grupo, subgrupo: l.subgrupo ?? '', conta: l.conta })),
    });
    return { importadas: r.count };
  }
  /** FK de contas_pagar é SET NULL (igual ao protótipo): excluir uma conta usada desclassifica os pagamentos. */
  excluirPlanoConta(id: string) {
    return this.prisma.plano_contas.delete({ where: { id } });
  }

  // ----- centros de custo
  centrosCusto(somenteAtivos: boolean) {
    return this.prisma.centros_custo.findMany({ where: somenteAtivos ? { ativo: true } : {}, orderBy: { nome: 'asc' } });
  }
  criarCentroCusto(dto: CentroCustoDto) {
    return this.prisma.centros_custo.create({ data: { nome: dto.nome } });
  }
  excluirCentroCusto(id: string) {
    return this.prisma.centros_custo.delete({ where: { id } });
  }

  // ----- subgrupos do DRE
  dreSubgrupos() {
    return this.prisma.dre_subgrupos.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
  }
  async criarDreSubgrupo(dto: DreSubgrupoDto) {
    const ordem = dto.ordem ?? (await this.prisma.dre_subgrupos.count()) + 1;
    return this.prisma.dre_subgrupos.create({
      data: { nome: dto.nome.trim().toUpperCase(), sigla: dto.sigla ?? '', meta_pct: dto.meta_pct ?? null, ordem },
    });
  }
  salvarDreMeta(id: string, meta: number | null) {
    return this.prisma.dre_subgrupos.update({ where: { id }, data: { meta_pct: meta } });
  }
}
