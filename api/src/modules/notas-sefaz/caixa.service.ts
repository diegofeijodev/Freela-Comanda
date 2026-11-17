// Caixa de notas da SEFAZ e configuração da busca (rotas /v1/notas-sefaz). Lê e muda só o (ambiente, CNPJ) atual; a situação de cada
// nota é derivada na leitura (situacao-nota.ts), nunca gravada. Nada de XML, chave de certificado nem corpo da SEFAZ em log ou erro:
// o log `sefaz.caixa` leva só id, motivo e usuário.
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { notas_sefaz } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { normalizarChave } from '../../common/fiscal/chave-acesso';
import { normalizarCnpj } from '../../common/fiscal/cnpj';
import type { NotaParecida } from '../../common/fiscal/nota-repetida';
import { dataBrSp } from '../../common/time/dates';
import {
  CERTIFICADO_DIGITAL,
  CertificadoErro,
  type CertificadoDigitalPort,
  type CertificadoEmUso,
} from '../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { NotasService } from '../notas/notas.service';
import { EM_ANDAMENTO_MAX_MS, type SituacaoBusca } from './agenda';
import { CicloSefazService, esperarTrava, MSG_CICLO, type Quem } from './ciclo.service';
import type { SituacaoSefaz } from './classificacao';
import {
  A_CONFERIR,
  lancamentosDaNota,
  naoPareceCompra,
  podeConferir,
  situacaoDaNota,
  type MotivoIgnorar,
  type SituacaoNota,
} from './situacao-nota';

const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';
const DIA_MS = 24 * 60 * 60_000;
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;
const TX = { maxWait: 10_000, timeout: 30_000 };

const FRASE = {
  naoCadastrado: 'Envie o certificado digital da empresa no quadro acima para ligar a busca.',
  vencido: (d: Date) => `O certificado digital venceu em ${dataBrSp(d)}. Envie o renovado para a busca voltar.`,
  aviso280: 'A SEFAZ pode recusar este certificado (código 280). Se a busca falhar, peça ao contador um certificado A1 de empresa novo.',
  homologacao: 'Nota de teste (homologação) não entra no estoque.',
  cancelada: 'Esta nota foi cancelada pelo fornecedor e não entra no estoque.',
  semXml: 'A SEFAZ ainda não liberou o XML desta nota. Dê entrada pelo arquivo ou pela foto.',
  escrevaMotivo: 'Escreva o motivo.',
  naoEncontrado: 'Não encontrado.',
};

export type SituacaoBuscaResposta =
  | { ambiente: 'desligado' }
  | {
      ambiente: AmbienteSefaz;
      cnpj: string | null;
      busca_ligada: boolean;
      situacao: SituacaoBusca;
      mensagem: string | null;
      aviso: string | null;
      ultima_consulta: { em: string; novas: number } | null;
      primeira_consulta_em: string | null;
      proxima_consulta_em: string | null;
      bloqueado_ate: string | null;
      em_andamento: boolean;
      /** Soma de nsu_ate − nsu_de + 1 das lacunas não preenchidas. */
      lacunas: number;
      /** Dias desde `ultima_consulta_em`. */
      dias_sem_buscar: number | null;
      ligada_por_nome: string | null;
      ligada_em: string | null;
      /** Desligada aqui e ligada noutro (ambiente, CNPJ). */
      outro_cnpj_ou_modo: boolean;
      certificado: { ok: boolean; code: string | null; mensagem: string | null; avisos: string[] };
      contagem: { falta_lancar: number; parece_lancada: number; cancelada_depois_de_lancada: number };
      canceladas_depois: { id: string; numero: string; serie: string; emitente_nome: string }[];
      historico: {
        evento: 'ligada' | 'desligada' | 'parada_automatica';
        feito_por_nome: string | null;
        feito_em: string;
        c_stat: number | null;
      }[];
    };

