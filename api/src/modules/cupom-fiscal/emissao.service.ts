// Emissão do cupom fiscal (NFC-e), desenho §4.2–§4.4 e §5.1–§5.3: o número é reservado e gravado ANTES de a rede sair, e nada aqui se
// repete sozinho (toda chamada à SEFAZ nasce de um clique e passa pelas travas da §4.4 sob a trava do ambiente).
//   Antes de tudo (sem transação): servidor ligado, corpo, idempotência, emissão ligada, cadastro completo, produtos, totais, documento
//      do consumidor e o certificado em uso (`emUso()`): qualquer recusa aqui não reserva número e não chama a porta.
//   T1 (curta, `SELECT … FROM nfce_ambientes WHERE ambiente = $1 FOR UPDATE`): idempotência de novo, o trio (ambiente, CNPJ, série) e a
//      série fora das do caixa de hoje, as travas (`podeChamar`), o número (o menor descartado reaproveitável e livre, senão o próximo),
//      a montagem e a assinatura, e grava o cupom `enviando`, os itens, os pagamentos e o envio aberto com o XML assinado e o `idLote`.
//   Rede (fora de transação): a porta `SEFAZ_NFCE`.
//   T2 (sob a mesma trava): fecha o envio e aplica o retorno (`retornos.ts`) ao cupom (num UPDATE só, para o gatilho de imutável) e ao
//      ambiente (paradas, 656, relógio). Só grava o que já foi lido: não pode falhar depois de a SEFAZ responder.
//   T3 (transação própria, só valendo, autorizado e com `lanca_venda`): `nfce_lancar_venda`. Falhou = o cupom continua autorizado, com
//      `venda_erro`, e o "Lançar no estoque de novo" (`lancarVenda`) refaz.
// Log `nfce.envio`: ambiente, serviço, série, número, cStat, resultado, duração e tentativa; nunca XML, CSC, chave de acesso, CPF ou
// material do certificado. O CSC só é decifrado para o hash do QR e não sai daqui.

import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type itens_cardapio,
  type nfce_ambientes,
  type nfce_cupom_itens,
  type nfce_cupons,
  type nfce_emitente,
  type nfce_envios,
  type nfce_itens,
  type nfce_perfis_fiscais,
} from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { montarChaveNfce } from '../../common/fiscal/chave-acesso';
import { cnpjValido, normalizarCnpj } from '../../common/fiscal/cnpj';
import { cpfValido } from '../../common/fiscal/documentos';
import { textoDoCupom } from '../../common/fiscal/texto-fiscal';
import { postgresError } from '../../common/filters/http-exception.filter';
import {
  CERTIFICADO_DIGITAL,
  CertificadoErro,
  type CertificadoDigitalPort,
  type CertificadoEmUso,
} from '../certificado-digital/certificado-digital.port';
import { AssinaturaErro, assinarXmlEnveloped } from '../sefaz/assinatura-xml';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { dhSefaz } from '../sefaz/eventos-xml';
import {
  SEFAZ_NFCE,
  type ProtocoloNfce,
  type RespostaAutorizacao,
  type RespostaConsulta,
  type RespostaStatus,
  type SefazNfcePort,
} from '../sefaz/nfce.port';
import { SefazErro, sefazErro } from '../sefaz/sefaz-erro';
import { CupomCadastroService, type Autor, type SituacaoCupomFiscal } from './cadastro.service';
import { decifrarCsc } from './csc';
import { FRASE_ERRO, FRASE_RETORNO, FRASES_EMISSAO } from './frases';
import { FRASES_CADASTRO, TEXTO_FALTA, type CodigoFalta } from './frases-cadastro';
import { corpoEnviNfe, inserirSupl, MontagemNfceErro, montarNfe, montarNfeProc, type DadosNfce, type ItemXml } from './montagem-xml';
import { qrCodeV2, URL_CHAVE } from './qrcode-nfce';
import {
  acaoAutorizacao,
  acaoConsulta,
  acaoStatus,
  mensagemDoAmbiente,
  motivoSefaz,
  relogioDiverge,
  type AcaoRetorno,
  type ContextoRetorno,
  type Recusa,
} from './retornos';
import {
  acoesDoCupom,
  inicioDaEspera,
  situacaoEfetiva,
  vendaEstoque,
  type AcaoCupom,
  type CupomParaAcoes,
  type SituacaoCupom,
  type VendaEstoque,
} from './situacao-cupom';
import { calcularTotais, decimal2, precoCentavos, quantidadeValida, valorItemCentavos, type Totais, type TPag } from './totais';
import { MAX_ENVIOS, podeChamar, STATUS_CADA_MS, type EstadoTravas, type ResultadoTrava, type SituacaoAmbiente } from './travas';
import { motivosDoProduto, type Crt, type MotivoProduto, type PerfilFiscal } from './validacao-fiscal';

/** O corpo do POST cupons (desenho §8.2): dinheiro em centavos inteiros; `quantidade` em texto ("0.350"). */
export interface VendaParaCupom {
  chave_idempotencia: string;
  itens: { item_cardapio_id: string; quantidade: string }[];
  desconto_centavos: number;
  pagamentos: { t_pag: TPag; valor_centavos: number }[];
  consumidor_doc: string | null;
  total_esperado_centavos: number;
}

export interface ItemDoCupom {
  n_item: number;
  item_cardapio_id: string | null;
  nome_cardapio: string;
  x_prod: string;
  unidade: string;
  /** Como no banco, com 4 casas ("2.0000"): não é dinheiro. */
  quantidade: string;
  valor_unitario_centavos: number;
  valor_bruto_centavos: number;
  valor_desconto_centavos: number;
  perfil_nome: string;
}

/** O cupom para a tela (desenho §8.2; UX 10.3, 10.4, 10.8), sem XML. Dinheiro em centavos inteiros (`*_centavos`), nunca `Decimal`. */
export interface CupomDetalhe {
  id: string;
  ambiente: AmbienteSefaz;
  serie: number;
  numero: number;
  chave: string;
  /** A situação efetiva: `enviando` há 2 min ou mais já sai como `sem_resposta`. */
  situacao: SituacaoCupom;
  dh_emi: Date;
  envios: number;
  numero_reaproveitavel: boolean;
  /** Completo aqui (é o cupom); a lista mascara o CPF (UX 10.15). */
  consumidor_doc: string | null;
  valor_produtos_centavos: number;
  valor_desconto_centavos: number;
  valor_total_centavos: number;
  valor_troco_centavos: number;
  itens: ItemDoCupom[];
  pagamentos: { t_pag: string; valor_centavos: number }[];
  autorizada_em: Date | null;
  n_prot: string | null;
  c_stat: number | null;
  x_motivo: string | null;
  /** O aviso do 120 (UX 3.1: "Autorizado, com um aviso da SEFAZ"). */
  alerta: { c_msg: string | null; x_msg: string | null } | null;
  cancelado_em: Date | null;
  cancelamento_motivo: string | null;
  cancelamento_n_prot: string | null;
  cancelamento_pedido_em: Date | null;
  venda_estoque: VendaEstoque | null;
  venda_erro: string | null;
  descartado_em: Date | null;
  descarte_motivo: string | null;
  emitido_por_nome: string | null;
  criado_em: Date;
  /** A hora do servidor, para a contagem da tela (UX 10.3). */
  agora: Date;
  consultar_a_partir_de: Date | null;
  cancelar_ate: Date | null;
  acoes: AcaoCupom[];
  /** O que a SEFAZ disse na última chamada respondida deste cupom (código, família, frase da UX 6.1 e o `xMotivo`), se não foi sucesso. */
  recusa: Recusa | null;
  /** A frase da situação: a da `recusa` ou, sem ela, a da UX 6.1 para "não saiu" / "sem resposta" (nota 10 do controlador). */
  mensagem: string | null;
}

export interface TesteConexao {
  em_operacao: boolean;
  /** O `cStat` (null quando não houve resposta). */
  codigo: number | null;
  frase: string;
  agora: Date;
  /** Quando o botão volta (5 min, desenho §4.4 regra 7). */
  testar_de_novo_em: Date;
}

export const TX = { maxWait: 10_000, timeout: 30_000 };
const HORA_MS = 60 * 60_000;
/** Acima de R$ 10.000,00, o documento do consumidor é obrigatório (desenho §7.2). */
const DOC_OBRIGATORIO_ACIMA = 1_000_000n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T_PAG_ACEITOS: readonly string[] = ['01', '03', '04', '10', '11', '17'];
const T_PAG_COM_CARD: readonly string[] = ['03', '04', '17'];
/** Situações em que o cupom já é documento fiscal: o gatilho de imutável só deixa passar a lista branca. */
const DOCUMENTO: readonly SituacaoCupom[] = ['autorizado', 'cancelando', 'denegado', 'cancelado'];
/** Situações em que a tela mostra o que a SEFAZ disse (a `recusa`). */
const COM_RECUSA: readonly SituacaoCupom[] = ['nao_enviado', 'rejeitado', 'denegado', 'sem_resposta', 'nao_consta'];
const AUTORIZADO_OU_DENEGADO = new Set([100, 150, 120, 110, 301, 302]);
const CANCELADA = new Set([101, 151]);
const EVENTO_REGISTRADO = new Set([135, 155]);
/** `erro_code` do envio da consulta cuja resposta chegou depois de um "Enviar de novo": não decidiu nada no cupom (Ruling T11 I2). */
export const ERRO_CUPOM_MUDOU = 'CUPOM_MUDOU';
/** Os itens da `falta` que ligar a emissão trata com código próprio (desenho §8.4). */
const FALTA_VALENDO: readonly CodigoFalta[] = ['teste_homologacao', 'lanca_venda'];

type Tx = Prisma.TransactionClient;
type Erro = HttpException;

// ------------------------------------------------------------------------------------------------------------- funções puras

