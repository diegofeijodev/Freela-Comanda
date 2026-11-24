import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, dateToString, dayToDb, todaySp } from '../../common/time/dates';
import { pareceCana } from '../importacoes/previa';
import { apurarSemana, type Apuracao, type ContagemCana, type EntradaSemana } from './apuracao';
import type { CorrigirCanaDto, LancamentoCanaDto, ParametrosCanaDto, ProdutoCanaDto } from './dto/cana.dto';
import { camposDoLancamento, conferirData, conferirMotivo, type DadosLancamento, type TipoCana } from './regras';

type Lancamento = Prisma.cana_lancamentosGetPayload<object>;
type Tx = Prisma.TransactionClient;

/** Quantas semanas a lista devolve (a mais nova primeiro). */
const MAX_SEMANAS = 26;
const dia = (d: Date) => dateToString(d);
const diaBr = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const ehAdmin = (u: AuthUser) => u.perfil === 'admin';

/** Tela da loja com o módulo `cana` (o colaborador sem ele não lança: o `@Staff()` sozinho deixaria qualquer um). */
export function exigirModuloCana(u: AuthUser) {
  if (!ehAdmin(u) && !u.modulos.includes('cana')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
}

const paraLoja = (l: Lancamento, corrigido: boolean) => ({
  id: l.id,
  tipo: l.tipo,
  data: l.data,
  duzias: l.duzias,
  litros_caldo: l.litros_caldo,
  litros_frozen: l.litros_frozen,
  fornecedor: l.fornecedor,
  observacao: l.observacao,
  lancado_em: l.lancado_em,
  anulado: l.anulado_em !== null,
  corrigido,
});

export interface SemanaApurada extends Apuracao {
  contagem_inicial: { id: string; data: string; lancado_por_nome: string };
  contagem_final: { id: string; data: string; lancado_por_nome: string } | null;
  parametros: { litros_por_duzia_esperado: number | null; rendimento_frozen: number | null };
  /** Até existir o "fechar a semana" (B6), toda semana é calculada na hora, com a configuração de hoje. */
  calculada_com: 'configuracao_de_hoje';
}

/**
 * Controle da cana (desenho 2026-11-24, Parte B; contrato §22). Só LÊ vendas e itens_cardapio: não toca em estoque, inventário
 * nem CMV. O livro `cana_lancamentos` só cresce (gatilho): corrigir = anular com motivo + lançar com `substitui_id`, na mesma
 * transação. A loja lança às cegas (não vê nenhuma conta); a apuração é só do admin.
 */
@Injectable()
export class CanaService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- configuração (admin)
  async parametros() {
    const [p, historico] = await Promise.all([
      this.prisma.cana_parametros.findUnique({ where: { id: 1 } }),
      this.prisma.cana_parametros_historico.findMany({ orderBy: { alterado_em: 'desc' }, take: 5 }),
    ]);
    return {
      litros_por_duzia_esperado: p?.litros_por_duzia_esperado ?? null,
      rendimento_frozen: p?.rendimento_frozen ?? null,
      atualizado_por_nome: p?.atualizado_por_nome ?? null,
      atualizado_em: p?.atualizado_em ?? null,
      historico,
    };
  }

  async salvarParametros(u: AuthUser, dto: ParametrosCanaDto) {
    const valores = { litros_por_duzia_esperado: dto.litros_por_duzia_esperado, rendimento_frozen: dto.rendimento_frozen };
    await this.prisma.$transaction(async (tx) => {
      const quem = { atualizado_por: u.id, atualizado_por_nome: u.nome, atualizado_em: new Date() };
      await tx.cana_parametros.upsert({ where: { id: 1 }, create: { id: 1, ...valores, ...quem }, update: { ...valores, ...quem } });
      await tx.cana_parametros_historico.create({ data: { ...valores, alterado_por: u.id, alterado_por_nome: u.nome } });
    });
    return this.parametros();
  }

  /** Itens ativos do cardápio (e os já configurados, mesmo inativos), com a configuração e a marca "parece de caldo". */
  async produtos() {
    const itens = await this.prisma.itens_cardapio.findMany({
      where: { OR: [{ ativo: true }, { cana_produto: { isNot: null } }] },
      select: { id: true, nome: true, categoria: true, grupo: true, ativo: true, cana_produto: true },
      orderBy: { nome: 'asc' },
    });
    return itens.map(({ cana_produto: c, ...i }) => ({
      item_cardapio_id: i.id,
      nome: i.nome,
      categoria: i.categoria,
      grupo: i.grupo,
      item_ativo: i.ativo,
      parece_cana: pareceCana(i.nome),
      config: c
        ? { ml_por_unidade: c.ml_por_unidade, frozen: c.frozen, ativo: c.ativo, atualizado_por_nome: c.atualizado_por_nome, atualizado_em: c.atualizado_em }
        : null,
    }));
  }

  async salvarProduto(u: AuthUser, itemId: string, dto: ProdutoCanaDto) {
    const item = await this.prisma.itens_cardapio.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produto do cardápio não encontrado' });
    const dados = { ml_por_unidade: dto.ml_por_unidade, frozen: dto.frozen, ativo: dto.ativo, atualizado_por: u.id, atualizado_por_nome: u.nome, atualizado_em: new Date() };
    return this.prisma.cana_produtos.upsert({ where: { item_cardapio_id: itemId }, create: { item_cardapio_id: itemId, ...dados }, update: dados });
  }

  // ---------- lançamentos
  /** `repetido` = a mesma chave de repetição do mesmo usuário com os mesmos números: devolve o da 1ª vez (200). */
  async lancar(u: AuthUser, dto: LancamentoCanaDto): Promise<{ lancamento: Lancamento; repetido: boolean }> {
    const hoje = todaySp();
    const erroData = conferirData(dto.data, hoje, ehAdmin(u));
    if (erroData) throw new BadRequestException({ code: 'CANA_DATA_FORA', message: erroData });
    const campos = camposDoLancamento(dto.tipo, dto);
    if (!campos.ok) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: campos.mensagem });

    if (dto.chave_idempotencia) {
      const ja = await this.prisma.cana_lancamentos.findUnique({ where: { chave_idempotencia: dto.chave_idempotencia } });
      if (ja) return { lancamento: this.mesmoPedido(ja, u, dto.tipo, dto.data, campos.dados), repetido: true };
    }
    try {
      const lancamento = await this.prisma.cana_lancamentos.create({
        data: {
          tipo: dto.tipo,
          data: dayToDb(dto.data),
          ...campos.dados,
          chave_idempotencia: dto.chave_idempotencia ?? null,
          lancado_por: u.id,
          lancado_por_nome: u.nome,
        },
      });
      return { lancamento, repetido: false };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      // Corrida da mesma chave (duas idas ao mesmo tempo): a que chegou primeiro vale.
      if (dto.chave_idempotencia) {
        const ja = await this.prisma.cana_lancamentos.findUnique({ where: { chave_idempotencia: dto.chave_idempotencia } });
        if (ja) return { lancamento: this.mesmoPedido(ja, u, dto.tipo, dto.data, campos.dados), repetido: true };
      }
      throw this.contagemDoDia(dto.data, u);
    }
  }

  async anular(u: AuthUser, id: string, motivoBruto: string | undefined) {
    const motivo = conferirMotivo(motivoBruto);
    if (!motivo) throw new BadRequestException({ code: 'CANA_MOTIVO_OBRIGATORIO', message: 'Escreva o motivo (pelo menos 3 letras).' });
    return this.prisma.$transaction(async (tx) => {
      await this.anularNa(tx, u, id, motivo);
      return tx.cana_lancamentos.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Anula o lançamento e lança o novo (mesmo tipo, `substitui_id`) numa transação: nunca fica o antigo anulado sem o novo. */
  async corrigir(u: AuthUser, id: string, dto: CorrigirCanaDto) {
    const motivo = conferirMotivo(dto.motivo);
    if (!motivo) throw new BadRequestException({ code: 'CANA_MOTIVO_OBRIGATORIO', message: 'Escreva o motivo (pelo menos 3 letras).' });
    const hoje = todaySp();
    const erroData = conferirData(dto.data, hoje, true);
    if (erroData) throw new BadRequestException({ code: 'CANA_DATA_FORA', message: erroData });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const antigo = await this.anularNa(tx, u, id, `Corrigido: ${motivo}`);
        const campos = camposDoLancamento(antigo.tipo as TipoCana, dto);
        if (!campos.ok) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: campos.mensagem });
        return tx.cana_lancamentos.create({
          data: { tipo: antigo.tipo, data: dayToDb(dto.data), ...campos.dados, substitui_id: id, lancado_por: u.id, lancado_por_nome: u.nome },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw this.contagemDoDia(dto.data, u);
      throw e;
    }
  }

  /**
   * O que a loja pode ver de um lançamento dela (o mesmo recorte de `recentes`): sem o motivo nem quem anulou, sem o número novo de uma
   * correção. Vale também para a resposta do lançar: a mesma chave depois de o gerente anular não pode devolver o motivo dele.
   */
  async recorteDaLoja(l: Lancamento) {
    const corrigido = (await this.prisma.cana_lancamentos.count({ where: { substitui_id: l.id } })) > 0;
    return paraLoja(l, corrigido);
  }

  /** Loja: só o que ELA lançou nos últimos 7 dias, sem conta nenhuma, sem o motivo e sem o número novo de uma correção. */
  async recentes(u: AuthUser) {
    const hoje = todaySp();
    const ontem = addDays(hoje, -1);
    const [meus, contagens, fornecedores] = await Promise.all([
      this.prisma.cana_lancamentos.findMany({
        where: { lancado_por: u.id, data: { gte: dayToDb(addDays(hoje, -6)) } },
        orderBy: { lancado_em: 'desc' },
        take: 100,
        include: { substituido_por: { select: { id: true } } },
      }),
      this.prisma.cana_lancamentos.findMany({
        where: { tipo: 'contagem', anulado_em: null, data: { in: [dayToDb(hoje), dayToDb(ontem)] } },
        select: { data: true, lancado_por_nome: true, lancado_em: true },
      }),
      this.prisma.cana_lancamentos.groupBy({
        by: ['fornecedor'],
        where: { tipo: 'recebimento', fornecedor: { not: null }, anulado_em: null },
        _max: { lancado_em: true },
        orderBy: { _max: { lancado_em: 'desc' } },
        take: 5,
      }),
    ]);
    return {
      hoje,
      ontem,
      lancamentos: meus.map((l) => paraLoja(l, l.substituido_por !== null)),
      contagens_lancadas: contagens.map((c) => ({ data: c.data, por_nome: c.lancado_por_nome, em: c.lancado_em })),
      fornecedores: fornecedores.map((f) => f.fornecedor!),
    };
  }

  /** Admin: todos os lançamentos do período (com os anulados e as correções). */
  async listar(ini: string, fim: string, tipo?: TipoCana) {
    const ls = await this.prisma.cana_lancamentos.findMany({
      where: { data: { gte: dayToDb(ini), lte: dayToDb(fim) }, ...(tipo ? { tipo } : {}) },
      orderBy: [{ data: 'desc' }, { lancado_em: 'desc' }],
      include: { substituido_por: { select: { id: true } }, substitui: { select: { id: true, data: true, duzias: true, litros_caldo: true, litros_frozen: true, lancado_por_nome: true } } },
      take: 2000,
    });
    return ls.map(({ substituido_por, ...l }) => ({ ...l, corrigido_por_id: substituido_por?.id ?? null }));
  }

  // ---------- semanas (admin)
  /** As semanas fechadas (pares de contagens), a mais nova primeiro, com os 4 números principais. */
  async semanas() {
    const contagens = await this.contagens();
    const pares = contagens.slice(-(MAX_SEMANAS + 1));
    const apuradas = pares.length < 2 ? [] : await this.apurarPares(pares);
    return {
      contagens: contagens.length,
      ultima_contagem: contagens.length ? this.resumo(contagens.at(-1)!) : null,
      semanas: apuradas
        .map((s) => ({
          contagem_inicial: s.contagem_inicial,
          contagem_final: s.contagem_final!,
          periodo: s.periodo,
          cana_moida: s.cana.moida,
          caldo_produzido: s.caldo.produzido.litros,
          caldo_vendido: s.caldo.vendido.litros,
          perda: s.caldo.perda,
        }))
        .reverse(),
    };
  }

  /** Da última contagem até hoje (sem perda). `apuracao: null` = ainda não há contagem. */
  async semanaAtual(): Promise<{ apuracao: SemanaApurada | null }> {
    const contagens = await this.contagens();
    const ultima = contagens.at(-1);
    if (!ultima) return { apuracao: null };
    const [apuracao] = await this.apurar([[ultima, null]], dia(ultima.data), todaySp());
    return { apuracao: apuracao! };
  }

  async semana(contagemFinalId: string): Promise<SemanaApurada> {
    const contagens = await this.contagens();
    const i = contagens.findIndex((c) => c.id === contagemFinalId);
    if (i < 1) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Semana não encontrada' });
    const [apuracao] = await this.apurarPares([contagens[i - 1]!, contagens[i]!]);
    return apuracao!;
  }

  // ---------- internos
  private contagens() {
    return this.prisma.cana_lancamentos.findMany({ where: { tipo: 'contagem', anulado_em: null }, orderBy: { data: 'asc' } });
  }

  private resumo(c: Lancamento) {
    return { id: c.id, data: dia(c.data), duzias: c.duzias, litros_caldo: c.litros_caldo, litros_frozen: c.litros_frozen, lancado_por_nome: c.lancado_por_nome };
  }

  private apurarPares(contagens: Lancamento[]) {
    const pares: [Lancamento, Lancamento | null][] = [];
    for (let i = 1; i < contagens.length; i++) pares.push([contagens[i - 1]!, contagens[i]!]);
    return this.apurar(pares, dia(contagens[0]!.data), dia(contagens.at(-1)!.data));
  }

  /** Lê de uma vez tudo o que as semanas pedem (lançamentos, vendas por item e dia, configuração) e apura cada par. */
  private async apurar(pares: [Lancamento, Lancamento | null][], ini: string, fim: string): Promise<SemanaApurada[]> {
    const janela = { gt: dayToDb(ini), lte: dayToDb(fim) };
    const [lancs, vendas, semCardapio, produtos, params, ultimaVenda] = await Promise.all([
      this.prisma.cana_lancamentos.findMany({ where: { tipo: { in: ['recebimento', 'producao'] }, anulado_em: null, data: janela } }),
      this.prisma.vendas.groupBy({ by: ['item_cardapio_id', 'data'], where: { data: janela, item_cardapio_id: { not: null } }, _sum: { quantidade: true } }),
      this.prisma.vendas.groupBy({ by: ['produto_relatorio', 'data'], where: { data: janela, item_cardapio_id: null }, _sum: { quantidade: true }, _count: { _all: true } }),
      this.prisma.cana_produtos.findMany(),
      this.prisma.cana_parametros.findUnique({ where: { id: 1 } }),
      this.prisma.vendas.aggregate({ _max: { data: true } }),
    ]);
    const ids = [...new Set(vendas.map((v) => v.item_cardapio_id!))];
    const nomes = new Map((await this.prisma.itens_cardapio.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((i) => [i.id, i.nome]));
    const parametros = { litros_por_duzia_esperado: params?.litros_por_duzia_esperado ?? null, rendimento_frozen: params?.rendimento_frozen ?? null };
    const base: Omit<EntradaSemana, 'inicial' | 'final'> = {
      hoje: todaySp(),
      lancamentos: lancs.map((l) => ({ tipo: l.tipo as 'recebimento' | 'producao', data: dia(l.data), duzias: l.duzias, litros_caldo: l.litros_caldo })),
      vendas: vendas.map((v) => ({ item_cardapio_id: v.item_cardapio_id!, nome: nomes.get(v.item_cardapio_id!) ?? '', data: dia(v.data), quantidade: v._sum.quantidade ?? 0 })),
      vendas_sem_cardapio: semCardapio.map((v) => ({ produto_relatorio: v.produto_relatorio, data: dia(v.data), vendas: v._count._all, quantidade: v._sum.quantidade ?? 0 })),
      produtos: produtos.map((p) => ({ item_cardapio_id: p.item_cardapio_id, ml_por_unidade: p.ml_por_unidade, frozen: p.frozen, ativo: p.ativo })),
      parametros,
      vendas_importadas_ate: ultimaVenda._max.data ? dia(ultimaVenda._max.data) : null,
    };
    const contagem = (c: Lancamento): ContagemCana => ({ id: c.id, data: dia(c.data), duzias: c.duzias!, litros_caldo: c.litros_caldo!, litros_frozen: c.litros_frozen });
    const ref = (c: Lancamento) => ({ id: c.id, data: dia(c.data), lancado_por_nome: c.lancado_por_nome });
    return pares.map(([a, b]) => ({
      ...apurarSemana({ ...base, inicial: contagem(a), final: b ? contagem(b) : null }),
      contagem_inicial: ref(a),
      contagem_final: b ? ref(b) : null,
      parametros: {
        litros_por_duzia_esperado: parametros.litros_por_duzia_esperado === null ? null : Number(parametros.litros_por_duzia_esperado),
        rendimento_frozen: parametros.rendimento_frozen === null ? null : Number(parametros.rendimento_frozen),
      },
      calculada_com: 'configuracao_de_hoje' as const,
    }));
  }

  /** Anula com o trinco da linha: dois "Anular" ao mesmo tempo → um só passa (o outro vê 409). */
  private async anularNa(tx: Tx, u: AuthUser, id: string, motivo: string): Promise<Lancamento> {
    const [l] = await tx.$queryRaw<Lancamento[]>`SELECT * FROM cana_lancamentos WHERE id = ${id}::uuid FOR UPDATE`;
    if (!l) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lançamento não encontrado' });
    if (l.anulado_em)
      throw new ConflictException({ code: 'CANA_JA_ANULADO', message: `Este lançamento já foi anulado (por ${l.anulado_por_nome ?? 'outra pessoa'}).` });
    return tx.cana_lancamentos.update({
      where: { id },
      data: { anulado_em: new Date(), anulado_por: u.id, anulado_por_nome: u.nome, anulado_motivo: motivo },
    });
  }

  /** A mesma chave só devolve o lançamento guardado se for do mesmo usuário e com os mesmos números (senão vazaria o de outra pessoa). */
  private mesmoPedido(ja: Lancamento, u: AuthUser, tipo: TipoCana, data: string, d: DadosLancamento): Lancamento {
    const igualNum = (a: Prisma.Decimal | null, b: number | null) => (a === null ? b === null : b !== null && a.equals(b));
    const igual =
      ja.lancado_por === u.id &&
      ja.tipo === tipo &&
      dia(ja.data) === data &&
      igualNum(ja.duzias, d.duzias) &&
      igualNum(ja.litros_caldo, d.litros_caldo) &&
      igualNum(ja.litros_frozen, d.litros_frozen);
    if (!igual) throw new ConflictException({ code: 'CANA_CHAVE_REPETIDA', message: 'Este lançamento já foi enviado com outros números. Abra o formulário de novo.' });
    return ja;
  }

  private contagemDoDia(data: string, u: AuthUser) {
    const fim = ehAdmin(u) ? 'Anule a anterior para lançar outra.' : 'Se ela está errada, avise o gerente: só ele corrige.';
    return new ConflictException({ code: 'CANA_CONTAGEM_DO_DIA', message: `Já existe uma contagem em ${diaBr(data)}. ${fim}` });
  }
}
