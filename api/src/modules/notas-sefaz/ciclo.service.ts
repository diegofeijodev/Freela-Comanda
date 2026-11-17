// Ciclo da busca na SEFAZ (distribuição de DF-e, só leitura): decide pela agenda, chama a porta e grava o resultado.
// Duas transações curtas sob a trava consultiva CHAVE_TRAVA_SEFAZ, com a rede FORA delas:
//   T1 (trava tentada; quem não obtém desiste): confere de novo, fecha a consulta que ficou aberta como `interrompida`, cria a
//      consulta e grava a reserva pessimista (próxima = agora + 65 min) ANTES de a pergunta sair;
//   T2 (trava que espera; depois de a SEFAZ responder nada pode desistir): grava documentos crus, fecha a consulta e aplica a agenda.
// Nada de XML, chave, PEM nem corpo de resposta em log ou erro: só ids, códigos, números e duração.
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, notas_sefaz } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { cnpjValido, normalizarCnpj } from '../../common/fiscal/cnpj';
import { horaSp } from '../../common/time/dates';
import {
  CERTIFICADO_DIGITAL,
  CertificadoErro,
  type CertificadoDigitalPort,
  type CertificadoEmUso,
} from '../certificado-digital/certificado-digital.port';
import { SEFAZ_DFE, SefazErro, type AmbienteSefaz, type RespostaDistribuicao, type SefazDfePort } from '../sefaz/distribuicao.port';
import type { CodigoFault, PassoLeitura } from '../sefaz/sefaz-erro';
import { XmlInvalido } from '../sefaz/xml-leitura';
import {
  condicoes,
  decidir,
  liberadaEm,
  ESPERA_MS,
  PAGINAS_POR_CICLO,
  type AcaoAgenda,
  type Chamada,
  type EntradaAgenda,
  type EstadoLinha,
  type ResultadoConsulta,
} from './agenda';
import { FRASE } from './frases';
import {
  aplicarNaCaixa,
  chaveDoDocumento,
  classificar,
  tipoDoSchema,
  type LinhaCaixa,
  type SituacaoSefaz,
  type TipoDocumento,
} from './classificacao';

/** Trava consultiva da busca na SEFAZ (a do certificado é 7_011_161_201). O harness `scripts/ciclo-sefaz-banco.ts` usa o mesmo número. */
export const CHAVE_TRAVA_SEFAZ = 7_011_171_201;

export type Quem = { id: string; nome: string };
export type FimCiclo = 'feito' | 'desligado' | 'nao_ligada' | 'sem_cnpj' | 'certificado' | 'aguarde' | 'ocupada';
export type ResumoCiclo = { fim: FimCiclo; paginas: number };
type Origem = 'agendada' | 'botao';

export const MSG_CICLO = {
  desligada: 'A busca de notas na SEFAZ não está ativada neste servidor.',
  semCnpj: 'Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página.',
  buscaDesligada: 'A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ.',
  ocupada: 'Já existe uma busca em andamento.',
  aguarde: (h: string) => `A SEFAZ só permite nova busca a partir de ${h}.`,
  outraEmpresa:
    'O certificado digital é de outra empresa, e a SEFAZ recusaria a busca. Confira o CNPJ da empresa ou envie o certificado certo.',
};

const DIA_MS = 24 * 60 * 60_000;
const CLASSIFICAR_POR_VEZ = 200;
/** Documento que falha na classificação esta quantidade de vezes sai da fila como descartado (senão 200 presos param a fila de vez). */
export const TENTATIVAS_CLASSIFICACAO = 3;
const TENTATIVA = /Tentativa (\d+) de \d+\.$/;
/** Falhas SEGUIDAS ao gravar a resposta da mesma página (mesmo NSU enviado) que param a busca; antes disso vale a reserva de 65 min. */
export const FALHAS_GRAVACAO_PARA = 3;
/** `erro_code` da consulta cuja resposta não pôde ser gravada (a T2 caiu). Só esta marca conta para FALHAS_GRAVACAO_PARA. */
export const ERRO_GRAVACAO = 'GRAVACAO_FALHOU';
/** Decisão 5: `anteriorEnviada` é a mais recente em que a pergunta pode ter chegado à SEFAZ (sem `falha_antes_de_enviar`). */
const ENVIADAS: ResultadoConsulta[] = ['respondida', 'sem_resposta', 'interrompida'];
const TX1 = { maxWait: 5_000, timeout: 10_000 };
const TX2 = { maxWait: 10_000, timeout: 30_000 };

