import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/database/prisma.service';
import { normalizarCnpj } from '../../common/fiscal/cnpj';
import { dayToDb, isDateString, todaySp } from '../../common/time/dates';
import { classificarXml, conferirEnvioXml, EnvioInvalido, linhasDoDocumento, type ClassificacaoXml } from './documentos';
import type { Formato, OrigemDto, OrigemEdicaoDto, VendasConfirmarDto, VendasImportacaoDto } from './dto/vendas-importacao.dto';
import { FatosVendas, type Db } from './fatos-vendas';
import { ONDE_PLANILHA_PADRAO } from './importacoes.service';
import {
  agregarVendas,
  aplicarMapeamento,
  CAMPOS_VENDA,
  camposFaltando,
  dataDaCelula,
  MAPEAMENTO_PADRAO,
  NOME_DO_CAMPO,
  pedidoDoDia,
  type LinhaVenda,
  type Mapeamento,
  type Problema,
  type Separador,
} from './planilha';
import { fonteDaImportacao, montarPrevia, type Fonte, type Previa } from './previa';

const LOTE = 500;
const lotes = <T>(a: T[], n = LOTE) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
// Um mês de cupons numa transação só: tudo ou nada (mesmo teto da importação de hoje).
const OPCOES_TX = { timeout: 300_000, maxWait: 10_000 } as const;
/** Serializa as importações de vendas (prévia × confirmar, duplo clique, dois admins): `pg_advisory_xact_lock(hashtext(...))`. */
const TRAVA = 'importacao_vendas';

type Origem = {
  id: string;
  nome: string;
  formato_padrao: string;
  mapeamento: Prisma.JsonValue;
  separador_decimal: string;
  prefixo_pedido: string;
  ativo: boolean;
};

export type ResultadoImportacao = {
  importacao_id: string;
  confirmada_em: string;
  inseridas: number;
  ignoradas: number;
  apagadas: number;
  apagadas_valor_centavos: number;
  canceladas: { documentos: number; linhas: number; valor_centavos: number };
  documentos_novos: number;
  novos_produtos: number;
  valor_centavos: number;
  periodo: { ini: string; fim: string } | null;
  mapeamento_salvo: boolean;
};

type PreviaXml = Previa & {
  documentos?: ClassificacaoXml['contagem'] & {
    cancelamentos_de_importados: { documentos: number; linhas: number; valor_centavos: number; ini: string | null; fim: string | null };
  };
};

type Calculo = {
  origem: Origem | null;
  fonte: Fonte;
  validas: LinhaVenda[];
  previa: PreviaXml;
  xml: (ClassificacaoXml & { documentoDaVenda: Map<string, string> }) | null;
  mapeamento: Mapeamento | null;
  separador: Separador;
  dePara: Map<string, string | null>;
};

const erro400 = (code: string, message: string) => new BadRequestException({ code, message });
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Mapeamento vindo do corpo ou da origem: só campos conhecidos e nomes de coluna em texto. */
function mapeamentoConferido(m: unknown): Mapeamento | null {
  if (m == null) return null;
  if (typeof m !== 'object' || Array.isArray(m)) throw erro400('VALIDATION_ERROR', 'Mapeamento de colunas inválido.');
  const out: Mapeamento = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (!(CAMPOS_VENDA as readonly string[]).includes(k)) throw erro400('VALIDATION_ERROR', `Campo desconhecido no mapeamento: ${k}.`);
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || v.length > 200)
      throw erro400('VALIDATION_ERROR', `Coluna inválida para ${NOME_DO_CAMPO[k as keyof Mapeamento]}.`);
    out[k as keyof Mapeamento] = v;
  }
  return out;
}

/** Linhas do PDF já conferidas na tela → as mesmas regras da planilha (ponto decimal; sem pedido = 1 pedido por dia; sem data = a escolhida). */
function linhasDoPdf(linhas: Record<string, unknown>[], dataPadrao: string | undefined, prefixo: string, hoje: string) {
  const brutas = linhas.map((l) => {
    const t = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    const data = t(l.data).trim() || dataPadrao || '';
    const ped = t(l.pedido).trim();
    const dt = dataDaCelula(data);
    return {
      pedido: ped ? `${prefixo}${ped}` : dt ? pedidoDoDia(prefixo, dt.data) : '',
      data,
      hora: t(l.hora),
      produto_relatorio: t(l.produto_relatorio),
      quantidade: t(l.quantidade),
      valor_total: t(l.valor_total),
      desconto: t(l.desconto),
    };
  });
  const m: Mapeamento = {
    pedido: 'pedido',
    data: 'data',
    hora: 'hora',
    produto: 'produto_relatorio',
    quantidade: 'quantidade',
    valor_total: 'valor_total',
    desconto: 'desconto',
  };
  return aplicarMapeamento(brutas, m, 'ponto', { hoje, prefixo: '', primeiraLinha: 1 });
}

