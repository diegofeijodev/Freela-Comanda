// Leituras (selectors) que a prévia e o confirmar da importação de vendas fazem no banco. Só leem; quem grava é o serviço.
// O confirmar chama as mesmas leituras DENTRO da transação (depois da trava), então os números do resultado são os reais (risco 9).
import { Prisma } from '@prisma/client';
import { normalizarCnpj } from '../../common/fiscal/cnpj';
import { chaveVenda } from './planilha';
import { NOME_CUPOM, NOME_PADRAO, type Fonte, type TipoFonte } from './previa';

export type Db = Prisma.TransactionClient;

/** A fonte de cada venda, em SQL (mesma regra de `fonteDaImportacao`): cupom › XML › sistema › planilha padrão. */
const FONTE_SQL = Prisma.sql`CASE WHEN v.nfce_cupom_id IS NOT NULL THEN 'cupom'
            WHEN v.documento_id IS NOT NULL THEN 'xml:' || coalesce(i.origem_id::text, '')
            WHEN i.origem_id IS NOT NULL THEN 'sistema:' || i.origem_id::text
            ELSE 'padrao' END`;

type LinhaFonte = { fonte: string; origem_nome: string | null };

export function fonteDaLinha(r: LinhaFonte): Fonte {
  if (r.fonte === 'cupom') return { chave: 'cupom', nome: NOME_CUPOM, tipo: 'cupom' };
  if (r.fonte === 'padrao') return { chave: 'padrao', nome: NOME_PADRAO, tipo: 'padrao' };
  const tipo = r.fonte.slice(0, r.fonte.indexOf(':')) as TipoFonte;
  const nome = r.origem_nome ?? 'sistema sem nome';
  return { chave: r.fonte, nome: tipo === 'xml' ? `XML de ${nome}` : nome, tipo };
}

const LOTE_CHAVES = 5000;

export class FatosVendas {
  constructor(private readonly db: Db) {}

  /** Vendas já no banco com a chave (pedido + produto + data) de alguma linha do arquivo, com a fonte de cada uma. */
  async existentes(chaves: readonly { pedido: string; produto_relatorio: string; data: string }[]) {
    const out = new Map<string, Fonte & { pedido: string; data: string }>();
    for (let i = 0; i < chaves.length; i += LOTE_CHAVES) {
      const lote = chaves.slice(i, i + LOTE_CHAVES).map((k) => ({ p: k.pedido, x: k.produto_relatorio, d: k.data }));
      const rows = await this.db.$queryRaw<(LinhaFonte & { pedido: string; produto_relatorio: string; data: string })[]>`
        SELECT v.pedido, v.produto_relatorio, to_char(v.data, 'YYYY-MM-DD') AS data, ${FONTE_SQL} AS fonte, o.nome AS origem_nome
          FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) AS k(p text, x text, d date)
          JOIN vendas v ON v.pedido = k.p AND v.produto_relatorio = k.x AND v.data = k.d
          LEFT JOIN importacoes i ON i.id = v.importacao_id
          LEFT JOIN vendas_origens o ON o.id = i.origem_id`;
      for (const r of rows) out.set(chaveVenda(r), { ...fonteDaLinha(r), pedido: r.pedido, data: r.data });
    }
    return out;
  }

  /** Vendas do período por fonte: quantas e quanto (centavos). */
  async porFonte(ini: string, fim: string) {
    const rows = await this.db.$queryRaw<(LinhaFonte & { vendas: number; valor_centavos: bigint })[]>`
      SELECT ${FONTE_SQL} AS fonte, max(o.nome) AS origem_nome, count(*)::int AS vendas,
             round(coalesce(sum(v.valor_total), 0) * 100)::bigint AS valor_centavos
        FROM vendas v
        LEFT JOIN importacoes i ON i.id = v.importacao_id
        LEFT JOIN vendas_origens o ON o.id = i.origem_id
       WHERE v.data BETWEEN ${ini}::date AND ${fim}::date
       GROUP BY 1
       ORDER BY 3 DESC, 1`;
    return rows.map((r) => ({ ...fonteDaLinha(r), vendas: r.vendas, valor_centavos: Number(r.valor_centavos) }));
  }

