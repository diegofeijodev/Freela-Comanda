import { Db, inserirLinhas, q } from './banco';
import { PlanoContas } from './contas';
import { fmtDecimal, fmtInt, mesmoDecimal } from './decimal';
import { CASAS_VIEWS, COLUNAS_COM_CONTA, COLUNAS_USERS, GATILHOS, TABELAS, VIEWS } from './esquema';
import { Exportacao } from './exportacao';

export type Verificacao = { ok: boolean; linhas: string[] };

const marca = (ok: boolean) => (ok ? 'ok ' : 'DIFERENTE');

/** 1) Arquivo × banco, linha a linha e coluna a coluna (EXCEPT ALL nos dois sentidos, comparação tipada do Postgres). */
async function linhaALinha(tx: Db, exp: Exportacao, contas: PlanoContas, out: string[]): Promise<boolean> {
  let ok = true;
  let total = 0;
  const comparar = async (nome: string, tmp: string, projecao: string, alvo: string) => {
    const [r] = await tx.$queryRawUnsafe<{ a: number; b: number }[]>(
      `SELECT (SELECT count(*) FROM (SELECT ${projecao} FROM ${tmp} EXCEPT ALL SELECT ${projecao} FROM ${alvo}) x)::int AS a,
              (SELECT count(*) FROM (SELECT ${projecao} FROM ${alvo} EXCEPT ALL SELECT ${projecao} FROM ${tmp}) y)::int AS b`,
    );
    if (r?.a || r?.b) {
      ok = false;
      out.push(`  DIFERENTE ${nome}: ${r.a} linha(s) do arquivo não estão no banco; ${r.b} linha(s) do banco não estão no arquivo`);
    }
  };
  for (const t of TABELAS) {
    const tmp = q(`_lov_${t.nome}`);
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${tmp} (LIKE public.${q(t.nome)}) ON COMMIT DROP`);
    await inserirLinhas(tx, tmp, t.nome, t.colunas, exp.tabelas[t.nome] ?? []);
    await comparar(t.nome, tmp, '*', `public.${q(t.nome)}`);
    total += exp.tabelas[t.nome]?.length ?? 0;
  }
  // Contas: a senha travada é aleatória a cada carga, então ela entra na comparação como '' dos dois lados (e é conferida à parte).
  const travadas = contas.entram.filter((c) => c.senha_travada).map((c) => c.id);
  const lista = travadas.length ? travadas.map((id) => `'${id.replace(/[^0-9a-f-]/gi, '')}'::uuid`).join(', ') : 'NULL::uuid';
  await tx.$executeRawUnsafe('CREATE TEMP TABLE _lov_users (LIKE public.users) ON COMMIT DROP');
  const esperadas = contas.entram.map((c) => ({ ...Object.fromEntries(COLUNAS_USERS.map((k) => [k, c[k]])), password_hash: c.senha_travada ? '' : c.password_hash }));
  await inserirLinhas(tx, '_lov_users', 'users', COLUNAS_USERS, esperadas);
  const proj = `id, email, nome, perfil, created_at, CASE WHEN id IN (${lista}) THEN '' ELSE password_hash END AS senha`;
  await comparar('contas (users)', '_lov_users', proj, 'public.users');
  const [trav] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.users WHERE id IN (${lista}) AND password_hash !~ '^\\$2[aby]\\$'`);
  if (trav?.n) {
    ok = false;
    out.push(`  DIFERENTE contas com senha travada sem hash bcrypt: ${trav.n}`);
  }
  out.push(`  ${marca(ok)} ${fmtInt(total)} linhas em ${TABELAS.length} tabelas + ${contas.entram.length} conta(s), todas as colunas (datas, horas e decimais exatos)`);
  return ok;
}

