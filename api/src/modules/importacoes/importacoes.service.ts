import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { parseNum } from '../../common/parse/numero';
import { dayToDb } from '../../common/time/dates';
import type { ImportacaoDto } from './dto/importacoes.dto';
import { fichasDasLinhas, insumosDasLinhas, rendimentoDaObservacao, vendasDasLinhas } from './regras';

type Tx = Prisma.TransactionClient;
const LOTE = 500;
const lotes = <T>(a: T[], n = LOTE) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
// Importação grande (um mês de PDV) roda dentro de uma transação só: tudo ou nada, como a tela promete.
const OPCOES_TX = { timeout: 300_000, maxWait: 10_000 } as const;
/**
 * Vendas da "Planilha padrão do Comanda" (R4): nem do cupom fiscal, nem de XML, e sem sistema de origem (importação antiga, sem
 * `importacao_id`, ou importação sem `origem_id`). As 4.474 vendas de produção de antes de 25/11 são todas daqui.
 */
/** A trava das importações de vendas (`pg_advisory_xact_lock(hashtext(...))`): a rota antiga e o confirmar novo nunca correm juntos. */
export const TRAVA_IMPORTACAO_VENDAS = 'importacao_vendas';

export const ONDE_PLANILHA_PADRAO = {
  nfce_cupom_id: null,
  documento_id: null,
  OR: [{ importacao_id: null }, { importacoes: { is: { origem_id: null } } }],
} satisfies Prisma.vendasWhereInput;

@Injectable()
export class ImportacoesService {
  constructor(private readonly prisma: PrismaService) {}

