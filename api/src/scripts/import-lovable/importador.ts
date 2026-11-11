import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { conferirBanco, conferirEsquemaNosso, lerEsquemaNosso } from './banco';
import { carregar, ResultadoCarga } from './carga';
import { Opcoes } from './cli';
import { mascararEmail, planejarContas, PlanoContas } from './contas';
import { fmtInt } from './decimal';
import { GATILHOS } from './esquema';
import { Exportacao, validarExportacao } from './exportacao';
import { verificar, Verificacao } from './verificacao';

/** A carga inteira (e a verificação) numa transação; o padrão do Prisma (5 s) não serve. */
const TX = { timeout: 30 * 60e3, maxWait: 60e3 };

class Desfazer extends Error {}

const TITULO: Record<Opcoes['modo'], string> = {
  ensaio: 'ENSAIO (--dry-run): carga + verificação dentro de uma transação DESFEITA no fim — nada fica gravado',
  carga: 'CARGA: grava só se a verificação dentro da mesma transação der ok',
  verificacao: 'VERIFICAÇÃO (--verify): só leitura',
};

function cabecalho(op: Opcoes, banco: string, exp: Exportacao, contas: PlanoContas): string[] {
  const m = exp.resumo.meta;
  const out = [
    'Freela Comanda — importação dos dados do Lovable (Freela ERP)',
    `Modo: ${TITULO[op.modo]}`,
    `Banco: ${banco} (conferido com --expect-db)`,
    `Exportação: ${op.arquivo} — feita em ${m.agora} pelo Lovable (fuso ${m.fuso}, Postgres ${m.versao_pg})`,
  ];
  const adm = contas.entram.filter((c) => c.perfil === 'admin').length;
  out.push(
    `Contas (auth.users + profiles + user_roles → users, mesmo id): ${contas.total} no Lovable → ${contas.entram.length} entram (${adm} admin, ` +
      `${contas.entram.length - adm} loja), ${contas.fora.length} ficam de fora`,
  );
  for (const c of contas.entram) {
    const extra = c.dois_papeis ? 'tinha admin e loja → admin' : '';
    out.push(
      `  entra ${c.id} ${c.perfil.padEnd(5)} ${mascararEmail(c.email)} criada ${c.created_at.slice(0, 10)} último acesso ${c.ultimo_acesso ?? '—'}${extra ? ` (${extra})` : ''}`,
    );
  }
  out.push(
    '  Senhas: o Lovable não exporta senha, então TODAS as contas entram com uma senha aleatória que ninguém conhece. Depois da carga, ' +
      'o dono define a do admin com dist/src/scripts/definir-senha/main.js e o admin dá senha nova aos demais em Usuários.',
  );
  for (const c of contas.fora) {
    const quem = c.email ? mascararEmail(c.email) : '(sem e-mail)';
    out.push(`  fora  ${c.id} ${quem} último acesso ${c.ultimo_acesso ?? '—'} — ${c.motivo}`);
  }
  out.push(
    '  Confira a lista: no Lovable qualquer cadastro pela API pública ganhava o papel loja. Conta estranha = parar e remover no Lovable.',
  );
  return out;
}

function linhasDaCarga(r: ResultadoCarga): string[] {
  const total = r.tabelas.reduce((a, t) => a + t.linhas, 0);
  return [
    `Carga (ordem das chaves estrangeiras, FKs ligadas; configuracoes/sazonalidade/subgrupos substituíram os seeds da migração):`,
    `  ${r.tabelas.map((t) => `${t.tabela} ${fmtInt(t.linhas)}`).join(' · ')}`,
    `  total: ${fmtInt(total)} linhas em ${r.tabelas.length} tabelas + ${r.contas} conta(s)`,
    ...GATILHOS.map((g) => `  gatilho ${g.tabela}.${g.nome}: ${g.porque}`),
  ];
}

/** Orquestra os três modos. Lança erro (nada gravado) em qualquer trava; devolve ok=false se a verificação achar diferença. */
export async function executar(prisma: PrismaClient, exp: Exportacao, op: Opcoes): Promise<{ ok: boolean; linhas: string[] }> {
  const banco = await conferirBanco(prisma, op.expectDb);
  const esquema = await lerEsquemaNosso(prisma);
  const errosNosso = await conferirEsquemaNosso(prisma, esquema);
  if (errosNosso.length)
    throw new Error(`o banco "${banco}" não é o esperado pelo importador:\n  - ${errosNosso.join('\n  - ')}\nNada foi gravado.`);
  const errosExp = validarExportacao(exp, esquema);
  if (errosExp.length) throw new Error(`a exportação não bate com o sistema novo:\n  - ${errosExp.join('\n  - ')}\nNada foi gravado.`);
  // O formato 2 não traz senha: todas as contas entram com o hash de uma senha aleatória jogada fora (ninguém a conhece).
  const hashTravado = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const contas = planejarContas(exp.usuarios, exp.tabelas.profiles ?? [], exp.tabelas.user_roles ?? [], { ...op, hashTravado });
  const linhas = cabecalho(op, banco, exp, contas);

  if (op.modo === 'verificacao') {
    const v = await prisma.$transaction((tx) => verificar(tx, exp, contas), TX);
    return { ok: v.ok, linhas: [...linhas, ...v.linhas] };
  }

  let carga: ResultadoCarga | undefined;
  let v: Verificacao | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      carga = await carregar(tx, exp, contas);
      v = await verificar(tx, exp, contas);
      if (!v.ok || op.modo === 'ensaio') throw new Desfazer();
    }, TX);
  } catch (e) {
    if (!(e instanceof Desfazer)) throw e;
  }
  const fim =
    op.modo === 'ensaio'
      ? `RESULTADO: ensaio ${v?.ok ? 'OK' : 'COM DIFERENÇAS'} — transação desfeita, nada foi gravado`
      : v?.ok
        ? 'RESULTADO: carga GRAVADA e verificada. Rode --verify de novo (fora da transação) antes de subir a API.'
        : 'RESULTADO: a verificação achou diferenças DENTRO da carga — transação desfeita, nada foi gravado';
  return { ok: !!v?.ok, linhas: [...linhas, ...(carga ? linhasDaCarga(carga) : []), ...(v?.linhas ?? []), fim] };
}