/** SHA-256 do corpo do confirmar, sem a chave e sem a caixa da sobreposição (o "Tentar de novo" manda o mesmo corpo). */
export function hashDoCorpo(dto: VendasConfirmarDto): string {
  const { chave_idempotencia: _c, confirmar_sobreposicao: _s, ...resto } = dto as VendasConfirmarDto & Record<string, unknown>;
  void _c;
  void _s;
  return createHash('sha256').update(JSON.stringify(resto)).digest('hex');
}

@Injectable()
export class ImportacoesVendasService {
  private readonly log = new Logger('importacao.vendas');

  constructor(private readonly prisma: PrismaService) {}

  /** As leituras do banco (troca no teste). */
  protected fatos(db: Db): FatosVendas {
    return new FatosVendas(db);
  }

  // ---------------- sistemas de origem

  /** Os sistemas, o último usado primeiro (a tela já marca), com a data da última importação e as colunas lembradas. */
  async origens() {
    const ultimas = await this.prisma.$queryRaw<{ origem_id: string | null; em: Date }[]>`
      SELECT origem_id, max(created_at) AS em FROM importacoes WHERE tipo = 'vendas' GROUP BY origem_id`;
    const quando = new Map(ultimas.map((u) => [u.origem_id, u.em]));
    const os = await this.prisma.vendas_origens.findMany({ orderBy: { nome: 'asc' } });
    const lista = os
      .map((o) => ({ ...o, ultima_importacao_em: quando.get(o.id)?.toISOString() ?? null }))
      .sort(
        (a, b) =>
          Number(b.ativo) - Number(a.ativo) ||
          (b.ultima_importacao_em ?? '').localeCompare(a.ultima_importacao_em ?? '') ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      );
    return { origens: lista, planilha_padrao: { ultima_importacao_em: quando.get(null)?.toISOString() ?? null } };
  }

  private async nomeLivre(db: Db, nome: string, exceto?: string) {
    const alvo = semAcento(nome);
    const todas = await db.vendas_origens.findMany({ select: { id: true, nome: true } });
    const igual = todas.find((o) => o.id !== exceto && semAcento(o.nome) === alvo);
    if (igual) {
      throw new ConflictException({
        code: 'ORIGEM_REPETIDA',
        message: `Já existe um sistema chamado “${igual.nome}”. Escolha ele na lista ou use outro nome.`,
      });
    }
  }

  async criarOrigem(dto: OrigemDto, usuarioId: string) {
    const nome = dto.nome.replace(/\s+/g, ' ').trim();
    if (!nome) throw erro400('VALIDATION_ERROR', 'Dê um nome ao sistema.');
    return this.prisma.$transaction(async (tx) => {
      await this.nomeLivre(tx, nome);
      return tx.vendas_origens.create({
        data: {
          nome,
          formato_padrao: dto.formato_padrao,
          separador_decimal: dto.separador_decimal ?? 'virgula',
          prefixo_pedido: (dto.prefixo_pedido ?? '').trim(),
          criado_por: usuarioId,
          atualizado_por: usuarioId,
        },
      });
    });
  }

