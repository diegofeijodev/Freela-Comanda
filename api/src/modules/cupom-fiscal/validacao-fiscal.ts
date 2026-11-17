// Validação fiscal do cupom (NFC-e): perfil fiscal × regime da empresa (CRT), dados fiscais do item e "pronto para o cupom".
// Só as regras do desenho (§3.2, tabela da pesquisa B.8; §6 para os campos de 2027, que aqui só têm o formato conferido).
// O que muda por empresa (os códigos de cada perfil) é do contador e fica no banco; aqui ficam só as combinações que a SEFAZ aceita.
// Frases: as da UX §6.2 e as do NCM/CEST (§5.7) literais; as do plano (Task 5) literais; as de formato da UX §5.6/§5.7 ganham o nome
// do campo (a resposta 422 vem sozinha); as outras no estilo da UX §6.3. A Task 9 leva estas frases para `frases.ts`.

import { gtinValido } from '../../common/fiscal/documentos';
import { precoCentavos } from './totais';

export type Crt = 1 | 2 | 3 | 4;

export interface PerfilFiscal {
  cfop: string;
  csosn: string | null;
  cst_icms: string | null;
  aliq_icms: string | null;
  pis_cst: string | null;
  cofins_cst: string | null;
  c_ativ_sn: string | null;
  ibs_sn_aliq: string | null;
  cbs_sn_aliq: string | null;
  ibscbs_cst: string | null;
  ibscbs_cclass_trib: string | null;
  ativo: boolean;
}

export type MotivoProduto = 'falta_ncm' | 'falta_perfil' | 'sem_preco' | 'inativo' | 'perfil_inativo' | 'perfil_fora_do_regime';

/** CRT que pedem CSOSN (Simples, excesso de sublimite e MEI); o CRT 3 (regime normal) pede CST. Desenho §3.2. */
export const CRT_COM_CSOSN: readonly Crt[] = [1, 2, 4];
export const CSOSN_ACEITOS = ['102', '103', '300', '400', '500', '900'] as const;
export const CST_ACEITOS = ['00', '20', '40', '41', '60', '90'] as const;
/** Ficam fora: 5933 (só com ISSQN) e 5949 (gorjeta, fase 2). */
export const CFOP_ACEITOS = ['5101', '5102', '5103', '5104', '5115', '5405', '5656', '5667'] as const;
/** CSOSN 102, 103, 300, 400 e 900 (N12a-40). */
export const CFOP_SEM_ST = ['5101', '5102', '5103', '5104', '5115'] as const;
/** CSOSN 500 (N12a-44): 5405, ou 5656/5667 (combustível). */
export const CFOP_CSOSN_500 = ['5405', '5656', '5667'] as const;
/** CST 60 (N12-44). */
export const CFOP_CST_60 = ['5405'] as const;

/** Formata o CFOP como na tela: 5405 → 5.405. */
const cfopTexto = (c: string) => `${c[0]}.${c.slice(1)}`;