/** CPF/CNPJ como vai no cupom: maiúsculas e só `[0-9A-Z]` (o CNPJ pode ter letras); vazio = sem documento. */
function docNormalizado(s: string | null | undefined): string | null {
  const d = (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return d === '' ? null : d;
}

/**
 * SHA-256 (hex) do corpo normalizado (desenho §8.1): itens na ordem enviada (id em minúsculas e quantidade como veio), desconto (ausente
 * = 0), pagamentos na ordem e o documento sem máscara. As chaves do JSON têm ordem fixa: a ordem em que a tela as manda não muda o hash.
 */
export function pedidoHash(v: VendaParaCupom): string {
  const corpo = {
    itens: (v.itens ?? []).map((i) => ({ item_cardapio_id: String(i.item_cardapio_id).toLowerCase(), quantidade: i.quantidade })),
    desconto_centavos: v.desconto_centavos ?? 0,
    pagamentos: (v.pagamentos ?? []).map((p) => ({ t_pag: p.t_pag, valor_centavos: p.valor_centavos })),
    consumidor_doc: docNormalizado(v.consumidor_doc),
  };
  return createHash('sha256').update(JSON.stringify(corpo), 'utf8').digest('hex');
}

const centavos = (d: Prisma.Decimal): bigint => BigInt(d.times(100).toFixed(0));
const centavosNum = (d: Prisma.Decimal): number => Number(centavos(d));
const dec = (d: Prisma.Decimal | null): string | null => (d === null ? null : d.toFixed());
const vazioParaNull = (s: string | null | undefined): string | null => (s == null || s.trim() === '' ? null : s.trim());
const tamanho = (s: string) => Array.from(s).length;
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
/** `cStat` que cabe no CHECK do cupom (100–9999); o adaptador já garante, aqui é o cinto. */
export const cStatGravavel = (c: number | null | undefined): number | null => (c != null && c >= 100 && c <= 9999 ? c : null);
/** Data e hora da SEFAZ com fuso explícito; sem fuso ou ilegível = null. */
export function dataSefaz(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
const aammDe = (dhEmi: Date): string => {
  const dh = dhSefaz(dhEmi); // Brasília
  return dh.slice(2, 4) + dh.slice(5, 7);
};
/** `cNF`: 8 dígitos aleatórios, diferente do número da nota (desenho §4.1). */
function novoCnf(numero: bigint): string {
  for (;;) {
    const c = String(randomInt(0, 100_000_000)).padStart(8, '0');
    if (BigInt(c) !== numero) return c;
  }
}
/** O DigestValue da assinatura do `infNFe` (casa a autorização com a tentativa, desenho §5.1). */
const digestDa = (nfe: string): string | null => /<DigestValue>([^<]+)<\/DigestValue>/.exec(nfe)?.[1] ?? null;
/** O `tpAmb` do `infProt` (o `ProtocoloNfce` não o traz; vem do trecho do protocolo como chegou). */
const tpAmbDoProtocolo = (p: ProtocoloNfce): string | null => /<(?:[\w.-]+:)?tpAmb>\s*([12])\s*</.exec(p.xml)?.[1] ?? null;
/** Nota 7 do controlador: a chave do protocolo tem de ser a do cupom e o `tpAmb` o do ambiente da chamada. */
const protocoloDoCupom = (p: ProtocoloNfce, chave: string, a: AmbienteSefaz): boolean =>
  p.chave === chave && tpAmbDoProtocolo(p) === (a === 'producao' ? '1' : '2');
/** Primeira letra minúscula quando a palavra não é sigla ("Inscrição estadual" → "inscrição estadual"; "CNPJ da empresa" fica). */
const minuscula = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function perfilFiscalDe(p: nfce_perfis_fiscais): PerfilFiscal {
  return {
    cfop: p.cfop,
    csosn: p.csosn,
    cst_icms: p.cst_icms,
    aliq_icms: dec(p.aliq_icms),
    pis_cst: p.pis_cst,
    cofins_cst: p.cofins_cst,
    c_ativ_sn: p.c_ativ_sn,
    ibs_sn_aliq: dec(p.ibs_sn_aliq),
    cbs_sn_aliq: dec(p.cbs_sn_aliq),
    ibscbs_cst: p.ibscbs_cst,
    ibscbs_cclass_trib: p.ibscbs_cclass_trib,
    ativo: p.ativo,
  };
}
const crtDe = (e: Pick<nfce_emitente, 'crt'>): Crt | null => (e.crt === 1 || e.crt === 2 || e.crt === 3 || e.crt === 4 ? e.crt : null);

// ------------------------------------------------------------------------------------------------------------- erros

export const nfce503 = () => new ServiceUnavailableException({ code: 'NFCE_DESLIGADA', message: FRASE_ERRO.NFCE_DESLIGADA });
const invalido = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
export const r422 = (code: string, message: string) => new UnprocessableEntityException({ code, message });
export const r409 = (code: string, message: string) => new ConflictException({ code, message });
const naoAchei = () => new NotFoundException({ code: 'NOT_FOUND', message: FRASES_CADASTRO.naoEncontrado });
export const situacaoErro = (s: SituacaoCupom, acao: AcaoCupom) => r409('NFCE_SITUACAO', FRASE_ERRO.NFCE_SITUACAO(s, acao));

/** A trava que barrou → 409 com a frase (a da parada é a mensagem gravada no ambiente). */
export function erroDaTrava(r: Exclude<ResultadoTrava, { ok: true }>, amb: Pick<nfce_ambientes, 'mensagem'>): Erro {
  const ate = r.ate ?? new Date();
  switch (r.code) {
    case 'NFCE_PARADA':
      return r409('NFCE_PARADA', amb.mensagem ?? FRASE_ERRO.NFCE_EMISSAO_DESLIGADA);
    case 'NFCE_BLOQUEADA':
      return r409(r.code, FRASE_ERRO.NFCE_BLOQUEADA(ate));
    case 'NFCE_MUITAS_RECUSAS':
      return r409(r.code, FRASE_ERRO.NFCE_MUITAS_RECUSAS(ate));
    case 'NFCE_CONSULTA_CEDO':
      return r409(r.code, FRASE_ERRO.NFCE_CONSULTA_CEDO(ate));
    case 'NFCE_TESTE_CEDO':
      return r409(r.code, FRASE_ERRO.NFCE_TESTE_CEDO(ate));
    case 'NFCE_CANCELAMENTO_CEDO':
      return r409(r.code, FRASE_ERRO.NFCE_CANCELAMENTO_CEDO(ate));
    case 'NFCE_LIMITE_CANCELAMENTOS':
      return r409(r.code, FRASE_ERRO.NFCE_LIMITE_CANCELAMENTOS);
  }
}

/** Montagem e assinatura recusadas: frase fixa (nunca o dado), 422, antes de o número ser reservado (a T1 desfaz tudo). */
function erroDaMontagem(e: unknown): unknown {
  if (e instanceof MontagemNfceErro || e instanceof AssinaturaErro) return r422('NFCE_CUPOM_INVALIDO', e.message);
  return e;
}

// ------------------------------------------------------------------------------------------------------------- tipos internos

type Venda = {
  itens: { id: string; quantidade: string }[];
  desconto: bigint;
  pagamentos: { tPag: TPag; valor: bigint }[];
  doc: string | null;
  totalEsperado: bigint;
};

/** Um item pronto para o XML e para a fotografia em `nfce_cupom_itens`. */
type Linha = {
  itemCardapioId: string | null;
  nomeCardapio: string;
  perfilNome: string;
  perfil: PerfilFiscal;
  xml: ItemXml;
};

type Cadastro = {
  amb: nfce_ambientes;
  emitente: nfce_emitente;
  conf: { cnpj: string; razao_social: string; nome_fantasia: string };
  cnpj: string;
  crt: Crt;
  csc: string;
};

type Montado = { chave: string; nfe: string; enviNFe: string; idLote: bigint };

/** O que a T1 deixou gravado para a rede e a T2. */
type Reserva = {
  ambiente: AmbienteSefaz;
  cupomId: string;
  envioId: string;
  tentativa: number;
  serie: number;
  numero: bigint;
  chave: string;
  nfe: string;
  enviNFe: string;
  iniciadaEm: Date;
};

type Efeito = {
  ambiente?: SituacaoAmbiente;
  mensagem: string | null;
  bloquear656?: true;
  bloqueadoAte?: Date;
  codigo: number | null;
  /** O `dhRecbto` da resposta, para o relógio (§4.4, regra 8). */
  dhRecbto?: string | null;
};

type HorasDoCupom = { enviadoEm: Date | null; ultimaConsulta: Date | null };

@Injectable()
export class CupomEmissaoService {
  private readonly logger = new Logger(CupomEmissaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
    @Inject(SEFAZ_NFCE) private readonly porta: SefazNfcePort,
    private readonly cadastro: CupomCadastroService,
  ) {}

  // =========================================================================================================== emitir

  /** 201 com o cupom em qualquer situação final desta tentativa; 200 com o cupom já emitido pela mesma chave e o mesmo corpo. */
  async emitir(v: VendaParaCupom, autor: Autor, agora: Date = new Date()): Promise<{ status: 200 | 201; cupom: CupomDetalhe }> {
    const a = this.ambienteLigado();
    const venda = conferirCorpo(v);
    const hash = pedidoHash(v);
    const ja = await this.porIdempotencia(this.prisma, v.chave_idempotencia, hash);
    if (ja) return { status: 200, cupom: await this.detalhe(ja, agora) };

    const cad = await this.cadastroPronto(a);
    const linhas = await this.linhasDaVenda(venda.itens, cad.crt);
    const totais = totaisDaVenda(linhas, venda);
    if (totais.total > DOC_OBRIGATORIO_ACIMA && venda.doc === null) throw r422('NFCE_DOC_OBRIGATORIO', FRASE_ERRO.NFCE_DOC_OBRIGATORIO);
    const cert = await this.certificado(cad.cnpj, agora);

    const t1 = await this.prisma
      .$transaction(async (tx): Promise<Reserva | { existente: string }> => {
        const amb = await this.travarAmbiente(tx, a);
        const existente = await this.porIdempotencia(tx, v.chave_idempotencia, hash);
        if (existente) return { existente };
        const c = await this.conferirNaTrava(tx, a, amb, agora, { enviadoEm: null, ultimaConsultaDaChave: null });
        const { numero, avancar } = await this.escolherNumero(tx, a, c.amb.serie as number, c.amb.proximo_numero);
        const cNF = novoCnf(numero);
        const m = await this.montarAssinado(tx, c, cert, {
          serie: c.amb.serie as number,
          numero,
          cNF,
          dhEmi: agora,
          linhas,
          totais,
          venda,
        });
        const cupomId = randomUUID();
        const envioId = randomUUID();
        await tx.nfce_cupons.create({
          data: {
            id: cupomId,
            ambiente: a,
            serie: c.amb.serie as number,
            numero,
            chave: m.chave,
            c_nf: cNF,
            dh_emi: agora,
            situacao: 'enviando',
            envios: 1,
            chave_idempotencia: v.chave_idempotencia,
            pedido_hash: hash,
            // a resposta do "quem conta no estoque" fotografada agora (§3.4); em homologação, nunca
            lanca_venda: a === 'producao' && c.emitente.cupom_lanca_venda === true,
            consumidor_doc: venda.doc,
            valor_produtos: decimal2(totais.produtos),
            valor_desconto: decimal2(totais.desconto),
            valor_total: decimal2(totais.total),
            valor_troco: decimal2(totais.troco),
            emitido_por: autor.id,
            emitido_por_nome: autor.nome,
            criado_em: agora,
            atualizado_em: agora,
          },
        });
        await tx.nfce_cupom_itens.createMany({ data: linhas.map((l, k) => fotografia(cupomId, k + 1, l, totais)) });
        await tx.nfce_cupom_pagamentos.createMany({
          data: venda.pagamentos.map((p, k) => ({
            cupom_id: cupomId,
            ordem: k + 1,
            t_pag: p.tPag,
            valor: decimal2(p.valor),
            tp_integra: T_PAG_COM_CARD.includes(p.tPag) ? 2 : null,
          })),
        });
        await this.abrirEnvio(tx, { id: envioId, a, cupomId, servico: 'autorizacao', tentativa: 1, m, autor, cert, agora });
        if (avancar !== null) await tx.nfce_ambientes.update({ where: { ambiente: a }, data: { proximo_numero: avancar } });
        return {
          ambiente: a,
          cupomId,
          envioId,
          tentativa: 1,
          serie: c.amb.serie as number,
          numero,
          chave: m.chave,
          nfe: m.nfe,
          enviNFe: m.enviNFe,
          iniciadaEm: agora,
        };
      }, TX)
      .catch((e: unknown) => {
        throw erroDaMontagem(e);
      });
    if ('existente' in t1) return { status: 200, cupom: await this.detalhe(t1.existente, agora) };

    await this.enviarAutorizacao(t1, cert, agora);
    return { status: 201, cupom: await this.detalhe(t1.cupomId, agora) };
  }

  // =========================================================================================================== reenviar

  /**
   * "Enviar de novo" (§5.1): o mesmo número e o mesmo `cNF`, `dhEmi` novo (a chave muda só se o mês virou), relendo os códigos fiscais
   * dos produtos e os dados do emitente (UX 10.14); itens, quantidades, preços, pagamentos e consumidor não mudam. No máximo 3 envios.
   */
  async reenviar(id: string, autor: Autor, agora: Date = new Date()): Promise<CupomDetalhe> {
    const a = this.ambienteLigado();
    const c0 = await this.cupomOu404(this.prisma, id);
    if (c0.ambiente !== a) throw nfce503();
    if (c0.envios >= MAX_ENVIOS) throw r409('NFCE_LIMITE_ENVIOS', FRASE_ERRO.NFCE_LIMITE_ENVIOS);
    await this.conferirAcao(this.prisma, c0, 'enviar_de_novo', agora);
    const cad = await this.cadastroPronto(a);
    // a emissão desliga com a troca de CNPJ (§7.1); religada com o CNPJ novo, o cupom do CNPJ velho não sai mais
    if (c0.chave.slice(6, 20) !== cad.cnpj) throw situacaoErro(c0.situacao as SituacaoCupom, 'enviar_de_novo');
    const [fotos, pagamentos] = await Promise.all([
      this.prisma.nfce_cupom_itens.findMany({ where: { cupom_id: id }, orderBy: { n_item: 'asc' } }),
      this.prisma.nfce_cupom_pagamentos.findMany({ where: { cupom_id: id }, orderBy: { ordem: 'asc' } }),
    ]);
    const linhas = await this.linhasDoReenvio(fotos, cad.crt);
    const venda: Venda = {
      itens: [],
      desconto: centavos(c0.valor_desconto),
      pagamentos: pagamentos.map((p) => ({ tPag: p.t_pag as TPag, valor: centavos(p.valor) })),
      doc: c0.consumidor_doc,
      totalEsperado: centavos(c0.valor_total),
    };
    const totais = calcularTotais(
      linhas.map((l) => ({ quantidade: l.xml.quantidade, precoCentavos: l.xml.valorUnitario })),
      venda.desconto,
      venda.pagamentos,
    );
    if ('erro' in totais || totais.total !== venda.totalEsperado) {
      throw r422('NFCE_CUPOM_INVALIDO', 'Os valores do cupom não conferem com os itens e os pagamentos.');
    }
    const cert = await this.certificado(cad.cnpj, agora);

    const t1 = await this.prisma
      .$transaction(async (tx): Promise<Reserva> => {
        const amb = await this.travarAmbiente(tx, a);
        const c = await this.cupomOu404(tx, id);
        if (c.envios >= MAX_ENVIOS) throw r409('NFCE_LIMITE_ENVIOS', FRASE_ERRO.NFCE_LIMITE_ENVIOS);
        await this.conferirAcao(tx, c, 'enviar_de_novo', agora);
        const k = await this.conferirNaTrava(tx, a, amb, agora, { enviadoEm: null, ultimaConsultaDaChave: null });
        if (k.amb.serie !== c.serie || c.chave.slice(6, 20) !== k.cnpj) throw situacaoErro(c.situacao as SituacaoCupom, 'enviar_de_novo');
        const m = await this.montarAssinado(tx, k, cert, {
          serie: c.serie,
          numero: c.numero,
          cNF: c.c_nf,
          dhEmi: agora,
          linhas,
          totais,
          venda,
        });
        const tentativa = c.envios + 1;
        await tx.nfce_cupons.update({
          where: { id },
          data: {
            chave: m.chave,
            dh_emi: agora,
            situacao: 'enviando',
            envios: tentativa,
            c_stat: null,
            x_motivo: null,
            atualizado_em: agora,
          },
        });
        for (const [k2, f] of fotos.entries()) {
          const { cupom_id: _c, n_item: _n, ...dados } = fotografia(id, f.n_item, linhas[k2], totais);
          await tx.nfce_cupom_itens.update({ where: { id: f.id }, data: dados });
        }
        const envioId = randomUUID();
        await this.abrirEnvio(tx, { id: envioId, a, cupomId: id, servico: 'autorizacao', tentativa, m, autor, cert, agora });
        return {
          ambiente: a,
          cupomId: id,
          envioId,
          tentativa,
          serie: c.serie,
          numero: c.numero,
          chave: m.chave,
          nfe: m.nfe,
          enviNFe: m.enviNFe,
          iniciadaEm: agora,
        };
      }, TX)
      .catch((e: unknown) => {
        throw erroDaMontagem(e);
      });

    await this.enviarAutorizacao(t1, cert, agora);
    return this.detalhe(id, agora);
  }

  // =========================================================================================================== consultar

  /**
   * Consulta pela chave (§5.3, tabela "Consulta"): a única saída do `sem_resposta` e do `cancelando`; opcional nos outros. Passa pelas
   * travas da consulta (2 min do envio, 1 a cada 2 min por cupom, 20 por hora; o 656 e as paradas `parada_656`/`parada_certificado`).
   * Não depende da emissão ligada: um cupom pendente precisa de saída mesmo com a emissão desligada. Nunca reenvia.
   */
  async consultar(id: string, autor: Autor, agora: Date = new Date()): Promise<CupomDetalhe> {
    const a = this.ambienteLigado();
    const c0 = await this.cupomOu404(this.prisma, id);
    if (c0.ambiente !== a) throw nfce503();
    await this.conferirAcao(this.prisma, c0, 'consultar', agora);
    const cert = await this.certificado(c0.chave.slice(6, 20), agora);

    const r1 = await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, a);
      const c = await this.cupomOu404(tx, id);
      const horas = await this.horasDoCupom(tx, id);
      const para = paraAcoes(c, horas);
      const s = situacaoEfetiva(para, agora);
      if (!acoesDoCupom(para, agora).acoes.includes('consultar')) throw situacaoErro(s, 'consultar');
      const estado = await this.estadoTravas(tx, a, amb, agora, {
        enviadoEm: inicioDaEspera({ ...para, situacao: s }),
        ultimaConsultaDaChave: horas.ultimaConsulta,
      });
      const trava = podeChamar(estado, 'consulta', agora);
      if (!trava.ok) throw erroDaTrava(trava, amb);
      const envioId = randomUUID();
      await tx.nfce_envios.create({
        data: {
          id: envioId,
          ambiente: a,
          cupom_id: id,
          servico: 'consulta',
          iniciada_em: agora,
          iniciada_por: autor.id,
          iniciada_por_nome: autor.nome,
          certificado_impressao: cert.impressaoDigital.slice(0, 64),
        },
      });
      // `envios` e `chave` de agora: a T2 só aplica a resposta se o cupom ainda está nesta tentativa (Ruling T11 I2)
      return { envioId, chave: c.chave, envios: c.envios, enviadoEm: inicioDaEspera({ ...para, situacao: s }) ?? agora };
    }, TX);

    const inicio = Date.now();
    let resp: RespostaConsulta | SefazErro;
    let erroCode: string | null = null;
    try {
      resp = await this.porta.consultar(cert, a, r1.chave);
    } catch (e) {
      ({ resp, erroCode } = comoSefazErro(e));
    }
    const duracao = Date.now() - inicio;

    const t2 = await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, a);
      const c = await this.cupomOu404(tx, id);
      const horas = await this.horasDoCupom(tx, id);
      const atual = situacaoEfetiva(paraAcoes(c, horas), agora);
      const documento = DOCUMENTO.includes(c.situacao as SituacaoCupom);
      // Ruling T11 I2: a resposta é da tentativa que existia na T1 da consulta; um "Enviar de novo" no meio (outra tentativa ou outra
      // chave) = a resposta não decide nada no cupom (só prende o número se mostra a nota) e fica no diário com `CUPOM_MUDOU`
      const mesma = c.envios === r1.envios && c.chave === r1.chave;
      // nota 7: protocolo de outra chave ou de outro ambiente = resposta inválida (não decide nada)
      let r = resp;
      if (!(r instanceof SefazErro) && r.protocolo !== null && !protocoloDoCupom(r.protocolo, r1.chave, a)) {
        r = sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
        erroCode = 'SEFAZ_RESPOSTA_INVALIDA';
      }
      const ctx: ContextoRetorno = {
        ambiente: a,
        serie: c.serie,
        numero: Number(c.numero),
        agora,
        enviadoEm: r1.enviadoEm,
        ultimo656: amb.ultimo_656_em,
      };
      let acao = acaoConsulta(r, atual, ctx);
      // Ruling T11 I1: a autorização vale para a tentativa do `digVal`; sem ela no banco = resposta inválida (número preso)
      let nfe: string | null = null;
      let semTentativa = false;
      if (mesma && !documento && !(r instanceof SefazErro) && precisaDaTentativa(acao, r.protocolo)) {
        nfe = await this.tentativaAutorizada(tx, id, c.chave, r.protocolo?.digVal ?? null);
        if (nfe === null) {
          semTentativa = true;
          this.erroDigval(c, 'consulta');
          r = sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
          erroCode = 'SEFAZ_RESPOSTA_INVALIDA';
          acao = acaoConsulta(r, atual, ctx);
        }
      }
      await tx.nfce_envios.update({
        where: { id: r1.envioId },
        data: {
          ...fechamento(r, erroCode, duracao, agora, acao.rejeicao),
          ...(resp instanceof SefazErro ? {} : { xml_retorno: resp.xmlRetorno }),
          ...(r instanceof SefazErro
            ? {}
            : {
                c_stat_lote: cStatGravavel(r.cStat),
                c_stat: cStatGravavel(r.protocolo?.cStat),
                x_motivo: motivoSefaz(r.xMotivo) || null,
                n_prot: r.protocolo?.nProt ?? null,
                dh_recbto: r.protocolo?.dhRecbto ?? null,
                dig_val: r.protocolo?.digVal ?? null,
              }),
          ...(mesma || r instanceof SefazErro ? {} : { erro_code: ERRO_CUPOM_MUDOU }),
        },
      });
      let dados: Prisma.nfce_cuponsUpdateInput | null;
      if (!mesma) {
        const prende = !documento && c.numero_reaproveitavel && !(r instanceof SefazErro) && mostraANota(r);
        dados = prende ? { numero_reaproveitavel: false, atualizado_em: agora } : null;
      } else if (semTentativa) {
        dados = documento ? null : { situacao: 'sem_resposta', numero_reaproveitavel: false, atualizado_em: agora };
      } else {
        dados = cupomDepoisDaConsulta(c, acao, r, agora, nfe);
      }
      if (dados) await tx.nfce_cupons.update({ where: { id }, data: dados });
      await this.aplicarNoAmbiente(tx, amb, efeitoDe(acao, r instanceof SefazErro ? null : r.cStat), agora);
      return {
        antes: c.situacao as SituacaoCupom,
        depois: !mesma ? (c.situacao as SituacaoCupom) : semTentativa ? 'sem_resposta' : acao.cupom,
        lanca: c.lanca_venda && c.ambiente === 'producao',
        lancada: c.venda_lancada_em !== null,
      };
    }, TX);
    this.logEnvio({ a, servico: 'consulta', serie: c0.serie, numero: c0.numero, resp, duracao, tentativa: null });

    if (t2.depois === 'autorizado' && t2.antes !== 'autorizado' && t2.antes !== 'cancelando' && t2.lanca)
      await this.t3(id, 'lancar', agora);
    if (t2.depois === 'cancelado' && t2.antes !== 'cancelado' && t2.lancada) await this.t3(id, 'desfazer', agora);
    return this.detalhe(id, agora);
  }

  // =========================================================================================================== descartar

  /**
   * Descartar (UX 4.5): só nas situações de número livre (`nao_enviado`, `nao_consta`, `rejeitado`; no 539 também, mas o número não
   * volta). Motivo de 3 a 255 caracteres depois de aparar (UX 10.16). Não fala com a SEFAZ; sob a trava do ambiente, para não cruzar
   * com a escolha do número. Não depende da emissão ligada.
   */
  async descartar(id: string, motivo: string, autor: Autor, agora: Date = new Date()): Promise<CupomDetalhe> {
    this.ambienteLigado();
    const m = (motivo ?? '').trim();
    if (tamanho(m) < 3 || tamanho(m) > 255)
      throw new BadRequestException({ code: 'NFCE_MOTIVO', message: FRASE_ERRO.NFCE_MOTIVO('descartar') });
    const c0 = await this.cupomOu404(this.prisma, id);
    await this.prisma.$transaction(async (tx) => {
      await this.travarAmbiente(tx, c0.ambiente as AmbienteSefaz);
      const c = await this.cupomOu404(tx, id);
      await this.conferirAcao(tx, c, 'descartar', agora);
      await tx.nfce_cupons.update({
        where: { id },
        data: { situacao: 'descartado', descartado_em: agora, descarte_motivo: m, atualizado_em: agora },
      });
    }, TX);
    this.logger.log(JSON.stringify({ evento: 'nfce.descarte', ambiente: c0.ambiente, serie: c0.serie, numero: Number(c0.numero) }));
    return this.detalhe(id, agora);
  }

  // =========================================================================================================== venda no estoque

  /**
   * "Lançar no estoque de novo" / "Tirar a venda do estoque" (UX 3.2): refaz a T3 conforme a situação. Não fala com a SEFAZ: funciona
   * também com o servidor desligado. A falha não é erro HTTP: o cupom volta com a frase nova em `venda_erro`.
   */
  async lancarVenda(id: string, agora: Date = new Date()): Promise<CupomDetalhe> {
    const c = await this.cupomOu404(this.prisma, id);
    const v = vendaEstoque({
      situacao: c.situacao as SituacaoCupom,
      ambiente: c.ambiente as AmbienteSefaz,
      lanca_venda: c.lanca_venda,
      venda_lancada_em: c.venda_lancada_em,
      venda_desfeita_em: c.venda_desfeita_em,
    });
    if (v === 'pendente') await this.t3(id, 'lancar', agora);
    else if (v === 'desfazer_pendente') await this.t3(id, 'desfazer', agora);
    else throw situacaoErro(c.situacao as SituacaoCupom, 'lancar_venda');
    return this.detalhe(id, agora);
  }

  // =========================================================================================================== testar a conexão

  /** "Testar a conexão" (status do serviço): no máximo 1 a cada 5 min, e sob as mesmas paradas e o teto de recusas (T9-3). */
  async testarConexao(autor: Autor, agora: Date = new Date()): Promise<TesteConexao> {
    const a = this.ambienteLigado();
    const conf = await this.prisma.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    const cert = await this.certificado(normalizarCnpj(conf?.cnpj ?? ''), agora);

    const envioId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, a);
      const trava = podeChamar(await this.estadoTravas(tx, a, amb, agora, {}), 'status', agora);
      if (!trava.ok) throw erroDaTrava(trava, amb);
      await tx.nfce_envios.create({
        data: {
          id: envioId,
          ambiente: a,
          servico: 'status',
          iniciada_em: agora,
          iniciada_por: autor.id,
          iniciada_por_nome: autor.nome,
          certificado_impressao: cert.impressaoDigital.slice(0, 64),
        },
      });
      await tx.nfce_ambientes.update({ where: { ambiente: a }, data: { ultimo_status_em: agora } });
    }, TX);

    const inicio = Date.now();
    let resp: RespostaStatus | SefazErro;
    let erroCode: string | null = null;
    try {
      resp = await this.porta.status(cert, a);
    } catch (e) {
      ({ resp, erroCode } = comoSefazErro(e));
    }
    const duracao = Date.now() - inicio;

    const frase = await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, a);
      const acao = acaoStatus(resp, { agora, ultimo656: amb.ultimo_656_em });
      await tx.nfce_envios.update({
        where: { id: envioId },
        data: {
          ...fechamento(resp, erroCode, duracao, agora, acao.rejeicao),
          ...(resp instanceof SefazErro
            ? {}
            : { c_stat_lote: cStatGravavel(resp.cStat), x_motivo: motivoSefaz(resp.xMotivo) || null, dh_recbto: resp.dhRecbto }),
        },
      });
      const efeito: Efeito = {
        ambiente: acao.ambiente,
        mensagem: acao.ambiente ? acao.frase : null,
        bloquear656: acao.bloquear656,
        bloqueadoAte: acao.bloqueadoAte,
        codigo: acao.codigo,
        dhRecbto: resp instanceof SefazErro ? null : resp.dhRecbto,
      };
      const relogio = await this.aplicarNoAmbiente(tx, amb, efeito, agora);
      return { acao, relogio };
    }, TX);
    this.logEnvio({ a, servico: 'status', serie: null, numero: null, resp, duracao, tentativa: null });
    return {
      em_operacao: frase.acao.emOperacao && !frase.relogio,
      codigo: frase.acao.codigo,
      frase: frase.relogio ? FRASE_RETORNO.relogio : frase.acao.frase,
      agora,
      testar_de_novo_em: mais(agora, STATUS_CADA_MS),
    };
  }

  // =========================================================================================================== ligar e desligar

  /**
   * "Ligar a emissão de cupons" / "Desligar a emissão" (§7.1; UX 5.1), só no ambiente do servidor. Ligar confere a lista "falta" do
   * cadastro (a mesma da tela; valendo: o teste no modo de teste e a resposta do estoque têm código próprio) e, valendo, as três
   * confirmações; grava o trio (ambiente, CNPJ, série) e quem ligou, e limpa a parada e a mensagem. O bloqueio do 656 (`bloqueado_ate`,
   * `ultimo_656_em`) fica: ligar de novo não encurta a espera.
   */
  async ligarEmissao(
    a: AmbienteSefaz,
    ligada: boolean,
    confirmado: boolean,
    autor: Autor,
    agora: Date = new Date(),
  ): Promise<SituacaoCupomFiscal> {
    const servidor = this.ambienteLigado();
    if (a !== servidor) throw naoAchei();
    if (ligada) {
      if (a === 'producao' && confirmado !== true) throw invalido(FRASES_EMISSAO.confirmacoes);
      const falta = (await this.cadastro.situacao(agora)).falta;
      const basicos = falta.filter((f) => !FALTA_VALENDO.includes(f.codigo));
      if (basicos.length > 0)
        throw r422('NFCE_CONFIG_INCOMPLETA', FRASE_ERRO.NFCE_CONFIG_INCOMPLETA(basicos.map((f) => minuscula(f.texto))));
      if (falta.some((f) => f.codigo === 'teste_homologacao')) throw r422('NFCE_PRODUCAO_SEM_TESTE', FRASE_ERRO.NFCE_PRODUCAO_SEM_TESTE);
      if (falta.some((f) => f.codigo === 'lanca_venda')) throw r422('NFCE_LANCA_VENDA_PENDENTE', FRASE_ERRO.NFCE_LANCA_VENDA_PENDENTE);
    }
    await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, a);
      const quem = { alterada_por: autor.id, alterada_por_nome: autor.nome, alterada_em: agora };
      if (!ligada) {
        await tx.nfce_ambientes.update({ where: { ambiente: a }, data: { emissao_ligada: false, ...quem } });
      } else {
        const cnpj = await this.cnpjDaEmpresa(tx);
        if (cnpj === null || amb.serie === null) {
          throw r422('NFCE_CONFIG_INCOMPLETA', FRASE_ERRO.NFCE_CONFIG_INCOMPLETA([minuscula(TEXTO_FALTA.cnpj)]));
        }
        await tx.nfce_ambientes.update({
          where: { ambiente: a },
          data: { emissao_ligada: true, ligada_cnpj: cnpj, ligada_serie: amb.serie, situacao: 'ok', mensagem: null, ...quem },
        });
      }
      await tx.nfce_ambientes_historico.create({
        data: {
          ambiente: a,
          evento: ligada ? 'ligada' : 'desligada',
          situacao: ligada ? 'ok' : amb.situacao,
          feito_por: autor.id,
          feito_por_nome: autor.nome,
          feito_em: agora,
        },
      });
    }, TX);
    return this.cadastro.situacao(agora);
  }

  // =========================================================================================================== o cupom para a tela

  /** O cupom com as horas, as ações e a recusa calculadas no servidor (desenho §8.2): o mesmo formato do POST e do GET. */
  async detalhe(id: string, agora: Date = new Date()): Promise<CupomDetalhe> {
    const c = await this.cupomOu404(this.prisma, id);
    const [itens, pagamentos, envios] = await Promise.all([
      this.prisma.nfce_cupom_itens.findMany({ where: { cupom_id: id }, orderBy: { n_item: 'asc' } }),
      this.prisma.nfce_cupom_pagamentos.findMany({ where: { cupom_id: id }, orderBy: { ordem: 'asc' } }),
      this.prisma.nfce_envios.findMany({
        where: { cupom_id: id, servico: { in: ['autorizacao', 'consulta'] } },
        orderBy: [{ iniciada_em: 'desc' }, { tentativa: 'desc' }],
        select: {
          servico: true,
          iniciada_em: true,
          terminada_em: true,
          resultado: true,
          c_stat_lote: true,
          c_stat: true,
          x_motivo: true,
          n_prot: true,
          dh_recbto: true,
          dig_val: true,
          erro_code: true,
        },
      }),
    ]);
    const horas = horasDe(envios);
    const para = paraAcoes(c, horas);
    const s = situacaoEfetiva(para, agora);
    const { acoes, consultar_a_partir_de, cancelar_ate } = acoesDoCupom(para, agora);
    // a consulta que voltou depois de um "Enviar de novo" não decidiu nada: não é ela que explica a situação
    const ultimo = envios.find((e) => e.erro_code !== ERRO_CUPOM_MUDOU);
    const recusa = COM_RECUSA.includes(s) && ultimo?.resultado === 'respondida' ? recusaDoEnvio(ultimo, c, s) : null;
    const mensagem =
      recusa?.frase ??
      (s === 'nao_enviado'
        ? FRASE_RETORNO.naoEnviado
        : s === 'sem_resposta'
          ? FRASE_RETORNO.semResposta(consultar_a_partir_de ?? agora)
          : null);
    return {
      id: c.id,
      ambiente: c.ambiente as AmbienteSefaz,
      serie: c.serie,
      numero: Number(c.numero),
      chave: c.chave,
      situacao: s,
      dh_emi: c.dh_emi,
      envios: c.envios,
      numero_reaproveitavel: c.numero_reaproveitavel,
      consumidor_doc: c.consumidor_doc,
      valor_produtos_centavos: centavosNum(c.valor_produtos),
      valor_desconto_centavos: centavosNum(c.valor_desconto),
      valor_total_centavos: centavosNum(c.valor_total),
      valor_troco_centavos: centavosNum(c.valor_troco),
      itens: itens.map((i) => ({
        n_item: i.n_item,
        item_cardapio_id: i.item_cardapio_id,
        nome_cardapio: i.nome_cardapio,
        x_prod: i.x_prod,
        unidade: i.unidade,
        quantidade: i.quantidade.toFixed(4),
        valor_unitario_centavos: centavosNum(i.valor_unitario),
        valor_bruto_centavos: centavosNum(i.valor_bruto),
        valor_desconto_centavos: centavosNum(i.valor_desconto),
        perfil_nome: i.perfil_nome,
      })),
      pagamentos: pagamentos.map((p) => ({ t_pag: p.t_pag, valor_centavos: centavosNum(p.valor) })),
      autorizada_em: c.autorizada_em,
      n_prot: c.n_prot,
      c_stat: c.c_stat,
      x_motivo: c.x_motivo,
      alerta: c.alerta_c_msg !== null || c.alerta_x_msg !== null ? { c_msg: c.alerta_c_msg, x_msg: c.alerta_x_msg } : null,
      cancelado_em: c.cancelado_em,
      cancelamento_motivo: c.cancelamento_motivo,
      cancelamento_n_prot: c.cancelamento_n_prot,
      cancelamento_pedido_em: c.cancelamento_pedido_em,
      venda_estoque: vendaEstoque({ ...para, situacao: s }),
      venda_erro: c.venda_erro,
      descartado_em: c.descartado_em,
      descarte_motivo: c.descarte_motivo,
      emitido_por_nome: c.emitido_por_nome,
      criado_em: c.criado_em,
      agora,
      consultar_a_partir_de,
      cancelar_ate,
      acoes,
      recusa,
      mensagem,
    };
  }

  // =========================================================================================================== peças
  // As peças sem `private` (e as funções exportadas do fim do arquivo) servem também ao cancelamento (`cancelamento.service.ts`), que
  // segue o mesmo T1 → rede → T2 → T3 sob a mesma trava do ambiente. Fora do módulo cupom-fiscal, ninguém as usa.

  /** `NFCE_AMBIENTE` do servidor; desligado = 503 (tudo que fala com a SEFAZ ou muda a emissão). */
  ambienteLigado(): AmbienteSefaz {
    const s = this.cadastro.ambienteDoServidor();
    if (s === 'desligado') throw nfce503();
    return s;
  }

  private segredo(): string {
    const s = this.config.get<string>('CERTIFICADO_SECRET') || '';
    return s.length >= 16 ? s : '';
  }

  private async cnpjDaEmpresa(db: Pick<Tx, 'configuracoes'> = this.prisma): Promise<string | null> {
    const c = await db.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    const n = normalizarCnpj(c?.cnpj ?? '');
    return cnpjValido(n) ? n : null;
  }

  async cupomOu404(db: Pick<Tx, 'nfce_cupons'>, id: string): Promise<nfce_cupons> {
    const c = await db.nfce_cupons.findUnique({ where: { id } });
    if (!c) throw naoAchei();
    return c;
  }

  /** O cupom já emitido com esta chave: o id (mesmo corpo) ou 409 (outro corpo, UX 10.2). */
  private async porIdempotencia(db: Pick<Tx, 'nfce_cupons'>, chave: string, hash: string): Promise<string | null> {
    const c = await db.nfce_cupons.findFirst({ where: { chave_idempotencia: chave }, select: { id: true, pedido_hash: true } });
    if (!c) return null;
    if (c.pedido_hash !== hash) throw r409('NFCE_CHAVE_REUSADA', FRASE_ERRO.NFCE_CHAVE_REUSADA);
    return c.id;
  }

  /** `SELECT … FOR UPDATE` na linha do ambiente: põe na fila a numeração e as travas do 656 (desenho §4.2). */
  async travarAmbiente(tx: Tx, a: AmbienteSefaz): Promise<nfce_ambientes> {
    await tx.$queryRaw`SELECT ambiente FROM nfce_ambientes WHERE ambiente = ${a} FOR UPDATE`;
    const l = await tx.nfce_ambientes.findUnique({ where: { ambiente: a } });
    if (!l) throw new Error(`nfce_ambientes sem a linha ${a} (migração nfce)`);
    return l;
  }

  /** As horas do diário que as travas e as ações usam: o último envio de autorização e a última consulta deste cupom. */
  async horasDoCupom(tx: Pick<Tx, 'nfce_envios'>, id: string): Promise<HorasDoCupom> {
    const envios = await tx.nfce_envios.findMany({
      where: { cupom_id: id, servico: { in: ['autorizacao', 'consulta'] } },
      select: { servico: true, iniciada_em: true },
      orderBy: { iniciada_em: 'desc' },
    });
    return horasDe(envios);
  }

  /** O estado das travas do ambiente: recusas e consultas da última hora (e as "no futuro"), mais o que for do cupom. */
  async estadoTravas(
    tx: Pick<Tx, 'nfce_envios'>,
    a: AmbienteSefaz,
    amb: nfce_ambientes,
    agora: Date,
    doCupom: Pick<EstadoTravas, 'enviadoEm' | 'ultimaConsultaDaChave'>,
  ): Promise<EstadoTravas> {
    const desde = new Date(agora.getTime() - HORA_MS);
    // em sequência: dentro da transação interativa as consultas vão por uma conexão só
    const recusas = await tx.nfce_envios.findMany({
      where: { ambiente: a, rejeicao: true, iniciada_em: { gte: desde } },
      select: { iniciada_em: true },
    });
    const consultas = await tx.nfce_envios.findMany({
      where: { ambiente: a, servico: 'consulta', iniciada_em: { gte: desde } },
      select: { iniciada_em: true },
    });
    return {
      situacao: amb.situacao as SituacaoAmbiente,
      bloqueado_ate: amb.bloqueado_ate,
      recusas: recusas.map((r) => r.iniciada_em),
      consultas: consultas.map((r) => r.iniciada_em),
      ultimo_status_em: amb.ultimo_status_em,
      // nota 5: sempre presentes (sem eles as esperas da consulta somem sem erro)
      enviadoEm: doCupom.enviadoEm ?? null,
      ultimaConsultaDaChave: doCupom.ultimaConsultaDaChave ?? null,
    };
  }

  /** A ação está entre as do cupom agora (`acoesDoCupom`, com o `enviando` vencido); senão 409 com o rótulo da situação. */
  private async conferirAcao(tx: Pick<Tx, 'nfce_envios'>, c: nfce_cupons, acao: AcaoCupom, agora: Date): Promise<void> {
    const para = paraAcoes(c, await this.horasDoCupom(tx, c.id));
    if (!acoesDoCupom(para, agora).acoes.includes(acao)) throw situacaoErro(situacaoEfetiva(para, agora), acao);
  }

  /**
   * O cadastro que a emissão precisa, lido sem trava e antes de tudo (desenho §4.2, passo 1): a emissão ligada com o mesmo trio, e
   * empresa, série e CSC completos. Falta = 422 com os itens da UX 5.1.
   */
  private async cadastroPronto(
    a: AmbienteSefaz,
    db: Pick<Tx, 'nfce_ambientes' | 'nfce_emitente' | 'configuracoes'> = this.prisma,
  ): Promise<Cadastro> {
    // em sequência: na T1 `db` é a transação interativa (uma conexão só)
    const amb = await db.nfce_ambientes.findUnique({ where: { ambiente: a } });
    const emitente = await db.nfce_emitente.findUnique({ where: { id: 1 } });
    const conf = await db.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true, razao_social: true, nome_fantasia: true } });
    if (!amb || !emitente) throw new Error('nfce_ambientes/nfce_emitente sem as linhas da migração nfce');
    const cnpj = normalizarCnpj(conf?.cnpj ?? '');
    const cnpjOk = cnpjValido(cnpj);
    const trioOk = amb.emissao_ligada && amb.serie !== null && amb.ligada_serie === amb.serie && cnpjOk && amb.ligada_cnpj === cnpj;
    if (!trioOk) {
      throw r409('NFCE_EMISSAO_DESLIGADA', amb.emissao_ligada ? FRASES_CADASTRO.trioMudou : FRASE_ERRO.NFCE_EMISSAO_DESLIGADA);
    }
    const s = this.segredo();
    const csc = amb.csc_cifrado !== null && s !== '' ? decifrarCsc(amb.csc_cifrado, s) : null;
    const crt = crtDe(emitente);
    const falta: [boolean, string][] = [
      [emitente.ie === null, TEXTO_FALTA.ie],
      [crt === null, TEXTO_FALTA.crt],
      [!(emitente.logradouro && emitente.numero && emitente.bairro && emitente.cep), TEXTO_FALTA.endereco],
      [amb.serie === null, TEXTO_FALTA.serie(a)],
      [amb.id_csc === null || csc === null, TEXTO_FALTA.csc(a)],
    ];
    const itens = falta.filter(([f]) => f).map(([, t]) => minuscula(t));
    if (itens.length > 0) throw r422('NFCE_CONFIG_INCOMPLETA', FRASE_ERRO.NFCE_CONFIG_INCOMPLETA(itens));
    return {
      amb,
      emitente,
      conf: { cnpj, razao_social: conf?.razao_social ?? '', nome_fantasia: conf?.nome_fantasia ?? '' },
      cnpj,
      crt: crt as Crt,
      csc: csc as string,
    };
  }

  /**
   * Dentro da T1, sob a trava: o cadastro de novo (nota 12: o trio e a série fora das do caixa de hoje, cinto e suspensório) e as travas
   * da emissão (`podeChamar`, com todas as paradas e o teto de recusas).
   */
  private async conferirNaTrava(
    tx: Tx,
    a: AmbienteSefaz,
    amb: nfce_ambientes,
    agora: Date,
    doCupom: Pick<EstadoTravas, 'enviadoEm' | 'ultimaConsultaDaChave'>,
  ): Promise<Cadastro> {
    const c = await this.cadastroPronto(a, tx);
    if (c.emitente.series_outro_sistema.includes(c.amb.serie as number)) throw r422('NFCE_SERIE_INVALIDA', FRASE_ERRO.NFCE_SERIE_INVALIDA);
    const trava = podeChamar(await this.estadoTravas(tx, a, amb, agora, doCupom), 'autorizacao', agora);
    if (!trava.ok) throw erroDaTrava(trava, amb);
    return c;
  }

  /**
   * O número (desenho §4.3): o menor de cupom `descartado` com `numero_reaproveitavel`, abaixo do próximo, que nenhum outro cupom da
   * série prende (vivo, ou descartado no 539: o descarte antigo de um número que voltou 539 não o libera); senão o próximo (e soma 1).
   */
  private async escolherNumero(
    tx: Tx,
    a: AmbienteSefaz,
    serie: number,
    proximo: bigint,
  ): Promise<{ numero: bigint; avancar: bigint | null }> {
    const descartados = await tx.nfce_cupons.findMany({
      where: { ambiente: a, serie, situacao: 'descartado', numero_reaproveitavel: true, numero: { lt: proximo } },
      select: { numero: true },
      orderBy: { numero: 'asc' },
    });
    const vistos = new Set<bigint>();
    for (const { numero } of descartados) {
      if (vistos.has(numero)) continue;
      vistos.add(numero);
      const preso = await tx.nfce_cupons.findFirst({
        where: { ambiente: a, serie, numero, OR: [{ situacao: { not: 'descartado' } }, { numero_reaproveitavel: false }] },
        select: { id: true },
      });
      if (!preso) return { numero, avancar: null };
    }
    return { numero: proximo, avancar: proximo + 1n };
  }

  /** Monta (`montarNfe`), assina, põe o QR e embrulha no lote com um `idLote` novo. Recusa = MontagemNfceErro/AssinaturaErro (422). */
  private async montarAssinado(
    tx: Tx,
    c: Cadastro,
    cert: CertificadoEmUso,
    x: { serie: number; numero: bigint; cNF: string; dhEmi: Date; linhas: Linha[]; totais: Totais; venda: Venda },
  ): Promise<Montado> {
    const a = c.amb.ambiente as AmbienteSefaz;
    const tpAmb = a === 'producao' ? 1 : 2;
    const chave = montarChaveNfce({ aamm: aammDe(x.dhEmi), cnpj: c.cnpj, serie: x.serie, numero: Number(x.numero), tpEmis: 1, cNF: x.cNF });
    const e = c.emitente;
    const respTec =
      e.resp_tec_cnpj && e.resp_tec_contato && e.resp_tec_email && e.resp_tec_fone
        ? { cnpj: e.resp_tec_cnpj, contato: e.resp_tec_contato, email: e.resp_tec_email, fone: e.resp_tec_fone }
        : null;
    const dados: DadosNfce = {
      tpAmb,
      chave,
      cNF: x.cNF,
      serie: x.serie,
      numero: Number(x.numero),
      dhEmi: x.dhEmi,
      natOp: e.nat_op,
      emitente: {
        cnpj: c.cnpj,
        razaoSocial: c.conf.razao_social,
        nomeFantasia: vazioParaNull(c.conf.nome_fantasia),
        ie: e.ie as string,
        crt: c.crt,
        logradouro: e.logradouro as string,
        numero: e.numero as string,
        complemento: e.complemento,
        bairro: e.bairro as string,
        codMunicipio: e.cod_municipio,
        municipio: e.municipio,
        uf: e.uf,
        cep: e.cep as string,
        telefone: e.telefone,
      },
      consumidorDoc: x.venda.doc,
      itens: x.linhas.map((l) => l.xml),
      totais: x.totais,
      pagamentos: x.venda.pagamentos,
      infCpl: e.inf_cpl,
      respTec,
    };
    const nfe = montarNfe(dados);
    const assinada = assinarXmlEnveloped(nfe, `NFe${chave}`, cert);
    const qr = qrCodeV2({ chave, tpAmb, idCsc: c.amb.id_csc as number, csc: c.csc });
    const comSupl = inserirSupl(assinada, qr, URL_CHAVE[a]);
    const [lote] = await tx.$queryRaw<{ id: bigint }[]>`SELECT nextval('nfce_id_lote_seq') AS id`;
    const idLote = BigInt(lote.id);
    return { chave, nfe: comSupl, enviNFe: corpoEnviNfe(idLote, comSupl), idLote };
  }

  /** A linha aberta do diário (`resultado` nulo) com o XML assinado (nunca o CSC: o QR leva só o hash) e o `idLote`. */
  private async abrirEnvio(
    tx: Tx,
    x: {
      id: string;
      a: AmbienteSefaz;
      cupomId: string;
      servico: 'autorizacao';
      tentativa: number;
      m: Montado;
      autor: Autor;
      cert: CertificadoEmUso;
      agora: Date;
    },
  ): Promise<void> {
    await tx.nfce_envios.create({
      data: {
        id: x.id,
        ambiente: x.a,
        cupom_id: x.cupomId,
        servico: x.servico,
        tentativa: x.tentativa,
        id_lote: x.m.idLote,
        iniciada_em: x.agora,
        xml_enviado: x.m.nfe,
        iniciada_por: x.autor.id,
        iniciada_por_nome: x.autor.nome,
        certificado_impressao: x.cert.impressaoDigital.slice(0, 64),
      },
    });
  }

  /** Rede (fora de transação) → T2 → T3 do envio de autorização reservado na T1. */
  private async enviarAutorizacao(r: Reserva, cert: CertificadoEmUso, agora: Date): Promise<void> {
    const inicio = Date.now();
    let resp: RespostaAutorizacao | SefazErro;
    let erroCode: string | null = null;
    try {
      resp = await this.porta.autorizar(cert, r.ambiente, r.enviNFe);
    } catch (e) {
      ({ resp, erroCode } = comoSefazErro(e));
    }
    const duracao = Date.now() - inicio;

    const t2 = await this.prisma.$transaction(async (tx) => {
      const amb = await this.travarAmbiente(tx, r.ambiente);
      const c = await this.cupomOu404(tx, r.cupomId);
      const documento = DOCUMENTO.includes(c.situacao as SituacaoCupom);
      // nota 7: protocolo de outra chave ou de outro ambiente = resposta inválida: não grava autorização (o número fica preso)
      let validada = resp;
      if (!(validada instanceof SefazErro) && validada.protocolo !== null && !protocoloDoCupom(validada.protocolo, r.chave, r.ambiente)) {
        validada = sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
        erroCode = 'SEFAZ_RESPOSTA_INVALIDA';
      }
      const ctx: ContextoRetorno = {
        ambiente: r.ambiente,
        serie: r.serie,
        numero: Number(r.numero),
        agora,
        enviadoEm: r.iniciadaEm,
        ultimo656: amb.ultimo_656_em,
      };
      // `acao` = o que a resposta faz no ambiente e no teto (vale sempre, inclusive o 656 do lote que trouxe protNFe)
      const acao = acaoAutorizacao(validada, ctx);
      const p = validada instanceof SefazErro ? null : validada.protocolo;
      // Ruling T11 I1: o nfeProc é da tentativa do `digVal` (sem `digVal`, a única desta chave que saiu); sem ela = resposta inválida
      let efetiva = validada;
      let doCupom = acao;
      let nfe = r.nfe;
      let semTentativa = false;
      if ((acao.cupom === 'autorizado' || acao.cupom === 'denegado') && p !== null) {
        const t = await this.tentativaAutorizada(tx, r.cupomId, r.chave, p.digVal);
        if (t === null) {
          semTentativa = true;
          this.erroDigval(c, 'autorizacao');
          efetiva = sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
          erroCode = 'SEFAZ_RESPOSTA_INVALIDA';
          doCupom = acaoAutorizacao(efetiva, ctx);
        } else {
          nfe = t;
        }
      }
      const pe = efetiva instanceof SefazErro ? null : efetiva.protocolo;
      await tx.nfce_envios.update({
        where: { id: r.envioId },
        data: {
          ...fechamento(efetiva, erroCode, duracao, agora, acao.rejeicao),
          ...(resp instanceof SefazErro ? {} : { xml_retorno: resp.xmlRetorno }),
          ...(efetiva instanceof SefazErro
            ? {}
            : {
                c_stat_lote: cStatGravavel(efetiva.cStatLote),
                c_stat: cStatGravavel(pe?.cStat),
                x_motivo: motivoSefaz(pe ? pe.xMotivo : efetiva.xMotivoLote) || null,
                n_prot: pe?.nProt ?? null,
                dh_recbto: pe?.dhRecbto ?? efetiva.dhRecbto,
                dig_val: pe?.digVal ?? null,
              }),
        },
      });
      // a T2 grava no cupom se ele ainda está nesta tentativa; ou, se ele já seguiu (uma consulta o resolveu depois de 2 min) mas a
      // SEFAZ autorizou ou negou ESTA chave, grava assim mesmo (Ruling T11 I2): a nota é dela, e o número nunca pode voltar
      const desta = c.situacao === 'enviando' && c.envios === r.tentativa;
      const temNota = !semTentativa && (doCupom.cupom === 'autorizado' || doCupom.cupom === 'denegado');
      const foraDaVez = !desta && temNota && !documento && c.situacao !== 'descartado' && c.chave === r.chave;
      if (desta || foraDaVez) {
        await tx.nfce_cupons.update({
          where: { id: r.cupomId },
          data: {
            ...dadosDaAutorizacao(doCupom, efetiva, nfe, agora),
            ...(foraDaVez ? { dh_emi: r.iniciadaEm } : {}),
            ...(semTentativa ? { numero_reaproveitavel: false } : {}),
          },
        });
      } else if (!documento && (temNota || semTentativa) && c.numero_reaproveitavel) {
        // a SEFAZ tem a nota deste número, mas o cupom já é outra coisa: o número não volta, e o suporte precisa ver
        await tx.nfce_cupons.update({ where: { id: r.cupomId }, data: { numero_reaproveitavel: false, atualizado_em: agora } });
        this.logger.error(
          JSON.stringify({
            evento: 'nfce.envio',
            alerta: 'autorizacao_fora_da_vez',
            ambiente: c.ambiente,
            serie: c.serie,
            numero: Number(c.numero),
            situacao: c.situacao,
          }),
        );
      }
      const codigo = validada instanceof SefazErro ? null : (p?.cStat ?? validada.cStatLote);
      await this.aplicarNoAmbiente(
        tx,
        amb,
        { ...efeitoDe(acao, codigo), dhRecbto: validada instanceof SefazErro ? null : (p?.dhRecbto ?? validada.dhRecbto) },
        agora,
      );
      // a T3 só se esta T2 gravou a autorização (quem resolveu o cupom antes já cuidou da venda)
      return { acao: doCupom, lanca: (desta || foraDaVez) && c.lanca_venda && c.ambiente === 'producao' };
    }, TX);
    this.logEnvio({ a: r.ambiente, servico: 'autorizacao', serie: r.serie, numero: r.numero, resp, duracao, tentativa: r.tentativa });

    if (t2.acao.cupom === 'autorizado' && t2.lanca) await this.t3(r.cupomId, 'lancar', agora);
  }

  /**
   * A NFe da tentativa autorizada (§5.1; Ruling T11 I1), entre as tentativas desta chave: a de DigestValue igual ao `digVal` do
   * protocolo; sem `digVal`, só se UMA tentativa desta chave saiu do servidor (`resultado` ≠ `falha_antes_de_enviar`; a que está em
   * andamento conta). null = a NFe autorizada não está no banco: resposta inválida, nunca outra NFe no `nfeProc`.
   */
  private async tentativaAutorizada(tx: Tx, cupomId: string, chave: string, digVal: string | null): Promise<string | null> {
    const envios = await tx.nfce_envios.findMany({
      where: { cupom_id: cupomId, servico: 'autorizacao' },
      orderBy: { iniciada_em: 'desc' },
      select: { xml_enviado: true, resultado: true },
    });
    const desta = envios.filter((e): e is { xml_enviado: string; resultado: string | null } =>
      (e.xml_enviado ?? '').includes(`Id="NFe${chave}"`),
    );
    if (digVal !== null) return desta.find((e) => digestDa(e.xml_enviado) === digVal)?.xml_enviado ?? null;
    const sairam = desta.filter((e) => e.resultado !== 'falha_antes_de_enviar');
    return sairam.length === 1 ? sairam[0].xml_enviado : null;
  }

  /** A SEFAZ diz que tem a nota, mas a NFe dela não está no banco: erro para o suporte (sem XML, chave, CPF ou CSC). */
  private erroDigval(c: nfce_cupons, servico: 'autorizacao' | 'consulta'): void {
    this.logger.error(
      JSON.stringify({
        evento: 'nfce.envio',
        alerta: 'digval_sem_tentativa',
        ambiente: c.ambiente,
        servico,
        serie: c.serie,
        numero: Number(c.numero),
      }),
    );
  }

  /**
   * O que a resposta faz no ambiente (§4.4): parada (com a mensagem e o histórico `parada_automatica`), o 656 (`bloqueado_ate` e
   * `ultimo_656_em`) e o relógio (`dhRecbto` a mais de 2 min = `parada_configuracao`). A `parada_656` desliga a emissão e não é trocada
   * por outra parada. Devolve se o relógio parou o ambiente.
   */
  async aplicarNoAmbiente(tx: Tx, amb: nfce_ambientes, e: Efeito, agora: Date): Promise<boolean> {
    let parada = e.ambiente;
    let mensagem = e.mensagem;
    let relogio = false;
    if (!parada && e.dhRecbto && relogioDiverge(e.dhRecbto, agora)) {
      parada = 'parada_configuracao';
      mensagem = FRASE_RETORNO.relogio;
      relogio = true;
    }
    const dados: Prisma.nfce_ambientesUpdateInput = {};
    if (e.bloquear656 && e.bloqueadoAte) {
      dados.bloqueado_ate = e.bloqueadoAte;
      dados.ultimo_656_em = agora;
    }
    const muda = parada !== undefined && amb.situacao !== 'parada_656';
    if (muda) {
      dados.situacao = parada;
      dados.mensagem = mensagem;
      if (parada === 'parada_656') dados.emissao_ligada = false;
    }
    if (Object.keys(dados).length === 0) return relogio;
    await tx.nfce_ambientes.update({ where: { ambiente: amb.ambiente }, data: dados });
    if (muda) {
      await tx.nfce_ambientes_historico.create({
        data: {
          ambiente: amb.ambiente,
          evento: 'parada_automatica',
          situacao: parada as string,
          c_stat: e.codigo,
          mensagem,
          feito_em: agora,
        },
      });
      this.logger.warn(
        JSON.stringify({ evento: 'nfce.envio', ambiente: amb.ambiente, alerta: 'parada', situacao: parada, c_stat: e.codigo }),
      );
    }
    return relogio;
  }

  /**
   * T3 (§3.3): a venda numa transação própria, depois da que gravou a autorização (ou o cancelamento). A falha nunca desfaz a
   * autorização: grava `venda_erro` (a frase da função do banco, ou uma frase fixa; nunca a mensagem crua do driver).
   */
  async t3(id: string, tipo: 'lancar' | 'desfazer', agora: Date): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (tipo === 'lancar') await tx.$queryRaw`SELECT nfce_lancar_venda(${id}::uuid) AS n`;
        else await tx.$queryRaw`SELECT nfce_desfazer_venda(${id}::uuid) AS n`;
      }, TX);
      return true;
    } catch (e) {
      const pg = postgresError(e);
      const frase = pg?.code === 'REGRA' && pg.message !== '' ? pg.message : FRASES_EMISSAO.vendaErro;
      await this.prisma.nfce_cupons.update({ where: { id }, data: { venda_erro: frase, atualizado_em: agora } });
      this.logger.warn(JSON.stringify({ evento: 'nfce.venda', cupom: id, tipo, erro: pg?.code ?? 'ERRO' }));
      return false;
    }
  }

  /** O certificado em uso, do mesmo CNPJ-base: o erro da porta com a frase dela (503/422), ou 422 se for de outra empresa. */
  async certificado(cnpj: string, agora: Date): Promise<CertificadoEmUso> {
    if (!cnpjValido(cnpj)) throw r422('NFCE_CONFIG_INCOMPLETA', FRASE_ERRO.NFCE_CONFIG_INCOMPLETA([minuscula(TEXTO_FALTA.cnpj)]));
    let cert: CertificadoEmUso;
    try {
      cert = await this.certificados.emUso(agora);
    } catch (e) {
      if (e instanceof CertificadoErro) throw new HttpException({ code: e.code, message: e.message }, e.status);
      throw e;
    }
    if (normalizarCnpj(cert.cnpj).slice(0, 8) !== cnpj.slice(0, 8)) {
      throw r422('CERTIFICADO_OUTRO_CNPJ', FRASES_CADASTRO.certificadoOutraEmpresa);
    }
    return cert;
  }

  /** Os itens pedidos, do cardápio e do cadastro fiscal de agora; o que não entra no cupom = 422 com o 1º motivo (UX 6.2). */
  private async linhasDaVenda(pedidos: Venda['itens'], crt: Crt): Promise<Linha[]> {
    const ids = [...new Set(pedidos.map((p) => p.id))];
    const [itens, fiscais] = await Promise.all([
      this.prisma.itens_cardapio.findMany({ where: { id: { in: ids } } }),
      this.prisma.nfce_itens.findMany({ where: { item_cardapio_id: { in: ids } } }),
    ]);
    const perfis = await this.perfisDe(fiscais);
    const item = new Map(itens.map((i) => [i.id, i]));
    const fiscal = new Map(fiscais.map((f) => [f.item_cardapio_id, f]));
    return pedidos.map((p) => {
      const i = item.get(p.id);
      if (!i) throw r422('NFCE_ITEM_INDISPONIVEL', FRASES_CADASTRO.produtoSumiu);
      const f = fiscal.get(p.id) ?? null;
      const perfil = f?.perfil_fiscal_id ? (perfis.get(f.perfil_fiscal_id) ?? null) : null;
      const motivos = motivosDe(i, f, perfil, crt);
      if (motivos.length > 0) throw r422('NFCE_ITEM_INDISPONIVEL', FRASE_ERRO.NFCE_ITEM_INDISPONIVEL(i.nome, motivos[0]));
      const preco = precoCentavos((i.preco_venda as Prisma.Decimal).toFixed());
      return linhaDe(i, f as nfce_itens, perfil as nfce_perfis_fiscais, p.quantidade, preco);
    });
  }

  /**
   * Os itens do reenvio: quantidade e preço da fotografia; os códigos fiscais, o nome no cupom e a unidade relidos do cadastro (§5.1).
   * Produto desativado ou sem preço agora ainda sai (a venda é a mesma); sem NCM, sem perfil ou com o perfil fora do regime = 422. Item
   * apagado do cardápio: vai a fotografia.
   */
  private async linhasDoReenvio(fotos: nfce_cupom_itens[], crt: Crt): Promise<Linha[]> {
    const ids = fotos.map((f) => f.item_cardapio_id).filter((x): x is string => x !== null);
    const [itens, fiscais] = await Promise.all([
      this.prisma.itens_cardapio.findMany({ where: { id: { in: ids } } }),
      this.prisma.nfce_itens.findMany({ where: { item_cardapio_id: { in: ids } } }),
    ]);
    const perfis = await this.perfisDe(fiscais);
    const item = new Map(itens.map((i) => [i.id, i]));
    const fiscal = new Map(fiscais.map((f) => [f.item_cardapio_id, f]));
    return fotos.map((foto) => {
      const quantidade = foto.quantidade.toFixed(4);
      const preco = centavos(foto.valor_unitario);
      const i = foto.item_cardapio_id === null ? undefined : item.get(foto.item_cardapio_id);
      if (!i) return linhaDaFotografia(foto, quantidade, preco);
      const f = fiscal.get(i.id) ?? null;
      const perfil = f?.perfil_fiscal_id ? (perfis.get(f.perfil_fiscal_id) ?? null) : null;
      const motivos = motivosDe(i, f, perfil, crt).filter((m) => m !== 'inativo' && m !== 'sem_preco');
      if (motivos.length > 0) throw r422('NFCE_ITEM_INDISPONIVEL', FRASE_ERRO.NFCE_ITEM_INDISPONIVEL(foto.nome_cardapio, motivos[0]));
      return { ...linhaDe(i, f as nfce_itens, perfil as nfce_perfis_fiscais, quantidade, preco), nomeCardapio: foto.nome_cardapio };
    });
  }

  private async perfisDe(fiscais: nfce_itens[]): Promise<Map<string, nfce_perfis_fiscais>> {
    const ids = [...new Set(fiscais.map((f) => f.perfil_fiscal_id).filter((x): x is string => x !== null))];
    const perfis = ids.length === 0 ? [] : await this.prisma.nfce_perfis_fiscais.findMany({ where: { id: { in: ids } } });
    return new Map(perfis.map((p) => [p.id, p]));
  }

  logEnvio(x: {
    a: AmbienteSefaz;
    servico: string;
    serie: number | null;
    numero: bigint | null;
    resp: { cStat?: number; cStatLote?: number; protocolo?: { cStat: number } | null } | SefazErro;
    duracao: number;
    tentativa: number | null;
  }): void {
    const r = x.resp;
    const cStat = r instanceof SefazErro ? null : (r.protocolo?.cStat ?? r.cStatLote ?? r.cStat ?? null);
    const resultado = r instanceof SefazErro ? (r.enviado ? 'sem_resposta' : 'falha_antes_de_enviar') : 'respondida';
    this.logger.log(
      JSON.stringify({
        evento: 'nfce.envio',
        ambiente: x.a,
        servico: x.servico,
        serie: x.serie,
        numero: x.numero === null ? null : Number(x.numero),
        c_stat: cStat,
        resultado,
        duracao_ms: x.duracao,
        tentativa: x.tentativa,
      }),
    );
  }
}

