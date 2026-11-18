// Cancelamento do cupom fiscal (NFC-e), desenho §5.4: o evento 110111 ao `NFeRecepcaoEvento4` da NFC-e de SP, até a autorização + 29 min
// (`autorizada_em` = o `dhRecbto` do protocolo; a SEFAZ aceita 30: 1 min de folga), na hora do servidor. O mesmo molde da emissão
// (`emissao.service.ts`), sob a mesma trava do ambiente, e nada aqui se repete sozinho (cada pedido nasce de um clique):
//   Antes de tudo (sem transação): servidor ligado, motivo (15 a 255 caracteres, sem emoji, normalizado como vai no `xJust`), o cupom do
//      ambiente do servidor, autorizado e no prazo, e o certificado em uso do CNPJ da chave. Não depende da emissão ligada: como a
//      consulta, o cancelamento resolve um cupom (só o 656, a `parada_656` e a `parada_certificado` o param; `travas.ts`).
//   T1 (`FOR UPDATE` no ambiente): situação e prazo de novo, as travas do evento (no máximo 3 pedidos por cupom e 1 a cada 2 min; o
//      pedido que falhou antes de sair não conta), a montagem e a assinatura do evento; grava o cupom `cancelando` (motivo e hora do
//      pedido) e o envio aberto com o evento assinado e o `idLote`. Se o processo morrer depois daqui, o `cancelando` só sai pela consulta.
//   Rede (fora de transação): a porta `SEFAZ_NFCE`.
//   T2 (sob a mesma trava): confere o retorno contra a chave e o ambiente do cupom (outro, ou o registro sem `nProt` = resposta inválida
//      = `cancelando`, a consulta decide), fecha o envio e aplica o retorno (`acaoCancelamento`) ao cupom, num UPDATE só (gatilho de
//      imutável), e ao ambiente (656, paradas e o relógio, este só com a hora do registro novo: 135/155).
//   T3 (transação própria, só se a T2 gravou `cancelado` e a venda tinha entrado no estoque): `nfce_desfazer_venda`. Falhou = o cupom fica
//      cancelado com `venda_erro` (`desfazer_pendente`), e o "Tirar a venda do estoque" (`lancarVenda`) refaz.
// Recusado (outro código, 656, falha antes de enviar): o cupom volta a `autorizado` sem o motivo (ele fica só no diário, no evento
// assinado), e a resposta traz `recusa`/`mensagem` DESTA resposta (o GET depois não a repete). Log `nfce.envio` sem motivo, chave ou XML.

import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type nfce_cupons } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { textoFiscal } from '../../common/fiscal/texto-fiscal';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { AssinaturaErro, assinarXmlEnveloped } from '../sefaz/assinatura-xml';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { normalizarJustificativa } from '../sefaz/eventos-xml';
import { SEFAZ_NFCE, type RespostaEvento, type SefazNfcePort } from '../sefaz/nfce.port';
import { SefazErro, sefazErro } from '../sefaz/sefaz-erro';
import type { Autor } from './cadastro.service';
import {
  CupomEmissaoService,
  TX,
  cStatGravavel,
  comoSefazErro,
  dataSefaz,
  efeitoDe,
  erroDaTrava,
  eventoDoCupom,
  fechamento,
  nfce503,
  paraAcoes,
  r409,
  r422,
  situacaoErro,
  type CupomDetalhe,
} from './emissao.service';
import { corpoEnvEventoCancelamento, idCancelamento, montarCancelamento } from './evento-cancelamento';
import { FRASE_ERRO, FRASE_RETORNO } from './frases';
import { acaoCancelamento, motivoSefaz, type AcaoRetorno, type ContextoRetorno } from './retornos';
import { inicioDaEspera, PRAZO_CANCELAR_MS, situacaoEfetiva, type CupomParaAcoes } from './situacao-cupom';
import { podeChamar } from './travas';

type Tx = Prisma.TransactionClient;

/** O que a T1 deixou gravado para a rede e a T2. */
type Pedido = { envioId: string; tentativa: number; chave: string; motivo: string; envEvento: string; iniciadaEm: Date };

