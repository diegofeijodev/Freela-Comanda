/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória: `where`/`data` em formato livre */
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type notas_entrada,
  type notas_sefaz,
  type sefaz_consultas,
  type sefaz_distribuicao,
  type sefaz_distribuicao_historico,
  type sefaz_documentos,
  type sefaz_eventos_lotes,
  type sefaz_lacunas,
  type sefaz_manifestacao,
  type sefaz_manifestacoes,
} from '@prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { CHAVE_TRAVA_SEFAZ } from '../ciclo.service';
import { CHAVE_TRAVA_SEFAZ_EVENTOS } from '../respostas.service';

/**
 * As tabelas da busca e das respostas na SEFAZ em memória (mais a linha única de `configuracoes` e um `notas_entrada` mínimo, o que o
 * `NotasService.notasLancadas` lê). Os testes semeiam e conferem direto aqui.
 */
export type TabelasSefaz = {
  configuracoes: { id: number; cnpj: string };
  sefaz_distribuicao: sefaz_distribuicao[];
  sefaz_distribuicao_historico: sefaz_distribuicao_historico[];
  sefaz_consultas: sefaz_consultas[];
  sefaz_documentos: sefaz_documentos[];
  sefaz_lacunas: sefaz_lacunas[];
  notas_sefaz: notas_sefaz[];
  sefaz_manifestacao: sefaz_manifestacao[];
  sefaz_eventos_lotes: sefaz_eventos_lotes[];
  sefaz_manifestacoes: sefaz_manifestacoes[];
  notas_entrada: notas_entrada[];
};
type NomeTabela = Exclude<keyof TabelasSefaz, 'configuracoes'>;

// Chaves compostas do schema.prisma (o `where` do Prisma usa o nome gerado).
const COMPOSTAS: Record<string, string[]> = {
  ambiente_cnpj: ['ambiente', 'cnpj'],
  ambiente_chave: ['ambiente', 'chave'],
  ambiente_cnpj_nsu: ['ambiente', 'cnpj', 'nsu'],
};

/** Colunas com DEFAULT no banco (o resto vem do `data`). Ids e datas `now()` são gerados aqui. */
function padroes(tabela: NomeTabela): Record<string, unknown> {
  const agora = new Date();
  switch (tabela) {
    case 'sefaz_distribuicao':
      return {
        busca_ligada: false,
        situacao: 'ok',
        mensagem: null,
        aviso: null,
        ult_nsu: 0n,
        max_nsu: null,
        primeira_consulta_em: null,
        ultima_consulta_em: null,
        proxima_consulta_em: null,
        bloqueado_ate: null,
        em_andamento_desde: null,
        falhas_seguidas: 0,
        alterada_por: null,
        alterada_por_nome: null,
        alterada_em: null,
        criada_em: agora,
      };
    case 'sefaz_distribuicao_historico':
      return { id: randomUUID(), c_stat: null, mensagem: null, feito_por: null, feito_por_nome: null, feito_em: agora };
    case 'sefaz_consultas':
      return {
        id: randomUUID(),
        servico: 'distNSU',
        iniciada_por: null,
        iniciada_por_nome: null,
        terminada_em: null,
        resultado: null,
        c_stat: null,
        x_motivo: null,
        dh_resp: null,
        ult_nsu: null,
        max_nsu: null,
        documentos: null,
        erro_code: null,
      };
    case 'sefaz_lacunas':
      return { id: randomUUID(), detectada_em: agora, preenchida_em: null };
    case 'sefaz_documentos':
      return {
        id: randomUUID(),
        chave: null,
        tp_evento: null,
        xml: null,
        conteudo_bruto: null,
        recebido_em: agora,
        processado_em: null,
        erro_processamento: null,
      };
    case 'notas_sefaz':
      return {
        id: randomUUID(),
        emitente_nome: '',
        emitida_em: null,
        autorizada_em: null,
        valor_total: null,
        tp_nf: null,
        fin_nfe: null,
        nat_op: null,
        cancelada_em: null,
        resumo_id: null,
        documento_completo_id: null,
        ignorada_em: null,
        ignorada_por: null,
        ignorada_por_nome: null,
        motivo_ignorar: null,
        motivo_texto: null,
        criada_em: agora,
        atualizada_em: agora,
      };
    case 'sefaz_manifestacao':
      return {
        ligada: false,
        situacao: 'ok',
        mensagem: null,
        pausa_ate: null,
        falhas_seguidas: 0,
        ligada_em: null,
        alterada_por: null,
        alterada_por_nome: null,
        alterada_em: null,
        criada_em: agora,
      };
    case 'sefaz_eventos_lotes':
      return { id: randomUUID(), terminado_em: null, resultado: null, c_stat: null, x_motivo: null, eventos: null, erro_code: null };
    case 'sefaz_manifestacoes':
      return {
        id: randomUUID(),
        n_seq: 1,
        x_just: null,
        pedida_por: null,
        pedida_por_nome: null,
        pedida_em: agora,
        situacao: 'na_fila',
        tentativas: 0,
        lote_id: null,
        dh_evento: null,
        c_stat: null,
        x_motivo: null,
        n_prot: null,
        dh_reg_evento: null,
        xml_evento: null,
        xml_retorno: null,
        impressao_digital: null,
        saiu_em: null,
        criada_em: agora,
        atualizada_em: agora,
      };
    case 'notas_entrada':
      return {
        id: randomUUID(),
        chave: null,
        numero: null,
        serie: null,
        fornecedor_nome: '',
        fornecedor_cnpj: null,
        data_emissao: new Date('2026-11-10T00:00:00Z'),
        data_entrada: new Date('2026-11-10T00:00:00Z'),
        valor_total: '0',
        forma_pagamento: 'outros',
        origem: 'xml',
        status: 'rascunho',
        observacao: null,
        usuario_id: null,
        repetida_de: null,
        created_at: agora,
      };
  }
}

