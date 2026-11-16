import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizaNome } from '../../common/parse/normaliza';
import { PrismaService } from '../../common/database/prisma.service';
import { dayToDb } from '../../common/time/dates';
import type { LancarNotaDto } from './dto/notas.dto';

/** Formas pagas no ato: viram conta já quitada (A_VISTA do protótipo, src/lib/nfe.ts). */
export const A_VISTA = ['pix', 'dinheiro', 'cartao_debito', 'transferencia'];

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class NotasService {
  constructor(private readonly prisma: PrismaService) {}

  recentes(limite: number) {
    return this.prisma.notas_entrada.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(Math.max(limite, 1), 200) });
  }

  async existe(chave: string) {
    return { existe: !!(await this.prisma.notas_entrada.findUnique({ where: { chave }, select: { id: true } })) };
  }

  /** Vínculos produto do fornecedor → insumo salvos por lancar_nota (para pré-preencher a próxima nota). */
  vinculos(cnpj: string) {
    return this.prisma.vinculos_produto.findMany({ where: { fornecedor_cnpj: cnpj } });
  }

  /**
   * "Dar entrada" do protótipo, em UMA transação: nota + itens → lancar_nota (estoque, preço, vínculos) → contas a pagar
   * (à vista = uma conta já paga; senão uma por parcela) → fornecedor novo pelo CNPJ.
   */
  async lancar(dto: LancarNotaDto, usuarioId: string) {
    const aVista = A_VISTA.includes(dto.forma_pagamento);
    if (!aVista && (!dto.parcelas.length || dto.parcelas.some((p) => !p.vencimento))) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Informe o vencimento de cada parcela' });
    }
    if (dto.itens.some((l) => l.item_estoque_id && l.novo_insumo)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Escolha um insumo existente ou cadastre um novo, não os dois',
      });
    }
    const chave = dto.chave?.trim() || null;
    if (chave && (await this.prisma.notas_entrada.findUnique({ where: { chave }, select: { id: true } }))) {
      throw new ConflictException({ code: 'DUPLICADO', message: 'Esta nota já foi lançada' });
    }
    const totalItens = dto.itens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);
    const valorNota = dto.valor_total || totalItens;
    const cnpj = dto.fornecedor_cnpj?.replace(/\D/g, '') || null;

    return this.prisma.$transaction(
      async (tx) => {
        const nota = await tx.notas_entrada.create({
          data: {
            chave,
            numero: dto.numero || null,
            serie: dto.serie || null,
            fornecedor_nome: dto.fornecedor_nome,
            fornecedor_cnpj: cnpj,
            data_emissao: dayToDb(dto.data_emissao || dto.data_entrada),
            data_entrada: dayToDb(dto.data_entrada),
            valor_total: valorNota,
            forma_pagamento: dto.forma_pagamento,
            origem: dto.origem,
            usuario_id: usuarioId,
          },
          select: { id: true },
        });
        const { ids: insumoIds, criados: insumosCriados } = await this.resolverNovosInsumos(tx, dto);
        await tx.notas_entrada_itens.createMany({
          data: dto.itens.map((l, k) => ({
            nota_id: nota.id,
            codigo_fornecedor: l.codigo || null,
            descricao: l.descricao,
            unidade: l.unidade || null,
            quantidade: l.quantidade,
            valor_unitario: l.valor_unitario,
            valor_total: l.quantidade * l.valor_unitario,
            item_estoque_id: l.item_estoque_id || (l.novo_insumo ? insumoIds.get(normalizaNome(l.novo_insumo.nome)) : null) || null,
            fator: l.fator || 1,
            ordem: k,
          })),
        });
        await tx.$executeRaw`SELECT lancar_nota(${nota.id}::uuid, ${dto.atualizar_preco}::boolean, ${usuarioId}::uuid)`;

        const descricao = `NF ${dto.numero ?? ''} — ${dto.fornecedor_nome}`.trim();
        const contas = aVista
          ? [
              {
                descricao,
                fornecedor_nome: dto.fornecedor_nome,
                nota_id: nota.id,
                valor: valorNota,
                vencimento: dayToDb(dto.data_entrada),
                forma_pagamento: dto.forma_pagamento,
                status: 'paga',
                pago_em: dayToDb(dto.data_entrada),
                valor_pago: valorNota,
              },
            ]
          : dto.parcelas.map((p, i) => ({
              descricao,
              fornecedor_nome: dto.fornecedor_nome,
              nota_id: nota.id,
              parcela: `${i + 1}/${dto.parcelas.length}`,
              valor: r2(p.valor || 0),
              vencimento: dayToDb(p.vencimento),
              forma_pagamento: dto.forma_pagamento,
            }));
        await tx.contas_pagar.createMany({ data: contas });

        // Fornecedor novo pelo CNPJ. Nome já cadastrado (sem CNPJ) não derruba a entrada: no protótipo esse insert
        // falhava em silêncio; aqui é ON CONFLICT DO NOTHING.
        if (cnpj && !(await tx.fornecedores.findFirst({ where: { cnpj }, select: { id: true } }))) {
          await tx.fornecedores.createMany({ data: [{ nome: dto.fornecedor_nome, cnpj }], skipDuplicates: true });
        }
        return { id: nota.id, contas: aVista ? 0 : contas.length, a_vista: aVista, insumos_criados: insumosCriados };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /**
   * Cadastra, dentro da transação da nota, os insumos novos pedidos nas linhas. Nome já existente (comparado sem caixa/acento)
   * é reaproveitado (e reativado); a mesma linha repetida na nota cria um só. O preço do insumo recém-criado vale já na criação.
   */
  private async resolverNovosInsumos(tx: Prisma.TransactionClient, dto: LancarNotaDto) {
    const ids = new Map<string, string>();
    let criados = 0;
    const novos = dto.itens.filter((l) => l.novo_insumo);
    if (!novos.length) return { ids, criados };
    const existentes = await tx.itens_estoque.findMany({ select: { id: true, nome: true, ativo: true } });
    const porNome = new Map(existentes.map((e) => [normalizaNome(e.nome), e]));
    const subgrupos = new Map((await tx.subgrupos.findMany({ select: { nome: true } })).map((s) => [normalizaNome(s.nome), s.nome]));
    for (const l of novos) {
      const ni = l.novo_insumo!;
      const chave = normalizaNome(ni.nome);
      if (!chave || ids.has(chave)) continue;
      const achado = porNome.get(chave);
      if (achado) {
        if (!achado.ativo) await tx.itens_estoque.update({ where: { id: achado.id }, data: { ativo: true } });
        ids.set(chave, achado.id);
        continue;
      }
      const fator = l.fator || 1;
      const subgrupo = ni.subgrupo ? subgrupos.get(normalizaNome(ni.subgrupo)) : undefined;
      try {
        const novo = await tx.itens_estoque.create({
          data: {
            nome: ni.nome.trim(),
            unidade: ni.unidade.trim().toUpperCase(),
            ...(subgrupo ? { subgrupo } : {}),
            preco_unitario: l.valor_unitario / fator,
            fornecedor: dto.fornecedor_nome,
            ...(fator > 1 ? { qtd_por_embalagem: fator, embalagem_compra: l.unidade?.trim().toUpperCase() || null } : {}),
          },
          select: { id: true },
        });
        ids.set(chave, novo.id);
        criados++;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({ code: 'DUPLICADO', message: 'Já existe um insumo com este nome' });
        }
        throw e;
      }
    }
    return { ids, criados };
  }
}
