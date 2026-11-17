/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória: `where`/`data` em formato livre */
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type notas_sefaz,
  type sefaz_consultas,
  type sefaz_distribuicao,
  type sefaz_distribuicao_historico,
  type sefaz_documentos,
  type sefaz_lacunas,
} from '@prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';

/** As tabelas da busca na SEFAZ em memória (mais a linha única de `configuracoes`). Os testes semeiam e conferem direto aqui. */
export type TabelasSefaz = {
  configuracoes: { id: number; cnpj: string };
  sefaz_distribuicao: sefaz_distribuicao[];
  sefaz_distribuicao_historico: sefaz_distribuicao_historico[];
  sefaz_consultas: sefaz_consultas[];
  sefaz_documentos: sefaz_documentos[];
  sefaz_lacunas: sefaz_lacunas[];
  notas_sefaz: notas_sefaz[];
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
  }
}

/** Linha completa com os padrões do banco, para semear direto em `t`. */
export function linhaCom<K extends NomeTabela>(tabela: K, dados: Record<string, unknown>): TabelasSefaz[K][number] {
  return normalizar(tabela, { ...padroes(tabela), ...dados }) as TabelasSefaz[K][number];
}

function normalizar(tabela: NomeTabela, linha: Record<string, unknown>): Record<string, unknown> {
  // Decimal como o Prisma devolve
  if (
    tabela === 'notas_sefaz' &&
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
    if (COMPOSTAS[k]) return COMPOSTAS[k].every((c) => igual(linha[c], v[c]));
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).some((x) => igual(linha[k], x));
      if ('gte' in v) return linha[k] !== null && comparar(linha[k], v.gte) >= 0;
      throw new Error(`filtro não suportado pelo Prisma falso: ${k}`);
    }
    return igual(linha[k], v);
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

/**
 * Prisma falso da busca na SEFAZ: só a superfície que o ciclo e a caixa usam (`where` por igualdade, `in` e `gte`).
 * `$transaction(cb)` desfaz tudo se `cb` lançar. A trava consultiva é simulada: `trava.ocupada = true` = outra conexão a segura;
 * `$queryRaw` (tentada) devolve `[{ ok }]` e `$executeRaw` (que espera) aguarda a liberação.
 */
export function montarPrismaSefaz(o: { cnpjEmpresa?: string; travaOcupada?: boolean } = {}): {
  prisma: PrismaService;
  t: TabelasSefaz;
  trava: { ocupada: boolean };
} {
  const t: TabelasSefaz = {
    configuracoes: { id: 1, cnpj: o.cnpjEmpresa ?? '12.345.678/0001-95' },
    sefaz_distribuicao: [],
    sefaz_distribuicao_historico: [],
    sefaz_consultas: [],
    sefaz_documentos: [],
    sefaz_lacunas: [],
    notas_sefaz: [],
  };
  const trava = { ocupada: !!o.travaOcupada };
  let dono: symbol | null = null;
  const esperando: (() => void)[] = [];

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
  };

  const liberar = (id: symbol) => {
    if (dono !== id) return;
    dono = null;
    trava.ocupada = false;
    esperando.splice(0).forEach((r) => r());
  };

  const prisma = {
    ...tabelas,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const id = Symbol('tx');
      const antes = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, copia(v)])) as TabelasSefaz;
      const tx = {
        ...tabelas,
        $queryRaw: async () => {
          if (trava.ocupada && dono !== id) return [{ ok: false }];
          trava.ocupada = true;
          dono = id;
          return [{ ok: true }];
        },
        $executeRaw: async () => {
          while (trava.ocupada && dono !== id) await new Promise<void>((r) => esperando.push(r));
          trava.ocupada = true;
          dono = id;
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
  return { prisma: prisma as unknown as PrismaService, t, trava };
}
