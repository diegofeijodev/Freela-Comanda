// Cadastro do cupom fiscal (NFC-e), rotas /v1/cupom-fiscal de leitura e cadastro: situação ("Para ligar a emissão, falta:" e pendentes),
// empresa no cupom, numeração e CSC de cada ambiente, perfis fiscais e dados do cupom de cada produto. Tudo só do admin e tudo funciona com
// o servidor desligado (`NFCE_AMBIENTE` vazia): nada aqui fala com a SEFAZ.
// Valida ANTES de gravar, com as frases de `frases.ts` / `frases-cadastro.ts` (um CHECK do banco que dispara vira 500): códigos aparados,
// máscara de NCM/CEST/GTIN/CEP/IE/telefone limpa, "" e só espaços = NULL. As regras do regime (CSOSN × CST × CFOP) são de
// `validacao-fiscal.ts`, com o CRT de agora.
// O CSC só entra cifrado (`csc.ts`, `CERTIFICADO_SECRET`, rótulo `nfce-csc`); as respostas são montadas campo a campo (nunca a linha do
// banco espalhada) e só levam `csc_dica`. O histórico do ambiente guarda o NOME do campo mudado, nunca o valor.
// Dinheiro sai em centavos inteiros (`preco_venda_centavos: number`), nunca `Decimal` (o `wire.ts` o converteria em reais).

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type nfce_ambientes, type nfce_emitente, type nfce_perfis_fiscais } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { cnpjValido, normalizarCnpj } from '../../common/fiscal/cnpj';
import { cabeNoEsquema, textoDoCupom } from '../../common/fiscal/texto-fiscal';
import { CERTIFICADO_DIGITAL, CertificadoErro, type CertificadoDigitalPort } from '../certificado-digital/certificado-digital.port';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { cifrarCsc, decifrarCsc, dicaDoCsc, FORMATO_CSC } from './csc';
import type {
  AtualizarPerfilDto,
  PerfilEmLoteDto,
  PerfilFiscalDto,
  SalvarAmbienteDto,
  SalvarEmitenteDto,
  SalvarProdutoDto,
} from './cupom-fiscal.dto';
import { FRASE_ERRO } from './frases';
import { FRASES_CADASTRO, ROTULO_EMITENTE, TEXTO_FALTA, type CodigoFalta } from './frases-cadastro';
import { tipoPendente, type SituacaoCupom, type TipoPendente } from './situacao-cupom';
import { precoCentavos } from './totais';
import type { SituacaoAmbiente } from './travas';
import {
  erroDoItemFiscal,
  erroDoPerfil,
  motivosDoProduto,
  perfilValeNoRegime,
  type Crt,
  type MotivoProduto,
  type PerfilFiscal,
} from './validacao-fiscal';

export type Autor = { id: string; nome: string };
export type AmbienteServidor = AmbienteSefaz | 'desligado';

export type ItemFalta = { codigo: CodigoFalta; texto: string };
export type Pendentes = { total: number; primeiro: { id: string; serie: number; numero: number; tipo: TipoPendente } | null };

/** GET situacao (desenho §8.2). Com o servidor desligado, `ambiente = 'desligado'` e os dados são os do valendo (como a lista de cupons). */
export interface SituacaoCupomFiscal {
  ambiente: AmbienteServidor;
  agora: Date;
  /** Ligada no banco E o trio (ambiente, CNPJ, série) ainda é o de quando foi ligada (desenho §7.1); sempre falso com o servidor desligado. */
  emissao_ligada: boolean;
  situacao: SituacaoAmbiente;
  mensagem: string | null;
  bloqueado_ate: Date | null;
  serie: number | null;
  proximo_numero: number;
  falta: ItemFalta[];
  certificado: { ok: boolean; mensagem: string | null };
  pendentes: Pendentes;
}

export interface EmitenteResposta {
  /** De Configurações (aba Geral): só leitura aqui. */
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  ie: string | null;
  crt: number | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cod_municipio: string;
  municipio: string;
  uf: string;
  telefone: string | null;
  nat_op: string;
  inf_cpl: string | null;
  resp_tec_cnpj: string | null;
  resp_tec_contato: string | null;
  resp_tec_email: string | null;
  resp_tec_fone: string | null;
  series_outro_sistema: number[];
  sem_outro_sistema: boolean;
  cupom_lanca_venda: boolean | null;
  cupom_lanca_venda_por_nome: string | null;
  cupom_lanca_venda_em: Date | null;
  tp_regime_ibscbs: number | null;
  atualizado_por_nome: string | null;
  atualizado_em: Date | null;
}

export interface HistoricoAmbiente {
  evento: string;
  campos: string[];
  mensagem: string | null;
  feito_por_nome: string | null;
  feito_em: Date;
}

/** GET ambientes/:ambiente. O CSC nunca: só `csc_dica`. */
export interface AmbienteResposta {
  ambiente: AmbienteSefaz;
  serie: number | null;
  proximo_numero: number;
  /** "Último usado nesta série: 41" (UX 5.3); null = nenhum. */
  ultimo_numero_usado: number | null;
  /** Os pendentes que travam a troca de série (UX 5.3, "Há 1 cupom pendente nesta série"). */
  pendentes_na_serie: { total: number; primeiro_id: string | null };
  id_csc: number | null;
  csc_dica: string | null;
  emissao_ligada: boolean;
  situacao: SituacaoAmbiente;
  mensagem: string | null;
  bloqueado_ate: Date | null;
  alterada_por_nome: string | null;
  alterada_em: Date | null;
  /** As 5 últimas linhas de `nfce_ambientes_historico` (UX 10.11). */
  historico: HistoricoAmbiente[];
}

/** Um perfil fiscal. As alíquotas (%) seguem o `wire.ts` (viram número); não são dinheiro. */
export interface PerfilResposta {
  id: string;
  nome: string;
  cfop: string;
  csosn: string | null;
  cst_icms: string | null;
  aliq_icms: Prisma.Decimal | null;
  pis_cst: string | null;
  cofins_cst: string | null;
  c_ativ_sn: string | null;
  ibs_sn_aliq: Prisma.Decimal | null;
  cbs_sn_aliq: Prisma.Decimal | null;
  ibscbs_cst: string | null;
  ibscbs_cclass_trib: string | null;
  ativo: boolean;
  /** Quantos produtos usam o perfil ("64 produtos", UX 5.6). */
  produtos: number;
  /** null = a empresa ainda não tem regime (CRT). */
  vale_no_regime: boolean | null;
  atualizado_por_nome: string | null;
  atualizado_em: Date | null;
}

