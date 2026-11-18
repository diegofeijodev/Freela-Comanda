/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória: `where`/`data` em formato livre */
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type itens_cardapio,
  type nfce_ambientes,
  type nfce_ambientes_historico,
  type nfce_cupom_itens,
  type nfce_cupom_pagamentos,
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
 * Estrito de propósito: confere os CHECKs, os únicos e as chaves estrangeiras das tabelas que o cadastro e a emissão gravam (o Postgres
 * recusa e o filtro vira 500 ou 409 `EM_USO`), o gatilho de imutável dos cupons (`nfce_cupons_imutavel`, só a lista branca passa depois
 * de autorizado) e o dos itens e pagamentos (`nfce_filhos_imutaveis`), e os índices únicos parciais dos cupons vivos; devolve
 * `Prisma.Decimal` e `bigint` como o Prisma, e conta as transações (`est.transacoes`) e os `FOR UPDATE` pedidos dentro delas
 * (`est.travas`, os valores do `$queryRaw`). Os outros `$queryRaw` da emissão: `nextval('nfce_id_lote_seq')` (`est.idLote`) e as
 * funções da venda (`nfce_lancar_venda`/`nfce_desfazer_venda`, com as recusas da migração; `est.vendas` guarda cada chamada que lançou
 * ou desfez e `est.falharVenda` faz as próximas N falharem como um erro do banco).
 */
