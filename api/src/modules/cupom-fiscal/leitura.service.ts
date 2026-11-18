// Leitura do cupom fiscal (NFC-e), rotas GET de /v1/cupom-fiscal (desenho §5.6, §7.4 e §8.2; UX 3, 4 e 10): a lista (Emitidos), o cupom,
// o DANFE, o XML do cupom e do cancelamento, o zip do mês para o contador e as vendas do período (o aviso da importação). Nada aqui fala
// com a SEFAZ (o serviço nem tem a porta) e tudo funciona com o servidor desligado (`NFCE_AMBIENTE` vazia): sem `ambiente`, vale o do
// servidor, e desligado = `producao` (UX 10.6). Horas e ações vêm do servidor (`acoesDoCupom`, UX 10.3); dinheiro em centavos inteiros
// (`*_centavos`), menos o DANFE, que devolve o texto do XML ("24.00"). O CPF vem mascarado na lista (`***.982.247-**`) e inteiro só no
// cupom e no DANFE (Ruling T11-1); o XML só sai pela rota própria, como foi guardado (é o documento fiscal), e o CSC nunca está nele.
// Dias e meses são de Brasília (UTC−3 fixo) sobre colunas `timestamptz`: o cupom das 23h30 do dia 17 é do dia 17.

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type nfce_cupons } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { mascararCpf } from '../../common/fiscal/documentos';
import { addDays, isDateString } from '../../common/time/dates';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { lerXml, primeiro, texto } from '../sefaz/xml-leitura';
import { CupomCadastroService, PENDENTES_NO_BANCO } from './cadastro.service';
import { danfeDoNfeProc, type Danfe } from './danfe';
import { CupomEmissaoService, paraAcoes, r409, type CupomDetalhe } from './emissao.service';
import { FRASE_ERRO, FRASES_LEITURA, type AcaoDaFrase } from './frases';
import {
  acoesDoCupom,
  situacaoEfetiva,
  tipoPendente,
  vendaEstoque,
  type AcaoCupom,
  type CupomParaAcoes,
  type SituacaoCupom,
  type VendaEstoque,
} from './situacao-cupom';
import { zipSemCompressao } from './zip';

export interface FiltroCupons {
  ambiente?: AmbienteSefaz;
  /** Dias de Brasília ("AAAA-MM-DD"), pela hora em que o cupom foi criado. */
  ini?: string;
  fim?: string;
  /** Pela situação efetiva (o `enviando` de 2 min ou mais sai como `sem_resposta`). */
  situacao?: SituacaoCupom[];
  /** "Precisam de você": os pendentes da faixa mais a venda pendente no estoque (`tipoPendente`). */
  atencao?: boolean;
  /** Só lê, nunca emite (UX 10.2b): `[]` ou o cupom. */
  chave_idempotencia?: string;
  limite?: number;
}

/** Uma linha de Emitidos (UX 4.1): sem XML, sem itens; o CPF mascarado. */
export interface CupomLinha {
  id: string;
  ambiente: AmbienteSefaz;
  serie: number;
  numero: number;
  chave: string;
  situacao: SituacaoCupom;
  dh_emi: Date;
  criado_em: Date;
  autorizada_em: Date | null;
  cancelado_em: Date | null;
  descartado_em: Date | null;
  envios: number;
  valor_total_centavos: number;
  pagamentos: { t_pag: string; valor_centavos: number }[];
  /** CPF `***.982.247-**`; CNPJ inteiro (é de empresa; UX 10.15). */
  consumidor_doc: string | null;
  venda_estoque: VendaEstoque | null;
  acoes: AcaoCupom[];
  consultar_a_partir_de: Date | null;
  cancelar_ate: Date | null;
}

