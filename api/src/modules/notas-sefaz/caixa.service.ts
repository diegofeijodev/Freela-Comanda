// Caixa de notas da SEFAZ, configuração da busca e das respostas à SEFAZ (rotas /v1/notas-sefaz). Lê e muda só o (ambiente, CNPJ) atual;
// a situação de cada nota e a sua resposta à SEFAZ são derivadas na leitura (situacao-nota.ts, respostas-plano.ts), nunca gravadas. As
// rotas só escrevem na fila das respostas (evento pedido pelo admin, cancelado ou de volta à fila) sob a trava das respostas; quem fala com a
// SEFAZ é só o tique (respostas.service.ts). Nada de XML, chave de certificado nem corpo da SEFAZ em log, erro ou resposta: o log
// `sefaz.caixa` leva só id, motivo, tipo do evento e usuário; a frase de cada recusa é derivada do código, nunca o `x_motivo` da SEFAZ.
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
import { Prisma, type notas_sefaz, type sefaz_manifestacoes } from '@prisma/client';
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
import type { TipoEvento } from '../sefaz/eventos.port';
import { normalizarJustificativa } from '../sefaz/eventos-xml';
import { NotasService } from '../notas/notas.service';
import { EM_ANDAMENTO_MAX_MS, type SituacaoBusca } from './agenda';
import { CicloSefazService, esperarTrava, MSG_CICLO, type Quem } from './ciclo.service';
import type { SituacaoSefaz } from './classificacao';
import { ESPERA_ADMIN_MS, fraseRecusa, type EstadoEvento, type SituacaoRespostas } from './respostas-agenda';
import {
  avisoDePrazo,
  finalAtiva,
  prazoDaNota,
  respondivel,
  type EventoExistente,
  type NotaParaPlano,
  type OrigemEvento,
} from './respostas-plano';
import { eventoExistente, jaEnviada, MOTIVO_SEM_ASSINATURA, RespostasSefazService, resultadosDosLotes } from './respostas.service';
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

/** Frases das rotas das respostas à SEFAZ (as de lote e de recusa ficam em `frases.ts`). */
const FRASE_ROTA = {
  desligadas: 'As respostas à SEFAZ não estão ativadas neste servidor.',
  naoLigadas: 'As respostas à SEFAZ estão desligadas. Ligue em Configurações → Notas da SEFAZ.',
  motivoNaoAvisa: 'Este motivo não avisa a SEFAZ.',
  motivoSempreAvisa: 'Este motivo sempre avisa a SEFAZ.',
  naoRespondivel: 'Esta nota não aceita resposta à SEFAZ.',
  prazoPassou: 'Passou o prazo de 90 dias para responder à SEFAZ sobre esta nota.',
  jaRespondida: 'Esta nota já tem resposta final na SEFAZ.',
  justificativa: {
    curta: 'Conte o que houve com pelo menos 15 letras.',
    longa: 'Use no máximo 255 letras.',
    caractere: 'Use só letras, números e pontuação comum (sem emoji).',
  },
  nadaAReenviar: 'Não há resposta para enviar de novo nesta nota.',
};

/** O evento que cada motivo pede quando o admin marca "avisar a SEFAZ" (desenho, decisão 3 do construtor). Outro e "Ciente" não avisam. */
const EVENTO_DO_MOTIVO: Partial<Record<MotivoIgnorar, Exclude<TipoEvento, '210210'>>> = {
  lancada_de_outro_jeito: '210200',
  nao_e_compra: '210200',
  nao_reconheco: '210220',
  compra_nao_aconteceu: '210240',
};
const TIPO_FINAL = { '210200': 'confirmacao', '210220': 'nao_reconheco', '210240': 'nao_aconteceu' } as const;
/** O histórico da busca (o quadro das respostas não mostra lista: só quem ligou e a situação). */
const EVENTOS_DA_BUSCA = ['ligada', 'desligada', 'parada_automatica'];

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
      respostas: RespostasSefaz;
    };