const listaCfop = (cs: readonly string[]) => {
  const t = cs.map(cfopTexto);
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}`;
};

export const FRASES_VALIDACAO = {
  // UX §6.2 (literais)
  csosn500: 'O CSOSN 500 só vale com o CFOP 5.405.',
  simplesSemCsosn: 'No Simples, escolha o CSOSN.',
  normalSemCst: 'No regime normal, escolha o CST.',
  // plano (Task 5)
  osDois: 'Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois.',
  csosnSemSt: (csosn: string) => `O CSOSN ${csosn} só vale com o tipo de venda (CFOP) ${listaCfop(CFOP_SEM_ST)}.`,
  cfopFora: (cfop: string) => `O tipo de venda (CFOP) ${cfopTexto(cfop)} não entra no cupom.`,
  gtin: 'Este GTIN não confere. Confira os números ou deixe em branco (produto sem código de barras).',
  // UX §5.7 (literais)
  ncm: 'O NCM tem 8 números.',
  cest: 'O CEST tem 7 números.',
  // novas, no estilo da UX §6.3 (as de formato dão nome ao campo do "Use 2 números." da UX §5.6/§5.7)
  semCfop: 'Escolha o tipo de venda (CFOP).',
  semCodigo: 'Escolha o CSOSN (Simples) ou o CST (regime normal).',
  csosnFora: (csosn: string) => `O CSOSN ${csosn} não entra no cupom.`,
  cstFora: (cst: string) => `O CST ${cst} não entra no cupom.`,
  cst60: `O CST 60 só vale com o tipo de venda (CFOP) ${listaCfop(CFOP_CST_60)}.`,
  aliqIcms: 'A alíquota do ICMS vai de 0 a 100, com até 2 casas.',
  pisCst: 'O CST do PIS tem 2 números.',
  cofinsCst: 'O CST da COFINS tem 2 números.',
  cAtivSn: 'A atividade no Simples (cAtivSN) tem 2 números.',
  ibsSnAliq: 'A alíquota efetiva do IBS vai de 0 a 100, com até 4 casas.',
  cbsSnAliq: 'A alíquota efetiva da CBS vai de 0 a 100, com até 4 casas.',
  ibscbsCst: 'O CST do IBS/CBS tem 3 números.',
  ibscbsCclassTrib: 'A classificação do IBS/CBS (cClassTrib) tem 6 números.',
  origem: 'A origem vai de 0 a 8.',
  descricao: 'O nome no cupom tem até 120 letras.',
  unidade: 'A unidade no cupom tem até 6 letras.',
} as const;

const F = FRASES_VALIDACAO;

/** Nulo, indefinido ou só espaços = campo vazio. Quem grava converte o vazio em NULL (os CHECKs do banco recusam ''). */
function presente(s: string | null | undefined): s is string {
  return s != null && s.trim() !== '';
}

const contem = (lista: readonly string[], v: string) => lista.includes(v);

/** Decimal com ponto, de 0 a 100, com até `casas` casas. */
function percentualValido(v: string, casas: number): boolean {
  if (!new RegExp(`^\\d{1,3}(\\.\\d{1,${casas}})?$`).test(v)) return false;
  return Number(v) <= 100;
}

/**
 * Primeiro erro do perfil, na ordem: CSOSN e CST juntos; CFOP fora da lista; código que falta no regime; código fora da lista;
 * CFOP × código; formatos. Com `crt` nulo (regime ainda não cadastrado), aceita CSOSN ou CST.
 */
export function erroDoPerfil(p: PerfilFiscal, crt: Crt | null): string | null {
  const csosn = presente(p.csosn) ? p.csosn : null;
  const cst = presente(p.cst_icms) ? p.cst_icms : null;
  if (csosn !== null && cst !== null) return F.osDois;

  if (!/^\d{4}$/.test(p.cfop)) return F.semCfop;
  if (!contem(CFOP_ACEITOS, p.cfop)) return F.cfopFora(p.cfop);

  if (crt === null) {
    if (csosn === null && cst === null) return F.semCodigo;
  } else if (CRT_COM_CSOSN.includes(crt)) {
    if (csosn === null) return F.simplesSemCsosn;
  } else if (cst === null) {
    return F.normalSemCst;
  }

  if (csosn !== null) {
    if (!contem(CSOSN_ACEITOS, csosn)) return F.csosnFora(csosn);
    if (csosn === '500') {
      if (!contem(CFOP_CSOSN_500, p.cfop)) return F.csosn500;
    } else if (!contem(CFOP_SEM_ST, p.cfop)) {
      return F.csosnSemSt(csosn);
    }
  } else if (cst !== null) {
    if (!contem(CST_ACEITOS, cst)) return F.cstFora(cst);
    if (cst === '60' && !contem(CFOP_CST_60, p.cfop)) return F.cst60;
  }

  if (presente(p.aliq_icms) && !percentualValido(p.aliq_icms, 2)) return F.aliqIcms;
  if (presente(p.pis_cst) && !/^\d{2}$/.test(p.pis_cst)) return F.pisCst;
  if (presente(p.cofins_cst) && !/^\d{2}$/.test(p.cofins_cst)) return F.cofinsCst;
  if (presente(p.c_ativ_sn) && !/^\d{2}$/.test(p.c_ativ_sn)) return F.cAtivSn;
  if (presente(p.ibs_sn_aliq) && !percentualValido(p.ibs_sn_aliq, 4)) return F.ibsSnAliq;
  if (presente(p.cbs_sn_aliq) && !percentualValido(p.cbs_sn_aliq, 4)) return F.cbsSnAliq;
  if (presente(p.ibscbs_cst) && !/^\d{3}$/.test(p.ibscbs_cst)) return F.ibscbsCst;
  if (presente(p.ibscbs_cclass_trib) && !/^\d{6}$/.test(p.ibscbs_cclass_trib)) return F.ibscbsCclassTrib;
  return null;
}

/** O perfil serve para o regime da empresa: é o mesmo critério do cadastro, com o CRT de agora. */
export function perfilValeNoRegime(p: PerfilFiscal, crt: Crt): boolean {
  return erroDoPerfil(p, crt) === null;
}

/** Preço de venda > 0 depois do arredondamento a 2 casas que a emissão usa (`precoCentavos`). */
function temPreco(preco: string | null): boolean {
  if (preco == null || !/^\d+(\.\d+)?$/.test(preco)) return false;
  return precoCentavos(preco) > 0n;
}

/**
 * Por que o produto não entra no cupom, na ordem do tipo `MotivoProduto`. Vazio = pronto para o cupom.
 * Perfil desativado esconde o motivo do regime (o conserto é o mesmo: escolher outro perfil). Com `crt` nulo, o regime não é conferido
 * (a emissão já para antes, por falta de configuração).
 */
export function motivosDoProduto(
  i: { ativo: boolean; preco_venda: string | null; ncm: string | null; perfil: PerfilFiscal | null },
  crt: Crt | null,
): MotivoProduto[] {
  const m: MotivoProduto[] = [];
  if (i.ncm == null || !/^\d{8}$/.test(i.ncm)) m.push('falta_ncm');
  if (i.perfil === null) m.push('falta_perfil');
  if (!temPreco(i.preco_venda)) m.push('sem_preco');
  if (!i.ativo) m.push('inativo');
  if (i.perfil !== null) {
    if (!i.perfil.ativo) m.push('perfil_inativo');
    else if (crt !== null && !perfilValeNoRegime(i.perfil, crt)) m.push('perfil_fora_do_regime');
  }
  return m;
}

/** Primeiro erro dos dados fiscais do item, na ordem dos campos. Campo vazio = ausente (NCM e perfil vazios deixam o item incompleto). */
export function erroDoItemFiscal(i: {
  ncm?: string | null;
  cest?: string | null;
  gtin?: string | null;
  origem?: number;
  descricao_cupom?: string | null;
  unidade?: string | null;
}): string | null {
  if (presente(i.ncm) && !/^\d{8}$/.test(i.ncm)) return F.ncm;
  if (presente(i.cest) && !/^\d{7}$/.test(i.cest)) return F.cest;
  if (presente(i.gtin) && !gtinValido(i.gtin)) return F.gtin;
  if (i.origem !== undefined && !(Number.isInteger(i.origem) && i.origem >= 0 && i.origem <= 8)) return F.origem;
  if (presente(i.descricao_cupom) && Array.from(i.descricao_cupom).length > 120) return F.descricao;
  if (presente(i.unidade) && Array.from(i.unidade).length > 6) return F.unidade;
  return null;
}