  recentes(limite: number) {
    return this.prisma.importacoes.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(Math.max(limite, 1), 100) });
  }

  private registro(tx: Tx, tipo: string, dto: ImportacaoDto, usuarioId: string) {
    return tx.importacoes.create({
      data: { tipo, arquivo: dto.arquivo ?? null, linhas: dto.linhas.length, erros: dto.erros ?? 0, usuario_id: usuarioId },
      select: { id: true },
    });
  }

  /** Insumos: upsert pelo nome; "Substituir" desativa os que não vieram no arquivo. */
  async insumos(dto: ImportacaoDto, usuarioId: string) {
    const payload = insumosDasLinhas(dto.linhas);
    if (!payload.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Nenhuma linha com nome' });
    return this.prisma.$transaction(async (tx) => {
      await this.registro(tx, 'insumos', dto, usuarioId);
      for (const p of payload) {
        await tx.itens_estoque.upsert({ where: { nome: p.nome }, create: p, update: p });
      }
      let desativados = 0;
      if (dto.modo === 'substituir') {
        const r = await tx.itens_estoque.updateMany({ where: { nome: { notIn: payload.map((p) => p.nome) } }, data: { ativo: false } });
        desativados = r.count;
      }
      return { linhas: dto.linhas.length, importados: payload.length, desativados };
    }, OPCOES_TX);
  }

  /** Fichas: upsert do cabeçalho pelo nome, troca TODOS os ingredientes desses itens e recalcula as baixas das vendas. */
  async fichas(dto: ImportacaoDto, usuarioId: string) {
    const { grupos, cabecalhos } = fichasDasLinhas(dto.linhas);
    if (!cabecalhos.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Nenhuma linha com item_cardapio' });
    return this.prisma.$transaction(async (tx) => {
      await this.registro(tx, 'fichas', dto, usuarioId);
      const insumos = await tx.itens_estoque.findMany({ select: { id: true, nome: true } });
      const porNome = new Map(insumos.map((i) => [i.nome.toLowerCase(), i.id]));
      let desativados = 0;
      if (dto.modo === 'substituir') {
        const r = await tx.itens_cardapio.updateMany({ where: { nome: { notIn: [...grupos.keys()] } }, data: { ativo: false } });
        desativados = r.count;
      }
      const idPorNome = new Map<string, string>();
      for (const c of cabecalhos) {
        const r = await tx.itens_cardapio.upsert({ where: { nome: c.nome }, create: c, update: c, select: { id: true } });
        idPorNome.set(c.nome, r.id);
      }
      await tx.ficha_ingredientes.deleteMany({ where: { item_cardapio_id: { in: [...idPorNome.values()] } } });
      const ings = dto.linhas
        .filter((r) => (r.item_cardapio ?? '').trim() && porNome.has((r.insumo ?? '').trim().toLowerCase()))
        .map((r, k) => ({
          item_cardapio_id: idPorNome.get((r.item_cardapio ?? '').trim())!,
          item_estoque_id: porNome.get((r.insumo ?? '').trim().toLowerCase())!,
          quantidade: parseNum(r.quantidade) ?? 0,
          unidade: (r.unidade ?? '').trim().toUpperCase() || null,
          observacao: (r.observacao ?? '').trim() || null,
          ordem: k,
          rendimento: rendimentoDaObservacao(r.observacao),
        }));
      for (const l of lotes(ings)) await tx.ficha_ingredientes.createMany({ data: l });
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT recalcular_baixas() AS n`;
      return { linhas: dto.linhas.length, fichas: cabecalhos.length, ingredientes: ings.length, desativados, baixas: Number(n) };
    }, OPCOES_TX);
  }

  /**
   * Vendas pela rota antiga (= "Planilha padrão do Comanda", origem nula; R4 do desenho de 24/11): produto novo entra no de-para (ligado ao
   * item de mesmo nome, se houver); linhas repetidas somam; "Substituir" apaga só as vendas da planilha padrão no período do arquivo (nunca
   * as do cupom fiscal, `nfce_cupom_id`, as de XML, `documento_id`, nem as de outro sistema de origem); venda já existente
   * (pedido+produto+data) é ignorada. O gatilho gera as baixas. A tela nova (`/vendas/importar`) usa `vendas/previa` e `vendas/confirmar`.
   */
  async vendas(dto: ImportacaoDto, usuarioId: string) {
    const vs = vendasDasLinhas(dto.linhas);
    if (!vs.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Nenhuma venda válida no arquivo' });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TRAVA_IMPORTACAO_VENDAS}))`;
      const imp = await this.registro(tx, 'vendas', dto, usuarioId);
      const cards = await tx.itens_cardapio.findMany({ select: { id: true, nome: true } });
      const cardPorNome = new Map(cards.map((c) => [c.nome.toLowerCase(), c.id]));
      const dp = new Map((await tx.de_para_produtos.findMany()).map((d) => [d.produto_relatorio, d.item_cardapio_id]));
      const novos = new Map<string, string | null>();
      for (const r of dto.linhas) {
        const p = (r.produto_relatorio ?? '').trim();
        if (!p || dp.has(p) || novos.has(p)) continue;
        novos.set(p, cardPorNome.get((r.item_cardapio ?? '').trim().toLowerCase()) ?? null);
      }
      if (novos.size) {
        await tx.de_para_produtos.createMany({
          data: [...novos].map(([produto_relatorio, item_cardapio_id]) => ({ produto_relatorio, item_cardapio_id })),
          skipDuplicates: true,
        });
        novos.forEach((v, k) => dp.set(k, v));
      }
      let apagadas = 0;
      if (dto.modo === 'substituir') {
        const datas = vs.map((v) => v.data).sort();
        const r = await tx.vendas.deleteMany({
          where: {
            ...ONDE_PLANILHA_PADRAO,
            data: { gte: dayToDb(datas[0]!), lte: dayToDb(datas[datas.length - 1]!) },
          },
        });
        apagadas = r.count;
      }
      let inseridas = 0;
      for (const l of lotes(vs)) {
        const r = await tx.vendas.createMany({
          data: l.map((v) => ({
            ...v,
            data: dayToDb(v.data),
            hora: v.hora ? new Date(`1970-01-01T${v.hora}Z`) : null,
            item_cardapio_id: dp.get(v.produto_relatorio) ?? null,
            importacao_id: imp.id,
          })),
          skipDuplicates: true,
        });
        inseridas += r.count;
      }
      return {
        linhas: dto.linhas.length,
        vendas: vs.length,
        inseridas,
        ignoradas: vs.length - inseridas,
        apagadas,
        novos_produtos: novos.size,
      };
    }, OPCOES_TX);
  }

  dePara() {
    return this.prisma.de_para_produtos.findMany({ orderBy: { produto_relatorio: 'asc' } });
  }

  /**
   * Liga o produto do relatório a um item do cardápio e reaponta as vendas dele (o gatilho refaz as baixas). Só as da importação: a venda
   * do cupom fiscal (`nfce_cupom_id`) já nasce com o item certo e não muda.
   */
  async mapear(produto: string, itemId: string | null) {
    if (!(await this.prisma.de_para_produtos.findUnique({ where: { produto_relatorio: produto } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produto não encontrado no de-para' });
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.de_para_produtos.update({
        where: { produto_relatorio: produto },
        data: { item_cardapio_id: itemId, updated_at: new Date() },
      });
      const r = await tx.vendas.updateMany({
        where: { produto_relatorio: produto, nfce_cupom_id: null },
        data: { item_cardapio_id: itemId },
      });
      return { vendas: r.count };
    }, OPCOES_TX);
  }
}