export type TabelasCupom = {
  configuracoes: { id: number; cnpj: string; razao_social: string; nome_fantasia: string };
  nfce_emitente: nfce_emitente[];
  nfce_ambientes: nfce_ambientes[];
  nfce_ambientes_historico: nfce_ambientes_historico[];
  nfce_perfis_fiscais: nfce_perfis_fiscais[];
  nfce_itens: nfce_itens[];
  itens_cardapio: itens_cardapio[];
  nfce_cupons: nfce_cupons[];
  nfce_cupom_itens: nfce_cupom_itens[];
  nfce_cupom_pagamentos: nfce_cupom_pagamentos[];
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
  'nfce_cupom_itens',
  'nfce_cupom_pagamentos',
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
    case 'nfce_cupom_itens':
      return {
        id: randomUUID(),
        item_cardapio_id: null,
        cest: null,
        gtin: null,
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
        valor_desconto: '0',
      };
    case 'nfce_cupom_pagamentos':
      return { id: randomUUID(), tp_integra: null };
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
  nfce_cupom_itens: 'id',
  nfce_cupom_pagamentos: 'id',
  nfce_envios: 'id',
};
const DECIMAIS: Partial<Record<NomeTabela, string[]>> = {
  itens_cardapio: ['preco_venda', 'mkup', 'aliquota'],
  nfce_perfis_fiscais: ['aliq_icms', 'ibs_sn_aliq', 'cbs_sn_aliq'],
  nfce_cupons: ['valor_produtos', 'valor_desconto', 'valor_total', 'valor_troco'],
  nfce_cupom_itens: ['aliq_icms', 'ibs_sn_aliq', 'cbs_sn_aliq', 'quantidade', 'valor_unitario', 'valor_bruto', 'valor_desconto'],
  nfce_cupom_pagamentos: ['valor'],
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
    case 'nfce_cupons': {
      if (!AMBIENTES.includes(l.ambiente)) throw check('nfce_cupons_ambiente');
      if (!inteiroEntre(l.serie, 0, 889) || l.serie === null) throw check('nfce_cupons_serie');
      if (!(typeof l.numero === 'bigint' && l.numero >= 1n && l.numero <= 999_999_999n)) throw check('nfce_cupons_numero');
      if (!(typeof l.chave === 'string' && /^35[0-9]{4}[0-9A-Z]{12}[0-9]{2}65[0-9]{22}$/.test(l.chave))) throw check('nfce_cupons_chave');
      const partes =
        l.chave.slice(22, 25) === String(l.serie).padStart(3, '0') &&
        l.chave.slice(25, 34) === String(l.numero).padStart(9, '0') &&
        l.chave.slice(34, 35) === String(l.tp_emis) &&
        l.chave.slice(35, 43) === l.c_nf;
      if (!partes) throw check('nfce_cupons_chave_partes');
      if (!(typeof l.c_nf === 'string' && /^[0-9]{8}$/.test(l.c_nf))) throw check('nfce_cupons_c_nf');
      if (!SITUACOES_CUPOM.includes(l.situacao)) throw check('nfce_cupons_situacao');
      if (!inteiroEntre(l.envios, 0, 3) || l.envios === null) throw check('nfce_cupons_envios');
      if (!(typeof l.pedido_hash === 'string' && /^[0-9a-f]{64}$/.test(l.pedido_hash))) throw check('nfce_cupons_pedido_hash');
      if (typeof l.lanca_venda !== 'boolean' || (l.ambiente !== 'producao' && l.lanca_venda)) throw check('nfce_cupons_lanca_venda');
      if (!casaRe(l.consumidor_doc, /^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$/)) throw check('nfce_cupons_consumidor_doc');
      const valores = [l.valor_produtos, l.valor_desconto, l.valor_total, l.valor_troco] as Prisma.Decimal[];
      if (!valores.every((v) => v instanceof Prisma.Decimal && v.gte(0))) throw check('nfce_cupons_valores');
      if (!l.valor_total.equals(l.valor_produtos.minus(l.valor_desconto))) throw check('nfce_cupons_valor_total');
      if (!casaRe(l.n_prot, /^[0-9]{15}([0-9]{2})?$/)) throw check('nfce_cupons_n_prot');
      if (!casaRe(l.cancelamento_n_prot, /^[0-9]{15}([0-9]{2})?$/)) throw check('nfce_cupons_cancelamento_n_prot');
      if (!inteiroEntre(l.c_stat, 100, 9999)) throw check('nfce_cupons_c_stat');
      if (antiga !== null) imutavel(antiga as Record<string, any>, l);
      const outros = t.nfce_cupons.filter((o) => o !== antiga) as Record<string, any>[];
      if (outros.some((o) => o.id === l.id || o.chave_idempotencia === l.chave_idempotencia)) {
        throw erroPrisma('chave_idempotencia repetida (falso)', 'P2002');
      }
      const vivo = (o: Record<string, any>) => o.situacao !== 'descartado';
      if (vivo(l) && outros.some((o) => vivo(o) && o.ambiente === l.ambiente && o.serie === l.serie && o.numero === l.numero)) {
        throw erroPrisma('Key (ambiente, serie, numero)= (falso: nfce_cupons_numero_vivo)', 'P2002');
      }
      if (vivo(l) && outros.some((o) => vivo(o) && o.chave === l.chave))
        throw erroPrisma('Key (chave)= (falso: nfce_cupons_chave_viva)', 'P2002');
      return;
    }
    case 'nfce_cupom_itens':
    case 'nfce_cupom_pagamentos': {
      const cupom = t.nfce_cupons.find((c) => c.id === l.cupom_id);
      if (!cupom) throw erroPrisma(`FK ${n}.cupom_id (falso)`, 'P2003');
      const antes = antiga === null ? null : t.nfce_cupons.find((c) => c.id === (antiga as Record<string, any>).cupom_id);
      if ([cupom, antes].some((c) => c && PROTEGIDAS.includes(c.situacao))) throw check(`nfce_filhos_imutaveis (${cupom.situacao})`);
      if (n === 'nfce_cupom_itens') {
        if (!inteiroEntre(l.n_item, 1, 990) || l.n_item === null) throw check('nfce_cupom_itens_n_item');
        if (!(typeof l.ncm === 'string' && /^[0-9]{8}$/.test(l.ncm))) throw check('nfce_cupom_itens_ncm');
        if (!(typeof l.cfop === 'string' && /^[0-9]{4}$/.test(l.cfop))) throw check('nfce_cupom_itens_cfop');
        if ((l.csosn === null) === (l.cst_icms === null)) throw check('nfce_cupom_itens_icms');
        if (!(Number.isInteger(l.origem) && l.origem >= 0 && l.origem <= 8)) throw check('nfce_cupom_itens_origem');
        if (!(l.quantidade instanceof Prisma.Decimal && l.quantidade.gt(0))) throw check('nfce_cupom_itens_quantidade');
        const v = l as Record<string, Prisma.Decimal>;
        if (!(v.valor_unitario.gte(0) && v.valor_bruto.gte(0) && v.valor_desconto.gte(0) && v.valor_desconto.lte(v.valor_bruto))) {
          throw check('nfce_cupom_itens_valores');
        }
        if (tamanho(l.c_prod) > 60 || tamanho(l.x_prod) > 120 || tamanho(l.unidade) > 6) throw check('varchar nfce_cupom_itens');
        if (typeof l.nome_cardapio !== 'string' || typeof l.perfil_nome !== 'string') throw check('nfce_cupom_itens NOT NULL');
        const dup = (t.nfce_cupom_itens as Record<string, any>[]).some(
          (o) => o !== antiga && o.cupom_id === l.cupom_id && o.n_item === l.n_item,
        );
        if (dup) throw erroPrisma('(cupom_id, n_item) repetido (falso)', 'P2002');
      } else {
        if (!(Number.isInteger(l.ordem) && l.ordem >= 1)) throw check('nfce_cupom_pagamentos_ordem');
        if (!['01', '03', '04', '10', '11', '17'].includes(l.t_pag)) throw check('nfce_cupom_pagamentos_t_pag');
        if (!(l.valor instanceof Prisma.Decimal && l.valor.gt(0))) throw check('nfce_cupom_pagamentos_valor');
        if (!(l.tp_integra === null || [1, 2].includes(l.tp_integra))) throw check('nfce_cupom_pagamentos_tp_integra');
        const dup = (t.nfce_cupom_pagamentos as Record<string, any>[]).some(
          (o) => o !== antiga && o.cupom_id === l.cupom_id && o.ordem === l.ordem,
        );
        if (dup) throw erroPrisma('(cupom_id, ordem) repetido (falso)', 'P2002');
      }
      return;
    }
    case 'nfce_envios': {
      if (!AMBIENTES.includes(l.ambiente)) throw check('nfce_envios_ambiente');
      if (!['autorizacao', 'consulta', 'cancelamento', 'status'].includes(l.servico)) throw check('nfce_envios_servico');
      if ((l.servico === 'status') !== (l.cupom_id === null)) throw check('nfce_envios_cupom');
      if (!(l.tentativa === null || (Number.isInteger(l.tentativa) && l.tentativa >= 1))) throw check('nfce_envios_tentativa');
      if (!(l.id_lote === null || (typeof l.id_lote === 'bigint' && l.id_lote >= 1n && l.id_lote <= 999_999_999_999_999n))) {
        throw check('nfce_envios_id_lote');
      }
      const resultados = ['respondida', 'falha_antes_de_enviar', 'sem_resposta', 'interrompida'];
      if (!(l.resultado === null || resultados.includes(l.resultado))) throw check('nfce_envios_resultado');
      if (!(l.iniciada_em instanceof Date)) throw check('nfce_envios iniciada_em NOT NULL');
      if (!casaRe(l.n_prot, /^[0-9]{1,17}$/)) throw check('varchar(17) nfce_envios.n_prot');
      if (l.cupom_id !== null && !t.nfce_cupons.some((c) => c.id === l.cupom_id))
        throw erroPrisma('FK nfce_envios.cupom_id (falso)', 'P2003');
      return;
    }
    default:
      return; // cardápio: só a semente do teste
  }
}