// ------------------------------------------------------------------------------------------------------------- funções do serviço

/**
 * O corpo, antes de qualquer leitura (400): chave da venda, ao menos um item, quantidade (Review Focus 1), centavos inteiros, ao menos
 * um pagamento com `tPag` da lista e valor > 0, e o documento do consumidor (CPF ou CNPJ com DV). O DTO barra o mesmo na rota; aqui é a
 * conferência do serviço (os testes e outras entradas não passam pelo DTO).
 */
function conferirCorpo(v: VendaParaCupom): Venda {
  if (typeof v.chave_idempotencia !== 'string' || !UUID.test(v.chave_idempotencia)) throw invalido(FRASES_EMISSAO.chaveDaVenda);
  if (!Array.isArray(v.itens) || v.itens.length === 0) {
    throw new BadRequestException({ code: 'NFCE_SEM_ITENS', message: FRASE_ERRO.NFCE_SEM_ITENS });
  }
  const itens = v.itens.map((i) => {
    if (typeof i?.item_cardapio_id !== 'string' || !UUID.test(i.item_cardapio_id)) throw invalido(FRASES_CADASTRO.produtoSumiu);
    if (!quantidadeValida(i.quantidade)) throw invalido(FRASES_CADASTRO.quantidade);
    return { id: i.item_cardapio_id.toLowerCase(), quantidade: i.quantidade };
  });
  const inteiro = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const desconto = v.desconto_centavos ?? 0;
  if (!inteiro(desconto) || !inteiro(v.total_esperado_centavos)) throw invalido(FRASES_EMISSAO.valorEmCentavos);
  if (!Array.isArray(v.pagamentos) || v.pagamentos.length === 0) throw invalido(FRASES_CADASTRO.tPag);
  const pagamentos = v.pagamentos.map((p) => {
    if (!T_PAG_ACEITOS.includes(p?.t_pag)) throw invalido(FRASES_CADASTRO.tPag);
    if (!inteiro(p.valor_centavos) || p.valor_centavos < 1) throw invalido(FRASES_CADASTRO.valorPagamento);
    return { tPag: p.t_pag, valor: BigInt(p.valor_centavos) };
  });
  return {
    itens,
    desconto: BigInt(desconto),
    pagamentos,
    doc: conferirDoc(v.consumidor_doc),
    totalEsperado: BigInt(v.total_esperado_centavos),
  };
}