/** Evento registrado e vinculado à nota (o 155 é o mesmo, fora do prazo de vinculação). */
const EVENTO_REGISTRADO = new Set([135, 155]);
const LOTE_PROCESSADO = 128;
/** Teto do texto antes da normalização (o DTO já corta em 1000): acima de 255 depois de normalizar, a recusa é a mesma. */
const MOTIVO_MAX_ENTRADA = 1000;

@Injectable()
export class CupomCancelamentoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEFAZ_NFCE) private readonly porta: SefazNfcePort,
    private readonly emissao: CupomEmissaoService,
  ) {}

  /**
   * "Cancelar o cupom" (UX 4.3): 200 com o cupom em qualquer resultado desta chamada (`cancelado`, `cancelando` ou de volta a
   * `autorizado` com a recusa). Erros HTTP só antes de o pedido sair: 400 `NFCE_MOTIVO`, 404, 409 `NFCE_SITUACAO`,
   * `NFCE_CANCELAMENTO_FORA_DO_PRAZO` e as travas (`NFCE_CANCELAMENTO_CEDO`, `NFCE_LIMITE_CANCELAMENTOS`, `NFCE_BLOQUEADA`, `NFCE_PARADA`),
   * 422 do certificado e 503 com o servidor desligado.
   */
  async cancelar(id: string, motivo: string, autor: Autor, agora: Date = new Date()): Promise<CupomDetalhe> {
    const a = this.emissao.ambienteLigado();
    const m = motivoDoCancelamento(motivo);
    const c0 = await this.emissao.cupomOu404(this.prisma, id);
    if (c0.ambiente !== a) throw nfce503();
    await this.conferirSituacao(this.prisma, c0, agora);
    const cert = await this.emissao.certificado(c0.chave.slice(6, 20), agora);

    const p = await this.prisma.$transaction(async (tx): Promise<Pedido> => {
      const amb = await this.emissao.travarAmbiente(tx, a);
      const c = await this.emissao.cupomOu404(tx, id);
      const para = await this.conferirSituacao(tx, c, agora);
      const pedidos = await this.pedidosDoCupom(tx, id);
      // nota 2 do controlador: só o pedido que saiu (ou pode ter saído: o aberto conta) gasta uma das 3 e abre a espera de 2 min
      const sairam = pedidos.filter((e) => e.resultado !== 'falha_antes_de_enviar');
      const estado = {
        ...(await this.emissao.estadoTravas(tx, a, amb, agora, {
          enviadoEm: inicioDaEspera(para),
          ultimaConsultaDaChave: para.ultimaConsultaDaChave,
        })),
        // nota 1: sempre presentes (sem eles os limites do cancelamento somem sem erro)
        cancelamentosDoCupom: sairam.length,
        ultimoCancelamentoDoCupom: sairam.reduce<Date | null>((u, e) => (u === null || e.iniciada_em > u ? e.iniciada_em : u), null),
      };
      const trava = podeChamar(estado, 'evento', agora);
      if (!trava.ok) throw erroDaTrava(trava, amb);

      const evento = eventoAssinado(c, a, m, agora, cert);
      const [lote] = await tx.$queryRaw<{ id: bigint }[]>`SELECT nextval('nfce_id_lote_seq') AS id`;
      const envEvento = corpoEnvEventoCancelamento(BigInt(lote.id), evento);
      const envioId = randomUUID();
      const tentativa = pedidos.length + 1;
      await tx.nfce_envios.create({
        data: {
          id: envioId,
          ambiente: a,
          cupom_id: id,
          servico: 'cancelamento',
          tentativa,
          id_lote: BigInt(lote.id),
          iniciada_em: agora,
          xml_enviado: evento,
          iniciada_por: autor.id,
          iniciada_por_nome: autor.nome,
          certificado_impressao: cert.impressaoDigital.slice(0, 64),
        },
      });
      await tx.nfce_cupons.update({
        where: { id },
        data: { situacao: 'cancelando', cancelamento_motivo: m, cancelamento_pedido_em: agora, atualizado_em: agora },
      });
      return { envioId, tentativa, chave: c.chave, motivo: m, envEvento, iniciadaEm: agora };
    }, TX);

    const inicio = Date.now();
    let resp: RespostaEvento | SefazErro;
    let erroCode: string | null = null;
    try {
      resp = await this.porta.registrarEvento(cert, a, p.envEvento);
    } catch (e) {
      ({ resp, erroCode } = comoSefazErro(e));
    }
    const duracao = Date.now() - inicio;

    const t2 = await this.prisma.$transaction(async (tx) => {
      const amb = await this.emissao.travarAmbiente(tx, a);
      const c = await this.emissao.cupomOu404(tx, id);
      // nota 4: o retorno tem de ser desta chave e deste ambiente (e o registro, com protocolo) antes de gravar `cancelado`
      let r: RespostaEvento | SefazErro = resp;
      if (!(r instanceof SefazErro) && !retornoDoCupom(r, p.chave, a)) {
        r = sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
        erroCode = 'SEFAZ_RESPOSTA_INVALIDA';
      }
      const ctx: ContextoRetorno = {
        ambiente: a,
        serie: c.serie,
        numero: Number(c.numero),
        agora,
        enviadoEm: p.iniciadaEm,
        ultimo656: amb.ultimo_656_em,
      };
      const acao = acaoCancelamento(r, ctx);
      const codigo = r instanceof SefazErro ? null : codigoDe(r);
      await tx.nfce_envios.update({
        where: { id: p.envioId },
        data: {
          ...fechamento(r, erroCode, duracao, agora, acao.rejeicao),
          ...(resp instanceof SefazErro ? {} : { xml_retorno: resp.xmlRetorno }),
          ...(r instanceof SefazErro
            ? {}
            : {
                c_stat_lote: cStatGravavel(r.cStatLote),
                c_stat: cStatGravavel(r.cStat),
                x_motivo: motivoSefaz(doEvento(r) ? r.xMotivo : r.xMotivoLote) || null,
                n_prot: r.nProt,
                dh_recbto: r.dhRegEvento,
              }),
        },
      });
      const ultimo = await tx.nfce_envios.findFirst({
        where: { cupom_id: id, servico: 'cancelamento' },
        orderBy: { tentativa: 'desc' },
        select: { id: true },
      });
      const dados = cupomDepoisDoEvento(c, acao, r, p, ultimo?.id === p.envioId, agora);
      if (dados) await tx.nfce_cupons.update({ where: { id }, data: dados });
      // Ruling T12 I1: o relógio só confere a hora da resposta NOVA (o registro, 135/155); o 573 traz a hora do evento já registrado, que
      // pode ser de minutos antes (o 2º pedido sai pelo menos 2 min depois do 1º) e pararia a emissão por engano
      const dhNova = acao.cupom === 'cancelado' && !(r instanceof SefazErro) ? r.dhRegEvento : null;
      await this.emissao.aplicarNoAmbiente(tx, amb, { ...efeitoDe(acao, codigo), dhRecbto: dhNova }, agora);
      return { acao, cancelou: dados?.situacao === 'cancelado', lancada: c.venda_lancada_em !== null };
    }, TX);
    this.emissao.logEnvio({
      a,
      servico: 'cancelamento',
      serie: c0.serie,
      numero: c0.numero,
      resp: resp instanceof SefazErro ? resp : { cStat: codigoDe(resp) },
      duracao,
      tentativa: p.tentativa,
    });

    if (t2.cancelou && t2.lancada) await this.emissao.t3(id, 'desfazer', agora);
    return this.respostaDoPedido(await this.emissao.detalhe(id, agora), t2.acao, resp);
  }

  /**
   * Situação e prazo (§5.4), antes e dentro da T1: só o `autorizado` (com protocolo) cancela, e até `autorizada_em` + 29 min pela hora do
   * servidor (nota 6). A ordem importa: passado o prazo, a resposta é a do prazo, não a da situação (que esconde o "Cancelar").
   */
  private async conferirSituacao(db: Pick<Tx, 'nfce_envios'>, c: nfce_cupons, agora: Date): Promise<CupomParaAcoes> {
    const para = paraAcoes(c, await this.emissao.horasDoCupom(db, c.id));
    const s = situacaoEfetiva(para, agora);
    if (s !== 'autorizado' || c.autorizada_em === null || c.n_prot === null) throw situacaoErro(s, 'cancelar');
    if (agora.getTime() > c.autorizada_em.getTime() + PRAZO_CANCELAR_MS) {
      throw r409('NFCE_CANCELAMENTO_FORA_DO_PRAZO', FRASE_ERRO.NFCE_CANCELAMENTO_FORA_DO_PRAZO(c.autorizada_em));
    }
    return para;
  }

  /** Os pedidos de cancelamento deste cupom no diário (todos; quem conta decide o que vale). */
  private pedidosDoCupom(tx: Tx, id: string) {
    return tx.nfce_envios.findMany({
      where: { cupom_id: id, servico: 'cancelamento' },
      select: { id: true, iniciada_em: true, resultado: true },
    });
  }

  /**
   * A resposta do clique: o cupom como ficou e, se ele voltou a `autorizado`, o porquê desta resposta (UX 4.3: a frase da recusa, a do
   * 656 ou a da parada; ou o "nada foi enviado"). O `detalhe` só tira a recusa do diário da autorização e da consulta.
   */
  private respostaDoPedido(d: CupomDetalhe, acao: AcaoRetorno, resp: RespostaEvento | SefazErro): CupomDetalhe {
    if (d.situacao !== 'autorizado') return d;
    if (acao.recusa) return { ...d, recusa: acao.recusa, mensagem: acao.recusa.frase };
    if (resp instanceof SefazErro && !resp.enviado) return { ...d, mensagem: FRASE_RETORNO.naoEnviado };
    return d;
  }
}

