import { readFileSync } from 'node:fs';
import { TABELAS, TABELAS_DE_CONTAS, VIEWS } from './esquema';

export const FORMATO = 'erpfreela-export/1';

export type Linha = Record<string, unknown>;
export type ColunaInfo = { nome: string; tipo: string; nulo: boolean };
export type ResumoTabela = { linhas: number; somas: Record<string, string | null>; colunas: ColunaInfo[] };
export type Resumo = {
  meta: { agora: string; hoje: string; semana_ref: string; fuso: string; versao_pg: string };
  tabelas: Record<string, ResumoTabela>;
  views: Record<string, number>;
  usuarios: number;
  movimentacoes_por_tipo: Record<string, { linhas: number; quantidade: string | null }>;
};
/** Formato gravado pelo `pull.mjs` (api/scripts/lovable-export). */
export type Exportacao = { formato: string; resumo: Resumo; tabelas: Record<string, Linha[]>; usuarios: Linha[]; views: Record<string, Linha[]> };
/** Colunas das tabelas base do NOSSO banco (information_schema), por tabela. */
export type EsquemaNosso = Map<string, ColunaInfo[]>;

const CHAVES_CONTA = ['id', 'email', 'encrypted_password', 'created_at', 'ultimo_acesso', 'confirmada', 'apagada', 'banida', 'anonima'];

export function lerExportacao(arquivo: string): Exportacao {
  const exp = JSON.parse(readFileSync(arquivo, 'utf8')) as Exportacao;
  if (!exp || typeof exp !== 'object' || !exp.resumo || !exp.tabelas || !Array.isArray(exp.usuarios) || !exp.views) {
    throw new Error(`${arquivo} não é uma exportação do pull.mjs`);
  }
  return exp;
}

const lista = (xs: string[]) => xs.join(', ');

/** Compara as colunas de uma tabela no Lovable (resumo) com as nossas: nome, tipo e se aceita nulo. */
function diferencasDeColunas(tabela: string, lov: ColunaInfo[], nossas: ColunaInfo[]): string[] {
  const out: string[] = [];
  const n = new Map(nossas.map((c) => [c.nome, c]));
  const l = new Map(lov.map((c) => [c.nome, c]));
  const soLov = lov.filter((c) => !n.has(c.nome)).map((c) => c.nome);
  const soNossa = nossas.filter((c) => !l.has(c.nome)).map((c) => c.nome);
  if (soLov.length) out.push(`${tabela}: coluna(s) que existem no Lovable e não no sistema novo: ${lista(soLov)}`);
  if (soNossa.length) out.push(`${tabela}: coluna(s) do sistema novo que não existem no Lovable: ${lista(soNossa)}`);
  for (const c of lov) {
    const o = n.get(c.nome);
    if (!o) continue;
    if (o.tipo !== c.tipo) out.push(`${tabela}.${c.nome}: tipo ${c.tipo} no Lovable × ${o.tipo} aqui`);
    if (o.nulo !== c.nulo) out.push(`${tabela}.${c.nome}: ${c.nulo ? 'aceita' : 'não aceita'} nulo no Lovable × ${o.nulo ? 'aceita' : 'não aceita'} aqui`);
  }
  return out;
}

/** Primeira linha cujas chaves não são exatamente as esperadas (chave a mais = dado que se perderia; a menos = viraria nulo). */
function conferirChaves(o: string, linhas: Linha[], esperadas: readonly string[]): string | null {
  const set = new Set(esperadas);
  for (let i = 0; i < linhas.length; i++) {
    const r = linhas[i];
    if (!r || typeof r !== 'object') return `${o}, linha ${i + 1}: não é um objeto`;
    const desconhecidas = Object.keys(r).filter((k) => !set.has(k));
    const faltando = esperadas.filter((k) => !(k in r));
    if (desconhecidas.length || faltando.length) {
      return `${o}, linha ${i + 1}: ${desconhecidas.length ? `chave(s) desconhecida(s) ${lista(desconhecidas)}` : ''}${desconhecidas.length && faltando.length ? '; ' : ''}${faltando.length ? `falta(m) ${lista(faltando)}` : ''}`;
    }
  }
  return null;
}