/** 2) Resumo calculado no Supabase na hora do pull × as mesmas contas aqui. */
async function resumoLovable(tx: Db, exp: Exportacao, out: string[]): Promise<boolean> {
  let ok = true;
  for (const t of TABELAS) {
    const r = exp.resumo.tabelas[t.nome];
    if (!r) continue;
    const somas = Object.keys(r.somas ?? {});
    const sel = ['count(*)::int AS linhas', ...somas.map((c) => `sum(${q(c)})::text AS ${q(c)}`)].join(', ');
    const [n] = await tx.$queryRawUnsafe<Record<string, string | number | null>[]>(`SELECT ${sel} FROM public.${q(t.nome)}`);
    const okL = Number(n?.linhas) === Number(r.linhas);
    ok &&= okL;
    out.push(`  ${marca(okL)} ${t.nome} — linhas: Lovable ${fmtInt(Number(r.linhas))} | nosso ${fmtInt(Number(n?.linhas))}`);
    for (const c of somas) {
      const nosso = (n?.[c] as string | null) ?? null;
      const igual = mesmoDecimal(r.somas[c], nosso);
      ok &&= igual;
      out.push(`      ${marca(igual)} soma de ${t.nome}.${c}: Lovable ${fmtDecimal(r.somas[c])} | nosso ${fmtDecimal(nosso)}`);
    }
  }
  const mov = await tx.$queryRawUnsafe<{ tipo: string; n: number; s: string | null }[]>(
    'SELECT tipo, count(*)::int AS n, sum(quantidade)::text AS s FROM public.movimentacoes GROUP BY tipo ORDER BY tipo',
  );
  const tipos = [...new Set([...Object.keys(exp.resumo.movimentacoes_por_tipo ?? {}), ...mov.map((m) => m.tipo)])].sort();
  for (const tipo of tipos) {
    const l = exp.resumo.movimentacoes_por_tipo?.[tipo];
    const n = mov.find((m) => m.tipo === tipo);
    const igual = Number(l?.linhas ?? 0) === (n?.n ?? 0) && mesmoDecimal(l?.quantidade ?? null, n?.s ?? null);
    ok &&= igual;
    out.push(
      `  ${marca(igual)} movimentacoes tipo ${tipo} (count(*) e sum(quantidade)): Lovable ${fmtInt(Number(l?.linhas ?? 0))} linhas, ${fmtDecimal(l?.quantidade)} | ` +
        `nosso ${fmtInt(n?.n ?? 0)} linhas, ${fmtDecimal(n?.s)}`,
    );
  }
  return ok;
}