/** CPF (11 dígitos) ou CNPJ (14 caracteres, pode ter letras), com DV; o que não confere = 400 com a frase do tipo (UX 6.2). */
function conferirDoc(s: string | null | undefined): string | null {
  const d = docNormalizado(s);
  if (d === null) return null;
  if (/^[0-9]{11}$/.test(d) && cpfValido(d)) return d;
  if (d.length === 14 && cnpjValido(d)) return d;
  const tipo = /^[0-9]+$/.test(d) && d.length <= 11 ? 'cpf' : 'cnpj';
  throw new BadRequestException({ code: 'NFCE_DOC_INVALIDO', message: FRASE_ERRO.NFCE_DOC_INVALIDO(tipo) });
}

/**
 * Os totais com os preços de agora (o servidor lê o preço, a tela nunca manda). O total esperado vem antes do pagamento: com o preço
 * novo, o que a tela cobrou pode não bastar, e o que o admin precisa saber é que o preço mudou (UX 10.1).
 */
function totaisDaVenda(linhas: Linha[], v: Venda): Totais {
  const produtos = linhas.reduce((s, l) => s + valorItemCentavos(l.xml.quantidade, l.xml.valorUnitario), 0n);
  if (v.desconto >= produtos) throw r422('NFCE_DESCONTO_INVALIDO', FRASE_ERRO.NFCE_DESCONTO_INVALIDO(produtos));
  const total = produtos - v.desconto;
  if (total !== v.totalEsperado) throw r409('NFCE_TOTAL_MUDOU', FRASE_ERRO.NFCE_TOTAL_MUDOU(total));
  const t = calcularTotais(
    linhas.map((l) => ({ quantidade: l.xml.quantidade, precoCentavos: l.xml.valorUnitario })),
    v.desconto,
    v.pagamentos,
  );
  if (!('erro' in t)) return t;
  const pago = v.pagamentos.reduce((s, p) => s + p.valor, 0n);
  switch (t.erro) {
    case 'SEM_ITENS':
      throw new BadRequestException({ code: 'NFCE_SEM_ITENS', message: FRASE_ERRO.NFCE_SEM_ITENS });
    case 'DESCONTO_INVALIDO':
      throw r422('NFCE_DESCONTO_INVALIDO', FRASE_ERRO.NFCE_DESCONTO_INVALIDO(produtos));
    case 'PAGAMENTO_INSUFICIENTE':
      throw r422('NFCE_PAGAMENTO_INSUFICIENTE', FRASE_ERRO.NFCE_PAGAMENTO_INSUFICIENTE(pago, total));
    case 'TROCO_INVALIDO':
      throw r422('NFCE_TROCO_INVALIDO', FRASE_ERRO.NFCE_TROCO_INVALIDO);
    case 'VALOR_MAXIMO':
      throw r422('NFCE_VALOR_MAXIMO', FRASES_EMISSAO.valorMaximo);
  }
}

