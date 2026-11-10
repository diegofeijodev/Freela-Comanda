import { Db, inserirLinhas, problemasDeBancoNaoVazio, q } from './banco';
import { PlanoContas } from './contas';
import { COLUNAS_USERS, GATILHOS, TABELAS, TABELAS_COM_SEED } from './esquema';
import { Exportacao } from './exportacao';

export type ResultadoCarga = { tabelas: { tabela: string; linhas: number }[]; contas: number };

const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n').filter(Boolean).slice(-3).join(' ');

/**
 * Dentro da transação do chamador: trava as tabelas, confere que só há os seeds, troca os seeds pelos do Lovable, desliga os
 * gatilhos de GATILHOS, carrega as 23 tabelas em ordem de chave estrangeira (as FKs CONTINUAM valendo) e as contas, e religa os gatilhos.
 */
export async function carregar(tx: Db, exp: Exportacao, contas: PlanoContas): Promise<ResultadoCarga> {
  const todas = [...TABELAS.map((t) => t.nome), 'users'].map((t) => `public.${q(t)}`).join(', ');
  await tx.$executeRawUnsafe(`LOCK TABLE ${todas} IN EXCLUSIVE MODE`);
  const naoVazio = await problemasDeBancoNaoVazio(tx);
  if (naoVazio.length) {
    throw new Error(`O banco não está vazio (${naoVazio.join('; ')}). A importação só roda num banco recém-migrado. Nada foi gravado.`);
  }
  for (const t of TABELAS_COM_SEED) await tx.$executeRawUnsafe(`DELETE FROM public.${q(t)}`);
  for (const g of GATILHOS) await tx.$executeRawUnsafe(`ALTER TABLE public.${q(g.tabela)} DISABLE TRIGGER ${q(g.nome)}`);

  const out: ResultadoCarga = { tabelas: [], contas: contas.entram.length };
  for (const t of TABELAS) {
    const linhas = exp.tabelas[t.nome] ?? [];
    try {
      await inserirLinhas(tx, `public.${q(t.nome)}`, t.nome, t.colunas, linhas);
    } catch (e) {
      throw new Error(`ao carregar ${t.nome}: ${erroDe(e)}. Nada foi gravado.`);
    }
    out.tabelas.push({ tabela: t.nome, linhas: linhas.length });
  }
  const users = contas.entram.map((c) => Object.fromEntries(COLUNAS_USERS.map((k) => [k, c[k]])));
  try {
    await inserirLinhas(tx, 'public.users', 'users', COLUNAS_USERS, users);
  } catch (e) {
    throw new Error(`ao carregar as contas: ${erroDe(e)}. Nada foi gravado.`);
  }
  for (const g of GATILHOS) await tx.$executeRawUnsafe(`ALTER TABLE public.${q(g.tabela)} ENABLE TRIGGER ${q(g.nome)}`);
  return out;
}