const LIMITE_PADRAO = 100;
const LIMITE_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const SITUACOES: readonly string[] = [
  'enviando',
  'nao_enviado',
  'sem_resposta',
  'nao_consta',
  'rejeitado',
  'autorizado',
  'cancelando',
  'denegado',
  'cancelado',
  'descartado',
];
/** O cupom já é documento fiscal: tem o nfeProc e o número é dele para sempre. */
const DOCUMENTO: readonly string[] = ['autorizado', 'cancelando', 'denegado', 'cancelado'];
/** Cancelamento registrado (o 155 é o mesmo, fora do prazo de vinculação). */
const EVENTO_REGISTRADO: ReadonlySet<number> = new Set([135, 155]);

const invalido = (message = 'Filtro inválido.') => new BadRequestException({ code: 'VALIDATION_ERROR', message });
/** 00h00 do dia em Brasília. */
const inicioDoDiaSp = (dia: string) => new Date(`${dia}T00:00:00-03:00`);
const centavos = (d: Prisma.Decimal): number => Number(d.times(100).toFixed(0));
const docDaLista = (d: string | null): string | null => (d !== null && /^[0-9]{11}$/.test(d) ? mascararCpf(d) : d);
const tpAmbDe = (a: string) => (a === 'producao' ? '1' : '2');

/** Os parâmetros da URL de `GET cupons` → o filtro; valor estranho = 400 VALIDATION_ERROR. `limite` vai a 1–500 (padrão 100). */
export function filtroDaLista(q: Record<string, string | string[] | undefined>): FiltroCupons {
  const um = (k: string): string | undefined => {
    const v = q[k];
    if (!Array.isArray(v)) return v;
    if (v.length > 1) throw invalido();
    return v[0];
  };
  const f: FiltroCupons = {};
  const ambiente = um('ambiente');
  if (ambiente !== undefined) {
    if (ambiente !== 'homologacao' && ambiente !== 'producao') throw invalido();
    f.ambiente = ambiente;
  }
  for (const k of ['ini', 'fim'] as const) {
    const v = um(k);
    if (v === undefined) continue;
    if (!isDateString(v)) throw invalido('ini e fim devem ser datas AAAA-MM-DD');
    f[k] = v;
  }
  if (f.ini !== undefined && f.fim !== undefined && f.ini > f.fim) throw invalido('ini deve ser até fim');
  const s = q.situacao;
  if (s !== undefined) {
    const lista = (Array.isArray(s) ? s : [s])
      .flatMap((x) => x.split(','))
      .map((x) => x.trim())
      .filter((x) => x !== '');
    if (lista.some((x) => !SITUACOES.includes(x))) throw invalido();
    if (lista.length > 0) f.situacao = lista as SituacaoCupom[];
  }
  const atencao = um('atencao');
  if (atencao !== undefined) {
    if (atencao !== 'true' && atencao !== 'false') throw invalido();
    f.atencao = atencao === 'true';
  }
  const chave = um('chave_idempotencia');
  if (chave !== undefined) {
    // a coluna é uuid: o malformado viraria erro do banco (500)
    if (!UUID.test(chave)) throw invalido();
    f.chave_idempotencia = chave;
  }
  const limite = um('limite');
  if (limite === undefined) f.limite = LIMITE_PADRAO;
  else {
    const n = Number(limite);
    if (limite.trim() === '' || !Number.isFinite(n)) throw invalido();
    f.limite = Math.min(Math.max(Math.trunc(n), 1), LIMITE_MAX);
  }
  return f;
}

type EnvioDoCancelamento = {
  servico: string;
  c_stat: number | null;
  n_prot: string | null;
  xml_enviado: string | null;
  xml_retorno: string | null;
};

/**
 * O `procEventoNFe` do cancelamento deste cupom, montado do diário (Tarefa 13, nota 3), ou null. Só o cancelamento que a SEFAZ registrou
 * com o protocolo gravado no cupom (`cancelamento_n_prot`), conferido contra a chave e o ambiente (nunca um XML não autorizado):
 *   1. o pedido nosso que voltou 135/155: o `evento` assinado que saiu (`xml_enviado`) + o `retEvento` da resposta dele;
 *   2. senão (o cancelamento que a consulta confirmou), o `procEventoNFe` que a SEFAZ mandou na consulta, como veio (com o namespace da
 *      NF-e posto na raiz, que lá ele herdava do `retConsSitNFe`).
 */