// ------------------------------------------------------------------------------------------------------------- funções do serviço

/**
 * O motivo como vai no `xJust` e no cupom: controles fora (`textoFiscal`), acentos compostos (NFC), aspas e travessões do celular e
 * espaços repetidos normalizados (`normalizarJustificativa`); de 15 a 255 caracteres, só U+0020–U+00FF (sem emoji). Senão 400.
 */
function motivoDoCancelamento(motivo: unknown): string {
  const j = typeof motivo === 'string' ? normalizarJustificativa(textoFiscal(motivo.normalize('NFC'), MOTIVO_MAX_ENTRADA)) : null;
  if (j === null || !j.ok) throw new BadRequestException({ code: 'NFCE_MOTIVO', message: FRASE_ERRO.NFCE_MOTIVO('cancelar') });
  return j.texto;
}

/** O evento 110111 montado e assinado. Recusa da montagem ou da assinatura = 422 com a frase fixa delas (nunca o dado), na T1. */
function eventoAssinado(c: nfce_cupons, a: AmbienteSefaz, motivo: string, agora: Date, cert: CertificadoEmUso): string {
  let xml: string;
  try {
    xml = montarCancelamento({
      tpAmb: a === 'producao' ? 1 : 2,
      cnpj: c.chave.slice(6, 20),
      chave: c.chave,
      nProt: c.n_prot as string,
      xJust: motivo,
      dhEvento: agora,
    });
  } catch (e) {
    throw r422('NFCE_CUPOM_INVALIDO', e instanceof Error ? e.message : 'O cancelamento não pôde ser montado.');
  }
  try {
    return assinarXmlEnveloped(xml, idCancelamento(c.chave), cert);
  } catch (e) {
    if (e instanceof AssinaturaErro) throw r422('NFCE_CUPOM_INVALIDO', e.message);
    throw e;
  }
}