/** Quadro "Respostas à SEFAZ" do painel. Sem `SEFAZ_MANIFESTACAO=ligada`: `disponivel = false` e o resto vazio. */
export type RespostasSefaz = {
  disponivel: boolean;
  ligadas: boolean;
  situacao: SituacaoRespostas;
  mensagem: string | null;
  pausa_ate: string | null;
  ligadas_por_nome: string | null;
  ligadas_em: string | null;
  na_fila: number;
  falharam: number;
  /** As notas no aviso do prazo (`prazo_perto`), a que vence primeiro antes. */
  prazos_perto: { id: string; numero: string; serie: string; emitente_nome: string; prazo_final: string }[];
};

/** Um evento da nota: `em` = última mudança; `mensagem` = a frase da recusa (pelo código) ou do evento que não assinou, senão null. */
export type EstadoResposta = { estado: EstadoEvento; em: string; protocolo: string | null; c_stat: number | null; mensagem: string | null };

/**
 * A resposta à SEFAZ de uma nota: `ciencia` e `final` = o evento mais recente de cada grupo fora os cancelados; `prazo_perto` = o aviso
 * do prazo (`avisoDePrazo`); `pode_responder` = respondível (autorizada, de compra, no prazo, sem resposta final ativa), sem olhar se as
 * respostas estão ligadas (isso o painel diz).
 */
export type RespostaNota = {
  ciencia: EstadoResposta | null;
  final: (EstadoResposta & { tipo: 'confirmacao' | 'nao_reconheco' | 'nao_aconteceu'; origem: OrigemEvento }) | null;
  prazo_final: string | null;
  prazo_perto: boolean;
  prazo_passou: boolean;
  pode_responder: boolean;
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
  /** null com a variável `SEFAZ_MANIFESTACAO` desligada. */
  resposta: RespostaNota | null;
};

type Contexto = { ambiente: AmbienteSefaz; cnpj: string };
/** Os eventos de cada nota (por id) e o resultado dos lotes deles; null = respostas indisponíveis no servidor. */
type EventosDasNotas = { porNota: Map<string, sefaz_manifestacoes[]>; resultadoDoLote: Map<string, string | null> } | null;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const respostasVazias = (disponivel: boolean): RespostasSefaz => ({
  disponivel,
  ligadas: false,
  situacao: 'ok',
  mensagem: null,
  pausa_ate: null,
  ligadas_por_nome: null,
  ligadas_em: null,
  na_fila: 0,
  falharam: 0,
  prazos_perto: [],
});

/** A nota no formato do planejador (só o que as regras de prazo e de "respondível" leem tem de ser exato). */
function notaParaPlano(nota: notas_sefaz, situacao: SituacaoNota, lancada: NotaParecida | null): NotaParaPlano {
  return {
    id: nota.id,
    situacao,
    situacao_sefaz: nota.situacao_sefaz as SituacaoSefaz,
    tp_nf: nota.tp_nf,
    autorizada_em: nota.autorizada_em,
    emitida_em: nota.emitida_em,
    tem_xml_completo: nota.documento_completo_id !== null,
    lancada_pela_chave_em: lancada ? new Date(lancada.created_at) : null,
  };
}

/** Frase de um evento, derivada na leitura: a da recusa pelo código, ou a fixa do evento que não assinou. Nunca o `x_motivo` da SEFAZ. */
function mensagemDoEvento(e: sefaz_manifestacoes): string | null {
  if (e.situacao === 'recusada' && e.c_stat !== null) return fraseRecusa(e.c_stat, e.tp_evento as TipoEvento);
  if (e.situacao === 'falhou' && e.x_motivo === MOTIVO_SEM_ASSINATURA) return MOTIVO_SEM_ASSINATURA;
  return null;
}

function estadoDe(e: sefaz_manifestacoes): EstadoResposta {
  return {
    estado: e.situacao as EstadoEvento,
    em: e.atualizada_em.toISOString(),
    protocolo: e.n_prot,
    c_stat: e.c_stat,
    mensagem: mensagemDoEvento(e),
  };
}

