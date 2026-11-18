// Validação fiscal do cupom (NFC-e): perfil fiscal × regime da empresa (CRT), dados fiscais do item e "pronto para o cupom".
// Só as regras do desenho (§3.2, tabela da pesquisa B.8; §6 para os campos de 2027, que aqui só têm o formato conferido).
// O que muda por empresa (os códigos de cada perfil) é do contador e fica no banco; aqui ficam só as combinações que a SEFAZ aceita.
// Frases: as da UX §6.2 e as do NCM/CEST (§5.7) literais; as do plano (Task 5) literais; as de formato da UX §5.6/§5.7 ganham o nome
// do campo (a resposta 422 vem sozinha); as outras no estilo da UX §6.3. Todas moram em `frases.ts` (`FRASES_VALIDACAO`, fonte única).

import { gtinValido } from '../../common/fiscal/documentos';
import { cabeNoEsquema, textoDoCupom } from '../../common/fiscal/texto-fiscal';
import { FRASES_VALIDACAO } from './frases';
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

export type MotivoProduto =
  'falta_ncm' | 'falta_perfil' | 'sem_preco' | 'inativo' | 'perfil_inativo' | 'perfil_fora_do_regime' | 'nome_fora_do_padrao';

/** CRT que pedem CSOSN (Simples, excesso de sublimite e MEI); o CRT 3 (regime normal) pede CST. Desenho §3.2. */
export const CRT_COM_CSOSN: readonly Crt[] = [1, 2, 4];
export const CSOSN_ACEITOS = ['102', '103', '300', '400', '500', '900'] as const;
/** Os CST que entram no cupom agora: o 20 fica fora até o perfil ter a redução da base (pRedBC; decisão T6-2, com a frase própria). */
export const CST_ACEITOS = ['00', '40', '41', '60', '90'] as const;
/** Ficam fora: 5933 (só com ISSQN) e 5949 (gorjeta, fase 2). */
export const CFOP_ACEITOS = ['5101', '5102', '5103', '5104', '5115', '5405', '5656', '5667'] as const;
/** CSOSN 102, 103, 300, 400 e 900 (N12a-40). */
export const CFOP_SEM_ST = ['5101', '5102', '5103', '5104', '5115'] as const;
/** CSOSN 500 (N12a-44): 5405, ou 5656/5667 (combustível). */
export const CFOP_CSOSN_500 = ['5405', '5656', '5667'] as const;
/** CST 60 (N12-44). */
export const CFOP_CST_60 = ['5405'] as const;
/** PIS/COFINS que vão só com o CST (grupos PISNT/COFINSNT). */
export const CST_PIS_COFINS_NT = ['04', '05', '06', '07', '08', '09'] as const;
/** PIS/COFINS que vão em PISOutr/COFINSOutr com base, alíquota e valor zerados (prática do Simples; decisão do controlador, T6-3). */
export const CST_PIS_COFINS_OUTR_ZERADO = ['49', '99'] as const;
/** Os outros pedem alíquota (ou quantidade), que o perfil ainda não tem: ficam barrados (T6-3). */
const CST_PIS_COFINS_ACEITOS = [...CST_PIS_COFINS_NT, ...CST_PIS_COFINS_OUTR_ZERADO] as const;

const F = FRASES_VALIDACAO;

/** Nulo, indefinido ou só espaços = campo vazio. Quem grava converte o vazio em NULL (os CHECKs do banco recusam ''). */
function presente(s: string | null | undefined): s is string {
  return s != null && s.trim() !== '';
}