/** O lote foi processado e trouxe o `retEvento`: vale o código do evento (como em `acaoCancelamento`). */
const doEvento = (r: RespostaEvento): r is RespostaEvento & { cStat: number } => r.cStatLote === LOTE_PROCESSADO && r.cStat !== null;
/** O código que decidiu: o do evento, ou o do lote. */
const codigoDe = (r: RespostaEvento): number => (doEvento(r) ? r.cStat : r.cStatLote);
const tpAmbDe = (a: AmbienteSefaz) => (a === 'producao' ? '1' : '2');

/**
 * Nota 4 do controlador: o `retEvento` (no máximo um, `lerRetornoEvento`) é deste cupom? `chNFe` e `tpAmb` lidos do `infEvento` dele
 * (o `RespostaEvento` não os traz; o lote tem o próprio `tpAmb` antes). O registro (135/155) só vale com a chave, o ambiente e um `nProt`
 * válido presentes; as outras respostas, só se o que vier não for de outra chave nem de outro ambiente. Sem `retEvento`, nada a conferir.
 */
function retornoDoCupom(r: RespostaEvento, chave: string, a: AmbienteSefaz): boolean {
  if (r.cStat === null) return true;
  const ret = /<(?:[\w.-]+:)?retEvento[\s>][\s\S]*?<\/(?:[\w.-]+:)?retEvento>/.exec(r.xmlRetorno)?.[0] ?? '';
  const ch = /<(?:[\w.-]+:)?chNFe>\s*([0-9A-Z]{44})\s*</.exec(ret)?.[1] ?? null;
  const tp = /<(?:[\w.-]+:)?tpAmb>\s*([12])\s*</.exec(ret)?.[1] ?? null;
  if (doEvento(r) && EVENTO_REGISTRADO.has(r.cStat)) return eventoDoCupom({ chave: ch, tpAmb: tp, nProt: r.nProt }, chave, a);
  return (ch === null || ch === chave) && (tp === null || tp === tpAmbDe(a));
}