const tentarTrava = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${CHAVE_TRAVA_SEFAZ}::bigint) AS ok`;
export const esperarTrava = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAVE_TRAVA_SEFAZ}::bigint)`;

/**
 * `x_motivo` de uma consulta sem retorno legível: o status HTTP, o passo em que a leitura parou e o código do SOAP Fault, só rótulos
 * de listas fechadas (ex.: "HTTP 500 · passo http · Fault VersionMismatch"); nunca o corpo da resposta. Nada disso = null.
 */
export function motivoDoErro(httpStatus?: number, passo?: PassoLeitura, fault?: CodigoFault): string | null {
  const partes = [httpStatus !== undefined ? `HTTP ${httpStatus}` : null, passo ? `passo ${passo}` : null, fault ? `Fault ${fault}` : null];
  return partes.filter((x) => x !== null).join(' · ') || null;
}

/** Classe e `code` do erro, nunca a mensagem (pode trazer texto de biblioteca, SQL ou dado). */
export function descreverErro(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? `${e.name} ${code}` : e.name;
}

type Recusa =
  | { fim: 'desligado' | 'sem_cnpj' | 'nao_ligada' | 'ocupada' }
  | { fim: 'aguarde'; liberada: Date | null }
  /** `erro` null = certificado de outra raiz de CNPJ. */
  | { fim: 'certificado'; erro: CertificadoErro | null };
type Preparo = { ambiente: AmbienteSefaz; cnpj: string; cert: CertificadoEmUso };
type Contexto = Omit<EntradaAgenda, 'agora' | 'chamada'>;
type Reserva = { consultaId: string; contexto: Contexto };

const recusou = <T extends object>(x: T | Recusa): x is Recusa => 'fim' in x;

function paraLinhaCaixa(n: notas_sefaz): LinhaCaixa {
  return {
    ambiente: n.ambiente as AmbienteSefaz,
    cnpj_destinatario: n.cnpj_destinatario,
    chave: n.chave,
    emitente_cnpj: n.emitente_cnpj,
    emitente_nome: n.emitente_nome,
    numero: n.numero,
    serie: n.serie,
    emitida_em: n.emitida_em,
    autorizada_em: n.autorizada_em,
    valor_total: n.valor_total === null ? null : n.valor_total.toString(),
    tp_nf: n.tp_nf,
    fin_nfe: n.fin_nfe,
    nat_op: n.nat_op,
    situacao_sefaz: n.situacao_sefaz as SituacaoSefaz,
    cancelada_em: n.cancelada_em,
    resumo_id: n.resumo_id,
    documento_completo_id: n.documento_completo_id,
  };
}