function respostaDaNota(plano: NotaParaPlano, eventos: sefaz_manifestacoes[], existentes: EventoExistente[], agora: Date): RespostaNota {
  const vivos = eventos.filter((e) => e.situacao !== 'cancelada').sort((a, b) => b.criada_em.getTime() - a.criada_em.getTime());
  const ciencia = vivos.find((e) => e.tp_evento === '210210') ?? null;
  const final = vivos.find((e) => e.tp_evento !== '210210') ?? null;
  const prazo = prazoDaNota(plano, agora);
  return {
    ciencia: ciencia ? estadoDe(ciencia) : null,
    final: final
      ? {
          ...estadoDe(final),
          tipo: TIPO_FINAL[final.tp_evento as keyof typeof TIPO_FINAL],
          origem: final.origem as OrigemEvento,
        }
      : null,
    prazo_final: iso(prazo.prazo_final),
    prazo_perto: avisoDePrazo(plano, existentes, agora),
    prazo_passou: prazo.prazo_passou,
    pode_responder: respondivel(plano, existentes, agora),
  };
}

const ehP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class CaixaSefazService {
  private readonly logger = new Logger(CaixaSefazService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ciclo: CicloSefazService,
    private readonly notas: NotasService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
    private readonly respostas: RespostasSefazService,
  ) {}

  private desligada(): HttpException {
    return new ServiceUnavailableException({ code: 'SEFAZ_DESLIGADA', message: MSG_CICLO.desligada });
  }

  private respostasDesligadas(): HttpException {
    return new ServiceUnavailableException({ code: 'SEFAZ_RESPOSTAS_DESLIGADAS', message: FRASE_ROTA.desligadas });
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
      onde ? this.derivar(onde, agora) : Promise.resolve([]),
      onde ? this.prisma.sefaz_lacunas.findMany({ where: { ...onde, preenchida_em: null } }) : Promise.resolve([]),
      onde
        ? this.prisma.sefaz_distribuicao_historico.findMany({
            where: { ...onde, evento: { in: EVENTOS_DA_BUSCA } },
            orderBy: { feito_em: 'desc' },
            take: 5,
          })
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
      respostas: await this.quadroRespostas(onde, derivadas),
    };
  }

  /**
   * O quadro das respostas. `ligadas_por_nome` e `ligadas_em` vêm da mesma escrita (a autoria do último "Ligar", como na busca), não de
   * `ligada_em` (a base da confirmação automática, que um "Ligar de novo" depois de uma parada não reescreve).
   */
  private async quadroRespostas(onde: Contexto | null, derivadas: { nota: notas_sefaz; linha: NotaSefazLinha }[]): Promise<RespostasSefaz> {
    if (!this.respostas.disponivel()) return respostasVazias(false);
    if (!onde) return respostasVazias(true);
    const [linha, naFila, falharam] = await Promise.all([
      this.prisma.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: onde } }),
      this.prisma.sefaz_manifestacoes.count({ where: { ...onde, situacao: 'na_fila' } }),
      this.prisma.sefaz_manifestacoes.count({ where: { ...onde, situacao: 'falhou' } }),
    ]);
    const ligadas = linha?.ligada ?? false;
    const prazosPerto = derivadas
      .filter((d) => d.linha.resposta?.prazo_perto && d.linha.resposta.prazo_final)
      .map((d) => ({
        id: d.nota.id,
        numero: d.nota.numero,
        serie: d.nota.serie,
        emitente_nome: d.nota.emitente_nome,
        prazo_final: d.linha.resposta!.prazo_final!,
      }))
      .sort((a, b) => (a.prazo_final < b.prazo_final ? -1 : a.prazo_final > b.prazo_final ? 1 : a.id < b.id ? -1 : 1));
    return {
      disponivel: true,
      ligadas,
      situacao: (linha?.situacao as SituacaoRespostas | undefined) ?? 'ok',
      mensagem: linha?.mensagem ?? null,
      pausa_ate: iso(linha?.pausa_ate ?? null),
      ligadas_por_nome: ligadas ? (linha!.alterada_por_nome ?? null) : null,
      ligadas_em: ligadas ? iso(linha!.alterada_em) : null,
      na_fila: naFila,
      falharam,
      prazos_perto: prazosPerto,
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

  /**
   * "Ligar as respostas" / "Desligar as respostas", sob a trava das respostas (a T1 do tique lê a mesma linha). Ligar pede as conferências
   * de "Ligar a busca" (não a busca ligada) e volta a situação a `ok` com as falhas zeradas; `ligada_em` (base da confirmação automática) só
   * muda na passagem de desligada para ligada: "Ligar de novo" depois de uma parada não a reescreve. Nenhum dos dois mexe em `pausa_ate` nem
   * na fila: desligadas, os eventos na fila esperam.
   */
  async configurarRespostas(ligar: boolean, quem: Quem, agora: Date = new Date()): Promise<SituacaoBuscaResposta> {
    if (!this.respostas.disponivel()) throw this.respostasDesligadas();
    const autoria = { alterada_por: quem.id, alterada_por_nome: quem.nome, alterada_em: agora };
    const historico = (onde: Contexto, evento: string, situacao: string) => ({
      data: { ...onde, evento, situacao, feito_por: quem.id, feito_por_nome: quem.nome, feito_em: agora },
    });
    if (ligar) {
      const onde = await this.ciclo.conferirParaLigar(agora);
      await this.prisma.$transaction(async (tx) => {
        await this.respostas.esperarTravaEventos(tx);
        const linha = await tx.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: onde } });
        const volta = { ligada: true, situacao: 'ok', mensagem: null, falhas_seguidas: 0, ...autoria };
        if (!linha) await tx.sefaz_manifestacao.create({ data: { ...onde, ...volta, ligada_em: agora } });
        else {
          await tx.sefaz_manifestacao.update({
            where: { ambiente_cnpj: onde },
            data: { ...volta, ...(linha.ligada ? {} : { ligada_em: agora }) },
          });
        }
        await tx.sefaz_distribuicao_historico.create(historico(onde, 'respostas_ligadas', 'ok'));
      }, TX);
    } else {
      const ambiente = this.ciclo.ambiente() as AmbienteSefaz;
      const cnpj = await this.ciclo.cnpjDaEmpresa();
      if (cnpj) {
        const onde = { ambiente, cnpj };
        await this.prisma.$transaction(async (tx) => {
          await this.respostas.esperarTravaEventos(tx);
          const linha = await tx.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: onde } });
          if (!linha) return;
          await tx.sefaz_manifestacao.update({ where: { ambiente_cnpj: onde }, data: { ligada: false, ...autoria } });
          await tx.sefaz_distribuicao_historico.create(historico(onde, 'respostas_desligadas', linha.situacao));
        }, TX);
      }
    }
    this.logger.log(JSON.stringify({ evento: 'sefaz.caixa', acao: ligar ? 'ligar_respostas' : 'desligar_respostas', usuario_id: quem.id }));
    return this.situacao(agora);
  }

  // ------------------------------------------------------------------------------------------------------------ caixa

  async listar(filtro: 'a_conferir' | 'todas', limite: number, agora: Date = new Date()): Promise<NotaSefazLinha[]> {
    const { ambiente, cnpj } = await this.contexto();
    if (!cnpj) return [];
    const teto = Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite), 1), LIMITE_MAXIMO) : LIMITE_PADRAO;
    const derivadas = (await this.derivar({ ambiente, cnpj }, agora)).sort(porEmissao);
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

  /**
   * Ignorar. Sem `avisarSefaz`, o da entrega 2 (só a nota). Com ele, pede à SEFAZ o evento do motivo (210200, 210220 ou 210240), pelas
   * regras nesta ordem: variável → respostas ligadas → motivo que avisa → nota respondível → prazo → sem resposta final ativa →
   * justificativa. A nota ignorada e o evento (`admin`, na fila, 60 s de espera para o "Desfazer") são gravados na MESMA transação, sob a
   * trava das respostas; a ciência da nota ainda na fila que nunca saiu é cancelada (seria 655 depois da resposta final).
   */
  async ignorar(
    id: string,
    motivo: MotivoIgnorar,
    texto: string | null,
    quem: Quem,
    agora: Date = new Date(),
    avisarSefaz = false,
  ): Promise<NotaSefazLinha> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    const onde = { ambiente, cnpj: cnpj! };
    const txt = (texto ?? '').trim();
    if (motivo === 'compra_nao_aconteceu' && !avisarSefaz) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: FRASE_ROTA.motivoSempreAvisa });
    }
    const ignorada = (motivoTexto: string | null) => ({
      ignorada_em: agora,
      ignorada_por: quem.id,
      ignorada_por_nome: quem.nome,
      motivo_ignorar: motivo,
      motivo_texto: motivoTexto,
      atualizada_em: agora,
    });

    if (!avisarSefaz) {
      if (motivo === 'outro' && !txt) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: FRASE.escrevaMotivo });
      await this.prisma.notas_sefaz.update({ where: { id: nota.id }, data: ignorada(txt || null) });
      this.logger.log(JSON.stringify({ evento: 'sefaz.caixa', acao: 'ignorar', id: nota.id, motivo, usuario_id: quem.id }));
      return this.linhaDe(id, onde, agora);
    }

    if (!this.respostas.disponivel()) throw this.respostasDesligadas();
    let tpEvento: Exclude<TipoEvento, '210210'>;
    try {
      tpEvento = await this.prisma.$transaction(async (tx) => {
        await this.respostas.esperarTravaEventos(tx);
        const linha = await tx.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: onde } });
        if (!linha?.ligada) throw new ConflictException({ code: 'SEFAZ_RESPOSTAS_NAO_LIGADAS', message: FRASE_ROTA.naoLigadas });
        const tp = EVENTO_DO_MOTIVO[motivo];
        if (!tp) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: FRASE_ROTA.motivoNaoAvisa });
        const prazo = prazoDaNota(nota, agora);
        if (nota.situacao_sefaz !== 'autorizada' || nota.tp_nf !== 1 || prazo.prazo_final === null) {
          throw new ConflictException({ code: 'SEFAZ_NAO_RESPONDIVEL', message: FRASE_ROTA.naoRespondivel });
        }
        if (prazo.prazo_passou) throw new ConflictException({ code: 'SEFAZ_PRAZO_PASSOU', message: FRASE_ROTA.prazoPassou });
        const eventos = await tx.sefaz_manifestacoes.findMany({ where: { nota_sefaz_id: nota.id } });
        const resultadoDoLote = await resultadosDosLotes(tx, eventos);
        if (finalAtiva(eventos.map((e) => eventoExistente(e, resultadoDoLote)))) {
          throw new ConflictException({ code: 'SEFAZ_JA_RESPONDIDA', message: FRASE_ROTA.jaRespondida });
        }
        // Uma resposta do mesmo tipo recusada pela SEFAZ ainda ocupa a vaga (ambiente, chave, tipo, nSeq 1): sem retificação nesta entrega.
        if (eventos.some((e) => e.tp_evento === tp && e.situacao !== 'cancelada')) {
          throw new ConflictException({ code: 'SEFAZ_NAO_RESPONDIVEL', message: FRASE_ROTA.naoRespondivel });
        }
        let xJust: string | null = null;
        if (tp === '210240') {
          const j = normalizarJustificativa(texto ?? '');
          if (!j.ok) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: FRASE_ROTA.justificativa[j.erro] });
          xJust = j.texto;
        }

        // A nota antes do evento: se o INSERT do evento falhar, a transação desfaz a nota ignorada junto.
        await tx.notas_sefaz.update({ where: { id: nota.id }, data: ignorada(xJust ?? (txt || null)) });
        const ciencias = eventos
          .filter((e) => e.tp_evento === '210210' && e.situacao === 'na_fila' && !jaEnviada(e, resultadoDoLote))
          .map((e) => e.id);
        if (ciencias.length > 0) {
          await tx.sefaz_manifestacoes.updateMany({
            where: { id: { in: ciencias }, tp_evento: '210210', situacao: 'na_fila' },
            data: { situacao: 'cancelada', atualizada_em: agora },
          });
        }
        await tx.sefaz_manifestacoes.create({
          data: {
            nota_sefaz_id: nota.id,
            ...onde,
            chave: nota.chave,
            tp_evento: tp,
            n_seq: 1,
            x_just: xJust,
            origem: 'admin',
            pedida_por: quem.id,
            pedida_por_nome: quem.nome,
            pedida_em: agora,
            enviar_apos: new Date(agora.getTime() + ESPERA_ADMIN_MS),
            situacao: 'na_fila',
            tentativas: 0,
            criada_em: agora,
            atualizada_em: agora,
          },
        });
        return tp;
      }, TX);
    } catch (e) {
      // A conferência acima decide; o índice `sefaz_manifestacoes_uma_final` (ou o do evento) só pega a corrida entre duas abas.
      if (ehP2002(e)) throw new ConflictException({ code: 'SEFAZ_JA_RESPONDIDA', message: FRASE_ROTA.jaRespondida });
      throw e;
    }
    this.logger.log(
      JSON.stringify({ evento: 'sefaz.caixa', acao: 'ignorar', id: nota.id, motivo, tp_evento: tpEvento, usuario_id: quem.id }),
    );
    return this.linhaDe(id, onde, agora);
  }

  /**
   * Volta a nota para a lista e, sob a trava das respostas, cancela o evento pedido pelo admin que ainda está na fila sem nenhuma tentativa
   * gasta (o "Desfazer" sempre o encontra assim: ele espera 60 s; e também o que voltou de um lote recusado inteiro, numa parada ou espera).
   * O que pode ter chegado à SEFAZ (enviando, registrado, ou de volta à fila com tentativa gasta) fica: depois de sair, não há volta aqui.
   */
  async reabrir(id: string, quem: Quem, agora: Date = new Date()): Promise<NotaSefazLinha> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    const cancelados = await this.prisma.$transaction(async (tx) => {
      await this.respostas.esperarTravaEventos(tx);
      await tx.notas_sefaz.update({
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
      // `tentativas = 0`: nunca gastou tentativa, então não pode estar registrado (lote recusado inteiro, 108/656/280, relógio ou falha
      // antes de enviar devolvem sem gastar). Com tentativa gasta (queda, sem resposta, 999), pode estar na SEFAZ: fica.
      const r = await tx.sefaz_manifestacoes.updateMany({
        where: { nota_sefaz_id: nota.id, origem: 'admin', situacao: 'na_fila', tentativas: 0 },
        data: { situacao: 'cancelada', atualizada_em: agora },
      });
      return r.count;
    }, TX);
    this.logger.log(
      JSON.stringify({
        evento: 'sefaz.caixa',
        acao: 'reabrir',
        id: nota.id,
        motivo: nota.motivo_ignorar,
        ...(cancelados > 0 ? { eventos_cancelados: cancelados } : {}),
        usuario_id: quem.id,
      }),
    );
    return this.linhaDe(id, { ambiente, cnpj }, agora);
  }

  /** "Tentar de novo": o evento `falhou` mais recente da nota volta à fila com as tentativas zeradas e sai no próximo tique. */
  async responderDeNovo(id: string, quem: Quem, agora: Date = new Date()): Promise<NotaSefazLinha> {
    const { ambiente, cnpj } = await this.contexto();
    const nota = await this.achar(id, { ambiente, cnpj });
    const tp = await this.prisma.$transaction(async (tx) => {
      await this.respostas.esperarTravaEventos(tx);
      const [ultimo] = await tx.sefaz_manifestacoes.findMany({
        where: { nota_sefaz_id: nota.id, situacao: 'falhou' },
        orderBy: { atualizada_em: 'desc' },
        take: 1,
      });
      if (!ultimo) throw new ConflictException({ code: 'SEFAZ_NADA_A_REENVIAR', message: FRASE_ROTA.nadaAReenviar });
      await tx.sefaz_manifestacoes.update({
        where: { id: ultimo.id },
        data: { situacao: 'na_fila', tentativas: 0, enviar_apos: agora, atualizada_em: agora },
      });
      return ultimo.tp_evento;
    }, TX);
    this.logger.log(JSON.stringify({ evento: 'sefaz.caixa', acao: 'responder_de_novo', id: nota.id, tp_evento: tp, usuario_id: quem.id }));
    return this.linhaDe(id, { ambiente, cnpj }, agora);
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

  private async linhaDe(id: string, onde: { ambiente: AmbienteSefaz; cnpj: string | null }, agora: Date): Promise<NotaSefazLinha> {
    const nota = await this.achar(id, onde);
    return (await this.derivarLinhas(onde.ambiente, [nota], agora))[0]!.linha;
  }

  /** Carrega as linhas do (ambiente, CNPJ) e cruza com as lançadas numa consulta só. */
  private async derivar(onde: Contexto, agora: Date) {
    const notas = await this.prisma.notas_sefaz.findMany({ where: { ambiente: onde.ambiente, cnpj_destinatario: onde.cnpj } });
    return this.derivarLinhas(onde.ambiente, notas, agora);
  }

  /** Os eventos das notas (todas as situações) e o resultado dos lotes deles; null sem `SEFAZ_MANIFESTACAO=ligada`. */
  private async eventosDasNotas(notas: notas_sefaz[]): Promise<EventosDasNotas> {
    if (!this.respostas.disponivel()) return null;
    const eventos = notas.length
      ? await this.prisma.sefaz_manifestacoes.findMany({ where: { nota_sefaz_id: { in: notas.map((n) => n.id) } } })
      : [];
    const porNota = new Map<string, sefaz_manifestacoes[]>();
    for (const e of eventos) {
      const lista = porNota.get(e.nota_sefaz_id);
      if (lista) lista.push(e);
      else porNota.set(e.nota_sefaz_id, [e]);
    }
    return { porNota, resultadoDoLote: await resultadosDosLotes(this.prisma, eventos) };
  }

  private async derivarLinhas(ambiente: AmbienteSefaz, notas: notas_sefaz[], agora: Date) {
    const chaves = [...new Set(notas.map((n) => normalizarChave(n.chave)))];
    const emitentes = [...new Set(notas.map((n) => normalizarCnpj(n.emitente_cnpj)).filter(Boolean))];
    const [lancadas, eventos] = await Promise.all([this.notas.notasLancadas({ chaves, emitentes }), this.eventosDasNotas(notas)]);
    return notas.map((nota) => {
      const { lancada, parecidas } = lancamentosDaNota(nota, lancadas);
      const motivo = nota.motivo_ignorar as MotivoIgnorar | null;
      const situacao = situacaoDaNota(
        { situacao_sefaz: nota.situacao_sefaz as SituacaoSefaz, motivo_ignorar: motivo },
        { lancada: lancada !== null, parecida: parecidas.length > 0 },
      );
      let resposta: RespostaNota | null = null;
      if (eventos) {
        const daNota = eventos.porNota.get(nota.id) ?? [];
        const existentes = daNota.map((e) => eventoExistente(e, eventos.resultadoDoLote));
        resposta = respostaDaNota(notaParaPlano(nota, situacao, lancada), daNota, existentes, agora);
      }
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
        resposta,
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