/** Situações em que o cupom é documento fiscal (gatilhos `nfce_cupons_imutavel` e `nfce_filhos_imutaveis`). */
const PROTEGIDAS = ['autorizado', 'cancelando', 'denegado', 'cancelado'];
const SITUACOES_CUPOM = [
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
const CAMPOS_DO_CANCELAMENTO = ['cancelado_em', 'cancelamento_motivo', 'cancelamento_n_prot', 'cancelamento_pedido_em'];

const mesmoValor = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal) return a.equals(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => mesmoValor(x, b[i]));
  return (a ?? null) === (b ?? null);
};

/** O gatilho `nfce_cupons_imutavel` da migração: com o cupom já documento fiscal, só a lista branca muda. */
function imutavel(antiga: Record<string, any>, nova: Record<string, any>): void {
  if (!PROTEGIDAS.includes(antiga.situacao)) return;
  const passa =
    nova.situacao === antiga.situacao ||
    (antiga.situacao === 'autorizado' && ['cancelando', 'cancelado'].includes(nova.situacao)) ||
    (antiga.situacao === 'cancelando' && ['autorizado', 'cancelado'].includes(nova.situacao));
  if (!passa) throw check(`nfce_cupons_imutavel: ${antiga.situacao} não passa para ${nova.situacao}`);
  const livres = new Set(['situacao', 'venda_lancada_em', 'venda_desfeita_em', 'venda_erro', 'atualizado_em']);
  if (antiga.situacao === 'autorizado' || antiga.situacao === 'cancelando') for (const c of CAMPOS_DO_CANCELAMENTO) livres.add(c);
  for (const k of new Set([...Object.keys(antiga), ...Object.keys(nova)])) {
    if (!livres.has(k) && !mesmoValor(antiga[k], nova[k])) throw check(`nfce_cupons_imutavel: ${antiga.situacao} não muda ${k}`);
  }
}