  /** A última importação confirmada do mesmo arquivo (R7). */
  async arquivoJaImportado(sha: string | undefined) {
    if (!sha) return null;
    const [r] = await this.db.$queryRaw<{ em: Date; por: string | null; vendas: number | null }[]>`
      SELECT i.created_at AS em, u.nome AS por, (i.resultado->>'inseridas')::int AS vendas
        FROM importacoes i LEFT JOIN users u ON u.id = i.usuario_id
       WHERE i.arquivo_sha256 = ${sha} AND i.resultado IS NOT NULL
       ORDER BY i.created_at DESC LIMIT 1`;
    return r ? { em: r.em.toISOString(), por: r.por, vendas: r.vendas } : null;
  }

  async dePara(produtos: readonly string[]) {
    const out = new Map<string, string | null>();
    for (let i = 0; i < produtos.length; i += LOTE_CHAVES) {
      const rs = await this.db.de_para_produtos.findMany({
        where: { produto_relatorio: { in: produtos.slice(i, i + LOTE_CHAVES) } },
        select: { produto_relatorio: true, item_cardapio_id: true },
      });
      for (const r of rs) out.set(r.produto_relatorio, r.item_cardapio_id);
    }
    return out;
  }

  cardapio() {
    return this.db.itens_cardapio.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
  }

  origem(id: string) {
    return this.db.vendas_origens.findUnique({ where: { id } });
  }

  /** CNPJ da loja = o espelho da empresa principal em `configuracoes` (A.4); '' = não cadastrado. */
  async cnpjLoja() {
    const c = await this.db.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    return normalizarCnpj(c?.cnpj ?? '');
  }

  /** Empresas ativas (menos a da loja): CNPJ → nome para a tela. */
  async empresas(cnpjLoja: string) {
    const es = await this.db.empresas.findMany({ where: { ativo: true }, select: { cnpj: true, razao_social: true, nome_fantasia: true } });
    return new Map(es.filter((e) => normalizarCnpj(e.cnpj) !== cnpjLoja).map((e) => [normalizarCnpj(e.cnpj), e.nome_fantasia || e.razao_social]));
  }

  /** Situação das chaves já registradas em `vendas_documentos`; trava as linhas no confirmar (FOR UPDATE). */
  async registrados(chaves: readonly string[], travar: boolean) {
    const out = new Map<string, 'autorizada' | 'cancelada'>();
    if (!chaves.length) return out;
    const rows = travar
      ? await this.db.$queryRaw<{ chave: string; situacao: 'autorizada' | 'cancelada' }[]>`
          SELECT chave, situacao FROM vendas_documentos WHERE chave = ANY(${[...chaves]}::text[]) FOR UPDATE`
      : await this.db.$queryRaw<{ chave: string; situacao: 'autorizada' | 'cancelada' }[]>`
          SELECT chave, situacao FROM vendas_documentos WHERE chave = ANY(${[...chaves]}::text[])`;
    for (const r of rows) out.set(r.chave, r.situacao);
    return out;
  }

  /** Chaves que são de cupons emitidos pelo próprio Comanda. */
  async doComanda(chaves: readonly string[]) {
    if (!chaves.length) return new Set<string>();
    const rs = await this.db.nfce_cupons.findMany({ where: { chave: { in: [...chaves] } }, select: { chave: true } });
    return new Set(rs.map((r) => r.chave));
  }

  /** As vendas dos documentos que um cancelamento vai tirar (P8: quantas linhas, quanto e de quando a quando). */
  async vendasDosDocumentos(chaves: readonly string[]) {
    const vazio = { documentos: 0, linhas: 0, valor_centavos: 0, ini: null as string | null, fim: null as string | null };
    if (!chaves.length) return vazio;
    const [r] = await this.db.$queryRaw<{ linhas: number; valor_centavos: bigint; ini: string | null; fim: string | null }[]>`
      SELECT count(v.id)::int AS linhas, round(coalesce(sum(v.valor_total), 0) * 100)::bigint AS valor_centavos,
             to_char(min(v.data), 'YYYY-MM-DD') AS ini, to_char(max(v.data), 'YYYY-MM-DD') AS fim
        FROM vendas_documentos d JOIN vendas v ON v.documento_id = d.id
       WHERE d.chave = ANY(${[...chaves]}::text[])`;
    return { documentos: chaves.length, linhas: r?.linhas ?? 0, valor_centavos: Number(r?.valor_centavos ?? 0), ini: r?.ini ?? null, fim: r?.fim ?? null };
  }
}