  /**
   * Edita o sistema (nunca apaga: "Parar de usar" = ativo false). Trocar as letras antes do pedido de um sistema que já tem vendas é
   * recusado: a chave das vendas (pedido + produto + data) mudaria e o mesmo arquivo entraria de novo (R1).
   */
  async editarOrigem(id: string, dto: OrigemEdicaoDto, usuarioId: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.vendas_origens.findUnique({ where: { id } });
      if (!o) throw new NotFoundException({ code: 'ORIGEM_NAO_ENCONTRADA', message: 'Sistema de origem não encontrado.' });
      const nome = dto.nome === undefined ? undefined : dto.nome.replace(/\s+/g, ' ').trim();
      if (nome !== undefined) {
        if (!nome) throw erro400('VALIDATION_ERROR', 'Dê um nome ao sistema.');
        await this.nomeLivre(tx, nome, id);
      }
      const prefixo = dto.prefixo_pedido === undefined ? undefined : dto.prefixo_pedido.trim();
      if (prefixo !== undefined && prefixo !== o.prefixo_pedido) {
        const n = await tx.vendas.count({ where: { importacoes: { is: { origem_id: id } } } });
        if (n > 0) {
          throw new ConflictException({
            code: 'ORIGEM_PREFIXO_EM_USO',
            message: `Este sistema já tem ${n} vendas importadas: trocar as letras antes do pedido faria o mesmo arquivo entrar de novo. Crie outro sistema.`,
          });
        }
      }
      const mapeamento = dto.mapeamento === undefined ? undefined : mapeamentoConferido(dto.mapeamento);
      return tx.vendas_origens.update({
        where: { id },
        data: {
          nome,
          formato_padrao: dto.formato_padrao,
          separador_decimal: dto.separador_decimal,
          prefixo_pedido: prefixo,
          mapeamento: mapeamento === undefined ? undefined : mapeamento === null ? Prisma.DbNull : mapeamento,
          ativo: dto.ativo,
          atualizado_por: usuarioId,
          atualizado_em: new Date(),
        },
      });
    });
  }

  /** "Últimas importações de vendas" do passo 1: quando, de qual sistema, formato, arquivo, quantas vendas novas e quem. */
  async recentes(limite: number) {
    const n = Math.min(Math.max(Math.trunc(limite) || 5, 1), 50);
    return this.prisma.$queryRaw<unknown[]>`
      SELECT i.id, i.created_at, i.arquivo, coalesce(i.formato, 'planilha') AS formato, i.origem_id,
             coalesce(o.nome, 'Planilha padrão do Comanda') AS origem_nome, u.nome AS usuario_nome,
             coalesce((i.resultado->>'inseridas')::int, NULL) AS inseridas, i.linhas
        FROM importacoes i LEFT JOIN vendas_origens o ON o.id = i.origem_id LEFT JOIN users u ON u.id = i.usuario_id
       WHERE i.tipo = 'vendas'
       ORDER BY i.created_at DESC LIMIT ${n}`;
  }

  // ---------------- prévia e confirmar

  /** A prévia (A.1 passo 4): nunca grava. */
  async previa(dto: VendasImportacaoDto, hoje = todaySp()): Promise<PreviaXml> {
    return (await this.calcular(this.prisma, dto, hoje, false)).previa;
  }

  /** Converte o arquivo e monta a prévia contra o banco. No confirmar roda dentro da transação, depois da trava. */
  private async calcular(db: Db, dto: VendasImportacaoDto, hoje: string, travar: boolean): Promise<Calculo> {
    const f = this.fatos(db);
    const formato: Formato = dto.formato;
    let origem: Origem | null = null;
    if (dto.origem_id) {
      origem = (await f.origem(dto.origem_id)) as Origem | null;
      if (!origem) throw new NotFoundException({ code: 'ORIGEM_NAO_ENCONTRADA', message: 'Sistema de origem não encontrado.' });
    } else if (formato !== 'planilha')
      throw erro400('VALIDATION_ERROR', 'A planilha padrão só aceita planilha. Escolha o sistema de onde vem o arquivo.');
    if (formato === 'xml' && dto.modo === 'substituir') {
      throw erro400('VALIDATION_ERROR', 'Com XML, cupom repetido nunca entra duas vezes e cupom cancelado sai sozinho: não há Substituir.');
    }
    const prefixo = origem?.prefixo_pedido ?? '';
    const fonte = fonteDaImportacao(formato, origem);

    let lidas = 0;
    let validas: LinhaVenda[] = [];
    let problemas: Problema[] = [];
    let mapeamento: Mapeamento | null = null;
    let separador: Separador = 'virgula';
    let xml: Calculo['xml'] = null;
    if (formato === 'planilha') {
      if (!Array.isArray(dto.linhas_brutas)) throw erro400('VALIDATION_ERROR', 'Envie as linhas da planilha.');
      mapeamento = origem ? (mapeamentoConferido(dto.mapeamento) ?? mapeamentoConferido(origem.mapeamento)) : MAPEAMENTO_PADRAO;
      const faltam = camposFaltando(mapeamento);
      if (faltam.length) throw erro400('MAPEAMENTO_INCOMPLETO', `Escolha a coluna de: ${faltam.map((c) => NOME_DO_CAMPO[c]).join(', ')}.`);
      separador = dto.separador_decimal ?? (origem?.separador_decimal as Separador | undefined) ?? 'virgula';
      lidas = dto.linhas_brutas.length;
      ({ validas, problemas } = aplicarMapeamento(dto.linhas_brutas, mapeamento!, separador, {
        hoje,
        prefixo,
        primeiraLinha: dto.primeira_linha,
      }));
    } else if (formato === 'pdf') {
      if (!Array.isArray(dto.linhas)) throw erro400('VALIDATION_ERROR', 'Envie as linhas conferidas do relatório.');
      if (dto.data_padrao !== undefined && !isDateString(dto.data_padrao)) throw erro400('VALIDATION_ERROR', 'Data das vendas inválida.');
      lidas = dto.linhas.length;
      ({ validas, problemas } = linhasDoPdf(dto.linhas, dto.data_padrao, prefixo, hoje));
    } else {
      let env;
      try {
        env = conferirEnvioXml(dto);
      } catch (e) {
        if (e instanceof EnvioInvalido) throw erro400('VALIDATION_ERROR', e.message);
        throw e;
      }
      const cnpjLoja = await f.cnpjLoja();
      if (!cnpjLoja) throw erro400('LOJA_SEM_CNPJ', 'Cadastre o CNPJ da empresa principal em Empresas antes de importar XML.');
      const chaves = [...new Set([...env.documentos.map((d) => d.chave), ...env.cancelamentos.map((c) => c.chave)])];
      const [empresas, registrados, doComanda] = await Promise.all([
        f.empresas(cnpjLoja),
        f.registrados(chaves, travar),
        f.doComanda(chaves),
      ]);
      const cls = classificarXml(env, {
        cnpjLoja,
        empresas,
        registrados,
        doComanda,
        cnpjsIncluidos: new Set((dto.cnpjs_incluidos ?? []).map(normalizarCnpj)),
        nfeIncluidas: new Set(dto.nfe_incluidas ?? []),
      });
      const documentoDaVenda = new Map<string, string>();
      validas = cls.novos.flatMap((d) => {
        // documento de outra empresa incluída leva o CNPJ no pedido: a mesma série-número de dois CNPJs não colide
        const ls = linhasDoDocumento(d, prefixo, d.emitente_cnpj === cnpjLoja ? '' : ` ${d.emitente_cnpj}`);
        for (const l of ls) documentoDaVenda.set(l.pedido, d.chave);
        return ls;
      });
      lidas = validas.length;
      xml = { ...cls, documentoDaVenda };
    }

    const { vendas } = agregarVendas(validas);
    const datas = vendas.map((v) => v.data).sort();
    const produtos = [...new Set(vendas.map((v) => v.produto_relatorio))];
    const [existentes, porFonte, arquivoJaImportado, dePara, cardapio] = await Promise.all([
      f.existentes(vendas),
      datas.length ? f.porFonte(datas[0]!, datas[datas.length - 1]!) : Promise.resolve([]),
      f.arquivoJaImportado(dto.arquivo_sha256),
      f.dePara(produtos),
      f.cardapio(),
    ]);
    const propria = porFonte.find((p) => p.chave === fonte.chave);
    const previa: PreviaXml = montarPrevia(
      { lidas, validas, problemas },
      {
        propria: fonte,
        modo: dto.modo,
        existentes,
        porFonte,
        substituir: dto.modo === 'substituir' ? { vendas: propria?.vendas ?? 0, valor_centavos: propria?.valor_centavos ?? 0 } : null,
        arquivoJaImportado,
        dePara: new Set(dePara.keys()),
        cardapio,
      },
    );
    if (xml) {
      const importados = xml.cancelar.filter((c) => c.importado).map((c) => c.chave);
      previa.documentos = { ...xml.contagem, cancelamentos_de_importados: await f.vendasDosDocumentos(importados) };
    }
    return { origem, fonte, validas, previa, xml, mapeamento, separador, dePara };
  }

  /**
   * Confirma numa transação só (A.8): trava → idempotência → conferências de novo (os números podem ter mudado desde a prévia) →
   * importação → colunas lembradas → de-para → documentos e cancelamentos (XML) → Substituir → vendas (o gatilho dá as baixas) → resultado.
   * A mesma `chave_idempotencia` com o mesmo corpo devolve o resultado guardado (`repetida`); com outro corpo, 409.
   */
  async confirmar(
    dto: VendasConfirmarDto,
    user: AuthUser,
    hoje = todaySp(),
  ): Promise<{ resultado: ResultadoImportacao; repetida: boolean }> {
    const corpo = hashDoCorpo(dto);
    try {
      return await this.prisma.$transaction((tx) => this.confirmarNaTransacao(tx, dto, user, hoje, corpo), OPCOES_TX);
    } catch (e) {
      // a trava deixa isto quase impossível; se mesmo assim a chave colidir, quem venceu já gravou: devolve o resultado dele
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ja = await this.prisma.importacoes.findUnique({ where: { chave_idempotencia: dto.chave_idempotencia } });
        if (ja) return this.repetida(ja, corpo);
      }
      throw e;
    }
  }

  private repetida(ja: { corpo_sha256: string | null; resultado: Prisma.JsonValue }, corpo: string) {
    if (ja.corpo_sha256 !== corpo || !ja.resultado) {
      throw new ConflictException({ code: 'IMPORTACAO_JA_CONFIRMADA', message: 'Esta importação já foi feita.' });
    }
    return { resultado: ja.resultado as unknown as ResultadoImportacao, repetida: true };
  }

  private async confirmarNaTransacao(tx: Db, dto: VendasConfirmarDto, user: AuthUser, hoje: string, corpo: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TRAVA}))`;
    const ja = await tx.importacoes.findUnique({ where: { chave_idempotencia: dto.chave_idempotencia } });
    if (ja) return this.repetida(ja, corpo);

    const c = await this.calcular(tx, dto, hoje, true);
    const p = c.previa;
    if (p.sobreposicao.length && !dto.confirmar_sobreposicao) {
      throw new ConflictException({
        code: 'IMPORTACAO_SOBREPOSICAO',
        message: 'Neste período já há vendas vindas de outro lugar. Confira o aviso e marque a caixa para importar.',
      });
    }
    const cancelamentos = c.xml?.cancelar ?? [];
    if (p.linhas.novas === 0 && cancelamentos.length === 0) {
      throw erro400('IMPORTACAO_VAZIA', 'Nenhuma venda válida no arquivo. Confira as colunas de Data e Quantidade.');
    }
    const dePara = await this.deParaNovos(tx, dto.de_para_novos, p);

    const imp = await tx.importacoes.create({
      data: {
        tipo: 'vendas',
        arquivo: dto.arquivo,
        linhas: p.linhas.lidas,
        erros: p.linhas.com_problema,
        usuario_id: user.id,
        origem_id: c.origem?.id ?? null,
        formato: dto.formato,
        arquivo_sha256: dto.arquivo_sha256 ?? null,
        chave_idempotencia: dto.chave_idempotencia,
        corpo_sha256: corpo,
      },
      select: { id: true, created_at: true },
    });

    let mapeamentoSalvo = false;
    if (dto.formato === 'planilha' && c.origem && dto.salvar_mapeamento && c.mapeamento) {
      await tx.vendas_origens.update({
        where: { id: c.origem.id },
        data: {
          mapeamento: c.mapeamento as Prisma.InputJsonObject,
          separador_decimal: c.separador,
          atualizado_por: user.id,
          atualizado_em: new Date(),
        },
      });
      mapeamentoSalvo = true;
    }

    // de-para: os produtos novos entram (com o item escolhido na prévia, ou sem item); o de-para que já existe não muda
    const itemDe = new Map(c.dePara);
    const novos = p.produtos_sem_de_para.map((x) => ({
      produto_relatorio: x.produto_relatorio,
      item_cardapio_id: dePara.get(x.produto_relatorio) ?? null,
    }));
    if (novos.length) {
      await tx.de_para_produtos.createMany({ data: novos, skipDuplicates: true });
      for (const n of novos) itemDe.set(n.produto_relatorio, n.item_cardapio_id);
    }

    // XML: registra os documentos novos e aplica os cancelamentos (antes das vendas novas: o "apagadas" conta só as antigas)
    const idDoDocumento = new Map<string, string>();
    if (c.xml?.novos.length) {
      for (const l of lotes(c.xml.novos)) {
        const rs = await tx.vendas_documentos.createManyAndReturn({
          data: l.map((d) => ({
            chave: d.chave,
            modelo: d.modelo,
            serie: d.serie,
            numero: BigInt(d.numero),
            emitente_cnpj: d.emitente_cnpj,
            dh_emi: d.dh_emi,
            valor_total: d.valor_total,
            situacao: 'autorizada',
            importacao_id: imp.id,
          })),
          select: { id: true, chave: true },
        });
        for (const r of rs) idDoDocumento.set(r.chave, r.id);
      }
    }
    const canceladas = { documentos: 0, linhas: 0, valor_centavos: p.documentos?.cancelamentos_de_importados.valor_centavos ?? 0 };
    for (const k of cancelamentos) {
      const [r] = await tx.$queryRaw<
        { n: number }[]
      >`SELECT vendas_documento_cancelar(${k.chave}, ${imp.id}::uuid, ${k.dh_evento}::timestamptz) AS n`;
      if (k.importado) {
        canceladas.documentos++;
        canceladas.linhas += Number(r?.n ?? 0);
      }
    }

    // Substituir (R3/R4): só a fonte própria, no período das linhas válidas do arquivo
    let apagadas = 0;
    if (dto.modo === 'substituir' && p.periodo) {
      const onde: Prisma.vendasWhereInput = c.origem
        ? { nfce_cupom_id: null, documento_id: null, importacoes: { is: { origem_id: c.origem.id } } }
        : { ...ONDE_PLANILHA_PADRAO };
      const r = await tx.vendas.deleteMany({ where: { ...onde, data: { gte: dayToDb(p.periodo.ini), lte: dayToDb(p.periodo.fim) } } });
      apagadas = r.count;
    }

    const { vendas } = agregarVendas(c.validas);
    let inseridas = 0;
    for (const l of lotes(vendas)) {
      const r = await tx.vendas.createMany({
        data: l.map((v) => ({
          pedido: v.pedido,
          data: dayToDb(v.data),
          hora: v.hora ? new Date(`1970-01-01T${v.hora}Z`) : null,
          produto_relatorio: v.produto_relatorio,
          item_cardapio_id: itemDe.get(v.produto_relatorio) ?? null,
          preco_unitario:
            v.preco_unitario ?? (v.quantidade.isZero() ? new Prisma.Decimal(0) : v.valor_total.div(v.quantidade).toDecimalPlaces(4)),
          quantidade: v.quantidade,
          desconto: v.desconto,
          taxa: v.taxa,
          frete: v.frete,
          valor_total: v.valor_total,
          importacao_id: imp.id,
          documento_id: c.xml ? (idDoDocumento.get(c.xml.documentoDaVenda.get(v.pedido) ?? '') ?? null) : null,
        })),
        skipDuplicates: true,
      });
      inseridas += r.count;
    }

    const resultado: ResultadoImportacao = {
      importacao_id: imp.id,
      confirmada_em: imp.created_at.toISOString(),
      inseridas,
      ignoradas: vendas.length - inseridas,
      apagadas,
      apagadas_valor_centavos: apagadas ? (p.substituir?.valor_centavos ?? 0) : 0,
      canceladas,
      documentos_novos: idDoDocumento.size,
      novos_produtos: novos.length,
      valor_centavos: p.valor_centavos,
      periodo: p.periodo ? { ini: p.periodo.ini, fim: p.periodo.fim } : null,
      mapeamento_salvo: mapeamentoSalvo,
    };
    await tx.importacoes.update({ where: { id: imp.id }, data: { resultado: resultado as unknown as Prisma.InputJsonValue } });
    this.log.log(
      JSON.stringify({
        action: 'importacao.vendas',
        importacao_id: imp.id,
        user_id: user.id,
        formato: dto.formato,
        inseridas,
        ignoradas: resultado.ignoradas,
        apagadas,
        canceladas: canceladas.documentos,
        documentos_novos: resultado.documentos_novos,
      }),
    );
    return { resultado, repetida: false };
  }

  /** Confere a escolha da prévia para os produtos novos: o item tem de existir no cardápio. */
  private async deParaNovos(tx: Db, escolhas: Record<string, unknown>[] | undefined, p: Previa): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!escolhas?.length) return out;
    const novos = new Set(p.produtos_sem_de_para.map((x) => x.produto_relatorio));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const e of escolhas) {
      const produto = typeof e.produto_relatorio === 'string' ? e.produto_relatorio : null;
      const item = e.item_cardapio_id;
      if (!produto || (item !== null && item !== undefined && (typeof item !== 'string' || !uuid.test(item)))) {
        throw erro400('VALIDATION_ERROR', 'Escolha de item do cardápio inválida.');
      }
      if (novos.has(produto)) out.set(produto, (item as string | null | undefined) ?? null);
    }
    const ids = [...new Set([...out.values()].filter((x): x is string => !!x))];
    if (ids.length) {
      const achados = await tx.itens_cardapio.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (achados.length !== ids.length)
        throw erro400('VALIDATION_ERROR', 'Item do cardápio não encontrado. Atualize a tela e escolha de novo.');
    }
    return out;
  }
}