/** Uma linha de GET produtos (desenho §8.2, UX 10.17): a grade da aba Produtos e a busca da aba Emitir. */
export interface ProdutoCupom {
  item_cardapio_id: string;
  nome: string;
  categoria: string;
  /** "Vazio = a unidade de venda da ficha (UN)" (UX 5.7). */
  unidade_venda: string;
  /** O preço do cardápio arredondado UMA vez a 2 casas (`precoCentavos`); null = sem preço que sirva. */
  preco_venda_centavos: number | null;
  ativo: boolean;
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  origem: number;
  descricao_cupom: string | null;
  unidade: string | null;
  perfil_fiscal_id: string | null;
  perfil_nome: string | null;
  pronto: boolean;
  motivos: MotivoProduto[];
}

const TX = { maxWait: 10_000, timeout: 30_000 };
const HISTORICO_MAX = 5;
const LOTE_MAX = 500;
const MAX_TEXTO_EMITENTE = 60;
const MAX_INF_CPL = 500;

/** Pendentes que travam a troca de série (desenho §4.1). */
const PENDENTES_DA_SERIE: SituacaoCupom[] = ['enviando', 'sem_resposta', 'nao_enviado', 'nao_consta', 'rejeitado'];
/** Situações que entram na faixa de pendentes (a venda pendente no estoque entra à parte: não é situação). */
const PENDENTES_DA_FAIXA: SituacaoCupom[] = [...PENDENTES_DA_SERIE, 'cancelando'];
/** Cupom que chegou a ser autorizado. */
const JA_AUTORIZADO: SituacaoCupom[] = ['autorizado', 'cancelando', 'cancelado'];

const CAMPOS_FISCAIS = [
  'cfop',
  'csosn',
  'cst_icms',
  'aliq_icms',
  'pis_cst',
  'cofins_cst',
  'c_ativ_sn',
  'ibs_sn_aliq',
  'cbs_sn_aliq',
  'ibscbs_cst',
  'ibscbs_cclass_trib',
] as const;
type CampoFiscal = (typeof CAMPOS_FISCAIS)[number];

const F = FRASES_CADASTRO;

/** Aparado; vazio ou só espaços = null (os CHECKs do banco recusam ''). */
function vazioParaNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === '' ? null : t;
}

/** Sem máscara (espaço, ponto, hífen, barra, parênteses e "+"): NCM, CEST, GTIN, CEP, IE e telefone. Vazio = null. */
function semMascara(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.replace(/[\s.\-/()+]/g, '');
  return t === '' ? null : t;
}

const tamanho = (s: string) => Array.from(s).length;
const dec = (d: Prisma.Decimal | null): string | null => (d === null ? null : d.toFixed());
const recusa = (code: string, message: string) => new UnprocessableEntityException({ code, message });

function crtDe(e: Pick<nfce_emitente, 'crt'>): Crt | null {
  return e.crt === 1 || e.crt === 2 || e.crt === 3 || e.crt === 4 ? e.crt : null;
}

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

/** Os campos fiscais que vieram no corpo, aparados ("" = null). Os que não vieram ficam de fora (PATCH: não mexe). */
function fiscaisDe(dto: Partial<Record<CampoFiscal, string | null>>): Partial<Record<CampoFiscal, string | null>> {
  const r: Partial<Record<CampoFiscal, string | null>> = {};
  for (const k of CAMPOS_FISCAIS) if (dto[k] !== undefined) r[k] = vazioParaNull(dto[k]);
  return r;
}

/**
 * Preço do cardápio em centavos, arredondado UMA vez (metade para cima) como a emissão faz. Nulo, negativo ou fora do formato = null
 * (a lista nunca cai por um preço torto: o motivo `sem_preco` aparece).
 */
export function precoVendaCentavos(preco: Prisma.Decimal | null): number | null {
  if (preco === null) return null;
  const s = preco.toFixed();
  return /^\d+(\.\d+)?$/.test(s) ? Number(precoCentavos(s)) : null;
}

/**
 * O teste no modo de teste que ligar valendo pede (desenho §7.1): pelo menos 1 cupom autorizado e 1 cancelado em homologação, com o CNPJ
 * da empresa (o cupom não tem coluna de CNPJ: sai da chave, posições 7 a 20). O cancelado também foi autorizado: um só cupom autorizado e
 * depois cancelado já prova as duas coisas.
 */
export function testeHomologacaoFeito(cupons: { chave: string; situacao: string }[], cnpj: string): boolean {
  const deste = cupons.filter((c) => c.chave.slice(6, 20) === cnpj);
  return deste.some((c) => (JA_AUTORIZADO as string[]).includes(c.situacao)) && deste.some((c) => c.situacao === 'cancelado');
}

type Leitor = Pick<Prisma.TransactionClient, 'nfce_cupons'>;