function motivosDe(i: itens_cardapio, f: nfce_itens | null, perfil: nfce_perfis_fiscais | null, crt: Crt): MotivoProduto[] {
  return motivosDoProduto(
    {
      ativo: i.ativo,
      preco_venda: dec(i.preco_venda),
      ncm: f?.ncm ?? null,
      perfil: perfil ? perfilFiscalDe(perfil) : null,
      nome_cupom: vazioParaNull(f?.descricao_cupom) ?? i.nome,
    },
    crt,
  );
}

/**
 * O item como vai no XML (§3.1): `cProd` = código do cardápio ou o id; `xProd` = nome no cupom ou o do cardápio; unidade = a fiscal ou
 * a de venda. Os textos já cortados no tamanho da coluna da fotografia (a montagem os limpa igual).
 */
function linhaDe(i: itens_cardapio, f: nfce_itens, perfil: nfce_perfis_fiscais, quantidade: string, preco: bigint): Linha {
  const p = perfilFiscalDe(perfil);
  return {
    itemCardapioId: i.id,
    nomeCardapio: i.nome,
    perfilNome: perfil.nome,
    perfil: p,
    xml: {
      cProd: textoDoCupom(vazioParaNull(i.codigo) ?? i.id, 60),
      xProd: textoDoCupom(vazioParaNull(f.descricao_cupom) ?? i.nome, 120),
      ncm: f.ncm as string,
      cest: f.cest,
      gtin: f.gtin,
      origem: f.origem,
      cfop: p.cfop,
      unidade: textoDoCupom(vazioParaNull(f.unidade) ?? i.unidade_venda, 6),
      quantidade,
      valorUnitario: preco,
      csosn: p.csosn,
      cstIcms: p.cst_icms,
      aliqIcms: p.aliq_icms,
      pisCst: p.pis_cst,
      cofinsCst: p.cofins_cst,
    },
  };
}