/** Linha completa com os padrões do banco, para semear direto em `t`. */
export function linhaCom<K extends NomeTabela>(tabela: K, dados: Record<string, unknown>): TabelasSefaz[K][number] {
  return normalizar(tabela, { ...padroes(tabela), ...dados }) as TabelasSefaz[K][number];
}

function normalizar(tabela: NomeTabela, linha: Record<string, unknown>): Record<string, unknown> {
  // Decimal como o Prisma devolve
  if (
    (tabela === 'notas_sefaz' || tabela === 'notas_entrada') &&
    linha.valor_total !== null &&
    linha.valor_total !== undefined &&
    !(linha.valor_total instanceof Prisma.Decimal)
  ) {
    linha.valor_total = new Prisma.Decimal(linha.valor_total as string);
  }
  return linha;
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
    if (COMPOSTAS[k]) return COMPOSTAS[k].every((c) => igual(linha[c], v[c]));
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).some((x) => igual(linha[k], x));
      if ('gte' in v) return linha[k] !== null && comparar(linha[k], v.gte) >= 0;
      if ('lte' in v) return linha[k] !== null && comparar(linha[k], v.lte) <= 0;
      if ('not' in v) return !igual(linha[k] ?? null, v.not);
      throw new Error(`filtro não suportado pelo Prisma falso: ${k}`);
    }
    return igual(linha[k], v);
  });
}

