/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória: `where`/`data` em formato livre */
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type itens_cardapio,
  type nfce_ambientes,
  type nfce_ambientes_historico,
  type nfce_cupons,
  type nfce_emitente,
  type nfce_envios,
  type nfce_itens,
  type nfce_perfis_fiscais,
} from '@prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';

/**
 * As tabelas do cupom fiscal em memória (mais a linha única de `configuracoes` e o cardápio), no molde de
 * `notas-sefaz/__tests__/prisma-sefaz.falso.ts`. Os testes semeiam e conferem direto em `t`. Nasce como a migração `nfce`: o emitente
 * (id = 1) e os dois ambientes, com a emissão desligada.
 *
 * Estrito de propósito: confere os CHECKs, os únicos e as chaves estrangeiras das tabelas que o cadastro grava (o Postgres recusa e o
 * filtro vira 500 ou 409 `EM_USO`), devolve `Prisma.Decimal` e `bigint` como o Prisma, e conta as transações (`est.transacoes`) e os
 * `FOR UPDATE` pedidos dentro delas (`est.travas`, os valores do `$queryRaw`).
 */
export type TabelasCupom = {
  configuracoes: { id: number; cnpj: string };
  nfce_emitente: nfce_emitente[];
  nfce_ambientes: nfce_ambientes[];
  nfce_ambientes_historico: nfce_ambientes_historico[];
  nfce_perfis_fiscais: nfce_perfis_fiscais[];
  nfce_itens: nfce_itens[];
  itens_cardapio: itens_cardapio[];
  nfce_cupons: nfce_cupons[];
  nfce_envios: nfce_envios[];
};
type NomeTabela = Exclude<keyof TabelasCupom, 'configuracoes'>;
const TABELAS: NomeTabela[] = [
  'nfce_emitente',
  'nfce_ambientes',
  'nfce_ambientes_historico',
  'nfce_perfis_fiscais',
  'nfce_itens',
  'itens_cardapio',
  'nfce_cupons',
  'nfce_envios',
];