/** Código aparado (' 102 ' → '102'); vazio = null. */
const aparado = (s: string | null | undefined): string | null => (presente(s) ? s.trim() : null);

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
  const csosn = aparado(p.csosn);
  const cst = aparado(p.cst_icms);
  const cfop = aparado(p.cfop) ?? '';
  const aliq = aparado(p.aliq_icms);
  const pis = aparado(p.pis_cst);
  const cofins = aparado(p.cofins_cst);
  if (csosn !== null && cst !== null) return F.osDois;

  if (!/^\d{4}$/.test(cfop)) return F.semCfop;
  if (!contem(CFOP_ACEITOS, cfop)) return F.cfopFora(cfop);

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
      if (!contem(CFOP_CSOSN_500, cfop)) return F.csosn500;
    } else if (!contem(CFOP_SEM_ST, cfop)) {
      return F.csosnSemSt(csosn, CFOP_SEM_ST);
    }
  } else if (cst !== null) {
    if (cst === '20') return F.cst20; // o grupo ICMS20 pede a redução da base (pRedBC), que o perfil não tem (T6-2)
    if (!contem(CST_ACEITOS, cst)) return F.cstFora(cst);
    if (cst === '60' && !contem(CFOP_CST_60, cfop)) return F.cst60(CFOP_CST_60);
    if (cst === '00' && aliq === null) return F.semAliqIcms;
  }

  if (aliq !== null && !percentualValido(aliq, 2)) return F.aliqIcms;
  if (pis !== null && !/^\d{2}$/.test(pis)) return F.pisCst;
  if (pis !== null && !contem(CST_PIS_COFINS_ACEITOS, pis)) return F.pisCofinsBarrado;
  if (cofins !== null && !/^\d{2}$/.test(cofins)) return F.cofinsCst;
  if (cofins !== null && !contem(CST_PIS_COFINS_ACEITOS, cofins)) return F.pisCofinsBarrado;
  const cAtivSn = aparado(p.c_ativ_sn);
  const ibsSn = aparado(p.ibs_sn_aliq);
  const cbsSn = aparado(p.cbs_sn_aliq);
  const ibscbsCst = aparado(p.ibscbs_cst);
  const cClassTrib = aparado(p.ibscbs_cclass_trib);
  if (cAtivSn !== null && !/^\d{2}$/.test(cAtivSn)) return F.cAtivSn;
  if (ibsSn !== null && !percentualValido(ibsSn, 4)) return F.ibsSnAliq;
  if (cbsSn !== null && !percentualValido(cbsSn, 4)) return F.cbsSnAliq;
  if (ibscbsCst !== null && !/^\d{3}$/.test(ibscbsCst)) return F.ibscbsCst;
  if (cClassTrib !== null && !/^\d{6}$/.test(cClassTrib)) return F.ibscbsCclassTrib;
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

/** O nome que vai no `xProd` cabe no cupom: não vazio depois de limpo e só com o que o `TString` do esquema aceita. */
function nomeCabeNoCupom(nome: string | null): boolean {
  const t = textoDoCupom(nome ?? '', 120);
  return t !== '' && cabeNoEsquema(t);
}

/**
 * Por que o produto não entra no cupom, na ordem do tipo `MotivoProduto`. Vazio = pronto para o cupom.
 * Perfil desativado esconde o motivo do regime (o conserto é o mesmo: escolher outro perfil). Com `crt` nulo, o regime não é conferido
 * (a emissão já para antes, por falta de configuração). `nome_cupom` = o nome que vai no cupom: `nfce_itens.descricao_cupom` ou, vazio,
 * `itens_cardapio.nome` (emoji ou símbolo no nome do cardápio = `nome_fora_do_padrao`; o conserto é o "Nome no cupom").
 */
export function motivosDoProduto(
  i: { ativo: boolean; preco_venda: string | null; ncm: string | null; perfil: PerfilFiscal | null; nome_cupom: string | null },
  crt: Crt | null,
): MotivoProduto[] {
  const m: MotivoProduto[] = [];
  const ncm = aparado(i.ncm);
  if (ncm === null || !/^\d{8}$/.test(ncm)) m.push('falta_ncm');
  if (i.perfil === null) m.push('falta_perfil');
  if (!temPreco(i.preco_venda)) m.push('sem_preco');
  if (!i.ativo) m.push('inativo');
  if (i.perfil !== null) {
    if (!i.perfil.ativo) m.push('perfil_inativo');
    else if (crt !== null && !perfilValeNoRegime(i.perfil, crt)) m.push('perfil_fora_do_regime');
  }
  if (!nomeCabeNoCupom(i.nome_cupom)) m.push('nome_fora_do_padrao');
  return m;
}

/**
 * Primeiro erro dos dados fiscais do item, na ordem dos campos. Campo vazio (ou origem nula) = ausente (NCM e perfil vazios deixam o
 * item incompleto). Códigos aparados antes de conferir; nome e unidade só com o que o esquema aceita (emoji e símbolos não).
 */
export function erroDoItemFiscal(i: {
  ncm?: string | null;
  cest?: string | null;
  gtin?: string | null;
  origem?: number | null;
  descricao_cupom?: string | null;
  unidade?: string | null;
}): string | null {
  const ncm = aparado(i.ncm);
  const cest = aparado(i.cest);
  const gtin = aparado(i.gtin);
  if (ncm !== null && !/^\d{8}$/.test(ncm)) return F.ncm;
  if (cest !== null && !/^\d{7}$/.test(cest)) return F.cest;
  if (gtin !== null && !gtinValido(gtin)) return F.gtin;
  if (i.origem != null && !(Number.isInteger(i.origem) && i.origem >= 0 && i.origem <= 8)) return F.origem;
  if (presente(i.descricao_cupom)) {
    if (Array.from(i.descricao_cupom).length > 120) return F.descricao;
    if (!cabeNoEsquema(textoDoCupom(i.descricao_cupom, 120))) return F.nomeCaractere;
  }
  if (presente(i.unidade)) {
    if (Array.from(i.unidade).length > 6) return F.unidade;
    if (!cabeNoEsquema(textoDoCupom(i.unidade, 6))) return F.unidadeCaractere;
  }
  return null;
}