/** O item apagado do cardápio depois da emissão: o reenvio leva a fotografia como está. */
function linhaDaFotografia(f: nfce_cupom_itens, quantidade: string, preco: bigint): Linha {
  const perfil: PerfilFiscal = {
    cfop: f.cfop,
    csosn: f.csosn,
    cst_icms: f.cst_icms,
    aliq_icms: dec(f.aliq_icms),
    pis_cst: f.pis_cst,
    cofins_cst: f.cofins_cst,
    c_ativ_sn: f.c_ativ_sn,
    ibs_sn_aliq: dec(f.ibs_sn_aliq),
    cbs_sn_aliq: dec(f.cbs_sn_aliq),
    ibscbs_cst: f.ibscbs_cst,
    ibscbs_cclass_trib: f.ibscbs_cclass_trib,
    ativo: true,
  };
  return {
    itemCardapioId: null,
    nomeCardapio: f.nome_cardapio,
    perfilNome: f.perfil_nome,
    perfil,
    xml: {
      cProd: f.c_prod,
      xProd: f.x_prod,
      ncm: f.ncm,
      cest: f.cest,
      gtin: f.gtin,
      origem: f.origem,
      cfop: f.cfop,
      unidade: f.unidade,
      quantidade,
      valorUnitario: preco,
      csosn: f.csosn,
      cstIcms: f.cst_icms,
      aliqIcms: dec(f.aliq_icms),
      pisCst: f.pis_cst,
      cofinsCst: f.cofins_cst,
    },
  };
}