/** Colunas com DEFAULT no banco (o resto vem do `data`). Ids e datas `now()` são gerados aqui. */
function padroes(tabela: NomeTabela): Record<string, unknown> {
  const agora = new Date();
  switch (tabela) {
    case 'nfce_emitente':
      return {
        id: 1,
        ie: null,
        crt: null,
        logradouro: null,
        numero: null,
        complemento: null,
        bairro: null,
        cep: null,
        cod_municipio: '3556206',
        municipio: 'Valinhos',
        uf: 'SP',
        telefone: null,
        nat_op: 'VENDA',
        inf_cpl: null,
        resp_tec_cnpj: null,
        resp_tec_contato: null,
        resp_tec_email: null,
        resp_tec_fone: null,
        series_outro_sistema: [],
        sem_outro_sistema: false,
        cupom_lanca_venda: null,
        cupom_lanca_venda_por: null,
        cupom_lanca_venda_por_nome: null,
        cupom_lanca_venda_em: null,
        tp_regime_ibscbs: null,
        atualizado_por: null,
        atualizado_por_nome: null,
        atualizado_em: null,
      };
    case 'nfce_ambientes':
      return {
        emissao_ligada: false,
        ligada_cnpj: null,
        ligada_serie: null,
        serie: null,
        proximo_numero: 1n,
        csc_cifrado: null,
        csc_dica: null,
        id_csc: null,
        situacao: 'ok',
        mensagem: null,
        bloqueado_ate: null,
        ultimo_656_em: null,
        ultimo_status_em: null,
        alterada_por: null,
        alterada_por_nome: null,
        alterada_em: null,
      };
    case 'nfce_ambientes_historico':
      return { id: randomUUID(), campos: [], c_stat: null, mensagem: null, feito_por: null, feito_por_nome: null, feito_em: agora };
    case 'nfce_perfis_fiscais':
      return {
        id: randomUUID(),
        csosn: null,
        cst_icms: null,
        aliq_icms: null,
        pis_cst: null,
        cofins_cst: null,
        c_ativ_sn: null,
        ibs_sn_aliq: null,
        cbs_sn_aliq: null,
        ibscbs_cst: null,
        ibscbs_cclass_trib: null,
        ativo: true,
        criado_em: agora,
        atualizado_por: null,
        atualizado_por_nome: null,
        atualizado_em: null,
      };
    case 'nfce_itens':
      return {
        perfil_fiscal_id: null,
        ncm: null,
        cest: null,
        gtin: null,
        origem: 0,
        descricao_cupom: null,
        unidade: null,
        atualizado_por: null,
        atualizado_por_nome: null,
        atualizado_em: null,
      };
    case 'itens_cardapio':
      return {
        id: randomUUID(),
        codigo: null,
        categoria: 'Pratos',
        grupo: 'Alimentos',
        unidade_venda: 'UN',
        preco_venda: null,
        mkup: null,
        ncm: null,
        cfop: null,
        cst: null,
        aliquota: null,
        observacoes: null,
        ativo: true,
        created_at: agora,
      };
    case 'nfce_cupons':
      return {
        id: randomUUID(),
        chave: '',
        c_nf: '00000001',
        tp_emis: 1,
        dh_cont: null,
        x_just: null,
        dh_emi: agora,
        situacao: 'enviando',
        numero_reaproveitavel: true,
        envios: 0,
        chave_idempotencia: randomUUID(),
        pedido_hash: '0'.repeat(64),
        lanca_venda: false,
        consumidor_doc: null,
        valor_produtos: '0',
        valor_desconto: '0',
        valor_total: '0',
        valor_troco: '0',
        autorizada_em: null,
        n_prot: null,
        c_stat: null,
        x_motivo: null,
        alerta_c_msg: null,
        alerta_x_msg: null,
        dig_val: null,
        xml_autorizado: null,
        cancelado_em: null,
        cancelamento_motivo: null,
        cancelamento_n_prot: null,
        cancelamento_pedido_em: null,
        venda_lancada_em: null,
        venda_desfeita_em: null,
        venda_erro: null,
        descartado_em: null,
        descarte_motivo: null,
        emitido_por: null,
        emitido_por_nome: null,
        criado_em: agora,
        atualizado_em: agora,
      };
    case 'nfce_envios':
      return {
        id: randomUUID(),
        cupom_id: null,
        tentativa: null,
        id_lote: null,
        terminada_em: null,
        resultado: null,
        c_stat_lote: null,
        c_stat: null,
        x_motivo: null,
        n_prot: null,
        dh_recbto: null,
        dig_val: null,
        rejeicao: false,
        erro_code: null,
        duracao_ms: null,
        xml_enviado: null,
        xml_retorno: null,
        iniciada_por: null,
        iniciada_por_nome: null,
        certificado_impressao: null,
      };
  }
}

/** Chave primária de cada tabela (o `where` do findUnique/update/upsert). */
const CHAVE: Record<NomeTabela, string> = {
  nfce_emitente: 'id',
  nfce_ambientes: 'ambiente',
  nfce_ambientes_historico: 'id',
  nfce_perfis_fiscais: 'id',
  nfce_itens: 'item_cardapio_id',
  itens_cardapio: 'id',
  nfce_cupons: 'id',
  nfce_envios: 'id',
};
const DECIMAIS: Partial<Record<NomeTabela, string[]>> = {
  itens_cardapio: ['preco_venda', 'mkup', 'aliquota'],
  nfce_perfis_fiscais: ['aliq_icms', 'ibs_sn_aliq', 'cbs_sn_aliq'],
  nfce_cupons: ['valor_produtos', 'valor_desconto', 'valor_total', 'valor_troco'],
};
const BIGINTS: Partial<Record<NomeTabela, string[]>> = {
  nfce_ambientes: ['proximo_numero'],
  nfce_cupons: ['numero'],
  nfce_envios: ['id_lote'],
};

/** Decimal e bigint como o Prisma devolve. */
function normalizar(tabela: NomeTabela, linha: Record<string, unknown>): Record<string, unknown> {
  for (const k of DECIMAIS[tabela] ?? []) {
    const v = linha[k];
    if (v !== null && v !== undefined && !(v instanceof Prisma.Decimal)) linha[k] = new Prisma.Decimal(v as string | number);
  }
  for (const k of BIGINTS[tabela] ?? []) {
    const v = linha[k];
    if (v !== null && v !== undefined && typeof v !== 'bigint') linha[k] = BigInt(v as number);
  }
  return linha;
}