const FINAL_ATIVA = ['na_fila', 'enviando', 'registrada', 'falhou'];
const conferencia = (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2002', clientVersion: 'falso' });

/**
 * O que o Postgres recusa em `sefaz_manifestacoes` e o falso confere a cada escrita (como no banco, a linha não muda):
 * os dois únicos parciais (`evento_ativo`, `uma_final`), o CHECK de `tentativas` (0–3), o de `c_stat` e a chave estrangeira `lote_id`.
 */
function conferirManifestacao(t: TabelasSefaz, nova: Record<string, any>, antiga: Record<string, any> | null): void {
  if (!Number.isInteger(nova.tentativas) || nova.tentativas < 0 || nova.tentativas > 3) {
    throw new Error('CHECK sefaz_manifestacoes_tentativas (falso)');
  }
  if (nova.c_stat !== null && (nova.c_stat < 100 || nova.c_stat > 9999)) throw new Error('CHECK sefaz_manifestacoes_c_stat (falso)');
  if (nova.lote_id !== null && !t.sefaz_eventos_lotes.some((l) => l.id === nova.lote_id)) {
    throw new Error('FK sefaz_manifestacoes_lote_id_fkey (falso)');
  }
  for (const o of t.sefaz_manifestacoes as Record<string, any>[]) {
    if (o === antiga || o.ambiente !== nova.ambiente || o.chave !== nova.chave) continue;
    if (o.tp_evento === nova.tp_evento && o.n_seq === nova.n_seq && o.situacao !== 'cancelada' && nova.situacao !== 'cancelada') {
      throw conferencia('sefaz_manifestacoes_evento_ativo (falso)');
    }
    const finais = o.tp_evento !== '210210' && nova.tp_evento !== '210210';
    if (finais && FINAL_ATIVA.includes(o.situacao) && FINAL_ATIVA.includes(nova.situacao)) {
      throw conferencia('sefaz_manifestacoes_uma_final (falso)');
    }
  }
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

// Cópia rasa por linha (Date clonada; Decimal e bigint são imutáveis): structuredClone perderia o protótipo do Decimal.
// `undefined` some, como no Prisma ("não mexe").
const copiaLinha = <T>(l: T): T =>
  l === null || l === undefined
    ? l
    : (Object.fromEntries(
        Object.entries(l as object)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v instanceof Date ? new Date(v) : v]),
      ) as T);
const copia = <T>(x: T): T => (Array.isArray(x) ? (x.map(copiaLinha) as T) : copiaLinha(x));

type Trava = { ocupada: boolean };

/**
 * Prisma falso da busca e das respostas na SEFAZ: só a superfície que o ciclo, a caixa e a fila usam (`where` por igualdade, `in`,
 * `gte`, `lte`, `not` e `OR`). `$transaction(cb)` desfaz tudo se `cb` lançar. As travas consultivas são simuladas, uma por chave:
 * `trava` = a da busca (CHAVE_TRAVA_SEFAZ) e `travaEventos` = a das respostas (CHAVE_TRAVA_SEFAZ_EVENTOS); `ocupada = true` = outra
 * conexão a segura; `$queryRaw` (tentada) devolve `[{ ok }]` e `$executeRaw` (que espera) aguarda a liberação. `chavesUsadas` guarda
 * a chave de cada pedido de trava (outra chave = erro: o teste pegaria a trava errada).
 */