export function procEventoDoCancelamento(
  c: Pick<nfce_cupons, 'chave' | 'ambiente' | 'cancelamento_n_prot'>,
  envios: EnvioDoCancelamento[],
): string | null {
  const nProt = c.cancelamento_n_prot;
  if (nProt === null) return null;
  for (const e of envios) {
    if (e.servico !== 'cancelamento' || e.c_stat === null || !EVENTO_REGISTRADO.has(e.c_stat) || e.n_prot !== nProt) continue;
    const ret = e.xml_retorno === null ? null : (/<retEvento[\s>][\s\S]*?<\/retEvento>/.exec(e.xml_retorno)?.[0] ?? null);
    if (e.xml_enviado === null || ret === null) continue;
    const proc = `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${e.xml_enviado}${ret}</procEventoNFe>`;
    if (eventoDoCupom(proc, c, nProt)) return proc;
  }
  for (const e of envios) {
    if (e.servico !== 'consulta' || e.xml_retorno === null) continue;
    for (const m of e.xml_retorno.matchAll(/<procEventoNFe[\s>][\s\S]*?<\/procEventoNFe>/g)) {
      const abre = m[0].slice(0, m[0].indexOf('>'));
      const proc = /\sxmlns=/.test(abre) ? m[0] : `<procEventoNFe xmlns="${NS_NFE}"${m[0].slice('<procEventoNFe'.length)}`;
      if (eventoDoCupom(proc, c, nProt)) return proc;
    }
  }
  return null;
}

/** O `procEventoNFe` é XML legível da NF-e, com o evento 110111 desta chave e o registro (135/155) deste protocolo e deste ambiente. */
function eventoDoCupom(proc: string, c: Pick<nfce_cupons, 'chave' | 'ambiente'>, nProt: string): boolean {
  try {
    const doc = lerXml(proc);
    if (doc.documentElement?.localName !== 'procEventoNFe' || doc.documentElement.namespaceURI !== NS_NFE) return false;
    const evento = primeiro(doc, 'evento');
    const ret = primeiro(doc, 'retEvento');
    if (evento === null || ret === null) return false;
    return (
      texto(evento, 'tpEvento') === '110111' &&
      texto(evento, 'chNFe') === c.chave &&
      (texto(ret, 'tpEvento') ?? '110111') === '110111' && // opcional no retEvento (TRetEvento)
      texto(ret, 'chNFe') === c.chave &&
      texto(ret, 'tpAmb') === tpAmbDe(c.ambiente) &&
      EVENTO_REGISTRADO.has(Number(texto(ret, 'cStat'))) &&
      texto(ret, 'nProt') === nProt
    );
  } catch {
    return false;
  }
}

/** O motivo do número que não virou cupom, pelo cupom mais novo com ele (`numeros-nao-usados.csv`). */
function motivoNaoUsado(c: { situacao: string; numero_reaproveitavel: boolean; c_stat: number | null }): string {
  const M = FRASES_LEITURA.naoUsado;
  if (!c.numero_reaproveitavel && (c.situacao === 'descartado' || c.situacao === 'rejeitado')) return M.outraNota;
  switch (c.situacao) {
    case 'nao_enviado':
      return M.naoSaiu;
    case 'nao_consta':
      return M.naoConsta;
    case 'rejeitado':
      return M.recusado(c.c_stat);
    case 'descartado':
      return M.descartado;
    default: // enviando e sem_resposta: o número está preso até a consulta
      return M.semResposta;
  }
}

/** Campo de CSV com `;` (o Excel em português): entre aspas se tiver `;`, aspas ou quebra de linha. */
const campoCsv = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