/**
 * O que a resposta muda no cupom, num UPDATE só (o gatilho de imutável deixa `autorizado ↔ cancelando`, `→ cancelado` e os campos do
 * cancelamento a partir de `autorizado`/`cancelando`). Já `cancelado` (a consulta resolveu antes) ou fora disso: nada.
 *   - registrado: `cancelado` com a hora do registro, o protocolo e o motivo deste pedido (a SEFAZ o registrou, mesmo que a consulta
 *     tenha voltado o cupom a `autorizado` enquanto ele estava na rede);
 *   - pode ter entrado (573, sem resposta, resposta inválida): `cancelando`; se a consulta o tinha voltado a `autorizado`, volta a ser;
 *   - não entrou (recusa, 656, falha antes de enviar): de volta a `autorizado`, sem o motivo e a hora do pedido (nota 3: o motivo fica
 *     no diário), só se o `cancelando` é DESTE pedido (um mais novo na rede decide por si).
 */
function cupomDepoisDoEvento(
  c: nfce_cupons,
  acao: AcaoRetorno,
  r: RespostaEvento | SefazErro,
  p: Pedido,
  desta: boolean,
  agora: Date,
): Prisma.nfce_cuponsUpdateInput | null {
  if (c.situacao !== 'autorizado' && c.situacao !== 'cancelando') return null;
  if (acao.cupom === 'cancelado' && !(r instanceof SefazErro)) {
    return {
      situacao: 'cancelado',
      cancelado_em: dataSefaz(r.dhRegEvento) ?? agora,
      cancelamento_n_prot: r.nProt,
      cancelamento_motivo: p.motivo,
      cancelamento_pedido_em: p.iniciadaEm,
      atualizado_em: agora,
    };
  }
  if (acao.cupom === 'cancelando') {
    if (c.situacao === 'cancelando') return null;
    return { situacao: 'cancelando', cancelamento_motivo: p.motivo, cancelamento_pedido_em: p.iniciadaEm, atualizado_em: agora };
  }
  if (c.situacao !== 'cancelando' || !desta) return null;
  return { situacao: 'autorizado', cancelamento_motivo: null, cancelamento_pedido_em: null, atualizado_em: agora };
}