export function montarPrismaSefaz(o: { cnpjEmpresa?: string; travaOcupada?: boolean } = {}): {
  prisma: PrismaService;
  t: TabelasSefaz;
  trava: Trava;
  travaEventos: Trava;
  chavesUsadas: number[];
} {
  const t: TabelasSefaz = {
    configuracoes: { id: 1, cnpj: o.cnpjEmpresa ?? '12.345.678/0001-95' },
    sefaz_distribuicao: [],
    sefaz_distribuicao_historico: [],
    sefaz_consultas: [],
    sefaz_documentos: [],
    sefaz_lacunas: [],
    notas_sefaz: [],
    sefaz_manifestacao: [],
    sefaz_eventos_lotes: [],
    sefaz_manifestacoes: [],
    notas_entrada: [],
  };
  const trava: Trava = { ocupada: !!o.travaOcupada };
  const travaEventos: Trava = { ocupada: false };
  const travas = new Map<number, Trava>([
    [CHAVE_TRAVA_SEFAZ, trava],
    [CHAVE_TRAVA_SEFAZ_EVENTOS, travaEventos],
  ]);
  const donos = new Map<Trava, symbol>();
  const esperando: (() => void)[] = [];
  const chavesUsadas: number[] = [];
  /** A trava pedida no SQL (`${chave}::bigint` é o 1º valor do template). */
  const travaDe = (valores: unknown[]): Trava => {
    const chave = Number(valores[0]);
    chavesUsadas.push(chave);
    const tr = travas.get(chave);
    if (!tr) throw new Error(`trava desconhecida no Prisma falso: ${chave}`);
    return tr;
  };

  const lista = (n: NomeTabela) => t[n] as unknown as Record<string, unknown>[];
  const achar = (n: NomeTabela, where: any) => lista(n).find((l) => casa(l, where)) ?? null;
  const obrigatoria = (n: NomeTabela, where: any) => {
    const l = achar(n, where);
    if (!l) throw new Prisma.PrismaClientKnownRequestError('Registro não encontrado (falso).', { code: 'P2025', clientVersion: 'falso' });
    return l;
  };
  const inserir = (n: NomeTabela, data: Record<string, unknown>) => {
    const linha = normalizar(n, { ...padroes(n), ...copia(data) });
    lista(n).push(linha);
    return copia(linha);
  };
  const muda = (n: NomeTabela, l: Record<string, unknown>, data: Record<string, unknown>) => {
    Object.assign(l, normalizar(n, { ...copia(data) }));
    return copia(l);
  };
  const mudaManifestacao = (l: Record<string, unknown>, data: Record<string, unknown>) => {
    conferirManifestacao(t, { ...l, ...copia(data) }, l);
    return muda('sefaz_manifestacoes', l, data);
  };
  const muitos = (n: NomeTabela, a: any = {}) => {
    const r = ordenar(
      lista(n).filter((l) => casa(l, a.where)),
      a.orderBy,
    );
    return copia(a.take !== undefined ? r.slice(0, a.take) : r);
  };

  const tabelas = {
    configuracoes: { findUnique: async () => copia(t.configuracoes) },
    sefaz_distribuicao: {
      findUnique: async (a: any) => copia(achar('sefaz_distribuicao', a.where)),
      findMany: async (a: any) => muitos('sefaz_distribuicao', a),
      upsert: async (a: any) => {
        const l = achar('sefaz_distribuicao', a.where);
        return l ? muda('sefaz_distribuicao', l, a.update) : inserir('sefaz_distribuicao', a.create);
      },
      update: async (a: any) => muda('sefaz_distribuicao', obrigatoria('sefaz_distribuicao', a.where), a.data),
    },
    sefaz_distribuicao_historico: {
      create: async (a: any) => inserir('sefaz_distribuicao_historico', a.data),
      findMany: async (a: any) => muitos('sefaz_distribuicao_historico', a),
    },
    sefaz_consultas: {
      create: async (a: any) => inserir('sefaz_consultas', a.data),
      update: async (a: any) => muda('sefaz_consultas', obrigatoria('sefaz_consultas', a.where), a.data),
      updateMany: async (a: any) => {
        const alvo = lista('sefaz_consultas').filter((l) => casa(l, a.where));
        for (const l of alvo) muda('sefaz_consultas', l, a.data);
        return { count: alvo.length };
      },
      findMany: async (a: any) => muitos('sefaz_consultas', a),
      findFirst: async (a: any) => muitos('sefaz_consultas', a)[0] ?? null,
      count: async (a: any) => muitos('sefaz_consultas', a).length,
    },
    sefaz_documentos: {
      createMany: async (a: any) => {
        let count = 0;
        for (const d of a.data as Record<string, unknown>[]) {
          const repetido = achar('sefaz_documentos', { ambiente_cnpj_nsu: { ambiente: d.ambiente, cnpj: d.cnpj, nsu: d.nsu } });
          if (repetido && a.skipDuplicates) continue;
          if (repetido) throw new Prisma.PrismaClientKnownRequestError('NSU repetido (falso).', { code: 'P2002', clientVersion: 'falso' });
          inserir('sefaz_documentos', d);
          count++;
        }
        return { count };
      },
      findMany: async (a: any) => muitos('sefaz_documentos', a),
      findUnique: async (a: any) => copia(achar('sefaz_documentos', a.where)),
      update: async (a: any) => muda('sefaz_documentos', obrigatoria('sefaz_documentos', a.where), a.data),
    },
    sefaz_lacunas: {
      create: async (a: any) => inserir('sefaz_lacunas', a.data),
      findMany: async (a: any) => muitos('sefaz_lacunas', a),
    },
    notas_sefaz: {
      findUnique: async (a: any) => copia(achar('notas_sefaz', a.where)),
      create: async (a: any) => {
        const d = a.data as Record<string, unknown>;
        if (achar('notas_sefaz', { ambiente_chave: { ambiente: d.ambiente, chave: d.chave } })) {
          throw new Prisma.PrismaClientKnownRequestError('Chave repetida (falso).', { code: 'P2002', clientVersion: 'falso' });
        }
        return inserir('notas_sefaz', d);
      },
      update: async (a: any) => muda('notas_sefaz', obrigatoria('notas_sefaz', a.where), a.data),
      findMany: async (a: any) => muitos('notas_sefaz', a),
      count: async (a: any) => muitos('notas_sefaz', a).length,
    },
    sefaz_manifestacao: {
      findUnique: async (a: any) => copia(achar('sefaz_manifestacao', a.where)),
      create: async (a: any) => {
        const d = a.data as Record<string, unknown>;
        if (achar('sefaz_manifestacao', { ambiente_cnpj: { ambiente: d.ambiente, cnpj: d.cnpj } })) {
          throw new Prisma.PrismaClientKnownRequestError('Linha repetida (falso).', { code: 'P2002', clientVersion: 'falso' });
        }
        return inserir('sefaz_manifestacao', d);
      },
      update: async (a: any) => muda('sefaz_manifestacao', obrigatoria('sefaz_manifestacao', a.where), a.data),
    },
    sefaz_eventos_lotes: {
      create: async (a: any) => inserir('sefaz_eventos_lotes', a.data),
      update: async (a: any) => muda('sefaz_eventos_lotes', obrigatoria('sefaz_eventos_lotes', a.where), a.data),
      findMany: async (a: any) => muitos('sefaz_eventos_lotes', a),
      count: async (a: any) => muitos('sefaz_eventos_lotes', a).length,
    },
    sefaz_manifestacoes: {
      create: async (a: any) => {
        const nova = normalizar('sefaz_manifestacoes', { ...padroes('sefaz_manifestacoes'), ...copia(a.data) });
        conferirManifestacao(t, nova, null);
        t.sefaz_manifestacoes.push(nova as sefaz_manifestacoes);
        return copia(nova);
      },
      findMany: async (a: any) => muitos('sefaz_manifestacoes', a),
      count: async (a: any) => muitos('sefaz_manifestacoes', a).length,
      update: async (a: any) => mudaManifestacao(obrigatoria('sefaz_manifestacoes', a.where), a.data),
      updateMany: async (a: any) => {
        const alvo = lista('sefaz_manifestacoes').filter((l) => casa(l, a.where));
        for (const l of alvo) mudaManifestacao(l, a.data);
        return { count: alvo.length };
      },
    },
    notas_entrada: {
      findMany: async (a: any) => muitos('notas_entrada', a),
    },
  };

  const liberar = (id: symbol) => {
    for (const [tr, dono] of donos) {
      if (dono !== id) continue;
      donos.delete(tr);
      tr.ocupada = false;
    }
    esperando.splice(0).forEach((r) => r());
  };

  const prisma = {
    ...tabelas,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const id = Symbol('tx');
      const antes = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, copia(v)])) as TabelasSefaz;
      const tx = {
        ...tabelas,
        $queryRaw: async (_sql: unknown, ...valores: unknown[]) => {
          const tr = travaDe(valores);
          if (tr.ocupada && donos.get(tr) !== id) return [{ ok: false }];
          tr.ocupada = true;
          donos.set(tr, id);
          return [{ ok: true }];
        },
        $executeRaw: async (_sql: unknown, ...valores: unknown[]) => {
          const tr = travaDe(valores);
          while (tr.ocupada && donos.get(tr) !== id) await new Promise<void>((r) => esperando.push(r));
          tr.ocupada = true;
          donos.set(tr, id);
          return 1;
        },
      };
      try {
        return await cb(tx);
      } catch (e) {
        for (const k of Object.keys(antes) as (keyof TabelasSefaz)[]) (t as any)[k] = (antes as any)[k];
        throw e;
      } finally {
        liberar(id);
      }
    },
  };
  return { prisma: prisma as unknown as PrismaService, t, trava, travaEventos, chavesUsadas };
}