@Injectable()
export class CupomLeituraService {
  private readonly logger = new Logger(CupomLeituraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cadastro: CupomCadastroService,
    private readonly emissao: CupomEmissaoService,
  ) {}

  /** O ambiente pedido ou o do servidor; desligado = `producao` (UX 10.6). */
  ambienteDaLeitura(a?: AmbienteSefaz): AmbienteSefaz {
    if (a !== undefined) return a;
    const s = this.cadastro.ambienteDoServidor();
    return s === 'desligado' ? 'producao' : s;
  }

  // ======================================================================================================================== lista

  /**
   * Emitidos (UX 4.1, 10.2b e 10.6): do mais novo para o mais velho. A situação e as ações são as efetivas, com a hora do servidor; com
   * filtro de situação ou "precisam de você", o banco traz um superconjunto e o filtro de verdade (e o limite) é aqui.
   */
  async listar(f: FiltroCupons, agora: Date = new Date()): Promise<CupomLinha[]> {
    const limite = Math.min(Math.max(f.limite ?? LIMITE_PADRAO, 1), LIMITE_MAX);
    const where: Prisma.nfce_cuponsWhereInput = { ambiente: this.ambienteDaLeitura(f.ambiente) };
    if (f.chave_idempotencia !== undefined) where.chave_idempotencia = f.chave_idempotencia;
    if (f.ini !== undefined || f.fim !== undefined) {
      where.criado_em = {
        ...(f.ini !== undefined ? { gte: inicioDoDiaSp(f.ini) } : {}),
        ...(f.fim !== undefined ? { lt: inicioDoDiaSp(addDays(f.fim, 1)) } : {}),
      };
    }
    const quer = f.situacao !== undefined && f.situacao.length > 0 ? new Set<SituacaoCupom>(f.situacao) : null;
    const e: Prisma.nfce_cuponsWhereInput[] = [];
    let refina = f.atencao === true;
    if (quer !== null) {
      const noBanco = new Set<string>(quer);
      if (quer.has('sem_resposta')) noBanco.add('enviando');
      refina ||= noBanco.has('enviando');
      e.push({ situacao: { in: [...noBanco] } });
    }
    if (f.atencao === true) e.push({ OR: PENDENTES_NO_BANCO });
    if (e.length > 0) where.AND = e;

    const linhas = await this.prisma.nfce_cupons.findMany({
      where,
      orderBy: [{ criado_em: 'desc' }, { numero: 'desc' }],
      ...(refina ? {} : { take: limite }),
      select: {
        id: true,
        ambiente: true,
        serie: true,
        numero: true,
        chave: true,
        situacao: true,
        dh_emi: true,
        criado_em: true,
        envios: true,
        numero_reaproveitavel: true,
        consumidor_doc: true,
        valor_total: true,
        autorizada_em: true,
        cancelado_em: true,
        cancelamento_pedido_em: true,
        lanca_venda: true,
        venda_lancada_em: true,
        venda_desfeita_em: true,
        descartado_em: true,
      },
    });
    const horas = await this.horasDosCupons(linhas.map((l) => l.id));
    const pagina = linhas
      .map((l) => {
        const h = horas.get(l.id);
        const para: CupomParaAcoes = {
          situacao: l.situacao as SituacaoCupom,
          ambiente: l.ambiente as AmbienteSefaz,
          envios: l.envios,
          numero_reaproveitavel: l.numero_reaproveitavel,
          autorizada_em: l.autorizada_em,
          cancelamento_pedido_em: l.cancelamento_pedido_em,
          lanca_venda: l.lanca_venda,
          venda_lancada_em: l.venda_lancada_em,
          venda_desfeita_em: l.venda_desfeita_em,
          enviadoEm: h?.enviadoEm ?? null,
          ultimaConsultaDaChave: h?.ultimaConsulta ?? null,
        };
        return { l, para, situacao: situacaoEfetiva(para, agora) };
      })
      .filter((x) => (quer === null || quer.has(x.situacao)) && (f.atencao !== true || tipoPendente(x.para, agora) !== null))
      .slice(0, limite);

    const pagamentos =
      pagina.length === 0
        ? []
        : await this.prisma.nfce_cupom_pagamentos.findMany({
            where: { cupom_id: { in: pagina.map((x) => x.l.id) } },
            orderBy: { ordem: 'asc' },
            select: { cupom_id: true, t_pag: true, valor: true },
          });
    return pagina.map(({ l, para, situacao }): CupomLinha => {
      const { acoes, consultar_a_partir_de, cancelar_ate } = acoesDoCupom(para, agora);
      return {
        id: l.id,
        ambiente: l.ambiente as AmbienteSefaz,
        serie: l.serie,
        numero: Number(l.numero),
        chave: l.chave,
        situacao,
        dh_emi: l.dh_emi,
        criado_em: l.criado_em,
        autorizada_em: l.autorizada_em,
        cancelado_em: l.cancelado_em,
        descartado_em: l.descartado_em,
        envios: l.envios,
        valor_total_centavos: centavos(l.valor_total),
        pagamentos: pagamentos.filter((p) => p.cupom_id === l.id).map((p) => ({ t_pag: p.t_pag, valor_centavos: centavos(p.valor) })),
        consumidor_doc: docDaLista(l.consumidor_doc),
        venda_estoque: vendaEstoque({ ...para, situacao }),
        acoes,
        consultar_a_partir_de,
        cancelar_ate,
      };
    });
  }