/** A linha de `nfce_cupom_itens`: a fotografia do item e dos códigos fiscais do momento (§3.1), com o valor e o desconto rateado. */
function fotografia(cupomId: string, nItem: number, l: Linha, t: Totais) {
  const { bruto, desconto } = t.itens[nItem - 1];
  const p = l.perfil;
  return {
    cupom_id: cupomId,
    n_item: nItem,
    item_cardapio_id: l.itemCardapioId,
    nome_cardapio: l.nomeCardapio,
    c_prod: l.xml.cProd,
    x_prod: l.xml.xProd,
    ncm: l.xml.ncm,
    cest: l.xml.cest,
    gtin: l.xml.gtin,
    origem: l.xml.origem,
    unidade: l.xml.unidade,
    cfop: p.cfop,
    csosn: p.csosn,
    cst_icms: p.cst_icms,
    aliq_icms: p.aliq_icms,
    pis_cst: p.pis_cst,
    cofins_cst: p.cofins_cst,
    c_ativ_sn: p.c_ativ_sn,
    ibs_sn_aliq: p.ibs_sn_aliq,
    cbs_sn_aliq: p.cbs_sn_aliq,
    ibscbs_cst: p.ibscbs_cst,
    ibscbs_cclass_trib: p.ibscbs_cclass_trib,
    perfil_nome: l.perfilNome,
    quantidade: l.xml.quantidade,
    valor_unitario: decimal2(l.xml.valorUnitario),
    valor_bruto: decimal2(bruto),
    valor_desconto: decimal2(desconto),
  };
}