/** Linha completa com os padrões do banco, para semear direto em `t` (sem conferir os CHECKs: a semente é do teste). */
export function linhaCom<K extends NomeTabela>(tabela: K, dados: Record<string, unknown>): TabelasCupom[K][number] {
  return normalizar(tabela, { ...padroes(tabela), ...dados }) as TabelasCupom[K][number];
}

const erroPrisma = (msg: string, code: 'P2002' | 'P2003' | 'P2025') =>
  new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion: 'falso' });
/** Violação de CHECK/tamanho: no Postgres vira erro sem mapeamento no filtro (500). */
const check = (nome: string) => new Error(`CHECK ${nome} (falso)`);

const casaRe = (v: unknown, re: RegExp) => v === null || (typeof v === 'string' && re.test(v));
const tamanho = (v: unknown) => (typeof v === 'string' ? Array.from(v).length : 0);
const inteiroEntre = (v: unknown, a: number, b: number) => v === null || (Number.isInteger(v) && (v as number) >= a && (v as number) <= b);
const decimalEntre = (v: unknown, a: number, b: number) => v === null || (v instanceof Prisma.Decimal && v.gte(a) && v.lte(b));
const AMBIENTES = ['homologacao', 'producao'];
const SITUACOES_AMBIENTE = ['ok', 'parada_656', 'parada_certificado', 'parada_configuracao', 'parada_serie_em_uso'];