  /** O último envio de autorização e a última consulta de cada cupom (as horas que a situação efetiva e as ações usam). */
  private async horasDosCupons(ids: string[]): Promise<Map<string, { enviadoEm: Date | null; ultimaConsulta: Date | null }>> {
    const m = new Map<string, { enviadoEm: Date | null; ultimaConsulta: Date | null }>();
    if (ids.length === 0) return m;
    const envios = await this.prisma.nfce_envios.findMany({
      where: { cupom_id: { in: ids }, servico: { in: ['autorizacao', 'consulta'] } },
      select: { cupom_id: true, servico: true, iniciada_em: true },
    });
    for (const e of envios) {
      if (e.cupom_id === null) continue;
      const h = m.get(e.cupom_id) ?? { enviadoEm: null, ultimaConsulta: null };
      const k = e.servico === 'autorizacao' ? 'enviadoEm' : 'ultimaConsulta';
      if (h[k] === null || e.iniciada_em > (h[k] as Date)) h[k] = e.iniciada_em;
      m.set(e.cupom_id, h);
    }
    return m;
  }

  // ======================================================================================================================== cupom

  /** O cupom (o mesmo formato do POST): itens, pagamentos, horas, ações, a recusa e a frase da situação, sem XML. CPF inteiro. */
  detalhe(id: string, agora: Date = new Date()): Promise<CupomDetalhe> {
    return this.emissao.detalhe(id, agora);
  }

  /** Os dados do DANFE (desenho §5.6), só do cupom autorizado e só do `nfeProc` guardado. Cancelado não se imprime de novo. */
  async danfe(id: string, agora: Date = new Date()): Promise<Danfe> {
    const c = await this.emissao.cupomOu404(this.prisma, id);
    if (c.situacao !== 'autorizado' || c.xml_autorizado === null) throw await this.semArquivo(c, 'imprimir', agora);
    return danfeDoNfeProc(c.xml_autorizado);
  }