/** 3) Resultado das views do Lovable (exportado) × as nossas, pela chave; números arredondados em CASAS_VIEWS dos dois lados. */
async function views(tx: Db, exp: Exportacao, out: string[]): Promise<{ ok: boolean; avisos: string[] }> {
  let ok = true;
  const avisos: string[] = [];
  const [sem] = await tx.$queryRawUnsafe<{ s: string }[]>(`SELECT date_trunc('week', current_date)::date::text AS s`);
  for (const v of VIEWS) {
    if (v.dependeDaSemana && sem?.s !== exp.resumo.meta.semana_ref) {
      avisos.push(
        `${v.nome} não comparada: depende da semana de "hoje" e a do Lovable no pull (${exp.resumo.meta.semana_ref}, fuso ${exp.resumo.meta.fuso}) ≠ a nossa agora (${sem?.s}). ` +
          'Rode o pull e a verificação na mesma semana (evite domingo à noite).',
      );
      continue;
    }
    const cols = Object.entries(v.colunas);
    const tmp = q(`_lov_${v.nome}`);
    const def = cols.map(([c, tp]) => `${q(c)} ${tp}`).join(', ');
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${tmp} (${def}) ON COMMIT DROP`);
    const linhas = exp.views[v.nome] ?? [];
    for (let i = 0; i < linhas.length; i += 500) {
      await tx.$executeRawUnsafe(`INSERT INTO ${tmp} SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${def})`, JSON.stringify(linhas.slice(i, i + 500)));
    }
    const k0 = q(v.chave[0] ?? '');
    const junta = v.chave.map((c) => `l.${q(c)} = n.${q(c)}`).join(' AND ');
    const iguais = cols
      .map(([c, tp]) => (tp === 'numeric' ? `round(l.${q(c)}, ${CASAS_VIEWS}) IS NOT DISTINCT FROM round(n.${q(c)}, ${CASAS_VIEWS})` : `l.${q(c)} IS NOT DISTINCT FROM n.${q(c)}`))
      .join(' AND ');
    const p = q(v.principal);
    const [r] = await tx.$queryRawUnsafe<{ nl: number; nn: number; sl: string | null; sn: string | null; dif: number }[]>(
      `SELECT (SELECT count(*) FROM ${tmp})::int AS nl, (SELECT count(*) FROM public.${q(v.nome)})::int AS nn,
              (SELECT round(sum(${p}), ${CASAS_VIEWS})::text FROM ${tmp}) AS sl, (SELECT round(sum(${p}), ${CASAS_VIEWS})::text FROM public.${q(v.nome)}) AS sn,
              (SELECT count(*) FROM ${tmp} l FULL JOIN public.${q(v.nome)} n ON ${junta} WHERE l.${k0} IS NULL OR n.${k0} IS NULL OR NOT (${iguais}))::int AS dif`,
    );
    const igual = !!r && r.nl === r.nn && r.dif === 0 && mesmoDecimal(r.sl, r.sn);
    ok &&= igual;
    out.push(`  ${marca(igual)} ${v.nome} — ${v.oque}`);
    out.push(
      `      linhas: Lovable ${fmtInt(r?.nl ?? 0)} | nosso ${fmtInt(r?.nn ?? 0)}; soma de ${v.principal}: Lovable ${fmtDecimal(r?.sl)} | nosso ${fmtDecimal(r?.sn)}; ` +
        `${fmtInt(r?.dif ?? 0)} linha(s) diferente(s) (todas as colunas, números até a ${CASAS_VIEWS}ª casa)`,
    );
  }
  return { ok, avisos };
}

/**
 * Tudo o que prova a carga, dentro da transação do chamador (tabelas temporárias são da conexão). Fonte de cada número:
 * «Lovable» = calculado no Supabase pela função de exportação na hora do pull (ou linhas exportadas das views);
 * «nosso» = a mesma conta, agora, neste banco.
 */
export async function verificar(tx: Db, exp: Exportacao, contas: PlanoContas): Promise<Verificacao> {
  const out: string[] = [];
  out.push('Verificação — «Lovable» = calculado no Supabase na hora do pull; «nosso» = a mesma conta agora, neste banco');
  out.push('1) Arquivo exportado × banco, linha a linha:');
  const a = await linhaALinha(tx, exp, contas, out);
  out.push('2) Contagens e somas de cada coluna numérica (count(*) e sum(coluna)), e movimentações por tipo:');
  const b = await resumoLovable(tx, exp, out);
  out.push(`3) Views (resultado do Lovable × o nosso, linha a linha pela chave):`);
  const c = await views(tx, exp, out);
  out.push('4) Gatilhos:');
  let d = true;
  for (const g of GATILHOS) {
    const [r] = await tx.$queryRawUnsafe<{ on: string }[]>(
      `SELECT tg.tgenabled::text AS on FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE c.relname = $1 AND tg.tgname = $2`,
      g.tabela,
      g.nome,
    );
    const ligado = r?.on === 'O';
    d &&= ligado;
    out.push(`  ${marca(ligado)} ${g.tabela}.${g.nome} ${ligado ? 'ligado' : `NÃO está ligado (tgenabled=${r?.on ?? 'ausente'})`} — ${g.porque}`);
  }
  const avisos = [...c.avisos];
  for (const [t, col] of COLUNAS_COM_CONTA) {
    const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.${q(t)} x WHERE x.${q(col)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = x.${q(col)})`,
    );
    if (r?.n) avisos.push(`${t}.${col}: ${r.n} linha(s) apontam para conta que não veio (excluída no Lovable ou deixada de fora) — o histórico fica, sem o nome`);
  }
  const [adm] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.users WHERE perfil = 'admin'`);
  const e = (adm?.n ?? 0) > 0;
  if (!e) out.push('  DIFERENTE nenhum administrador no banco: o "Primeiro acesso" ficaria aberto');
  for (const x of avisos) out.push(`  aviso: ${x}`);
  const ok = a && b && c.ok && d && e;
  out.push(ok ? 'verificação: ok' : 'verificação: DIFERENÇAS (ver as linhas DIFERENTE acima)');
  return { ok, linhas: out };
}
