// Fila das respostas à SEFAZ (eventos da manifestação do destinatário): a cada tique do agendador, confere tudo sem rede, aplica o
// planejador, monta e assina UM lote de até 20 eventos, envia FORA de transação e grava o resultado pela decisão do lote
// (respostas-agenda.ts). O mesmo padrão do ciclo da busca, com trava consultiva própria (CHAVE_TRAVA_SEFAZ_EVENTOS):
//   T1 (trava tentada; quem não obtém desiste): fecha como `interrompida` o lote que ficou aberto e devolve os eventos dele à fila;
//      aplica o planejador (cria os automáticos, cancela as ciências que deixaram de servir); escolhe até 20 pela ordem de envio;
//      assina cada um e grava `enviando` + XML + `tentativas + 1` + lote ANTES de a rede sair;
//   T2 (trava que espera; depois de a SEFAZ responder nada pode desistir): aplica `decidirLote`, grava o retorno de cada evento
//      (desfazendo o +1 de quem não gastou) e fecha o lote.
// Nunca em laço: um lote por tique, nenhuma repetição imediata. Log `sefaz.eventos` só com ids, códigos, contagens e duração:
// nunca XML, chave de acesso nem protocolo.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, notas_sefaz, sefaz_eventos_lotes, sefaz_manifestacao, sefaz_manifestacoes } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { normalizarChave } from '../../common/fiscal/chave-acesso';
import { normalizarCnpj } from '../../common/fiscal/cnpj';
import {
  CERTIFICADO_DIGITAL,
  CertificadoErro,
  type CertificadoDigitalPort,
  type CertificadoEmUso,
} from '../certificado-digital/certificado-digital.port';
import { NotasService } from '../notas/notas.service';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { SEFAZ_EVENTOS, type RespostaLoteEventos, type RetornoEvento, type SefazEventosPort, type TipoEvento } from '../sefaz/eventos.port';
import { dhSefaz, eventoAssinado } from '../sefaz/eventos-xml';
import { SefazErro, type CodigoFault, type PassoLeitura } from '../sefaz/sefaz-erro';
import { EM_ANDAMENTO_MAX_MS } from './agenda';
import { CicloSefazService, descreverErro, motivoDoErro } from './ciclo.service';
import type { SituacaoSefaz } from './classificacao';
import {
  decidirLote,
  derivaRelogio,
  DERIVA_MAX_MS,
  LOTE_MAX,
  TENTATIVAS_MAX,
  type ChamadaLote,
  type DecisaoLote,
  type EntradaLote,
  type EstadoEvento,
} from './respostas-agenda';
import { ordemDeEnvio, planejar, PRAZO_FINAL_DIAS, type EventoExistente, type NotaParaPlano, type OrigemEvento } from './respostas-plano';
import { lancamentosDaNota, situacaoDaNota, type MotivoIgnorar } from './situacao-nota';

/** Trava consultiva das respostas à SEFAZ (a da busca é 7_011_171_201; a do certificado, 7_011_161_201). */
export const CHAVE_TRAVA_SEFAZ_EVENTOS = 7_011_171_202;

export type FimRespostas =
  'feito' | 'indisponivel' | 'nao_ligadas' | 'parada' | 'pausa' | 'sem_cnpj' | 'certificado' | 'relogio' | 'ocupada' | 'vazia';
export type ResumoRespostas = { fim: FimRespostas; enviados: number };

/**
 * `erro_code` do lote em que algum evento voltou 577–579 (relógio): a próxima T1 lê no último lote fechado e o 2º seguido para.
 * O 656 de um evento dentro de um 128 vai como `c_stat` = 656 do lote (conta no "2º 656 em 24 h" junto com o 656 do lote).
 */
export const ERRO_RELOGIO = 'RELOGIO';
/** `erro_code` do lote que não saiu por erro que não é `SefazErro` (ex.: a montagem do corpo recusou o lote): falha ANTES de enviar. */
export const ERRO_LOCAL = 'ERRO_LOCAL';