  /**
   * O arquivo do cupom (`nota`: o `nfeProc` guardado; autorizado, cancelando, denegado ou cancelado) ou do cancelamento (o
   * `procEventoNFe`; só cancelado), com o nome da UX 3.5 (`cupom-2-12.xml`, `cancelamento-2-12.xml`).
   */
  async xml(id: string, tipo: 'nota' | 'cancelamento', agora: Date = new Date()): Promise<{ nome: string; xml: string }> {
    const c = await this.emissao.cupomOu404(this.prisma, id);
    const nome = `${tipo === 'nota' ? 'cupom' : 'cancelamento'}-${c.serie}-${c.numero}.xml`;
    if (tipo === 'nota') {
      if (!DOCUMENTO.includes(c.situacao) || c.xml_autorizado === null) throw await this.semArquivo(c, 'baixar_xml', agora);
      return { nome, xml: c.xml_autorizado };
    }
    if (c.situacao !== 'cancelado') throw await this.semArquivo(c, 'baixar_xml_cancelamento', agora);
    const xml = procEventoDoCancelamento(c, await this.enviosDoCancelamento([id]));
    if (xml === null) {
      this.semCancelamento(c);
      throw new NotFoundException({ code: 'NOT_FOUND', message: FRASES_LEITURA.semArquivoDoCancelamento });
    }
    return { nome, xml };
  }

  // ===================================================================================================================== contador