/**
 * Tudo o que precisa estar certo ANTES de abrir a transação. Devolve a lista de problemas (vazia = pode seguir).
 * Tabela do Lovable fora das 23 + profiles + user_roles, ou qualquer diferença de coluna, aborta: o Lovable pode ter mudado desde o port.
 */
export function validarExportacao(exp: Exportacao, nosso: EsquemaNosso): string[] {
  if (exp.formato !== FORMATO) return [`formato "${exp.formato}" ≠ "${FORMATO}": arquivo de outro pull`];
  const erros: string[] = [];
  const lov = exp.resumo.tabelas ?? {};
  const conhecidas: string[] = [...TABELAS.map((t) => t.nome), ...TABELAS_DE_CONTAS];
  for (const t of Object.keys(lov)) {
    if (!conhecidas.includes(t)) erros.push(`O Lovable tem a tabela "${t}", que o sistema novo não tem (mudou depois do port?): decidir o destino dela antes de migrar`);
  }
  for (const t of conhecidas) if (!lov[t]) erros.push(`falta a tabela "${t}" na exportação`);
  for (const t of TABELAS) {
    const info = lov[t.nome];
    if (!info) continue;
    erros.push(...diferencasDeColunas(t.nome, info.colunas ?? [], nosso.get(t.nome) ?? []));
    const linhas = exp.tabelas[t.nome];
    if (!Array.isArray(linhas)) {
      erros.push(`faltam as linhas de "${t.nome}" no arquivo`);
      continue;
    }
    if (linhas.length !== Number(info.linhas)) erros.push(`${t.nome}: ${linhas.length} linha(s) no arquivo; o resumo do Lovable diz ${info.linhas}. Refaça o pull.`);
    const e = conferirChaves(t.nome, linhas, t.colunas);
    if (e) erros.push(e);
  }
  if (exp.tabelas.configuracoes?.length !== 1) erros.push(`configuracoes: o Lovable tem ${exp.tabelas.configuracoes?.length ?? 0} linha(s); o sistema precisa de exatamente 1 (id 1)`);
  const contas: [string, readonly string[]][] = [['profiles', ['id', 'nome']], ['user_roles', ['user_id', 'role']]];
  for (const [t, precisa] of contas) {
    const linhas = exp.tabelas[t];
    if (!Array.isArray(linhas)) continue;
    if (lov[t] && linhas.length !== Number(lov[t].linhas)) erros.push(`${t}: ${linhas.length} linha(s) no arquivo; o resumo diz ${lov[t].linhas}. Refaça o pull.`);
    const sem = linhas.findIndex((r) => precisa.some((k) => !(k in (r ?? {}))));
    if (sem >= 0) erros.push(`${t}, linha ${sem + 1}: faltam ${lista([...precisa])}`);
  }
  if (exp.usuarios.length !== Number(exp.resumo.usuarios)) erros.push(`contas: ${exp.usuarios.length} no arquivo; o resumo diz ${exp.resumo.usuarios}. Refaça o pull.`);
  const e = conferirChaves('contas (auth.users)', exp.usuarios, CHAVES_CONTA);
  if (e) erros.push(e);
  for (const v of VIEWS) {
    const linhas = exp.views[v.nome];
    if (!Array.isArray(linhas) || exp.resumo.views?.[v.nome] == null) erros.push(`a view ${v.nome} não veio na exportação (o Lovable mudou?)`);
    else if (linhas.length !== Number(exp.resumo.views[v.nome])) erros.push(`${v.nome}: ${linhas.length} linha(s); o resumo diz ${exp.resumo.views[v.nome]}`);
  }
  return erros;
}