const DIA_MS = 24 * 60 * 60_000;
/** Lotes em que o pedido pode ter chegado à SEFAZ (`falha_antes_de_enviar` nunca saiu). */
const LOTE_SAIU: ReadonlySet<string> = new Set(['respondida', 'sem_resposta', 'interrompida']);
/** Sem `ligada_em` não há base para a confirmação automática: nenhuma nota é "lançada depois de ligar". */
const NUNCA = new Date(8.64e15);
const TX1 = { maxWait: 5_000, timeout: 15_000 };
const TX2 = { maxWait: 10_000, timeout: 30_000 };

const tentarTrava = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${CHAVE_TRAVA_SEFAZ_EVENTOS}::bigint) AS ok`;

type Recusa = { fim: Exclude<FimRespostas, 'feito'> };
type Preparo = { ambiente: AmbienteSefaz; cnpj: string; cert: CertificadoEmUso };
type EventoDoLote = { id: string; chave: string; tpEvento: TipoEvento; tentativas: number; xml: string };
type Montado = {
  loteId: string;
  idLote: bigint;
  eventos: EventoDoLote[];
  contexto: Pick<EntradaLote, 'falhasSeguidas' | 'semRespostaSeguidas' | 'vezes656Em24h' | 'relogioNoLoteAnterior'>;
};

const recusou = <T extends object>(x: T | Recusa): x is Recusa => 'fim' in x;

/** Linha das respostas: ligada, `ok` e fora da pausa; senão o motivo. */
function conferirLinha(l: sefaz_manifestacao | null, agora: Date): Recusa | null {
  if (!l || !l.ligada) return { fim: 'nao_ligadas' };
  if (l.situacao !== 'ok') return { fim: 'parada' };
  if (l.pausa_ate && agora < l.pausa_ate) return { fim: 'pausa' };
  return null;
}

/** `cStat` que cabe no CHECK da coluna (100–9999); o leitor aceita "000"–"099", que o banco recusaria e derrubaria a T2. */
const cStatGravavel = (c: number | null): number | null => (c !== null && c >= 100 && c <= 9999 ? c : null);

@Injectable()
export class RespostasSefazService {
  private readonly logger = new Logger(RespostasSefazService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ciclo: CicloSefazService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
    @Inject(SEFAZ_EVENTOS) private readonly eventos: SefazEventosPort,
    private readonly notas: NotasService,
  ) {}

  /** `SEFAZ_MANIFESTACAO = 'ligada'` e ambiente da busca ≠ `desligado` (os eventos usam o mesmo ambiente). */
  disponivel(): boolean {
    return this.config.get<string>('SEFAZ_MANIFESTACAO') === 'ligada' && this.ciclo.ambiente() !== 'desligado';
  }

  /** Trava que espera (`pg_advisory_xact_lock`), para quem escreve na fila fora do tique (rotas da Task 7) e para a T2. */
  esperarTravaEventos(tx: Prisma.TransactionClient): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAVE_TRAVA_SEFAZ_EVENTOS}::bigint)`;
  }

  /** Um tique: no máximo UM lote. Recusa = o motivo, sem rede; erro de banco na T1 ou na T2 sobe para o agendador (que só registra). */
  async processar(relogio: () => Date = () => new Date()): Promise<ResumoRespostas> {
    const p = await this.preparar(relogio());
    if (recusou(p)) return { fim: p.fim, enviados: 0 };
    const m = await this.montar(p, relogio());
    if (m.interrompidos > 0) {
      this.logger.warn(
        JSON.stringify({ evento: 'sefaz.eventos', ambiente: p.ambiente, alerta: 'lote_interrompido', eventos: m.interrompidos }),
      );
    }
    if (recusou(m.lote)) return { fim: m.lote.fim, enviados: 0 };
    await this.enviar(p, m.lote, relogio);
    return { fim: 'feito', enviados: m.lote.eventos.length };
  }

  /** Condições sem rede, nesta ordem: disponível → CNPJ → linha ligada e `ok` → pausa → relógio → certificado (e a raiz do CNPJ). */
  private async preparar(agora: Date): Promise<Preparo | Recusa> {
    if (!this.disponivel()) return { fim: 'indisponivel' };
    const ambiente = this.ciclo.ambiente() as AmbienteSefaz;
    const cnpj = await this.ciclo.cnpjDaEmpresa();
    if (!cnpj) return { fim: 'sem_cnpj' };
    const linha = await this.prisma.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: { ambiente, cnpj } } });
    const parada = conferirLinha(linha, agora);
    if (parada) return parada;
    if (await this.relogioFora(ambiente, agora)) return { fim: 'relogio' };
    let cert: CertificadoEmUso;
    try {
      cert = await this.certificados.emUso(agora);
    } catch (e) {
      if (e instanceof CertificadoErro) return { fim: 'certificado' };
      throw e;
    }
    if (normalizarCnpj(cert.cnpj).slice(0, 8) !== cnpj.slice(0, 8)) return { fim: 'certificado' };
    return { ambiente, cnpj, cert };
  }

  /**
   * A última consulta respondida da busca nas 24 h (do ambiente: o relógio é do servidor, não do CNPJ) com |dhResp − terminada_em|
   * acima de 2 min = não envia (a SEFAZ tolera 5). Sem consulta, ou com `dh_resp` ilegível, não confere.
   */
  private async relogioFora(ambiente: AmbienteSefaz, agora: Date): Promise<boolean> {
    const c = await this.prisma.sefaz_consultas.findFirst({
      where: { ambiente, resultado: 'respondida', terminada_em: { gte: new Date(agora.getTime() - DIA_MS) } },
      orderBy: { terminada_em: 'desc' },
    });
    const deriva = c ? derivaRelogio(c.dh_resp, c.terminada_em) : null;
    return deriva !== null && deriva > DERIVA_MAX_MS;
  }

  /** T1: trava tentada, confere a linha de novo, fecha o lote aberto, planeja, escolhe até 20, assina e grava `enviando`. */
  private montar(p: Preparo, agora: Date): Promise<{ lote: Montado | Recusa; interrompidos: number }> {
    return this.prisma.$transaction(async (tx) => {
      let interrompidos = 0;
      const fim = (r: Recusa) => ({ lote: r, interrompidos });
      const [trava] = await tentarTrava(tx);
      if (!trava?.ok) return fim({ fim: 'ocupada' });
      const onde = { ambiente: p.ambiente, cnpj: p.cnpj };
      const linha = await tx.sefaz_manifestacao.findUnique({ where: { ambiente_cnpj: onde } });
      const parada = conferirLinha(linha, agora);
      if (parada || !linha) return fim(parada ?? { fim: 'nao_ligadas' });

      // Lote aberto há pouco = outro processo no meio do envio (a T2 dele ainda vem): não mexe. Mais velho = a API caiu entre a T1 e a
      // T2: o lote vira `interrompida` e os eventos voltam à fila com a tentativa mantida (pode ter chegado à SEFAZ; o reenvio volta 573).
      const abertos = await tx.sefaz_eventos_lotes.findMany({ where: { ...onde, resultado: null } });
      if (abertos.some((l) => agora.getTime() - l.iniciado_em.getTime() <= EM_ANDAMENTO_MAX_MS)) return fim({ fim: 'ocupada' });
      for (const l of abertos) interrompidos += await this.interromper(tx, l, agora);

      // Contexto da decisão do lote, lido depois de fechar os abertos.
      const recentes = await tx.sefaz_eventos_lotes.findMany({ where: onde, orderBy: { iniciado_em: 'desc' }, take: 10 });
      let semRespostaSeguidas = 0;
      for (const l of recentes) {
        if (l.resultado !== 'sem_resposta') break;
        semRespostaSeguidas++;
      }
      const vezes656Em24h = await tx.sefaz_eventos_lotes.count({
        where: { ...onde, c_stat: 656, iniciado_em: { gte: new Date(agora.getTime() - DIA_MS) } },
      });
      const contexto: Montado['contexto'] = {
        falhasSeguidas: linha.falhas_seguidas,
        semRespostaSeguidas,
        vezes656Em24h,
        relogioNoLoteAnterior: recentes[0]?.erro_code === ERRO_RELOGIO,
      };

      const notas = await this.planejarNaFila(tx, p, linha, agora);

      // A fila: tudo `na_fila` já liberado, inclusive a ciência JÁ ENVIADA de nota que deixou de ser elegível (sem resposta, ela ficaria
      // para sempre na fila). As ciências que nunca saíram e deixaram de servir já foram canceladas pelo planejador.
      const fila = await tx.sefaz_manifestacoes.findMany({ where: { ...onde, situacao: 'na_fila', enviar_apos: { lte: agora } } });
      const baseDe = (id: string) => {
        const n = notas.get(id);
        return n ? (n.autorizada_em ?? n.emitida_em) : null;
      };
      const escolhidos = ordemDeEnvio(
        fila.map((e) => ({ ...e, tp_evento: e.tp_evento as TipoEvento, base: baseDe(e.nota_sefaz_id) })),
      ).slice(0, LOTE_MAX);
      if (escolhidos.length === 0) return fim({ fim: 'vazia' });

      // O lote antes dos eventos (a chave estrangeira `lote_id` é imediata). idLote = milissegundos do relógio (13 dígitos).
      const idLote = BigInt(agora.getTime());
      const lote = await tx.sefaz_eventos_lotes.create({
        data: { ...onde, id_lote: idLote, iniciado_em: agora, eventos: escolhidos.length },
      });
      const dhEvento = dhSefaz(agora);
      const eventos: EventoDoLote[] = [];
      for (const e of escolhidos) {
        const xml = eventoAssinado(
          { ambiente: p.ambiente, cnpjAutor: p.cnpj, chave: e.chave, tpEvento: e.tp_evento, dhEvento, xJust: e.x_just },
          p.cert,
        );
        const tentativas = e.tentativas + 1;
        await tx.sefaz_manifestacoes.update({
          where: { id: e.id },
          data: {
            situacao: 'enviando',
            dh_evento: dhEvento,
            xml_evento: xml,
            impressao_digital: p.cert.impressaoDigital,
            tentativas,
            lote_id: lote.id,
            atualizada_em: agora,
          },
        });
        eventos.push({ id: e.id, chave: e.chave, tpEvento: e.tp_evento, tentativas, xml });
      }
      return { lote: { loteId: lote.id, idLote, eventos, contexto }, interrompidos };
    }, TX1);
  }

  /** Fecha o lote como `interrompida`; os eventos dele voltam à fila com a tentativa mantida (na 3ª, `falhou`: o CHECK é 0–3). */
  private async interromper(tx: Prisma.TransactionClient, l: sefaz_eventos_lotes, agora: Date): Promise<number> {
    await tx.sefaz_eventos_lotes.update({ where: { id: l.id }, data: { resultado: 'interrompida', terminado_em: agora } });
    const presos = await tx.sefaz_manifestacoes.findMany({ where: { lote_id: l.id, situacao: 'enviando' } });
    for (const e of presos) {
      const situacao: EstadoEvento = e.tentativas >= TENTATIVAS_MAX ? 'falhou' : 'na_fila';
      await tx.sefaz_manifestacoes.update({ where: { id: e.id }, data: { situacao, atualizada_em: agora } });
    }
    return presos.length;
  }

  /**
   * O planejador dentro da T1: as notas do (ambiente, CNPJ) no prazo de 90 dias MAIS toda nota com evento na fila (senão a ciência que
   * deixou de servir nunca é cancelada), todos os eventos delas em toda situação (um único parcial violado aborta a T1 inteira) e as
   * lançadas pela chave (preenchida também na nota ignorada). Cria os automáticos e cancela as ciências na fila que nunca saíram.
   * Devolve as notas lidas, por id (a base da ordem de envio).
   */
  private async planejarNaFila(
    tx: Prisma.TransactionClient,
    p: Preparo,
    linha: sefaz_manifestacao,
    agora: Date,
  ): Promise<Map<string, notas_sefaz>> {
    const naFila = await tx.sefaz_manifestacoes.findMany({ where: { ambiente: p.ambiente, cnpj: p.cnpj, situacao: 'na_fila' } });
    const limite = new Date(agora.getTime() - PRAZO_FINAL_DIAS * DIA_MS);
    const lidas = await tx.notas_sefaz.findMany({
      where: {
        ambiente: p.ambiente,
        cnpj_destinatario: p.cnpj,
        OR: [
          { autorizada_em: { gte: limite } },
          { emitida_em: { gte: limite } },
          { id: { in: [...new Set(naFila.map((e) => e.nota_sefaz_id))] } },
        ],
      },
    });
    const notas = new Map(lidas.map((n) => [n.id, n]));
    if (lidas.length === 0) return notas;

    const eventos = await tx.sefaz_manifestacoes.findMany({ where: { nota_sefaz_id: { in: [...notas.keys()] } } });
    const loteIds = [...new Set(eventos.map((e) => e.lote_id).filter((x): x is string => x !== null))];
    const lotes = loteIds.length ? await tx.sefaz_eventos_lotes.findMany({ where: { id: { in: loteIds } } }) : [];
    const resultadoDoLote = new Map(lotes.map((l) => [l.id, l.resultado]));
    // Já saiu para a SEFAZ: gastou tentativa, ou o lote dele pode ter chegado lá. Uma falha ANTES de enviar não conta (a T2 desfaz o +1).
    const jaEnviada = (e: sefaz_manifestacoes) =>
      e.tentativas > 0 || (e.lote_id !== null && LOTE_SAIU.has(resultadoDoLote.get(e.lote_id) ?? ''));

    const lancadas = await this.notas.notasLancadas({
      chaves: [...new Set(lidas.map((n) => normalizarChave(n.chave)))],
      emitentes: [...new Set(lidas.map((n) => normalizarCnpj(n.emitente_cnpj)).filter(Boolean))],
    });
    const paraPlano: NotaParaPlano[] = lidas.map((n) => {
      const { lancada, parecidas } = lancamentosDaNota(n, lancadas);
      return {
        id: n.id,
        situacao: situacaoDaNota(
          { situacao_sefaz: n.situacao_sefaz as SituacaoSefaz, motivo_ignorar: n.motivo_ignorar as MotivoIgnorar | null },
          { lancada: lancada !== null, parecida: parecidas.length > 0 },
        ),
        situacao_sefaz: n.situacao_sefaz as SituacaoSefaz,
        tp_nf: n.tp_nf,
        autorizada_em: n.autorizada_em,
        emitida_em: n.emitida_em,
        tem_xml_completo: n.documento_completo_id !== null,
        lancada_pela_chave_em: lancada ? new Date(lancada.created_at) : null,
      };
    });
    const existentes: EventoExistente[] = eventos.map((e) => ({
      nota_sefaz_id: e.nota_sefaz_id,
      tp_evento: e.tp_evento as TipoEvento,
      situacao: e.situacao as EstadoEvento,
      origem: e.origem as OrigemEvento,
      pedida_em: e.pedida_em,
      ja_enviada: jaEnviada(e),
    }));
    const plano = planejar(paraPlano, existentes, linha.ligada_em ?? NUNCA, agora);

    const cancelar = new Set(plano.cancelarCiencias);
    const ciencias = eventos
      .filter((e) => cancelar.has(e.nota_sefaz_id) && e.tp_evento === '210210' && e.situacao === 'na_fila' && !jaEnviada(e))
      .map((e) => e.id);
    if (ciencias.length > 0) {
      await tx.sefaz_manifestacoes.updateMany({
        where: { id: { in: ciencias }, tp_evento: '210210', situacao: 'na_fila' },
        data: { situacao: 'cancelada', atualizada_em: agora },
      });
    }
    for (const c of plano.criar) {
      const n = notas.get(c.nota_sefaz_id)!;
      await tx.sefaz_manifestacoes.create({
        data: {
          nota_sefaz_id: n.id,
          ambiente: p.ambiente,
          cnpj: p.cnpj,
          chave: n.chave,
          tp_evento: c.tp_evento,
          n_seq: 1,
          origem: c.origem,
          pedida_em: agora,
          enviar_apos: agora,
          situacao: 'na_fila',
          tentativas: 0,
          criada_em: agora,
          atualizada_em: agora,
        },
      });
    }
    return notas;
  }

  /** Rede (fora de transação) → decisão → T2 → log. */
  private async enviar(p: Preparo, m: Montado, relogio: () => Date): Promise<void> {
    const inicio = Date.now();
    let resp: RespostaLoteEventos | null = null;
    let erro: Extract<ChamadaLote, { tipo: 'erro' }> | null = null;
    let erroCode: string | null = null;
    let causa: string | null = null; // só o `code` do Node ou a classe do erro, só para o log
    let diagnostico: { passo?: PassoLeitura; fault?: CodigoFault } = {};
    try {
      resp = await this.eventos.enviarLote(
        p.cert,
        p.ambiente,
        m.idLote,
        m.eventos.map((e) => e.xml),
      );
    } catch (e) {
      if (e instanceof SefazErro) {
        erro = { tipo: 'erro', code: e.code, enviado: e.enviado, httpStatus: e.httpStatus, fault: e.fault };
        erroCode = e.code;
        causa = e.causa ?? null;
        diagnostico = { passo: e.passo, fault: e.fault };
      } else {
        // A porta promete SefazErro; outro erro vem da montagem do corpo, antes de a rede sair: ninguém gasta tentativa.
        erro = { tipo: 'erro', code: 'SEFAZ_REDE', enviado: false };
        erroCode = ERRO_LOCAL;
        causa = descreverErro(e);
      }
    }
    const duracaoMs = Date.now() - inicio;
    const chamada: ChamadaLote = resp
      ? {
          tipo: 'retorno',
          cStat: resp.cStat,
          retornos: resp.retornos.map((r) => ({ chave: r.chave, tpEvento: r.tpEvento, nSeq: r.nSeq, cStat: r.cStat, nProt: r.nProt })),
        }
      : erro!;
    const agora = relogio();
    const d = decidirLote({
      agora,
      eventos: m.eventos.map(({ id, chave, tpEvento, tentativas }) => ({ id, chave, tpEvento, tentativas })),
      ...m.contexto,
      chamada,
    });
    const veio656 = resp !== null && d.eventos.some((e) => e.cStat === 656);

    await this.prisma.$transaction(async (tx) => {
      await this.esperarTravaEventos(tx);
      const onde = { ambiente: p.ambiente, cnpj: p.cnpj };
      const porId = new Map(m.eventos.map((e) => [e.id, e]));
      for (const de of d.eventos) {
        const ev = porId.get(de.id)!;
        const r = resp ? retornoDo(resp, ev) : null;
        // Só quem ainda é deste lote e está `enviando` (outro processo pode ter interrompido o lote).
        await tx.sefaz_manifestacoes.updateMany({
          where: { id: de.id, lote_id: m.loteId, situacao: 'enviando' },
          data: {
            situacao: de.estado,
            tentativas: de.gastou ? ev.tentativas : ev.tentativas - 1,
            c_stat: cStatGravavel(de.cStat),
            x_motivo: r ? r.xMotivo.slice(0, 255) : null,
            n_prot: de.protocolo,
            dh_reg_evento: r?.dhRegEvento?.slice(0, 40) ?? null,
            xml_retorno: r?.xml ?? null,
            atualizada_em: agora,
          },
        });
      }
      await tx.sefaz_eventos_lotes.update({
        where: { id: m.loteId },
        data: {
          terminado_em: agora,
          resultado: d.resultado,
          c_stat: resp ? (veio656 ? 656 : resp.cStat) : null,
          x_motivo: resp ? resp.xMotivo.slice(0, 255) : motivoDoErro(erro?.httpStatus, diagnostico.passo, diagnostico.fault),
          erro_code: erroCode ?? (d.relogio ? ERRO_RELOGIO : null),
        },
      });
      // A linha do PRÓPRIO lote; `ligada` e `ligada_em` nunca mudam aqui (parada = `situacao`, e ligar de novo é do admin).
      await tx.sefaz_manifestacao.update({
        where: { ambiente_cnpj: onde },
        data: {
          situacao: d.situacao,
          mensagem: d.mensagem,
          falhas_seguidas: d.falhasSeguidas,
          ...(d.pausaAte !== null ? { pausa_ate: d.pausaAte } : {}),
        },
      });
      if (d.situacao !== 'ok') {
        await tx.sefaz_distribuicao_historico.create({
          data: {
            ...onde,
            evento: 'respostas_paradas',
            situacao: d.situacao,
            // O código só quando a parada veio de um retorno da SEFAZ; por HTTP/transporte, null (o status vai na frase).
            c_stat: chamada.tipo === 'retorno' ? d.cStatParada : null,
            mensagem: d.mensagem,
            feito_em: agora,
          },
        });
      }
    }, TX2);

    this.registrar(p, m, d, { resp, erro, erroCode, causa, diagnostico, duracaoMs });
  }

  private registrar(
    p: Preparo,
    m: Montado,
    d: DecisaoLote,
    x: {
      resp: RespostaLoteEventos | null;
      erro: Extract<ChamadaLote, { tipo: 'erro' }> | null;
      erroCode: string | null;
      causa: string | null;
      diagnostico: { passo?: PassoLeitura; fault?: CodigoFault };
      duracaoMs: number;
    },
  ): void {
    const estados: Partial<Record<EstadoEvento, number>> = {};
    for (const e of d.eventos) estados[e.estado] = (estados[e.estado] ?? 0) + 1;
    // 135/136 sem protocolo no formato da SEFAZ (15 ou 17 dígitos): o leitor o deixou de fora; o alerta leva só a contagem.
    const semProtocolo = d.eventos.filter((e) => (e.cStat === 135 || e.cStat === 136) && e.protocolo === null).length;
    this.logger.log(
      JSON.stringify({
        evento: 'sefaz.eventos',
        ambiente: p.ambiente,
        lote_id: m.loteId,
        id_lote: m.idLote.toString(),
        resultado: d.resultado,
        c_stat: x.resp?.cStat ?? null,
        erro_code: x.erroCode,
        http_status: x.erro?.httpStatus ?? null,
        causa: x.causa,
        passo: x.diagnostico.passo ?? null,
        fault: x.diagnostico.fault ?? null,
        eventos: m.eventos.length,
        estados,
        situacao: d.situacao,
        pausa_ate: d.pausaAte?.toISOString() ?? null,
        alerta: semProtocolo > 0 ? 'registrada_sem_protocolo' : null,
        duracao_ms: x.duracaoMs,
      }),
    );
  }
}

/** O `retEvento` de um evento nosso: casa por (chNFe, tpEvento, nSeqEvento 1), como a decisão do lote. */
function retornoDo(resp: RespostaLoteEventos, ev: EventoDoLote): RetornoEvento | null {
  return resp.retornos.find((r) => r.chave === ev.chave && r.tpEvento === ev.tpEvento && r.nSeq === 1) ?? null;
}