  /**
   * O zip do mês para o contador (desenho §7.4; UX 4.6), dos cupons emitidos no mês (o `dhEmi`, em Brasília): o `nfeProc` de cada
   * autorizado, cancelando, denegado e cancelado, como foi guardado (`NFCe-<chave>.xml`), o `procEventoNFe` de cada cancelamento
   * (`NFCe-<chave>-cancelamento.xml`) e `numeros-nao-usados.csv` (desenho §4.3: série, número e motivo dos números que não viraram cupom).
   */
  async xmlDoMes(mes: string, ambiente?: AmbienteSefaz, agora: Date = new Date()): Promise<{ nome: string; zip: Buffer }> {
    if (!MES.test(mes)) throw invalido('mes deve ser AAAA-MM');
    const a = this.ambienteDaLeitura(ambiente);
    const [ano, m] = mes.split('-').map(Number);
    const seguinte = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, '0')}`;
    const cupons = await this.prisma.nfce_cupons.findMany({
      where: { ambiente: a, dh_emi: { gte: inicioDoDiaSp(`${mes}-01`), lt: inicioDoDiaSp(`${seguinte}-01`) } },
      orderBy: [{ serie: 'asc' }, { numero: 'asc' }, { criado_em: 'asc' }],
      select: {
        id: true,
        ambiente: true,
        serie: true,
        numero: true,
        chave: true,
        situacao: true,
        numero_reaproveitavel: true,
        c_stat: true,
        xml_autorizado: true,
        cancelamento_n_prot: true,
      },
    });
    const envios = await this.enviosDoCancelamento(cupons.filter((c) => c.situacao === 'cancelado').map((c) => c.id));
    const arquivos: { nome: string; dados: Buffer }[] = [];
    for (const c of cupons) {
      if (!DOCUMENTO.includes(c.situacao) || c.xml_autorizado === null) continue;
      arquivos.push({ nome: `NFCe-${c.chave}.xml`, dados: Buffer.from(c.xml_autorizado, 'utf8') });
      if (c.situacao !== 'cancelado') continue;
      const proc = procEventoDoCancelamento(
        c,
        envios.filter((e) => e.cupom_id === c.id),
      );
      if (proc === null) this.semCancelamento(c);
      else arquivos.push({ nome: `NFCe-${c.chave}-cancelamento.xml`, dados: Buffer.from(proc, 'utf8') });
    }
    arquivos.push({ nome: 'numeros-nao-usados.csv', dados: Buffer.from(await this.naoUsados(a, cupons), 'utf8') });
    return { nome: a === 'producao' ? `cupons-${mes}.zip` : `cupons-de-teste-${mes}.zip`, zip: zipSemCompressao(arquivos, agora) };
  }

  /**
   * `numeros-nao-usados.csv`: cada número dos cupons do mês que não é de nenhum documento fiscal (nem de um cupom de outro mês, quando o
   * número descartado foi reaproveitado depois), com o motivo do cupom mais novo com ele. Com BOM, para o Excel ler os acentos.
   */
  private async naoUsados(
    a: AmbienteSefaz,
    cupons: { serie: number; numero: bigint; situacao: string; numero_reaproveitavel: boolean; c_stat: number | null }[],
  ): Promise<string> {
    const chave = (c: { serie: number; numero: bigint }) => `${c.serie}-${c.numero}`;
    const usados = new Set(cupons.filter((c) => DOCUMENTO.includes(c.situacao)).map(chave));
    const candidatos = cupons.filter((c) => !DOCUMENTO.includes(c.situacao) && !usados.has(chave(c)));
    if (candidatos.length > 0) {
      const depois = await this.prisma.nfce_cupons.findMany({
        where: { ambiente: a, situacao: { in: [...DOCUMENTO] }, numero: { in: [...new Set(candidatos.map((c) => c.numero))] } },
        select: { serie: true, numero: true },
      });
      for (const d of depois) usados.add(chave(d));
    }
    // os cupons vêm do mais velho para o mais novo de cada número: fica o mais novo
    const porNumero = new Map<string, (typeof candidatos)[number]>();
    for (const c of candidatos) if (!usados.has(chave(c))) porNumero.set(chave(c), c);
    const linhas = [...porNumero.values()].map((c) => `${c.serie};${c.numero};${campoCsv(motivoNaoUsado(c))}`);
    return `﻿${['serie;numero;motivo', ...linhas].join('\n')}\n`;
  }

  /** Os pedidos de cancelamento e as consultas respondidas destes cupons, do mais novo para o mais velho. */
  private async enviosDoCancelamento(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.nfce_envios.findMany({
      where: { cupom_id: { in: ids }, servico: { in: ['cancelamento', 'consulta'] }, resultado: 'respondida' },
      orderBy: { iniciada_em: 'desc' },
      select: { cupom_id: true, servico: true, c_stat: true, n_prot: true, xml_enviado: true, xml_retorno: true },
    });
  }

  /** O cupom cancelado sem o arquivo do cancelamento: alerta no log (série e número; nunca chave, CPF ou XML). */
  private semCancelamento(c: Pick<nfce_cupons, 'ambiente' | 'serie' | 'numero'>): void {
    this.logger.error(
      JSON.stringify({
        evento: 'nfce.leitura',
        alerta: 'cancelamento_sem_arquivo',
        ambiente: c.ambiente,
        serie: c.serie,
        numero: Number(c.numero),
      }),
    );
  }

  /** 409 `NFCE_SITUACAO` com o rótulo da situação efetiva ("Este cupom já foi cancelado; não dá para imprimir."). */
  private async semArquivo(c: nfce_cupons, acao: AcaoDaFrase, agora: Date) {
    const s = situacaoEfetiva(paraAcoes(c, await this.emissao.horasDoCupom(this.prisma, c.id)), agora);
    return r409('NFCE_SITUACAO', FRASE_ERRO.NFCE_SITUACAO(s, acao));
  }

  // ======================================================================================================================== vendas

  /**
   * O aviso da importação de vendas (desenho §3.4): os cupons valendo cuja venda está no estoque (lançada e não desfeita), emitidos
   * entre `ini` e `fim` (dias de Brasília, como `vendas.data`), e o total deles.
   */
  async vendasNoPeriodo(ini: string, fim: string): Promise<{ quantidade: number; valor_centavos: number }> {
    if (!isDateString(ini) || !isDateString(fim) || ini > fim) throw invalido('ini e fim devem ser datas AAAA-MM-DD, com ini até fim');
    const cupons = await this.prisma.nfce_cupons.findMany({
      where: {
        ambiente: 'producao',
        venda_lancada_em: { not: null },
        venda_desfeita_em: null,
        dh_emi: { gte: inicioDoDiaSp(ini), lt: inicioDoDiaSp(addDays(fim, 1)) },
      },
      select: { valor_total: true },
    });
    return { quantidade: cupons.length, valor_centavos: cupons.reduce((s, c) => s + centavos(c.valor_total), 0) };
  }
}