export type NotaSefazLinha = {
  id: string;
  chave: string;
  emitente_cnpj: string;
  emitente_nome: string;
  numero: string;
  serie: string;
  emitida_em: string | null;
  autorizada_em: string | null;
  valor_total: number | null;
  situacao_sefaz: SituacaoSefaz;
  cancelada_em: string | null;
  situacao: SituacaoNota;
  lancada: NotaParecida | null;
  parecidas: NotaParecida[];
  pode_conferir: boolean;
  nao_parece_compra: boolean;
  ignorada: { em: string; por_nome: string | null; motivo: MotivoIgnorar; texto: string | null } | null;
};

type Contexto = { ambiente: AmbienteSefaz; cnpj: string };
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class CaixaSefazService {
  private readonly logger = new Logger(CaixaSefazService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ciclo: CicloSefazService,
    private readonly notas: NotasService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
  ) {}

  private desligada(): HttpException {
    return new ServiceUnavailableException({ code: 'SEFAZ_DESLIGADA', message: MSG_CICLO.desligada });
  }

  /** Ambiente do servidor (`desligado` = 503) e CNPJ da empresa (sem CNPJ = nenhuma nota para mostrar ou mudar). */
  private async contexto(): Promise<{ ambiente: AmbienteSefaz; cnpj: string | null }> {
    const ambiente = this.ciclo.ambiente();
    if (ambiente === 'desligado') throw this.desligada();
    return { ambiente, cnpj: await this.ciclo.cnpjDaEmpresa() };
  }

  // ---------------------------------------------------------------------------------------------------------- situação

  async situacao(agora: Date = new Date()): Promise<SituacaoBuscaResposta> {
    const ambiente = this.ciclo.ambiente();
    if (ambiente === 'desligado') return { ambiente: 'desligado' };
    const cnpj = await this.ciclo.cnpjDaEmpresa();
    const onde = cnpj ? { ambiente, cnpj } : null;
    const linha = onde ? await this.prisma.sefaz_distribuicao.findUnique({ where: { ambiente_cnpj: onde } }) : null;

    const ligadas = await this.prisma.sefaz_distribuicao.findMany({ where: { busca_ligada: true } });
    const outroCnpjOuModo = !linha?.busca_ligada && ligadas.some((l) => l.ambiente !== ambiente || l.cnpj !== cnpj);

    const [derivadas, lacunas, historico, consultas, certificado] = await Promise.all([
      onde ? this.derivar(onde) : Promise.resolve([]),
      onde ? this.prisma.sefaz_lacunas.findMany({ where: { ...onde, preenchida_em: null } }) : Promise.resolve([]),
      onde
        ? this.prisma.sefaz_distribuicao_historico.findMany({ where: onde, orderBy: { feito_em: 'desc' }, take: 5 })
        : Promise.resolve([]),
      onde ? this.prisma.sefaz_consultas.findMany({ where: onde, orderBy: { iniciada_em: 'desc' }, take: 20 }) : Promise.resolve([]),
      this.certificadoInfo(cnpj, agora),
    ]);

    const contagem = { falta_lancar: 0, parece_lancada: 0, cancelada_depois_de_lancada: 0 };
    for (const d of derivadas) {
      if (d.situacao === 'falta_lancar' || d.situacao === 'parece_lancada' || d.situacao === 'cancelada_depois_de_lancada') {
        contagem[d.situacao]++;
      }
    }

    // "N notas novas" (Decisão 6): linhas criadas desde o início do último ciclo que teve retorno.
    let ultimaConsulta: { em: string; novas: number } | null = null;
    if (linha?.ultima_consulta_em) {
      const respondida = consultas.find((c) => c.resultado === 'respondida');
      const inicioDoCiclo = respondida
        ? Math.min(...consultas.filter((c) => c.ciclo_id === respondida.ciclo_id).map((c) => c.iniciada_em.getTime()))
        : linha.ultima_consulta_em.getTime();
      const novas = derivadas.filter((d) => d.nota.criada_em.getTime() >= inicioDoCiclo).length;
      ultimaConsulta = { em: linha.ultima_consulta_em.toISOString(), novas };
    }

    return {
      ambiente,
      cnpj,
      busca_ligada: linha?.busca_ligada ?? false,
      situacao: (linha?.situacao as SituacaoBusca | undefined) ?? 'ok',
      mensagem: linha?.mensagem ?? null,
      aviso: linha?.aviso ?? null,
      ultima_consulta: ultimaConsulta,
      primeira_consulta_em: iso(linha?.primeira_consulta_em ?? null),
      proxima_consulta_em: iso(linha?.proxima_consulta_em ?? null),
      bloqueado_ate: iso(linha?.bloqueado_ate ?? null),
      em_andamento: !!linha?.em_andamento_desde && agora.getTime() - linha.em_andamento_desde.getTime() <= EM_ANDAMENTO_MAX_MS,
      lacunas: lacunas.reduce((s, l) => s + Number(l.nsu_ate - l.nsu_de + 1n), 0),
      dias_sem_buscar: linha?.ultima_consulta_em
        ? Math.max(0, Math.floor((agora.getTime() - linha.ultima_consulta_em.getTime()) / DIA_MS))
        : null,
      ligada_por_nome: linha?.busca_ligada ? (linha.alterada_por_nome ?? null) : null,
      ligada_em: linha?.busca_ligada ? iso(linha.alterada_em) : null,
      outro_cnpj_ou_modo: outroCnpjOuModo,
      certificado,
      contagem,
      canceladas_depois: derivadas
        .filter((d) => d.situacao === 'cancelada_depois_de_lancada')
        .sort(porEmissao)
        .map((d) => ({ id: d.nota.id, numero: d.nota.numero, serie: d.nota.serie, emitente_nome: d.nota.emitente_nome })),
      historico: historico.map((h) => ({
        evento: h.evento as 'ligada' | 'desligada' | 'parada_automatica',
        feito_por_nome: h.feito_por_nome,
        feito_em: h.feito_em.toISOString(),
        c_stat: h.c_stat,
      })),
    };
  }

  /** O que o painel mostra do certificado (frases da UX §4). Nunca chave, PEM nem arquivo: só o código e a frase. */
  private async certificadoInfo(cnpj: string | null, agora: Date) {
    const falha = (code: string, mensagem: string) => ({ ok: false, code, mensagem, avisos: [] as string[] });
    if (!cnpj) return falha('EMPRESA_SEM_CNPJ', MSG_CICLO.semCnpj);
    let cert: CertificadoEmUso;
    try {
      cert = await this.certificados.emUso(agora);
    } catch (e) {
      if (!(e instanceof CertificadoErro)) throw e;
      switch (e.code) {
        case 'CERTIFICADO_NAO_CADASTRADO':
          return falha(e.code, FRASE.naoCadastrado);
        case 'CERTIFICADO_VENCIDO':
          return falha(e.code, e.validoAte ? FRASE.vencido(e.validoAte) : e.message);
        default:
          return falha(e.code, e.message);
      }
    }
    if (normalizarCnpj(cert.cnpj).slice(0, 8) !== cnpj.slice(0, 8)) return falha('CERTIFICADO_OUTRO_CNPJ', MSG_CICLO.outraEmpresa);
    const ku = cert.certificado?.keyUsage as string[] | undefined;
    const avisos = Array.isArray(ku) && !ku.includes(OID_CLIENT_AUTH) ? [FRASE.aviso280] : [];
    return { ok: true, code: null, mensagem: null, avisos };
  }

  // ------------------------------------------------------------------------------------------------------ configuração

  /** Ligar ou desligar. Nunca escreve ult_nsu, próxima consulta, bloqueio, "em andamento" nem falhas (Review Focus 1). */
  async configurar(ligar: boolean, quem: Quem, agora: Date = new Date()): Promise<SituacaoBuscaResposta> {
    const ambiente = this.ciclo.ambiente();
    if (ambiente === 'desligado') throw this.desligada();
    if (ligar) {
      const { cnpj } = await this.ciclo.conferirParaLigar(agora);
      await this.prisma.$transaction(async (tx) => {
        await esperarTrava(tx);
        const autoria = { alterada_por: quem.id, alterada_por_nome: quem.nome, alterada_em: agora };
        await tx.sefaz_distribuicao.upsert({
          where: { ambiente_cnpj: { ambiente, cnpj } },
          create: { ambiente, cnpj, busca_ligada: true, situacao: 'ok', mensagem: null, ...autoria },
          update: { busca_ligada: true, situacao: 'ok', mensagem: null, ...autoria },
        });
        await tx.sefaz_distribuicao_historico.create({
          data: { ambiente, cnpj, evento: 'ligada', situacao: 'ok', feito_por: quem.id, feito_por_nome: quem.nome, feito_em: agora },
        });
      }, TX);
    } else {
      const cnpj = await this.ciclo.cnpjDaEmpresa();
      if (cnpj) {
        await this.prisma.$transaction(async (tx) => {
          await esperarTrava(tx);
          const chave = { ambiente_cnpj: { ambiente, cnpj } };
          const linha = await tx.sefaz_distribuicao.findUnique({ where: chave });
          if (!linha) return;
          await tx.sefaz_distribuicao.update({
            where: chave,
            data: { busca_ligada: false, alterada_por: quem.id, alterada_por_nome: quem.nome, alterada_em: agora },
          });
          await tx.sefaz_distribuicao_historico.create({
            data: {
              ambiente,
              cnpj,
              evento: 'desligada',
              situacao: linha.situacao,
              feito_por: quem.id,
              feito_por_nome: quem.nome,
              feito_em: agora,
            },
          });
        }, TX);
      }
    }
    this.logger.log(JSON.stringify({ evento: 'sefaz.caixa', acao: ligar ? 'ligar' : 'desligar', usuario_id: quem.id }));
    return this.situacao(agora);
  }

  // ------------------------------------------------------------------------------------------------------------ caixa

  async listar(filtro: 'a_conferir' | 'todas', limite: number): Promise<NotaSefazLinha[]> {
    const { ambiente, cnpj } = await this.contexto();
    if (!cnpj) return [];
    const teto = Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite), 1), LIMITE_MAXIMO) : LIMITE_PADRAO;
    const derivadas = (await this.derivar({ ambiente, cnpj })).sort(porEmissao);
    return derivadas
      .filter((d) => filtro === 'todas' || A_CONFERIR.has(d.situacao))
      .slice(0, teto)
      .map((d) => d.linha);
  }

  /** O `procNFe` guardado, para o admin conferir e dar entrada. A única saída de XML da busca. */
  async xml(id: string): Promise<string> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    if (ambiente === 'homologacao') throw new ConflictException({ code: 'SEFAZ_HOMOLOGACAO', message: FRASE.homologacao });
    if (nota.situacao_sefaz === 'cancelada') throw new ConflictException({ code: 'SEFAZ_CANCELADA', message: FRASE.cancelada });
    const doc = nota.documento_completo_id
      ? await this.prisma.sefaz_documentos.findUnique({ where: { id: nota.documento_completo_id } })
      : null;
    if (!doc?.xml) throw new NotFoundException({ code: 'SEFAZ_SEM_XML', message: FRASE.semXml });
    return doc.xml;
  }

  async ignorar(id: string, motivo: MotivoIgnorar, texto: string | null, quem: Quem, agora: Date = new Date()): Promise<NotaSefazLinha> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    const txt = (texto ?? '').trim();
    if (motivo === 'outro' && !txt) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: FRASE.escrevaMotivo });
    await this.prisma.notas_sefaz.update({
      where: { id: nota.id },
      data: {
        ignorada_em: agora,
        ignorada_por: quem.id,
        ignorada_por_nome: quem.nome,
        motivo_ignorar: motivo,
        motivo_texto: txt || null,
        atualizada_em: agora,
      },
    });
    this.logger.log(JSON.stringify({ evento: 'sefaz.caixa', acao: 'ignorar', id: nota.id, motivo, usuario_id: quem.id }));
    return this.linhaDe(id, { ambiente, cnpj });
  }

  async reabrir(id: string, quem: Quem, agora: Date = new Date()): Promise<NotaSefazLinha> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    await this.prisma.notas_sefaz.update({
      where: { id: nota.id },
      data: {
        ignorada_em: null,
        ignorada_por: null,
        ignorada_por_nome: null,
        motivo_ignorar: null,
        motivo_texto: null,
        atualizada_em: agora,
      },
    });
    this.logger.log(
      JSON.stringify({ evento: 'sefaz.caixa', acao: 'reabrir', id: nota.id, motivo: nota.motivo_ignorar, usuario_id: quem.id }),
    );
    return this.linhaDe(id, { ambiente, cnpj });
  }

  // ------------------------------------------------------------------------------------------------------- derivação

  /** A nota só vale para o (ambiente, CNPJ) atual: de outra linha (ou sem CNPJ na empresa) = 404. */
  private async achar(id: string, onde: { ambiente: AmbienteSefaz; cnpj: string | null }): Promise<notas_sefaz> {
    const nota = await this.prisma.notas_sefaz.findUnique({ where: { id } });
    if (!nota || !onde.cnpj || nota.ambiente !== onde.ambiente || nota.cnpj_destinatario !== onde.cnpj) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: FRASE.naoEncontrado });
    }
    return nota;
  }

  private async linhaDe(id: string, onde: { ambiente: AmbienteSefaz; cnpj: string | null }): Promise<NotaSefazLinha> {
    const nota = await this.achar(id, onde);
    return (await this.derivarLinhas(onde.ambiente, [nota]))[0]!.linha;
  }

  /** Carrega as linhas do (ambiente, CNPJ) e cruza com as lançadas numa consulta só. */
  private async derivar(onde: Contexto) {
    const notas = await this.prisma.notas_sefaz.findMany({ where: { ambiente: onde.ambiente, cnpj_destinatario: onde.cnpj } });
    return this.derivarLinhas(onde.ambiente, notas);
  }

  private async derivarLinhas(ambiente: AmbienteSefaz, notas: notas_sefaz[]) {
    const chaves = [...new Set(notas.map((n) => normalizarChave(n.chave)))];
    const emitentes = [...new Set(notas.map((n) => normalizarCnpj(n.emitente_cnpj)).filter(Boolean))];
    const lancadas = await this.notas.notasLancadas({ chaves, emitentes });
    return notas.map((nota) => {
      const { lancada, parecidas } = lancamentosDaNota(nota, lancadas);
      const motivo = nota.motivo_ignorar as MotivoIgnorar | null;
      const situacao = situacaoDaNota(
        { situacao_sefaz: nota.situacao_sefaz as SituacaoSefaz, motivo_ignorar: motivo },
        { lancada: lancada !== null, parecida: parecidas.length > 0 },
      );
      const linha: NotaSefazLinha = {
        id: nota.id,
        chave: nota.chave,
        emitente_cnpj: nota.emitente_cnpj,
        emitente_nome: nota.emitente_nome,
        numero: nota.numero,
        serie: nota.serie,
        emitida_em: iso(nota.emitida_em),
        autorizada_em: iso(nota.autorizada_em),
        valor_total: nota.valor_total === null ? null : Number(nota.valor_total),
        situacao_sefaz: nota.situacao_sefaz as SituacaoSefaz,
        cancelada_em: iso(nota.cancelada_em),
        situacao,
        lancada,
        parecidas,
        pode_conferir: podeConferir(ambiente, nota.documento_completo_id !== null, situacao),
        nao_parece_compra: naoPareceCompra(nota.tp_nf, nota.fin_nfe),
        ignorada:
          nota.ignorada_em && motivo
            ? { em: nota.ignorada_em.toISOString(), por_nome: nota.ignorada_por_nome, motivo, texto: nota.motivo_texto }
            : null,
      };
      return { nota, situacao, linha };
    });
  }
}

/** Emissão decrescente, nulos no fim; empate pela chave (ordem estável). */
function porEmissao(a: { nota: notas_sefaz }, b: { nota: notas_sefaz }): number {
  const x = a.nota.emitida_em?.getTime() ?? null;
  const y = b.nota.emitida_em?.getTime() ?? null;
  if (x === y) return a.nota.chave < b.nota.chave ? -1 : a.nota.chave > b.nota.chave ? 1 : 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}