/** O que o Postgres recusa nas tabelas que o cadastro grava (CHECKs da migração `nfce`, tamanhos, únicos e chaves estrangeiras). */
function conferir(t: TabelasCupom, n: NomeTabela, l: Record<string, any>, antiga: Record<string, unknown> | null): void {
  switch (n) {
    case 'nfce_emitente': {
      if (l.id !== 1) throw check('nfce_emitente_id');
      if (!casaRe(l.ie, /^[0-9]{1,14}$/)) throw check('nfce_emitente_ie');
      if (!(l.crt === null || [1, 2, 3, 4].includes(l.crt))) throw check('nfce_emitente_crt');
      if (!casaRe(l.cep, /^[0-9]{8}$/)) throw check('nfce_emitente_cep');
      if (!(typeof l.cod_municipio === 'string' && /^[0-9]{7}$/.test(l.cod_municipio))) throw check('nfce_emitente_cod_municipio');
      if (!(typeof l.uf === 'string' && /^[A-Z]{2}$/.test(l.uf))) throw check('nfce_emitente_uf');
      if (!(typeof l.municipio === 'string')) throw check('nfce_emitente_municipio NOT NULL');
      if (!(typeof l.nat_op === 'string' && tamanho(l.nat_op) >= 1 && tamanho(l.nat_op) <= 60)) throw check('nfce_emitente_nat_op');
      if (!(l.inf_cpl === null || tamanho(l.inf_cpl) <= 500)) throw check('nfce_emitente_inf_cpl');
      if (!casaRe(l.resp_tec_cnpj, /^[0-9A-Z]{12}[0-9]{2}$/)) throw check('nfce_emitente_resp_tec_cnpj');
      const nulos = [l.resp_tec_cnpj, l.resp_tec_contato, l.resp_tec_email, l.resp_tec_fone].filter((x) => x === null).length;
      if (nulos !== 0 && nulos !== 4) throw check('nfce_emitente_resp_tec_tudo_ou_nada');
      const series = l.series_outro_sistema as unknown[];
      if (!Array.isArray(series) || !series.every((s) => inteiroEntre(s, 0, 889) && s !== null)) {
        throw check('nfce_emitente_series_outro_sistema');
      }
      if (l.sem_outro_sistema && series.length > 0) throw check('nfce_emitente_sem_outro_sistema');
      if (!(l.tp_regime_ibscbs === null || inteiroEntre(l.tp_regime_ibscbs, -32768, 32767))) throw check('smallint');
      return;
    }
    case 'nfce_ambientes': {
      if (!AMBIENTES.includes(l.ambiente)) throw check('nfce_ambientes_ambiente');
      if (l.emissao_ligada && (l.ligada_cnpj === null || l.ligada_serie === null)) throw check('nfce_ambientes_ligada');
      if (!casaRe(l.ligada_cnpj, /^[0-9A-Z]{12}[0-9]{2}$/)) throw check('nfce_ambientes_ligada_cnpj');
      if (!inteiroEntre(l.ligada_serie, 0, 889)) throw check('nfce_ambientes_ligada_serie');
      if (!inteiroEntre(l.serie, 0, 889)) throw check('nfce_ambientes_serie');
      if (!(typeof l.proximo_numero === 'bigint' && l.proximo_numero >= 1n && l.proximo_numero <= 999_999_999n)) {
        throw check('nfce_ambientes_proximo_numero');
      }
      if ((l.csc_cifrado === null) !== (l.csc_dica === null)) throw check('nfce_ambientes_csc');
      if (!(l.csc_dica === null || tamanho(l.csc_dica) <= 4)) throw check('char(4) csc_dica');
      if (!inteiroEntre(l.id_csc, 1, 999_999)) throw check('nfce_ambientes_id_csc');
      if (!SITUACOES_AMBIENTE.includes(l.situacao)) throw check('nfce_ambientes_situacao');
      return;
    }
    case 'nfce_ambientes_historico': {
      if (!AMBIENTES.includes(l.ambiente)) throw check('nfce_ambientes_historico_ambiente');
      if (!['ligada', 'desligada', 'parada_automatica', 'configuracao'].includes(l.evento)) throw check('nfce_ambientes_historico_evento');
      if (!SITUACOES_AMBIENTE.includes(l.situacao)) throw check('nfce_ambientes_historico_situacao');
      if (!Array.isArray(l.campos) || !l.campos.every((c: unknown) => typeof c === 'string')) throw check('text[] campos');
      return;
    }
    case 'nfce_perfis_fiscais': {
      if (!(typeof l.nome === 'string' && l.nome.trim().length >= 1)) throw check('nfce_perfis_fiscais_nome');
      if (!(typeof l.cfop === 'string' && /^[0-9]{4}$/.test(l.cfop))) throw check('nfce_perfis_fiscais_cfop');
      if ((l.csosn === null) === (l.cst_icms === null)) throw check('nfce_perfis_fiscais_icms');
      if (!casaRe(l.csosn, /^[0-9]{3}$/)) throw check('nfce_perfis_fiscais_csosn');
      if (!casaRe(l.cst_icms, /^[0-9]{2}$/)) throw check('nfce_perfis_fiscais_cst_icms');
      if (!decimalEntre(l.aliq_icms, 0, 100)) throw check('nfce_perfis_fiscais_aliq_icms');
      if (!casaRe(l.pis_cst, /^[0-9]{2}$/)) throw check('nfce_perfis_fiscais_pis_cst');
      if (!casaRe(l.cofins_cst, /^[0-9]{2}$/)) throw check('nfce_perfis_fiscais_cofins_cst');
      if (!casaRe(l.c_ativ_sn, /^[0-9]{2}$/)) throw check('nfce_perfis_fiscais_c_ativ_sn');
      if (!decimalEntre(l.ibs_sn_aliq, 0, 100)) throw check('nfce_perfis_fiscais_ibs_sn_aliq');
      if (!decimalEntre(l.cbs_sn_aliq, 0, 100)) throw check('nfce_perfis_fiscais_cbs_sn_aliq');
      if (!casaRe(l.ibscbs_cst, /^[0-9]{3}$/)) throw check('nfce_perfis_fiscais_ibscbs_cst');
      if (!casaRe(l.ibscbs_cclass_trib, /^[0-9]{6}$/)) throw check('nfce_perfis_fiscais_ibscbs_cclass_trib');
      if (t.nfce_perfis_fiscais.some((o) => o !== antiga && o.nome === l.nome)) throw erroPrisma('nome repetido (falso)', 'P2002');
      return;
    }
    case 'nfce_itens': {
      if (!casaRe(l.ncm, /^[0-9]{8}$/)) throw check('nfce_itens_ncm');
      if (!casaRe(l.cest, /^[0-9]{7}$/)) throw check('nfce_itens_cest');
      if (!casaRe(l.gtin, /^([0-9]{8}|[0-9]{12,14})$/)) throw check('nfce_itens_gtin');
      if (!(Number.isInteger(l.origem) && l.origem >= 0 && l.origem <= 8)) throw check('nfce_itens_origem');
      if (!(l.unidade === null || (typeof l.unidade === 'string' && l.unidade.trim().length >= 1))) throw check('nfce_itens_unidade');
      if (tamanho(l.unidade) > 6) throw check('varchar(6) unidade');
      if (tamanho(l.descricao_cupom) > 120) throw check('varchar(120) descricao_cupom');
      if (!t.itens_cardapio.some((i) => i.id === l.item_cardapio_id)) throw erroPrisma('FK item_cardapio_id (falso)', 'P2003');
      if (l.perfil_fiscal_id !== null && !t.nfce_perfis_fiscais.some((p) => p.id === l.perfil_fiscal_id)) {
        throw erroPrisma('FK perfil_fiscal_id (falso)', 'P2003');
      }
      if (t.nfce_itens.some((o) => o !== antiga && o.item_cardapio_id === l.item_cardapio_id)) throw erroPrisma('PK (falso)', 'P2002');
      return;
    }
    default:
      return; // cardápio, cupons e envios: o cadastro só lê
  }
}