/** Erro de `raise exception` dentro de um `$queryRaw` (como o Prisma entrega: P2010 com o SQLSTATE P0001). */
const erroRegra = (msg: string) =>
  new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`P0001\`. Message: \`ERROR: ${msg}\``, {
    code: 'P2010',
    clientVersion: 'falso',
    meta: { code: 'P0001', message: `ERROR: ${msg}` },
  });

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
export type EstadoFalso = {
  transacoes: number;
  travas: unknown[][];
  /** O texto de cada `$queryRaw` (os pedaços do molde, juntos por `$n`). */
  sql: string[];
  /** Último valor de `nextval('nfce_id_lote_seq')`. */
  idLote: number;
  /** Cada chamada de `nfce_lancar_venda`/`nfce_desfazer_venda` que gravou (o id do cupom). */
  vendas: { lancar: string[]; desfazer: string[] };
  /** As próximas N chamadas das funções da venda falham como erro do banco (antes de conferir o cupom). */
  falharVenda: number;
};

export function montarPrismaCupom(o: { cnpjEmpresa?: string } = {}): {
  prisma: PrismaService;
  t: TabelasCupom;
  est: EstadoFalso;
} {
  const t: TabelasCupom = {
    configuracoes: {
      id: 1,
      cnpj: o.cnpjEmpresa ?? '12.345.678/0001-95',
      razao_social: 'Chopp e Espeto Valinhos Ltda',
      nome_fantasia: 'Chopp & Espeto',
    },
    nfce_emitente: [linhaCom('nfce_emitente', {})],
    nfce_ambientes: [linhaCom('nfce_ambientes', { ambiente: 'homologacao' }), linhaCom('nfce_ambientes', { ambiente: 'producao' })],
    nfce_ambientes_historico: [],
    nfce_perfis_fiscais: [],
    nfce_itens: [],
    itens_cardapio: [],
    nfce_cupons: [],
    nfce_cupom_itens: [],
    nfce_cupom_pagamentos: [],
    nfce_envios: [],
  };
  const est: EstadoFalso = { transacoes: 0, travas: [], sql: [], idLote: 0, vendas: { lancar: [], desfazer: [] }, falharVenda: 0 };

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

  /** As recusas e o efeito de `nfce_lancar_venda`/`nfce_desfazer_venda` da migração (sem a tabela `vendas`: só conta). */
  const venda = (tipo: 'lancar' | 'desfazer', id: string): number => {
    if (est.falharVenda > 0) {
      est.falharVenda--;
      throw new Error('conexão com o banco caiu (falso)');
    }
    const c = t.nfce_cupons.find((x) => x.id === id);
    if (!c) throw erroRegra('Cupom fiscal não encontrado.');
    if (tipo === 'desfazer') {
      if (c.situacao !== 'cancelado') throw erroRegra(`Só o cupom cancelado desfaz a venda no estoque (este está ${c.situacao}).`);
      est.vendas.desfazer.push(id);
      Object.assign(c, { venda_desfeita_em: c.venda_desfeita_em ?? new Date(), venda_erro: null });
      return 1;
    }
    if (c.ambiente !== 'producao') throw erroRegra('Cupom de homologação (modo de teste) não lança venda no estoque.');
    if (c.situacao !== 'autorizado') throw erroRegra(`Só o cupom autorizado lança a venda no estoque (este está ${c.situacao}).`);
    if (!c.lanca_venda) throw erroRegra('Este cupom não lança a venda no estoque: a venda dele vem da importação do outro sistema.');
    const ja = c.venda_lancada_em !== null;
    if (!ja) est.vendas.lancar.push(id);
    Object.assign(c, { venda_lancada_em: c.venda_lancada_em ?? new Date(), venda_erro: null });
    return ja ? 0 : 1;
  };

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
        $queryRaw: async (molde: TemplateStringsArray, ...valores: unknown[]) => {
          const sql = Array.from(molde).reduce((a, p, i) => (i === 0 ? p : `${a}$${i}${p}`), '');
          est.sql.push(sql);
          if (sql.includes('nextval')) return [{ id: BigInt(++est.idLote) }];
          if (sql.includes('nfce_lancar_venda')) return [{ n: venda('lancar', valores[0] as string) }];
          if (sql.includes('nfce_desfazer_venda')) return [{ n: venda('desfazer', valores[0] as string) }];
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