@Injectable()
export class CicloSefazService {
  private readonly logger = new Logger(CicloSefazService.name);
  /** Uma classificação por vez no processo (o tique e o botão podem pedir juntos): um resumo nunca corre com o cancelamento. */
  private filaClassificacao: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
    @Inject(SEFAZ_DFE) private readonly sefaz: SefazDfePort,
  ) {}

  /** Ausente, vazio ou qualquer valor fora dos dois ambientes = desligado (a validação do env já recusa valor estranho na subida). */
  ambiente(): AmbienteSefaz | 'desligado' {
    const v = this.config.get<string>('SEFAZ_DFE_AMBIENTE');
    return v === 'producao' || v === 'homologacao' ? v : 'desligado';
  }

  /** CNPJ da empresa (Configurações), normalizado e com DV conferido; senão null. */
  cnpjDaEmpresa(): Promise<string | null> {
    return this.lerCnpj(this.prisma);
  }

  private async lerCnpj(db: Pick<Prisma.TransactionClient, 'configuracoes'>): Promise<string | null> {
    const c = await db.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    const n = normalizarCnpj(c?.cnpj ?? '');
    return cnpjValido(n) ? n : null;
  }

  async ciclo(origem: Origem, quem: Quem | null, relogio: () => Date = () => new Date()): Promise<ResumoCiclo> {
    const p = await this.preparar(relogio());
    if (recusou(p)) return { fim: p.fim, paginas: 0 };
    const cicloId = randomUUID();
    const r = await this.reservar(p, origem, quem, cicloId, relogio());
    if (recusou(r)) return { fim: r.fim, paginas: 0 };
    return this.continuar(p, r, origem, quem, cicloId, relogio, { paginas: 0 });
  }

  /** Conferências e transação 1 aqui (recusa = HttpException, sem rede); a consulta e as páginas seguintes em segundo plano. */
  async buscarAgora(quem: Quem, relogio: () => Date = () => new Date()): Promise<{ iniciada: true; ciclo: Promise<ResumoCiclo> }> {
    const p = await this.preparar(relogio());
    if (recusou(p)) throw this.recusaHttp(p);
    const cicloId = randomUUID();
    const r = await this.reservar(p, 'botao', quem, cicloId, relogio());
    if (recusou(r)) throw this.recusaHttp(r);
    const feitas = { paginas: 0 };
    const ciclo = this.continuar(p, r, 'botao', quem, cicloId, relogio, feitas).catch((e: unknown): ResumoCiclo => {
      // nunca rejeita: a reserva e a consulta aberta ficam (a próxima T1 a fecha como `interrompida`)
      this.logger.error(`sefaz.distribuicao: busca interrompida por erro (${descreverErro(e)})`);
      return { fim: 'feito', paginas: feitas.paginas };
    });
    return { iniciada: true, ciclo };
  }

  /**
   * Conferências de Ligar, na ordem da `buscarAgora` (ambiente → CNPJ → certificado → raiz do CNPJ), sem olhar a agenda e sem rede.
   * Recusa = HttpException com a frase fixa. Devolve o (ambiente, CNPJ) em que a busca vai ser ligada.
   */
  async conferirParaLigar(agora: Date): Promise<{ ambiente: AmbienteSefaz; cnpj: string }> {
    const ambiente = this.ambiente();
    if (ambiente === 'desligado') throw this.recusaHttp({ fim: 'desligado' });
    const cnpj = await this.cnpjDaEmpresa();
    if (!cnpj) throw this.recusaHttp({ fim: 'sem_cnpj' });
    let cert: CertificadoEmUso;
    try {
      cert = await this.certificados.emUso(agora);
    } catch (e) {
      if (e instanceof CertificadoErro) throw this.recusaHttp({ fim: 'certificado', erro: e });
      throw e;
    }
    if (normalizarCnpj(cert.cnpj).slice(0, 8) !== cnpj.slice(0, 8)) throw this.recusaHttp({ fim: 'certificado', erro: null });
    return { ambiente, cnpj };
  }

  /** Passos 1–4: ambiente, CNPJ, linha e agenda, e só então o certificado (sem rede). */
  private async preparar(agora: Date): Promise<Preparo | Recusa> {
    const ambiente = this.ambiente();
    if (ambiente === 'desligado') return { fim: 'desligado' };
    const cnpj = await this.cnpjDaEmpresa();
    if (!cnpj) return { fim: 'sem_cnpj' };
    const linha = await this.prisma.sefaz_distribuicao.findUnique({ where: { ambiente_cnpj: { ambiente, cnpj } } });
    const parada = this.conferir(linha, agora);
    if (parada) return parada;
    let cert: CertificadoEmUso;
    try {
      cert = await this.certificados.emUso(agora);
    } catch (e) {
      if (e instanceof CertificadoErro) return { fim: 'certificado', erro: e };
      throw e;
    }
    if (normalizarCnpj(cert.cnpj).slice(0, 8) !== cnpj.slice(0, 8)) return { fim: 'certificado', erro: null };
    return { ambiente, cnpj, cert };
  }

  private conferir(linha: EstadoLinha | null, agora: Date): Recusa | null {
    const c = condicoes(linha, agora);
    if (c === 'ok') return null;
    if (c === 'aguarde') return { fim: 'aguarde', liberada: linha ? liberadaEm(linha) : null };
    return { fim: c };
  }

  private recusaHttp(r: Recusa): HttpException {
    switch (r.fim) {
      case 'desligado':
        return new ServiceUnavailableException({ code: 'SEFAZ_DESLIGADA', message: MSG_CICLO.desligada });
      case 'sem_cnpj':
        return new UnprocessableEntityException({ code: 'SEFAZ_SEM_CNPJ', message: MSG_CICLO.semCnpj });
      case 'nao_ligada':
        return new ConflictException({ code: 'SEFAZ_BUSCA_DESLIGADA', message: MSG_CICLO.buscaDesligada });
      case 'ocupada':
        return new ConflictException({ code: 'SEFAZ_OCUPADA', message: MSG_CICLO.ocupada });
      case 'aguarde':
        return new ConflictException({ code: 'SEFAZ_AGUARDE', message: MSG_CICLO.aguarde(r.liberada ? horaSp(r.liberada) : '') });
      case 'certificado':
        if (r.erro) return new HttpException({ code: r.erro.code, message: r.erro.message }, r.erro.status);
        return new UnprocessableEntityException({ code: 'SEFAZ_CERTIFICADO_OUTRA_EMPRESA', message: MSG_CICLO.outraEmpresa });
    }
  }

  /** Transação 1: trava tentada, confere tudo de novo, fecha a aberta, cria a consulta e grava a reserva de 65 min. */
  private reservar(p: Preparo, origem: Origem, quem: Quem | null, cicloId: string, agora: Date): Promise<Reserva | Recusa> {
    return this.prisma.$transaction(async (tx): Promise<Reserva | Recusa> => {
      const [trava] = await tentarTrava(tx);
      if (!trava?.ok) return { fim: 'ocupada' };
      // CNPJ trocado depois do passo 2: a linha da consulta não é mais a da empresa.
      if ((await this.lerCnpj(tx)) !== p.cnpj) return { fim: 'nao_ligada' };
      const chave = { ambiente_cnpj: { ambiente: p.ambiente, cnpj: p.cnpj } };
      const linha = await tx.sefaz_distribuicao.findUnique({ where: chave });
      const parada = this.conferir(linha, agora);
      if (parada || !linha) return parada ?? { fim: 'nao_ligada' };

      const onde = { ambiente: p.ambiente, cnpj: p.cnpj };
      await tx.sefaz_consultas.updateMany({
        where: { ...onde, resultado: null },
        data: { resultado: 'interrompida', terminada_em: agora },
      });
      // Contexto da agenda (Decisão 5), lido antes de criar a consulta nova.
      const anterior = await tx.sefaz_consultas.findFirst({
        where: { ...onde, resultado: { in: ENVIADAS } },
        orderBy: { iniciada_em: 'desc' },
      });
      const recentes = await tx.sefaz_consultas.findMany({ where: onde, orderBy: { iniciada_em: 'desc' }, take: 10 });
      let semRespostaSeguidas = 0;
      for (const c of recentes) {
        if (c.resultado !== 'sem_resposta') break;
        semRespostaSeguidas++;
      }
      const vezes656Em24h = await tx.sefaz_consultas.count({
        where: { ...onde, c_stat: 656, iniciada_em: { gte: new Date(agora.getTime() - DIA_MS) } },
      });

      const consulta = await tx.sefaz_consultas.create({
        data: {
          ciclo_id: cicloId,
          ...onde,
          origem,
          iniciada_por: quem?.id ?? null,
          iniciada_por_nome: quem?.nome ?? null,
          ult_nsu_enviado: linha.ult_nsu,
          iniciada_em: agora,
        },
      });
      const reservaAte = new Date(agora.getTime() + ESPERA_MS);
      await tx.sefaz_distribuicao.update({
        where: chave,
        data: { em_andamento_desde: agora, proxima_consulta_em: reservaAte },
      });
      return {
        consultaId: consulta.id,
        contexto: {
          ultNsuNosso: linha.ult_nsu,
          primeiraConsulta: linha.ultima_consulta_em === null,
          anteriorEnviada: (anterior?.resultado as ResultadoConsulta | undefined) ?? null,
          falhasSeguidas: linha.falhas_seguidas,
          semRespostaSeguidas,
          vezes656Em24h,
          reservaAte,
        },
      };
    }, TX1);
  }

  /** Rede → T2 → log → classificação; continua só com 138 e ultNSU < maxNSU, até 10 páginas e enquanto a T1 deixar. */
  private async continuar(
    p: Preparo,
    primeira: Reserva,
    origem: Origem,
    quem: Quem | null,
    cicloId: string,
    relogio: () => Date,
    feitas: { paginas: number },
  ): Promise<ResumoCiclo> {
    let reserva = primeira;
    for (;;) {
      feitas.paginas++;
      const acao = await this.pagina(p, reserva, origem, relogio);
      await this.classificarPendentes();
      if (!acao.maisPaginas || feitas.paginas >= PAGINAS_POR_CICLO) break;
      const proxima = await this.reservar(p, origem, quem, cicloId, relogio());
      if (recusou(proxima)) break; // busca desligada, CNPJ trocado ou trava: a página seguinte não sai
      reserva = proxima;
    }
    return { fim: 'feito', paginas: feitas.paginas };
  }

  private async pagina(p: Preparo, r: Reserva, origem: Origem, relogio: () => Date): Promise<AcaoAgenda> {
    const inicio = Date.now();
    let resp: RespostaDistribuicao | null = null;
    let erro: Extract<Chamada, { tipo: 'erro' }> | null = null;
    let causa: string | null = null; // só o `code` do Node, só para o log (nem banco nem agenda)
    let diagnostico: { passo?: PassoLeitura; fault?: CodigoFault } = {}; // rótulos fechados: banco (x_motivo) e log, nunca a agenda
    try {
      resp = await this.sefaz.distribuirPorNsu(p.cert, p.ambiente, p.cnpj, r.contexto.ultNsuNosso);
    } catch (e) {
      if (e instanceof SefazErro) {
        causa = e.causa ?? null;
        diagnostico = { passo: e.passo, fault: e.fault };
      }
      erro =
        e instanceof SefazErro
          ? { tipo: 'erro', code: e.code, enviado: e.enviado, httpStatus: e.httpStatus }
          : { tipo: 'erro', code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true };
    }
    const duracaoMs = Date.now() - inicio;
    const chamada: Chamada = resp
      ? { tipo: 'retorno', cStat: resp.cStat, ultNsu: resp.ultNsu, maxNsu: resp.maxNsu, documentos: resp.documentos.length }
      : erro!;
    const agora = relogio();
    const acao = decidir({ ...r.contexto, agora, chamada });

    const t2 = this.prisma.$transaction(async (tx) => {
      await esperarTrava(tx);
      const onde = { ambiente: p.ambiente, cnpj: p.cnpj };
      if (resp && resp.documentos.length > 0) {
        // Só texto e números: o XML é interpretado depois, na classificação (nada pode falhar aqui por causa dele).
        await tx.sefaz_documentos.createMany({
          data: resp.documentos.map((d) => ({
            ...onde,
            nsu: d.nsu,
            schema: d.schema,
            tipo: d.xml === null ? 'ilegivel' : tipoDoSchema(d.schema),
            xml: d.xml,
            conteudo_bruto: d.xml === null ? d.bruto : null,
            consulta_id: r.consultaId,
            recebido_em: agora,
          })),
          skipDuplicates: true,
        });
      }
      await tx.sefaz_consultas.update({
        where: { id: r.consultaId },
        data: {
          terminada_em: agora,
          resultado: acao.resultado,
          c_stat: resp?.cStat ?? null,
          x_motivo: resp ? resp.xMotivo.slice(0, 255) : motivoDoErro(erro?.httpStatus, diagnostico.passo, diagnostico.fault),
          dh_resp: resp ? resp.dhResp.slice(0, 40) : null,
          ult_nsu: resp?.ultNsu ?? null,
          max_nsu: resp?.maxNsu ?? null,
          documentos: resp ? resp.documentos.length : null,
          erro_code: erro?.code ?? null,
        },
      });
      const parada = acao.situacao !== 'ok';
      const respondeu = resp !== null && (resp.cStat === 137 || resp.cStat === 138);
      // A linha da PRÓPRIA consulta, mesmo que a busca tenha sido desligada ou o CNPJ trocado no meio (Review Focus 2).
      // `busca_ligada` só é escrito para desligar: nunca religa o que o admin desligou durante a consulta.
      await tx.sefaz_distribuicao.update({
        where: { ambiente_cnpj: onde },
        data: {
          ult_nsu: acao.ultNsu,
          proxima_consulta_em: acao.proximaConsultaEm,
          falhas_seguidas: acao.falhasSeguidas,
          situacao: acao.situacao,
          mensagem: acao.mensagem,
          em_andamento_desde: null,
          ...(acao.maxNsu !== null ? { max_nsu: acao.maxNsu } : {}),
          ...(acao.bloqueadoAte !== null ? { bloqueado_ate: acao.bloqueadoAte } : {}),
          ...(acao.aviso !== null ? { aviso: acao.aviso } : {}),
          ...(respondeu ? { ultima_consulta_em: agora } : {}),
          // "Primeira busca feita" (painel) só depois da 1ª resposta 137/138, nunca de uma tentativa que falhou
          ...(respondeu && r.contexto.primeiraConsulta ? { primeira_consulta_em: agora } : {}),
          ...(parada ? { busca_ligada: false } : {}),
        },
      });
      if (parada) {
        await tx.sefaz_distribuicao_historico.create({
          data: {
            ...onde,
            evento: 'parada_automatica',
            situacao: acao.situacao,
            c_stat: resp?.cStat ?? null,
            mensagem: acao.mensagem,
            feito_em: agora,
          },
        });
      }
      if (acao.lacuna) {
        const { nsuDe, nsuAte, causa } = acao.lacuna;
        // `sefaz_lacunas` não tem unicidade: confere antes, sob a trava, para uma nova tentativa não duplicar.
        const ja = await tx.sefaz_lacunas.findMany({ where: { ...onde, nsu_de: nsuDe, nsu_ate: nsuAte } });
        if (ja.length === 0) {
          await tx.sefaz_lacunas.create({
            data: { ...onde, nsu_de: nsuDe, nsu_ate: nsuAte, causa, consulta_id: r.consultaId, detectada_em: agora },
          });
        }
      }
    }, TX2);
    await t2.catch(async (e: unknown) => {
      await this.gravacaoFalhou(p, r, resp?.cStat ?? null, agora);
      throw e; // como antes: quem chamou registra e a página seguinte não sai
    });

    this.logger.log(
      JSON.stringify({
        evento: 'sefaz.distribuicao',
        origem,
        ambiente: p.ambiente,
        consulta_id: r.consultaId,
        resultado: acao.resultado,
        c_stat: resp?.cStat ?? null,
        erro_code: erro?.code ?? null,
        http_status: erro?.httpStatus ?? null,
        causa,
        passo: diagnostico.passo ?? null,
        fault: diagnostico.fault ?? null,
        documentos: resp?.documentos.length ?? 0,
        ult_nsu: resp?.ultNsu?.toString() ?? null,
        max_nsu: resp?.maxNsu?.toString() ?? null,
        situacao: acao.situacao,
        alerta: acao.alerta,
        duracao_ms: duracaoMs,
      }),
    );
    return acao;
  }

  /**
   * A T2 caiu e foi desfeita (nada da resposta ficou gravado). A consulta ganha a marca `erro_code` = ERRO_GRAVACAO e, nas 2 primeiras
   * vezes, nada mais muda: vale a reserva de 65 min da T1 e a próxima T1 fecha a consulta como `interrompida`. Na 3ª seguida com o
   * mesmo NSU (as 2 consultas imediatamente anteriores `interrompida` COM a marca e o mesmo `ult_nsu_enviado`), a mesma página
   * falharia para sempre: a busca para (desligada, `parada_configuracao`, histórico). Uma `interrompida` sem a marca (queda da API no
   * meio da consulta) não é falha de gravação e quebra a sequência. Religar ("Ligar a busca") zera a contagem: só contam as consultas
   * iniciadas depois do último `ligada` do histórico. Não mexe em NSU, próxima consulta nem bloqueio. Nunca lança.
   */
  private async gravacaoFalhou(p: Preparo, r: Reserva, cStat: number | null, agora: Date): Promise<void> {
    try {
      const parou = await this.prisma.$transaction(async (tx) => {
        await esperarTrava(tx);
        const onde = { ambiente: p.ambiente, cnpj: p.cnpj };
        await tx.sefaz_consultas.update({ where: { id: r.consultaId }, data: { erro_code: ERRO_GRAVACAO } });
        const [ligada] = await tx.sefaz_distribuicao_historico.findMany({
          where: { ...onde, evento: 'ligada' },
          orderBy: { feito_em: 'desc' },
          take: 1,
        });
        const recentes = await tx.sefaz_consultas.findMany({ where: onde, orderBy: { iniciada_em: 'desc' }, take: 10 });
        let seguidas = 1; // esta
        for (const c of recentes) {
          if (c.id === r.consultaId) continue;
          if (ligada && c.iniciada_em < ligada.feito_em) break; // de antes do último "Ligar": religar zera
          if (c.resultado !== 'interrompida' || c.erro_code !== ERRO_GRAVACAO || c.ult_nsu_enviado !== r.contexto.ultNsuNosso) break;
          if (++seguidas >= FALHAS_GRAVACAO_PARA) break;
        }
        if (seguidas < FALHAS_GRAVACAO_PARA) return false;
        await tx.sefaz_consultas.update({ where: { id: r.consultaId }, data: { resultado: 'interrompida', terminada_em: agora } });
        await tx.sefaz_distribuicao.update({
          where: { ambiente_cnpj: onde },
          data: { busca_ligada: false, situacao: 'parada_configuracao', mensagem: FRASE.gravacaoFalhou, em_andamento_desde: null },
        });
        await tx.sefaz_distribuicao_historico.create({
          data: {
            ...onde,
            evento: 'parada_automatica',
            situacao: 'parada_configuracao',
            c_stat: cStat,
            mensagem: FRASE.gravacaoFalhou,
            feito_em: agora,
          },
        });
        return true;
      }, TX1);
      if (parou) {
        this.logger.warn(
          JSON.stringify({
            evento: 'sefaz.distribuicao',
            consulta_id: r.consultaId,
            situacao: 'parada_configuracao',
            alerta: 'gravacao_falhou_3x',
          }),
        );
      }
    } catch (e) {
      this.logger.error(`sefaz.distribuicao: não consegui conferir as falhas de gravação (${descreverErro(e)})`);
    }
  }

  /**
   * Classifica até `limite` documentos com `processado_em` vazio, um por transação; devolve quantos foram processados.
   * Falha = fica pendente com "Tentativa N de 3." em `erro_processamento`; na 3ª, `processado_em` é preenchido e o motivo fica como
   * "Descartado depois de 3 tentativas: …" (o XML continua guardado; para tentar de novo, limpar `processado_em` e `erro_processamento`).
   */
  classificarPendentes(limite: number = CLASSIFICAR_POR_VEZ): Promise<number> {
    const vez = this.filaClassificacao.then(() => this.classificarAgora(limite));
    this.filaClassificacao = vez.catch(() => undefined);
    return vez;
  }

  private async classificarAgora(limite: number): Promise<number> {
    const docs = await this.prisma.sefaz_documentos.findMany({
      where: { processado_em: null },
      orderBy: [{ ambiente: 'asc' }, { cnpj: 'asc' }, { nsu: 'asc' }],
      take: limite,
    });
    let processados = 0;
    for (const d of docs) {
      const agora = new Date();
      try {
        // classificação pura com o (ambiente, CNPJ) do PRÓPRIO documento, não o da empresa de agora
        const c = classificar({ tipo: d.tipo as TipoDocumento, xml: d.xml }, d.cnpj);
        const marca = chaveDoDocumento(c);
        await this.prisma.$transaction(async (tx) => {
          const atual = marca.chave
            ? await tx.notas_sefaz.findUnique({ where: { ambiente_chave: { ambiente: d.ambiente, chave: marca.chave } } })
            : null;
          const op = aplicarNaCaixa(atual ? paraLinhaCaixa(atual) : null, c, d.id, {
            ambiente: d.ambiente as AmbienteSefaz,
            cnpj_destinatario: d.cnpj,
          });
          if (op && 'criar' in op) {
            await tx.notas_sefaz.create({ data: { ...op.criar, criada_em: agora, atualizada_em: agora } });
          } else if (op && atual) {
            // `atualizada_em` não tem @updatedAt nem gatilho: quem grava preenche.
            await tx.notas_sefaz.update({ where: { id: atual.id }, data: { ...op.atualizar, atualizada_em: agora } });
          }
          await tx.sefaz_documentos.update({
            where: { id: d.id },
            data: {
              chave: marca.chave,
              tp_evento: marca.tp_evento !== null && marca.tp_evento.length <= 6 ? marca.tp_evento : null,
              processado_em: agora,
              erro_processamento: null,
            },
          });
        });
        processados++;
      } catch (e) {
        // Pendente até a 3ª falha, depois descartado. A contagem mora na frase gravada: só conta a falha que o banco registrou
        // (banco fora do ar não descarta nada). A frase é fixa (nunca a mensagem da biblioteca).
        const frase = e instanceof XmlInvalido ? 'XML inválido.' : `Não foi possível classificar (${descreverErro(e)}).`;
        const tentativa = Number(TENTATIVA.exec(d.erro_processamento ?? '')?.[1] ?? 0) + 1;
        const descartado = tentativa >= TENTATIVAS_CLASSIFICACAO;
        await this.prisma.sefaz_documentos
          .update({
            where: { id: d.id },
            data: descartado
              ? { processado_em: agora, erro_processamento: `Descartado depois de ${tentativa} tentativas: ${frase}` }
              : { erro_processamento: `${frase} Tentativa ${tentativa} de ${TENTATIVAS_CLASSIFICACAO}.` },
          })
          .catch(() => undefined);
        this.logger.warn(
          JSON.stringify({
            evento: 'sefaz.classificacao',
            documento_id: d.id,
            nsu: d.nsu.toString(),
            erro: descreverErro(e),
            tentativa,
            descartado,
          }),
        );
      }
    }
    return processados;
  }
}