const igual = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
};
const comparar = (a: any, b: any): number => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return 1; // nulos no fim
  if (y === null || y === undefined) return -1;
  return x < y ? -1 : 1;
};

function casa(linha: Record<string, unknown>, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Record<string, any>[]).some((w) => casa(linha, w));
    if (k === 'AND') return (v as Record<string, any>[]).every((w) => casa(linha, w));
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      return Object.entries(v as Record<string, any>).every(([op, x]) => {
        switch (op) {
          case 'in':
            return (x as unknown[]).some((y) => igual(linha[k], y));
          case 'notIn':
            return !(x as unknown[]).some((y) => igual(linha[k], y));
          case 'gte':
            return linha[k] !== null && comparar(linha[k], x) >= 0;
          case 'lte':
            return linha[k] !== null && comparar(linha[k], x) <= 0;
          case 'gt':
            return linha[k] !== null && comparar(linha[k], x) > 0;
          case 'lt':
            return linha[k] !== null && comparar(linha[k], x) < 0;
          case 'not':
            return !igual(linha[k] ?? null, x);
          default:
            throw new Error(`filtro não suportado pelo Prisma falso: ${k}.${op}`);
        }
      });
    }
    return igual(linha[k] ?? null, v);
  });
}

function ordenar<T extends Record<string, unknown>>(
  linhas: T[],
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[],
): T[] {
  if (!orderBy) return linhas;
  const regras = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...linhas].sort((a, b) => {
    for (const [k, dir] of regras) {
      const c = comparar(a[k], b[k]);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

// Cópia por linha (Date e arrays clonados; Decimal e bigint são imutáveis): structuredClone perderia o protótipo do Decimal.
// `undefined` some, como no Prisma ("não mexe").
const copiaLinha = <T>(l: T): T =>
  l === null || l === undefined
    ? l
    : (Object.fromEntries(
        Object.entries(l as object)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v instanceof Date ? new Date(v) : Array.isArray(v) ? [...(v as unknown[])] : v]),
      ) as T);
const copia = <T>(x: T): T => (Array.isArray(x) ? (x.map(copiaLinha) as T) : copiaLinha(x));

/**
 * Prisma falso do cupom fiscal: a superfície que o cadastro usa (`where` por igualdade, `in`, `notIn`, `gt(e)`, `lt(e)`, `not`, `OR`,
 * `AND`; `orderBy`; `take`; `select` é ignorado e a linha inteira volta). `$transaction(cb)` desfaz tudo se `cb` lançar. `est.transacoes`
 * conta as transações; `est.travas` guarda os valores de cada `$queryRaw` feito dentro delas (o `SELECT … FOR UPDATE` do ambiente).
 */
export function montarPrismaCupom(o: { cnpjEmpresa?: string } = {}): {
  prisma: PrismaService;
  t: TabelasCupom;
  est: { transacoes: number; travas: unknown[][] };
} {
  const t: TabelasCupom = {
    configuracoes: { id: 1, cnpj: o.cnpjEmpresa ?? '12.345.678/0001-95' },
    nfce_emitente: [linhaCom('nfce_emitente', {})],
    nfce_ambientes: [linhaCom('nfce_ambientes', { ambiente: 'homologacao' }), linhaCom('nfce_ambientes', { ambiente: 'producao' })],
    nfce_ambientes_historico: [],
    nfce_perfis_fiscais: [],
    nfce_itens: [],
    itens_cardapio: [],
    nfce_cupons: [],
    nfce_envios: [],
  };
  const est = { transacoes: 0, travas: [] as unknown[][] };

  const lista = (n: NomeTabela) => t[n] as unknown as Record<string, unknown>[];
  const porChave = (n: NomeTabela, where: Record<string, unknown>) => {
    const k = CHAVE[n];
    if (!(k in where)) throw new Error(`findUnique/update sem a chave ${k} no Prisma falso (${n})`);
    return lista(n).find((l) => igual(l[k], where[k])) ?? null;
  };
  const obrigatoria = (n: NomeTabela, where: Record<string, unknown>) => {
    const l = porChave(n, where);
    if (!l) throw erroPrisma('Registro não encontrado (falso).', 'P2025');
    return l;
  };
  const inserir = (n: NomeTabela, data: Record<string, unknown>) => {
    const linha = normalizar(n, { ...padroes(n), ...copia(data) });
    conferir(t, n, linha, null);
    lista(n).push(linha);
    return copia(linha);
  };
  const muda = (n: NomeTabela, l: Record<string, unknown>, data: Record<string, unknown>) => {
    const nova = normalizar(n, { ...l, ...copia(data) });
    conferir(t, n, nova, l);
    Object.assign(l, nova);
    return copia(l);
  };
  const muitos = (n: NomeTabela, a: any = {}) => {
    const r = ordenar(
      lista(n).filter((l) => casa(l, a.where)),
      a.orderBy,
    );
    return copia(a.take !== undefined ? r.slice(0, a.take) : r);
  };
  const operacoes = (n: NomeTabela) => ({
    findUnique: async (a: any) => copia(porChave(n, a.where)),
    findFirst: async (a: any = {}) => muitos(n, a)[0] ?? null,
    findMany: async (a: any = {}) => muitos(n, a),
    count: async (a: any = {}) => muitos(n, { where: a.where }).length,
    create: async (a: any) => inserir(n, a.data),
    createMany: async (a: any) => {
      for (const d of a.data as Record<string, unknown>[]) inserir(n, d);
      return { count: (a.data as unknown[]).length };
    },
    update: async (a: any) => muda(n, obrigatoria(n, a.where), a.data),
    updateMany: async (a: any) => {
      const alvo = lista(n).filter((l) => casa(l, a.where));
      for (const l of alvo) muda(n, l, a.data);
      return { count: alvo.length };
    },
    upsert: async (a: any) => {
      const l = porChave(n, a.where);
      return l ? muda(n, l, a.update) : inserir(n, a.create);
    },
  });

  const tabelas = {
    configuracoes: { findUnique: async () => copia(t.configuracoes) },
    ...(Object.fromEntries(TABELAS.map((n) => [n, operacoes(n)])) as Record<NomeTabela, ReturnType<typeof operacoes>>),
  };

  const prisma = {
    ...tabelas,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      est.transacoes++;
      const antes = Object.fromEntries(TABELAS.map((n) => [n, copia(lista(n))])) as Record<NomeTabela, Record<string, unknown>[]>;
      const tx = {
        ...tabelas,
        $queryRaw: async (_sql: unknown, ...valores: unknown[]) => {
          est.travas.push(valores);
          return [{ ok: true }];
        },
      };
      try {
        return await cb(tx);
      } catch (e) {
        for (const n of TABELAS) lista(n).splice(0, lista(n).length, ...antes[n]); // desfaz no lugar: o teste segura `t.x`
        throw e;
      }
    },
  };
  return { prisma: prisma as unknown as PrismaService, t, est };
}