@Injectable()
export class CupomCadastroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CERTIFICADO_DIGITAL) private readonly certificados: CertificadoDigitalPort,
  ) {}

  /** `NFCE_AMBIENTE`: ausente, vazia ou `desligado` = desligado (a validação do env já recusa valor estranho na subida). */
  ambienteDoServidor(): AmbienteServidor {
    const v = this.config.get<string>('NFCE_AMBIENTE');
    return v === 'producao' || v === 'homologacao' ? v : 'desligado';
  }

  /** `CERTIFICADO_SECRET` (o mesmo do certificado e da chave de IA, sem fallback). Curto demais = ausente (a cifra recusaria). */
  private segredo(): string {
    const s = this.config.get<string>('CERTIFICADO_SECRET') || '';
    return s.length >= 16 ? s : '';
  }

  /** CNPJ da empresa (Configurações), normalizado e com DV conferido; senão null. */
  private async cnpjDaEmpresa(): Promise<string | null> {
    const c = await this.prisma.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    const n = normalizarCnpj(c?.cnpj ?? '');
    return cnpjValido(n) ? n : null;
  }

  /** A linha única do emitente (a migração `nfce` a cria). */
  private async lerEmitente(): Promise<nfce_emitente> {
    const e = await this.prisma.nfce_emitente.findUnique({ where: { id: 1 } });
    if (!e) throw new Error('nfce_emitente sem a linha id = 1 (migração nfce)');
    return e;
  }

  private async lerAmbiente(a: AmbienteSefaz, db: Pick<Prisma.TransactionClient, 'nfce_ambientes'> = this.prisma): Promise<nfce_ambientes> {
    const l = await db.nfce_ambientes.findUnique({ where: { ambiente: a } });
    if (!l) throw new Error(`nfce_ambientes sem a linha ${a} (migração nfce)`);
    return l;
  }

  // ------------------------------------------------------------------------------------------------------------- situação

  async situacao(agora: Date = new Date()): Promise<SituacaoCupomFiscal> {
    const servidor = this.ambienteDoServidor();
    const ambiente: AmbienteSefaz = servidor === 'desligado' ? 'producao' : servidor;
    const [amb, emitente, cnpj] = await Promise.all([this.lerAmbiente(ambiente), this.lerEmitente(), this.cnpjDaEmpresa()]);
    const [certificado, produtos, pendentes, testeFeito] = await Promise.all([
      this.certificadoInfo(cnpj, agora),
      this.linhasDeProdutos(crtDe(emitente)),
      this.pendentes(ambiente, agora),
      servidor === 'producao' && cnpj !== null ? this.testeHomologacao(cnpj) : Promise.resolve(false),
    ]);
    const trioOk = this.trioOk(amb, cnpj);
    return {
      ambiente: servidor,
      agora,
      emissao_ligada: servidor !== 'desligado' && trioOk,
      situacao: amb.situacao as SituacaoAmbiente,
      mensagem: amb.emissao_ligada && !trioOk ? F.trioMudou : amb.mensagem,
      bloqueado_ate: amb.bloqueado_ate,
      serie: amb.serie,
      proximo_numero: Number(amb.proximo_numero),
      falta: this.falta({
        servidor,
        ambiente,
        amb,
        emitente,
        cnpj,
        certificadoOk: certificado.ok,
        temPronto: produtos.some((p) => p.pronto),
        testeFeito,
      }),
      certificado,
      pendentes,
    };
  }

  /** Ligada no banco e o trio (ambiente, CNPJ, série) ainda é o de quando ligou: mudou o CNPJ ou a série, desliga sozinha (§7.1). */
  private trioOk(amb: nfce_ambientes, cnpj: string | null): boolean {
    return amb.emissao_ligada && amb.serie !== null && amb.ligada_serie === amb.serie && cnpj !== null && amb.ligada_cnpj === cnpj;
  }

  /** "Para ligar a emissão, falta:" na ordem da UX 5.1; os 3 do valendo só com o servidor valendo. */
  private falta(x: {
    servidor: AmbienteServidor;
    ambiente: AmbienteSefaz;
    amb: nfce_ambientes;
    emitente: nfce_emitente;
    cnpj: string | null;
    certificadoOk: boolean;
    temPronto: boolean;
    testeFeito: boolean;
  }): ItemFalta[] {
    const { amb, emitente: e } = x;
    const series = e.series_outro_sistema;
    const itens: [CodigoFalta, boolean, string][] = [
      ['certificado', !x.certificadoOk, TEXTO_FALTA.certificado],
      ['cnpj', x.cnpj === null, TEXTO_FALTA.cnpj],
      ['ie', e.ie === null, TEXTO_FALTA.ie],
      ['crt', crtDe(e) === null, TEXTO_FALTA.crt],
      ['endereco', !(e.logradouro && e.numero && e.bairro && e.cep), TEXTO_FALTA.endereco],
      ['serie', amb.serie === null, TEXTO_FALTA.serie(x.ambiente)],
      ['csc', amb.id_csc === null || !this.cscLegivel(amb), TEXTO_FALTA.csc(x.ambiente)],
      ['produto_pronto', !x.temPronto, TEXTO_FALTA.produto_pronto],
    ];
    if (x.servidor === 'producao') {
      itens.push(
        ['teste_homologacao', !x.testeFeito, TEXTO_FALTA.teste_homologacao],
        ['lanca_venda', e.cupom_lanca_venda === null, TEXTO_FALTA.lanca_venda],
        [
          'series_outro_sistema',
          !(e.sem_outro_sistema || series.length > 0) || (amb.serie !== null && series.includes(amb.serie)),
          TEXTO_FALTA.series_outro_sistema,
        ],
      );
    }
    return itens.filter(([, falta]) => falta).map(([codigo, , texto]) => ({ codigo, texto }));
  }

  /** O CSC guardado abre com o segredo de agora (trocar o segredo torna o CSC ilegível: o admin cadastra de novo). O valor não sai daqui. */
  private cscLegivel(amb: Pick<nfce_ambientes, 'csc_cifrado'>): boolean {
    const s = this.segredo();
    return amb.csc_cifrado !== null && s !== '' && decifrarCsc(amb.csc_cifrado, s) !== null;
  }

  /** O certificado em uso, do mesmo CNPJ-base da empresa. Só as frases fixas da porta: nunca chave, PEM nem arquivo. */
  private async certificadoInfo(cnpj: string | null, agora: Date): Promise<{ ok: boolean; mensagem: string | null }> {
    let certCnpj: string;
    try {
      certCnpj = (await this.certificados.emUso(agora)).cnpj;
    } catch (e) {
      if (e instanceof CertificadoErro) return { ok: false, mensagem: e.message };
      throw e;
    }
    if (cnpj === null) return { ok: false, mensagem: F.certificadoSemCnpj };
    if (normalizarCnpj(certCnpj).slice(0, 8) !== cnpj.slice(0, 8)) return { ok: false, mensagem: F.certificadoOutraEmpresa };
    return { ok: true, mensagem: null };
  }

  private async testeHomologacao(cnpj: string): Promise<boolean> {
    const cupons = await this.prisma.nfce_cupons.findMany({
      where: { ambiente: 'homologacao', situacao: { in: JA_AUTORIZADO } },
      select: { chave: true, situacao: true },
    });
    return testeHomologacaoFeito(cupons, cnpj);
  }

  /** A faixa de pendentes (UX 10.7) do ambiente: o tipo de cada cupom é o de `tipoPendente`; o primeiro é o mais velho. */
  private async pendentes(ambiente: AmbienteSefaz, agora: Date): Promise<Pendentes> {
    const linhas = await this.prisma.nfce_cupons.findMany({
      where: {
        ambiente,
        OR: [
          { situacao: { in: PENDENTES_DA_FAIXA } },
          { situacao: 'autorizado', lanca_venda: true, venda_lancada_em: null },
          { situacao: 'cancelado', lanca_venda: true, venda_lancada_em: { not: null }, venda_desfeita_em: null },
        ],
      },
      select: {
        id: true,
        ambiente: true,
        serie: true,
        numero: true,
        situacao: true,
        envios: true,
        numero_reaproveitavel: true,
        autorizada_em: true,
        cancelamento_pedido_em: true,
        lanca_venda: true,
        venda_lancada_em: true,
        venda_desfeita_em: true,
        criado_em: true,
      },
      orderBy: [{ criado_em: 'asc' }, { numero: 'asc' }],
    });
    // o `enviando` só vira pendente 2 min depois do envio (`situacaoEfetiva`): a hora vem do diário
    const enviando = linhas.filter((l) => l.situacao === 'enviando').map((l) => l.id);
    const envios =
      enviando.length === 0
        ? []
        : await this.prisma.nfce_envios.findMany({
            where: { cupom_id: { in: enviando }, servico: 'autorizacao' },
            select: { cupom_id: true, iniciada_em: true },
            orderBy: { iniciada_em: 'desc' },
          });
    const enviadoEm = new Map<string, Date>();
    for (const e of envios) if (e.cupom_id !== null && !enviadoEm.has(e.cupom_id)) enviadoEm.set(e.cupom_id, e.iniciada_em);

    const comTipo = linhas
      .map((l) => ({
        l,
        tipo: tipoPendente(
          {
            ...l,
            ambiente: l.ambiente as AmbienteSefaz,
            situacao: l.situacao as SituacaoCupom,
            enviadoEm: enviadoEm.get(l.id) ?? null,
            ultimaConsultaDaChave: null,
          },
          agora,
        ),
      }))
      .filter((x): x is { l: (typeof linhas)[number]; tipo: TipoPendente } => x.tipo !== null);
    const p = comTipo[0];
    return {
      total: comTipo.length,
      primeiro: p ? { id: p.l.id, serie: p.l.serie, numero: Number(p.l.numero), tipo: p.tipo } : null,
    };
  }

  // ------------------------------------------------------------------------------------------------------- empresa no cupom

  async emitente(): Promise<EmitenteResposta> {
    const [e, conf] = await Promise.all([
      this.lerEmitente(),
      this.prisma.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true, razao_social: true, nome_fantasia: true } }),
    ]);
    return {
      cnpj: normalizarCnpj(conf?.cnpj ?? ''),
      razao_social: conf?.razao_social ?? '',
      nome_fantasia: conf?.nome_fantasia ?? '',
      ie: e.ie,
      crt: e.crt,
      logradouro: e.logradouro,
      numero: e.numero,
      complemento: e.complemento,
      bairro: e.bairro,
      cep: e.cep,
      cod_municipio: e.cod_municipio,
      municipio: e.municipio,
      uf: e.uf,
      telefone: e.telefone,
      nat_op: e.nat_op,
      inf_cpl: e.inf_cpl,
      resp_tec_cnpj: e.resp_tec_cnpj,
      resp_tec_contato: e.resp_tec_contato,
      resp_tec_email: e.resp_tec_email,
      resp_tec_fone: e.resp_tec_fone,
      series_outro_sistema: e.series_outro_sistema,
      sem_outro_sistema: e.sem_outro_sistema,
      cupom_lanca_venda: e.cupom_lanca_venda,
      cupom_lanca_venda_por_nome: e.cupom_lanca_venda_por_nome,
      cupom_lanca_venda_em: e.cupom_lanca_venda_em,
      tp_regime_ibscbs: e.tp_regime_ibscbs,
      atualizado_por_nome: e.atualizado_por_nome,
      atualizado_em: e.atualizado_em,
    };
  }

  /**
   * Cada quadro da tela salva só os seus campos: o que não veio fica. Confere cada campo (frase da UX 5.2/5.4/5.5) e depois a linha toda
   * (responsável técnico tudo ou nada; "nenhum outro sistema" sem séries), como os CHECKs do banco, antes de gravar.
   */
  async salvarEmitente(dto: SalvarEmitenteDto, autor: Autor, agora: Date = new Date()): Promise<EmitenteResposta> {
    const invalido = (m: string) => recusa('NFCE_EMITENTE_INVALIDO', m);
    const atual = await this.lerEmitente();
    const muda: Prisma.nfce_emitenteUpdateInput = {};

    /** Texto do endereço e afins: aparado, "" = null, até `max` letras e só o que o esquema da NF-e aceita (sem emoji). */
    const texto = (campo: keyof typeof ROTULO_EMITENTE, v: string | null | undefined, max: number): string | null => {
      const t = vazioParaNull(v);
      if (t === null) return null;
      if (tamanho(t) > max) throw invalido(F.campoLongo(ROTULO_EMITENTE[campo], max));
      if (!cabeNoEsquema(textoDoCupom(t, max))) throw invalido(F.caractere(ROTULO_EMITENTE[campo]));
      return t;
    };
    const fone = (v: string | null | undefined): string | null => {
      const t = semMascara(v);
      if (t !== null && !/^\d{6,14}$/.test(t)) throw invalido(F.telefone);
      return t;
    };

    if (dto.ie !== undefined) {
      const ie = semMascara(dto.ie);
      if (ie !== null && !/^\d{12}$/.test(ie)) throw invalido(F.ie);
      muda.ie = ie;
    }
    if (dto.crt !== undefined) {
      if (dto.crt !== null && ![1, 2, 3, 4].includes(dto.crt)) throw invalido(F.crt);
      muda.crt = dto.crt;
    }
    for (const campo of ['logradouro', 'numero', 'complemento', 'bairro'] as const) {
      if (dto[campo] !== undefined) muda[campo] = texto(campo, dto[campo], MAX_TEXTO_EMITENTE);
    }
    if (dto.cep !== undefined) {
      const cep = semMascara(dto.cep);
      if (cep !== null && !/^\d{8}$/.test(cep)) throw invalido(F.cep);
      muda.cep = cep;
    }
    if (dto.cod_municipio !== undefined) {
      const cod = semMascara(dto.cod_municipio);
      if (cod === null || !/^\d{7}$/.test(cod)) throw invalido(F.codMunicipio);
      if (!cod.startsWith('35')) throw invalido(F.municipioDeSp); // cUF 35: o cupom daqui é de SP
      muda.cod_municipio = cod;
    }
    if (dto.municipio !== undefined) {
      const m = texto('municipio', dto.municipio, MAX_TEXTO_EMITENTE);
      if (m === null) throw invalido(F.semMunicipio);
      muda.municipio = m;
    }
    if (dto.telefone !== undefined) muda.telefone = fone(dto.telefone);
    if (dto.nat_op !== undefined) {
      const n = vazioParaNull(dto.nat_op);
      if (n === null) throw invalido(F.semNatOp);
      if (tamanho(n) > MAX_TEXTO_EMITENTE) throw invalido(F.natOpLonga);
      muda.nat_op = texto('nat_op', n, MAX_TEXTO_EMITENTE) ?? n;
    }
    if (dto.inf_cpl !== undefined) {
      const i = vazioParaNull(dto.inf_cpl);
      if (i !== null && tamanho(i) > MAX_INF_CPL) throw invalido(F.infCplLongo);
      muda.inf_cpl = texto('inf_cpl', i, MAX_INF_CPL);
    }
    if (dto.resp_tec_cnpj !== undefined) {
      const c = dto.resp_tec_cnpj === null ? '' : normalizarCnpj(dto.resp_tec_cnpj);
      if (c !== '' && !cnpjValido(c)) throw invalido(F.respTecCnpj);
      muda.resp_tec_cnpj = c === '' ? null : c;
    }
    if (dto.resp_tec_contato !== undefined) muda.resp_tec_contato = texto('resp_tec_contato', dto.resp_tec_contato, MAX_TEXTO_EMITENTE);
    if (dto.resp_tec_email !== undefined) {
      const m = texto('resp_tec_email', dto.resp_tec_email, MAX_TEXTO_EMITENTE);
      if (m !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) throw invalido(F.email);
      muda.resp_tec_email = m;
    }
    if (dto.resp_tec_fone !== undefined) muda.resp_tec_fone = fone(dto.resp_tec_fone);
    if (dto.series_outro_sistema !== undefined) {
      const s = dto.series_outro_sistema ?? [];
      if (!s.every((n) => Number.isInteger(n) && n >= 0 && n <= 889)) throw invalido(F.serieOutroSistema);
      muda.series_outro_sistema = [...new Set(s)].sort((a, b) => a - b);
    }
    if (typeof dto.sem_outro_sistema === 'boolean') muda.sem_outro_sistema = dto.sem_outro_sistema;
    if (typeof dto.cupom_lanca_venda === 'boolean' && dto.cupom_lanca_venda !== atual.cupom_lanca_venda) {
      // quem respondeu e quando (§3.4); repetir a mesma resposta não troca o autor
      muda.cupom_lanca_venda = dto.cupom_lanca_venda;
      muda.cupom_lanca_venda_por = autor.id;
      muda.cupom_lanca_venda_por_nome = autor.nome;
      muda.cupom_lanca_venda_em = agora;
    }
    if (dto.tp_regime_ibscbs !== undefined) {
      const t = dto.tp_regime_ibscbs;
      if (t !== null && !(Number.isInteger(t) && t >= 0 && t <= 9)) throw invalido(F.tpRegimeIbscbs); // só o formato (§6)
      muda.tp_regime_ibscbs = t;
    }

    // a linha inteira, como os CHECKs do banco
    const final = { ...atual, ...(muda as Partial<nfce_emitente>) };
    const resp = [final.resp_tec_cnpj, final.resp_tec_contato, final.resp_tec_email, final.resp_tec_fone];
    const vazios = resp.filter((r) => r === null).length;
    if (vazios !== 0 && vazios !== resp.length) throw invalido(F.respTecTudoOuNada);
    if (final.sem_outro_sistema && final.series_outro_sistema.length > 0) throw invalido(F.semOutroComSeries);

    await this.prisma.nfce_emitente.update({
      where: { id: 1 },
      data: { ...muda, atualizado_por: autor.id, atualizado_por_nome: autor.nome, atualizado_em: agora },
    });
    return this.emitente();
  }

  // --------------------------------------------------------------------------------------------- numeração e CSC (ambiente)

  async ambiente(a: AmbienteSefaz): Promise<AmbienteResposta> {
    const [amb, cnpj, hist] = await Promise.all([
      this.lerAmbiente(a),
      this.cnpjDaEmpresa(),
      this.prisma.nfce_ambientes_historico.findMany({
        where: { ambiente: a },
        orderBy: { feito_em: 'desc' },
        take: HISTORICO_MAX,
        select: { evento: true, campos: true, mensagem: true, feito_por_nome: true, feito_em: true },
      }),
    ]);
    const [ultimo, pendentes] =
      amb.serie === null
        ? [null, { total: 0, primeiro_id: null }]
        : await Promise.all([this.ultimoUsado(this.prisma, a, amb.serie), this.pendentesNaSerie(this.prisma, a, amb.serie)]);
    return {
      ambiente: a,
      serie: amb.serie,
      proximo_numero: Number(amb.proximo_numero),
      ultimo_numero_usado: ultimo === null ? null : Number(ultimo),
      pendentes_na_serie: pendentes,
      id_csc: amb.id_csc,
      csc_dica: amb.csc_dica,
      emissao_ligada: this.trioOk(amb, cnpj),
      situacao: amb.situacao as SituacaoAmbiente,
      mensagem: amb.mensagem,
      bloqueado_ate: amb.bloqueado_ate,
      alterada_por_nome: amb.alterada_por_nome,
      alterada_em: amb.alterada_em,
      historico: hist.map((h) => ({
        evento: h.evento,
        campos: h.campos,
        mensagem: h.mensagem,
        feito_por_nome: h.feito_por_nome,
        feito_em: h.feito_em,
      })),
    };
  }

  /**
   * O maior número já usado na série: todo cupom vivo (autorizado, cancelado, denegado ou pendente, §4.1) e também o descartado no 539
   * (`numero_reaproveitavel = false`: a SEFAZ já tem outra nota com ele). O descartado com número livre não conta (a T1 o reaproveita).
   */
  private async ultimoUsado(db: Leitor, a: AmbienteSefaz, serie: number): Promise<bigint | null> {
    const c = await db.nfce_cupons.findFirst({
      where: { ambiente: a, serie, OR: [{ situacao: { not: 'descartado' } }, { numero_reaproveitavel: false }] },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    return c?.numero ?? null;
  }

  private async pendentesNaSerie(db: Leitor, a: AmbienteSefaz, serie: number): Promise<{ total: number; primeiro_id: string | null }> {
    const ps = await db.nfce_cupons.findMany({
      where: { ambiente: a, serie, situacao: { in: PENDENTES_DA_SERIE } },
      orderBy: { criado_em: 'asc' },
      select: { id: true },
    });
    return { total: ps.length, primeiro_id: ps[0]?.id ?? null };
  }

  /**
   * Série, próximo número, IdCSC e CSC de um ambiente. `null` ou ausente = não muda; CSC vazio = não muda (é só escrita). Formatos antes de
   * tudo (422); depois, numa transação com o ambiente travado (`FOR UPDATE`, a mesma trava da reserva do número), os pendentes da série
   * atual (409) e o maior número usado na série que vale (422). Trocar a série com a emissão ligada desliga a emissão (§7.1).
   */
  async salvarAmbiente(a: AmbienteSefaz, dto: SalvarAmbienteDto, autor: Autor, agora: Date = new Date()): Promise<AmbienteResposta> {
    const serie = dto.serie ?? null;
    if (serie !== null && !(Number.isInteger(serie) && serie >= 0 && serie <= 889)) {
      throw recusa('NFCE_SERIE_INVALIDA', FRASE_ERRO.NFCE_SERIE_INVALIDA);
    }
    const numero = dto.proximo_numero ?? null;
    if (numero !== null && !(Number.isInteger(numero) && numero >= 1 && numero <= 999_999_999)) {
      throw recusa('NFCE_NUMERO_INVALIDO', F.numeroForaDaFaixa);
    }
    const idCsc = dto.id_csc ?? null;
    if (idCsc !== null && !(Number.isInteger(idCsc) && idCsc >= 1 && idCsc <= 999_999)) {
      throw recusa('NFCE_CSC_INVALIDO', FRASE_ERRO.NFCE_CSC_INVALIDO('id_csc'));
    }
    const csc = vazioParaNull(dto.csc);
    if (csc !== null && !FORMATO_CSC.test(csc)) throw recusa('NFCE_CSC_INVALIDO', FRASE_ERRO.NFCE_CSC_INVALIDO('csc'));
    const segredo = this.segredo();
    if (csc !== null && segredo === '') throw new ServiceUnavailableException({ code: 'NFCE_SEM_SEGREDO', message: F.semSegredo });
    if (serie !== null && (await this.lerEmitente()).series_outro_sistema.includes(serie)) {
      throw recusa('NFCE_SERIE_INVALIDA', FRASE_ERRO.NFCE_SERIE_INVALIDA);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT ambiente FROM nfce_ambientes WHERE ambiente = ${a} FOR UPDATE`;
      const amb = await this.lerAmbiente(a, tx);
      const trocaSerie = serie !== null && serie !== amb.serie;
      if (trocaSerie && amb.serie !== null && (await this.pendentesNaSerie(tx, a, amb.serie)).total > 0) {
        throw new ConflictException({ code: 'NFCE_SERIE_COM_PENDENTES', message: FRASE_ERRO.NFCE_SERIE_COM_PENDENTES });
      }
      const novaSerie = trocaSerie ? serie : amb.serie;
      const novoNumero = numero !== null ? BigInt(numero) : amb.proximo_numero;
      const mudaNumero = novoNumero !== amb.proximo_numero;
      if ((trocaSerie || mudaNumero) && novaSerie !== null) {
        const ultimo = await this.ultimoUsado(tx, a, novaSerie);
        if (ultimo !== null && novoNumero <= ultimo) {
          throw recusa('NFCE_NUMERO_INVALIDO', FRASE_ERRO.NFCE_NUMERO_INVALIDO(ultimo, novaSerie));
        }
      }

      const campos: string[] = [];
      const data: Prisma.nfce_ambientesUpdateInput = {};
      if (trocaSerie) {
        data.serie = serie;
        campos.push('serie');
      }
      if (mudaNumero) {
        data.proximo_numero = novoNumero;
        campos.push('proximo_numero');
      }
      if (idCsc !== null && idCsc !== amb.id_csc) {
        data.id_csc = idCsc;
        campos.push('id_csc');
      }
      if (csc !== null) {
        data.csc_cifrado = cifrarCsc(csc, segredo);
        data.csc_dica = dicaDoCsc(csc);
        campos.push('csc'); // o nome do campo; o valor nunca
      }
      if (campos.length === 0) return;
      const desligar = trocaSerie && amb.emissao_ligada;
      if (desligar) {
        data.emissao_ligada = false;
        data.mensagem = F.trioMudou;
      }
      await tx.nfce_ambientes.update({
        where: { ambiente: a },
        data: { ...data, alterada_por: autor.id, alterada_por_nome: autor.nome, alterada_em: agora },
      });
      const quem = { ambiente: a, situacao: amb.situacao, feito_por: autor.id, feito_por_nome: autor.nome, feito_em: agora };
      await tx.nfce_ambientes_historico.create({ data: { ...quem, evento: 'configuracao', campos } });
      if (desligar) {
        await tx.nfce_ambientes_historico.create({ data: { ...quem, evento: 'desligada', campos: ['serie'], mensagem: F.trioMudou } });
      }
    }, TX);
    return this.ambiente(a);
  }

  // ------------------------------------------------------------------------------------------------------------- perfis

  async perfis(): Promise<PerfilResposta[]> {
    const [perfis, usos, emitente] = await Promise.all([
      this.prisma.nfce_perfis_fiscais.findMany({ orderBy: { nome: 'asc' } }),
      this.prisma.nfce_itens.findMany({ where: { perfil_fiscal_id: { not: null } }, select: { perfil_fiscal_id: true } }),
      this.lerEmitente(),
    ]);
    const uso = new Map<string, number>();
    for (const u of usos) if (u.perfil_fiscal_id !== null) uso.set(u.perfil_fiscal_id, (uso.get(u.perfil_fiscal_id) ?? 0) + 1);
    const crt = crtDe(emitente);
    return perfis.map((p) => this.perfilResposta(p, uso.get(p.id) ?? 0, crt));
  }

  private perfilResposta(p: nfce_perfis_fiscais, produtos: number, crt: Crt | null): PerfilResposta {
    return {
      id: p.id,
      nome: p.nome,
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
      ativo: p.ativo,
      produtos,
      vale_no_regime: crt === null ? null : perfilValeNoRegime(perfilFiscalDe(p), crt),
      atualizado_por_nome: p.atualizado_por_nome,
      atualizado_em: p.atualizado_em,
    };
  }

  /** Nome aparado, de 1 a 60 letras e livre (o UNIQUE do banco é exato). */
  private async nomeDoPerfil(nome: string, outroQue: string | null): Promise<string> {
    const n = nome.trim();
    if (n === '') throw recusa('NFCE_PERFIL_INVALIDO', F.perfilSemNome);
    if (tamanho(n) > 60) throw recusa('NFCE_PERFIL_INVALIDO', F.perfilNomeLongo);
    const igual = await this.prisma.nfce_perfis_fiscais.findFirst({
      where: { nome: n, ...(outroQue !== null ? { id: { not: outroQue } } : {}) },
      select: { id: true },
    });
    if (igual) throw this.nomeRepetido();
    return n;
  }

  private nomeRepetido() {
    return new ConflictException({ code: 'NFCE_PERFIL_REPETIDO', message: F.perfilRepetido });
  }

  /** Confere o perfil com o CRT de agora (`erroDoPerfil`), com os códigos já aparados. */
  private async conferirPerfil(p: PerfilFiscal): Promise<Crt | null> {
    const crt = crtDe(await this.lerEmitente());
    const erro = erroDoPerfil(p, crt);
    if (erro) throw recusa('NFCE_PERFIL_INVALIDO', erro);
    return crt;
  }

  async criarPerfil(dto: PerfilFiscalDto, autor: Autor, agora: Date = new Date()): Promise<PerfilResposta> {
    const nome = await this.nomeDoPerfil(dto.nome ?? '', null);
    const f = fiscaisDe(dto);
    const ativo = dto.ativo ?? true;
    const crt = await this.conferirPerfil({
      cfop: f.cfop ?? '',
      csosn: f.csosn ?? null,
      cst_icms: f.cst_icms ?? null,
      aliq_icms: f.aliq_icms ?? null,
      pis_cst: f.pis_cst ?? null,
      cofins_cst: f.cofins_cst ?? null,
      c_ativ_sn: f.c_ativ_sn ?? null,
      ibs_sn_aliq: f.ibs_sn_aliq ?? null,
      cbs_sn_aliq: f.cbs_sn_aliq ?? null,
      ibscbs_cst: f.ibscbs_cst ?? null,
      ibscbs_cclass_trib: f.ibscbs_cclass_trib ?? null,
      ativo,
    });
    try {
      const p = await this.prisma.nfce_perfis_fiscais.create({
        data: { ...f, nome, cfop: f.cfop ?? '', ativo, atualizado_por: autor.id, atualizado_por_nome: autor.nome, atualizado_em: agora },
      });
      return this.perfilResposta(p, 0, crt);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw this.nomeRepetido();
      throw e;
    }
  }

  /**
   * Muda só o que veio. Mudou algum código: confere o perfil inteiro (o de agora + a mudança) com o regime de agora. Só desativar ou
   * renomear não confere o regime: um perfil antigo do Simples tem de poder ser desativado depois que a empresa virou regime normal.
   */
  async atualizarPerfil(id: string, dto: AtualizarPerfilDto, autor: Autor, agora: Date = new Date()): Promise<PerfilResposta> {
    const atual = await this.prisma.nfce_perfis_fiscais.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException({ code: 'NOT_FOUND', message: F.naoEncontrado });
    const f = fiscaisDe(dto);
    const { cfop, ...outros } = f;
    const ativo = typeof dto.ativo === 'boolean' ? dto.ativo : atual.ativo;
    let crt = crtDe(await this.lerEmitente());
    if (Object.keys(f).length > 0) {
      const junto: PerfilFiscal = { ...perfilFiscalDe(atual), ...outros, ativo, cfop: (cfop !== undefined ? cfop : atual.cfop) ?? '' };
      crt = await this.conferirPerfil(junto);
    }
    const nome = dto.nome !== undefined ? await this.nomeDoPerfil(dto.nome ?? '', id) : undefined; // null = sem nome (422)
    try {
      const p = await this.prisma.nfce_perfis_fiscais.update({
        where: { id },
        data: {
          ...outros,
          ...(cfop !== undefined ? { cfop: cfop ?? '' } : {}), // nulo não passa de conferirPerfil (semCfop)
          ...(nome !== undefined ? { nome } : {}),
          ativo,
          atualizado_por: autor.id,
          atualizado_por_nome: autor.nome,
          atualizado_em: agora,
        },
      });
      const produtos = await this.prisma.nfce_itens.count({ where: { perfil_fiscal_id: id } });
      return this.perfilResposta(p, produtos, crt);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw this.nomeRepetido();
      throw e;
    }
  }

  // ------------------------------------------------------------------------------------------------------------ produtos

  /** `prontos`: true = só os prontos para o cupom (busca da aba Emitir); false = só os que faltam dados; ausente = todos. */
  async produtos(prontos?: boolean): Promise<ProdutoCupom[]> {
    const linhas = await this.linhasDeProdutos(crtDe(await this.lerEmitente()));
    return prontos === undefined ? linhas : linhas.filter((l) => l.pronto === prontos);
  }

  /** Os itens do cardápio (todos, ou só `ids`) com os dados do cupom e o perfil, por nome; "pronto" com o regime de agora. */
  private async linhasDeProdutos(crt: Crt | null, ids?: string[]): Promise<ProdutoCupom[]> {
    const [itens, fiscais, perfis] = await Promise.all([
      this.prisma.itens_cardapio.findMany({
        ...(ids ? { where: { id: { in: ids } } } : {}),
        select: { id: true, nome: true, categoria: true, unidade_venda: true, preco_venda: true, ativo: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.nfce_itens.findMany({ where: ids ? { item_cardapio_id: { in: ids } } : undefined }),
      this.prisma.nfce_perfis_fiscais.findMany(),
    ]);
    const fiscalDe = new Map(fiscais.map((f) => [f.item_cardapio_id, f]));
    const perfilDe = new Map(perfis.map((p) => [p.id, p]));
    return itens.map((i) => {
      const f = fiscalDe.get(i.id) ?? null;
      const perfil = f?.perfil_fiscal_id ? (perfilDe.get(f.perfil_fiscal_id) ?? null) : null;
      const motivos = motivosDoProduto(
        {
          ativo: i.ativo,
          preco_venda: dec(i.preco_venda),
          ncm: f?.ncm ?? null,
          perfil: perfil ? perfilFiscalDe(perfil) : null,
          nome_cupom: vazioParaNull(f?.descricao_cupom) ?? i.nome,
        },
        crt,
      );
      return {
        item_cardapio_id: i.id,
        nome: i.nome,
        categoria: i.categoria,
        unidade_venda: i.unidade_venda,
        preco_venda_centavos: precoVendaCentavos(i.preco_venda),
        ativo: i.ativo,
        ncm: f?.ncm ?? null,
        cest: f?.cest ?? null,
        gtin: f?.gtin ?? null,
        origem: f?.origem ?? 0,
        descricao_cupom: f?.descricao_cupom ?? null,
        unidade: f?.unidade ?? null,
        perfil_fiscal_id: f?.perfil_fiscal_id ?? null,
        perfil_nome: perfil?.nome ?? null,
        pronto: motivos.length === 0,
        motivos,
      };
    });
  }

  /**
   * Dados do cupom de um produto: muda só o que veio (cria a linha de `nfce_itens` se ainda não existe). NCM, CEST e GTIN sem máscara;
   * "" e só espaços = NULL; a linha toda conferida (`erroDoItemFiscal`) e o perfil existente e ativo, antes de gravar.
   */
  async salvarProduto(itemId: string, dto: SalvarProdutoDto, autor: Autor, agora: Date = new Date()): Promise<ProdutoCupom> {
    const item = await this.prisma.itens_cardapio.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: F.naoEncontrado });
    const atual = await this.prisma.nfce_itens.findUnique({ where: { item_cardapio_id: itemId } });

    const muda: {
      ncm?: string | null;
      cest?: string | null;
      gtin?: string | null;
      origem?: number;
      descricao_cupom?: string | null;
      unidade?: string | null;
      perfil_fiscal_id?: string | null;
    } = {};
    if (dto.ncm !== undefined) muda.ncm = semMascara(dto.ncm);
    if (dto.cest !== undefined) muda.cest = semMascara(dto.cest);
    if (dto.gtin !== undefined) muda.gtin = semMascara(dto.gtin);
    if (dto.origem != null) muda.origem = dto.origem; // nula = ausente (fica a de agora; na linha nova, 0)
    if (dto.descricao_cupom !== undefined) muda.descricao_cupom = vazioParaNull(dto.descricao_cupom);
    if (dto.unidade !== undefined) muda.unidade = vazioParaNull(dto.unidade);
    const valor = <K extends 'ncm' | 'cest' | 'gtin' | 'descricao_cupom' | 'unidade'>(k: K): string | null =>
      muda[k] !== undefined ? (muda[k] ?? null) : (atual?.[k] ?? null);
    const erro = erroDoItemFiscal({
      ncm: valor('ncm'),
      cest: valor('cest'),
      gtin: valor('gtin'),
      origem: muda.origem ?? atual?.origem ?? 0,
      descricao_cupom: valor('descricao_cupom'),
      unidade: valor('unidade'),
    });
    if (erro) throw recusa('NFCE_PRODUTO_INVALIDO', erro);

    if (dto.perfil_fiscal_id !== undefined) {
      if (dto.perfil_fiscal_id === null) muda.perfil_fiscal_id = null;
      else muda.perfil_fiscal_id = (await this.perfilAtivo(dto.perfil_fiscal_id)).id;
    }

    const autoria = { atualizado_por: autor.id, atualizado_por_nome: autor.nome, atualizado_em: agora };
    await this.prisma.nfce_itens.upsert({
      where: { item_cardapio_id: itemId },
      create: { ...muda, item_cardapio_id: itemId, ...autoria },
      update: { ...muda, ...autoria },
    });
    const [linha] = await this.linhasDeProdutos(crtDe(await this.lerEmitente()), [itemId]);
    return linha;
  }

  /** O perfil escolhido para produtos: existe (senão "Escolha o perfil fiscal.") e está ativo. */
  private async perfilAtivo(id: string): Promise<nfce_perfis_fiscais> {
    const p = await this.prisma.nfce_perfis_fiscais.findUnique({ where: { id } });
    if (!p) throw recusa('NFCE_PRODUTO_INVALIDO', F.semPerfil);
    if (!p.ativo) throw recusa('NFCE_PRODUTO_INVALIDO', F.perfilDesativado);
    return p;
  }

  /**
   * "Aplicar perfil…" em vários produtos (UX 10.10): de 1 a 500 (repetidos contam uma vez), numa transação só. Atualiza as linhas de
   * `nfce_itens` que existem e cria as que faltam (o resto da linha fica como está). Produto que sumiu = 404 e nada muda.
   */
  async perfilEmLote(
    dto: PerfilEmLoteDto,
    autor: Autor,
    agora: Date = new Date(),
  ): Promise<{ atualizados: number; perfil_fiscal_id: string; perfil_nome: string }> {
    const ids = [...new Set(dto.itens ?? [])];
    if (ids.length < 1 || ids.length > LOTE_MAX) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: F.loteTamanho });
    const perfil = await this.perfilAtivo(dto.perfil_fiscal_id);
    const autoria = { atualizado_por: autor.id, atualizado_por_nome: autor.nome, atualizado_em: agora };

    await this.prisma.$transaction(async (tx) => {
      const existem = await tx.itens_cardapio.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (existem.length !== ids.length) throw new NotFoundException({ code: 'NOT_FOUND', message: F.produtoSumiu });
      const comLinha = new Set(
        (await tx.nfce_itens.findMany({ where: { item_cardapio_id: { in: ids } }, select: { item_cardapio_id: true } })).map(
          (l) => l.item_cardapio_id,
        ),
      );
      if (comLinha.size > 0) {
        await tx.nfce_itens.updateMany({ where: { item_cardapio_id: { in: [...comLinha] } }, data: { perfil_fiscal_id: perfil.id, ...autoria } });
      }
      const novos = ids.filter((id) => !comLinha.has(id));
      if (novos.length > 0) {
        await tx.nfce_itens.createMany({ data: novos.map((id) => ({ item_cardapio_id: id, perfil_fiscal_id: perfil.id, ...autoria })) });
      }
    }, TX);
    return { atualizados: ids.length, perfil_fiscal_id: perfil.id, perfil_nome: perfil.nome };
  }
}