/** O cupom depois da T2 da autorização (§5.3), num UPDATE só (nota 8: o gatilho de imutável vale a partir do `autorizado`). */
function dadosDaAutorizacao(
  acao: AcaoRetorno,
  r: RespostaAutorizacao | SefazErro,
  nfe: string,
  agora: Date,
): Prisma.nfce_cuponsUpdateInput {
  const dados: Prisma.nfce_cuponsUpdateInput = { situacao: acao.cupom, atualizado_em: agora };
  if (r instanceof SefazErro) return { ...dados, c_stat: null, x_motivo: null };
  const p = r.protocolo;
  dados.c_stat = cStatGravavel(p ? p.cStat : r.cStatLote);
  dados.x_motivo = motivoSefaz(p ? p.xMotivo : r.xMotivoLote) || null;
  if ((acao.cupom === 'autorizado' || acao.cupom === 'denegado') && p !== null) {
    Object.assign(dados, {
      n_prot: p.nProt,
      dig_val: p.digVal,
      // nota 7: `autorizada_em` = o `dhRecbto` do protocolo (base dos 30 min do cancelamento)
      autorizada_em: acao.cupom === 'autorizado' ? (dataSefaz(p.dhRecbto) ?? agora) : null,
      alerta_c_msg: acao.alerta?.c_msg ?? null,
      alerta_x_msg: acao.alerta?.x_msg ?? null,
      xml_autorizado: montarNfeProc(nfe, p.xml),
      numero_reaproveitavel: false,
    });
  }
  if (acao.numeroReaproveitavel === false) dados.numero_reaproveitavel = false;
  return dados;
}

/** O fechamento da linha do diário (resultado, código do erro, duração e se conta no teto de recusas). */
export function fechamento(r: unknown, erroCode: string | null, duracao: number, agora: Date, rejeicao: boolean) {
  const resultado = r instanceof SefazErro ? (r.enviado ? 'sem_resposta' : 'falha_antes_de_enviar') : 'respondida';
  return {
    terminada_em: agora,
    resultado,
    rejeicao,
    erro_code: r instanceof SefazErro ? (erroCode ?? r.code) : null,
    duracao_ms: Math.min(Math.max(0, Math.round(duracao)), 2_147_483_647),
  };
}

/** O erro da porta como `SefazErro`; outro erro (entrada recusada antes de qualquer conexão) = não enviado, com `ERRO_LOCAL`. */
export function comoSefazErro(e: unknown): { resp: SefazErro; erroCode: string | null } {
  if (e instanceof SefazErro) return { resp: e, erroCode: null };
  return { resp: sefazErro('SEFAZ_REDE', false), erroCode: 'ERRO_LOCAL' };
}

/** Protocolo autorizado ou denegado, com `nProt`: o que a SEFAZ diz que tem e que o `nfeProc` guarda. */
const comProtocolo = (p: ProtocoloNfce | null): p is ProtocoloNfce => p !== null && p.nProt !== null && AUTORIZADO_OU_DENEGADO.has(p.cStat);

/** A consulta vai gravar a autorização (ou a denegação, ou o cancelamento de uma nota que ainda não tínhamos): precisa da tentativa. */
const precisaDaTentativa = (acao: AcaoRetorno, p: ProtocoloNfce | null): boolean =>
  (acao.cupom === 'autorizado' || acao.cupom === 'denegado' || acao.cupom === 'cancelado') && comProtocolo(p);

/**
 * O que a consulta muda no cupom (§5.1 e §5.3), num UPDATE só e respeitando o gatilho de imutável: num cupom que já é documento
 * fiscal, só a situação e os campos do cancelamento. A nota na SEFAZ (autorizada, denegada ou cancelada) prende o número (nota 9).
 * `nfe` = a tentativa autorizada (`tentativaAutorizada`), já conferida quando `precisaDaTentativa`. null = nada a gravar.
 */
function cupomDepoisDaConsulta(
  c: nfce_cupons,
  acao: AcaoRetorno,
  r: RespostaConsulta | SefazErro,
  agora: Date,
  nfe: string | null,
): Prisma.nfce_cuponsUpdateInput | null {
  const dados: Prisma.nfce_cuponsUpdateInput = {};
  if (acao.cupom !== c.situacao) dados.situacao = acao.cupom;
  const documento = DOCUMENTO.includes(c.situacao as SituacaoCupom);
  if (!(r instanceof SefazErro) && !documento) {
    const p = r.protocolo;
    if (mostraANota(r)) dados.numero_reaproveitavel = false;
    if (precisaDaTentativa(acao, p) && comProtocolo(p)) {
      if (nfe === null) throw new Error('consulta: autorização sem a tentativa conferida');
      Object.assign(dados, {
        c_stat: cStatGravavel(p.cStat),
        x_motivo: motivoSefaz(p.xMotivo) || null,
        n_prot: p.nProt,
        dig_val: p.digVal,
        autorizada_em: acao.cupom === 'denegado' ? null : (dataSefaz(p.dhRecbto) ?? agora),
        alerta_c_msg: acao.alerta?.c_msg ?? null,
        alerta_x_msg: acao.alerta?.x_msg ?? null,
        xml_autorizado: montarNfeProc(nfe, p.xml),
        numero_reaproveitavel: false,
      });
    } else if (acao.cupom === 'nao_consta') {
      Object.assign(dados, { c_stat: cStatGravavel(r.cStat), x_motivo: motivoSefaz(r.xMotivo) || null });
    }
  }
  if (acao.cupom === 'cancelado' && c.situacao !== 'cancelado' && !(r instanceof SefazErro)) {
    dados.cancelado_em = c.cancelado_em ?? agora;
    dados.cancelamento_n_prot = r.cancelamento?.nProt ?? null;
  }
  if (Object.keys(dados).length === 0) return null;
  dados.atualizado_em = agora;
  return dados;
}

/** A resposta mostra a nota na SEFAZ (autorizada, denegada ou cancelada): o número é dela para sempre (nota 9). */
function mostraANota(r: RespostaConsulta): boolean {
  return (
    (r.protocolo !== null && AUTORIZADO_OU_DENEGADO.has(r.protocolo.cStat)) ||
    AUTORIZADO_OU_DENEGADO.has(r.cStat) ||
    CANCELADA.has(r.cStat) ||
    (r.cancelamento !== null && EVENTO_REGISTRADO.has(r.cancelamento.cStat))
  );
}

export function efeitoDe(acao: AcaoRetorno, codigo: number | null): Efeito {
  return {
    ambiente: acao.ambiente,
    mensagem: acao.ambiente ? mensagemDoAmbiente(acao) : null,
    bloquear656: acao.bloquear656,
    bloqueadoAte: acao.bloqueadoAte,
    codigo,
  };
}

function horasDe(envios: { servico: string; iniciada_em: Date }[]): HorasDoCupom {
  const ultima = (s: string) =>
    envios.filter((e) => e.servico === s).reduce<Date | null>((m, e) => (m === null || e.iniciada_em > m ? e.iniciada_em : m), null);
  return { enviadoEm: ultima('autorizacao'), ultimaConsulta: ultima('consulta') };
}

export function paraAcoes(c: nfce_cupons, h: HorasDoCupom): CupomParaAcoes {
  return {
    situacao: c.situacao as SituacaoCupom,
    ambiente: c.ambiente as AmbienteSefaz,
    envios: c.envios,
    numero_reaproveitavel: c.numero_reaproveitavel,
    autorizada_em: c.autorizada_em,
    cancelamento_pedido_em: c.cancelamento_pedido_em,
    lanca_venda: c.lanca_venda,
    venda_lancada_em: c.venda_lancada_em,
    venda_desfeita_em: c.venda_desfeita_em,
    enviadoEm: h.enviadoEm,
    ultimaConsultaDaChave: h.ultimaConsulta,
  };
}

/**
 * A recusa da última chamada respondida, refeita com a mesma regra pura que decidiu (`acaoAutorizacao`/`acaoConsulta`) sobre o que o
 * diário guardou. O contexto é o da chamada (a hora dela; o "2º 656" não é refeito: a frase do cupom fica a do bloqueio, e a parada
 * aparece no ambiente).
 */
function recusaDoEnvio(
  e: Pick<
    nfce_envios,
    'servico' | 'iniciada_em' | 'terminada_em' | 'c_stat_lote' | 'c_stat' | 'x_motivo' | 'n_prot' | 'dh_recbto' | 'dig_val'
  >,
  c: nfce_cupons,
  s: SituacaoCupom,
): Recusa | null {
  const ctx: ContextoRetorno = {
    ambiente: c.ambiente as AmbienteSefaz,
    serie: c.serie,
    numero: Number(c.numero),
    agora: e.terminada_em ?? e.iniciada_em,
    enviadoEm: e.iniciada_em,
    ultimo656: null,
  };
  const protocolo: ProtocoloNfce | null =
    e.c_stat === null
      ? null
      : {
          cStat: e.c_stat,
          xMotivo: e.x_motivo ?? '',
          chave: c.chave,
          dhRecbto: e.dh_recbto ?? '',
          nProt: e.n_prot,
          digVal: e.dig_val,
          cMsg: null,
          xMsg: null,
          xml: '',
        };
  if (e.servico === 'consulta') {
    const r: RespostaConsulta = { cStat: e.c_stat_lote ?? 0, xMotivo: e.x_motivo ?? '', protocolo, cancelamento: null, xmlRetorno: '' };
    return acaoConsulta(r, s, ctx).recusa;
  }
  const r: RespostaAutorizacao = {
    cStatLote: e.c_stat_lote ?? 0,
    xMotivoLote: protocolo === null ? (e.x_motivo ?? '') : '',
    dhRecbto: null,
    protocolo,
    xmlRetorno: '',
  };
  return acaoAutorizacao(r, ctx).recusa;
}
