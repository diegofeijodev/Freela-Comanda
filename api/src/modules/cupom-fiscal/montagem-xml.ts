// Montagem do XML da NFC-e (modelo 65, leiaute 4.00) a partir do cupom: pura, sem rede e sem assinatura. Desenho §5.2 (valores fixos e
// ordem da montagem); ordem dos elementos, grupos e tipos conferidos no `leiauteNFe_v4.00.xsd` do pacote 010h v1.03 (17/11/2026).
//
// 1. `montarNfe` → `<NFe xmlns="…/nfe"><infNFe Id="NFe<chave>" versao="4.00">…` (documento próprio; o xmlns no NFe deixa a C14N igual
//    dentro do lote); 2. `assinarXmlEnveloped(xml, 'NFe' + chave, cert)`; 3. `inserirSupl` (QR fora da assinatura, antes da `Signature`);
// 4. `corpoEnviNfe` (o `nfeDadosMsg` e o envelope `sem_prefixo` são do adaptador, desenho §8.3); 5. `montarNfeProc` ao autorizar.
//
// Nenhum dado entra cru: código (aparado) e número passam por expressão do esquema; texto livre por `textoDoCupom` (NFC, aspas e
// travessões do teclado em ASCII, `textoFiscal`: quebras de linha e U+0085/U+2028/U+2029 viram espaço, sem controles, cortado no tamanho
// do esquema) → `cabeNoEsquema` (só U+0020–U+00FF, o `TString` do esquema) → escape de & < > ". A validação do produto usa os mesmos.
// Recusa = `MontagemNfceErro` com frase fixa, sem dado do cupom (nem nome, nem CPF): um texto que a SEFAZ recusasse pelo esquema (225)
// pararia o ambiente inteiro (§5.3); aqui para só este cupom.

import { cnpjValido } from '../../common/fiscal/cnpj';
import { montarChaveNfce } from '../../common/fiscal/chave-acesso';
import { cpfValido, gtinValido } from '../../common/fiscal/documentos';
import { cabeNoEsquema, textoDoCupom } from '../../common/fiscal/texto-fiscal';
import { XMLDSIG } from '../sefaz/assinatura-xml';
import { dhSefaz } from '../sefaz/eventos-xml';
import { FRASES_VALIDACAO } from './frases';
import { calcularTotais, decimal2, decimal4, quantidadeValida, type Totais, type TPag } from './totais';
import { CRT_COM_CSOSN, CST_PIS_COFINS_NT, CST_PIS_COFINS_OUTR_ZERADO, type Crt } from './validacao-fiscal';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
export const VER_PROC = 'FreelaComanda 1.0';
/** `xProd` do item 1 em homologação (rejeição 373). */
export const XPROD_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
/** Teto do lote (rejeição 214), medido no `enviNFe`. */
export const TETO_LOTE_BYTES = 500 * 1024;

export interface EmitenteXml {
  cnpj: string; // configuracoes
  razaoSocial: string;
  nomeFantasia: string | null;
  ie: string; // nfce_emitente
  crt: Crt;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  codMunicipio: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string | null;
}

/** A fotografia do item (nfce_cupom_itens): dados do item + códigos do perfil fiscal no momento da emissão. */
export interface ItemXml {
  cProd: string;
  xProd: string;
  ncm: string;
  cest: string | null;
  gtin: string | null; // nulo = "SEM GTIN"
  origem: number;
  cfop: string;
  unidade: string;
  quantidade: string; // até 4 casas, ponto (quantidadeValida)
  valorUnitario: bigint; // centavos
  csosn: string | null;
  cstIcms: string | null;
  aliqIcms: string | null; // "18.00"
  pisCst: string | null;
  cofinsCst: string | null;
}

export interface RespTecXml {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
}

export interface DadosNfce {
  tpAmb: 1 | 2;
  chave: string;
  cNF: string;
  serie: number;
  numero: number;
  dhEmi: Date;
  natOp: string;
  emitente: EmitenteXml;
  consumidorDoc: string | null;
  itens: ItemXml[];
  totais: Totais;
  pagamentos: { tPag: TPag; valor: bigint }[];
  infCpl: string | null;
  respTec: RespTecXml | null;
}

const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const FRASES_MONTAGEM = {
  formato: (campo: string) => `${maiuscula(campo)} não confere com o padrão da SEFAZ.`,
  vazio: (campo: string) => `Falta ${campo}.`,
  caractere: (campo: string) => `${maiuscula(campo)} tem um caractere que a SEFAZ não aceita (como emoji ou símbolo).`,
  consumidor: 'O CPF ou CNPJ do consumidor não confere.',
  chave: 'A chave do cupom não confere com os dados da nota.',
  totais: 'Os valores do cupom não conferem com os itens e os pagamentos.',
  regime: 'O código do ICMS do perfil fiscal não confere com o regime da empresa (CSOSN no Simples, CST no regime normal).',
  codigoIcms: 'O código do ICMS do perfil fiscal não entra no cupom.',
  // as mesmas da validação do perfil (a validação barra antes; a montagem recusa de novo se o perfil escapar)
  semAliquota: FRASES_VALIDACAO.semAliqIcms,
  aliquota: FRASES_VALIDACAO.aliqIcms,
  cst20: FRASES_VALIDACAO.cst20,
  pisCofins: FRASES_VALIDACAO.pisCofinsBarrado,
  tamanho: 'O cupom passou do tamanho que a SEFAZ aceita (500 KB).',
} as const;

const F = FRASES_MONTAGEM;

/** Recusa da montagem: frase fixa (com, no máximo, o nome do campo), nunca o dado. */
export class MontagemNfceErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MontagemNfceErro';
  }
}

const recusa = (frase: string): never => {
  throw new MontagemNfceErro(frase);
};

function presente(s: string | null | undefined): s is string {
  return s != null && s.trim() !== '';
}

// --- texto livre -------------------------------------------------------------------------------------------------------------------

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

/** Texto obrigatório do esquema, já escapado. Vazio depois de limpo = "Falta …"; abaixo do mínimo = fora do padrão. */
function txt(s: string | null | undefined, max: number, min: number, campo: string): string {
  const t = textoDoCupom(s ?? '', max);
  if (!cabeNoEsquema(t)) recusa(F.caractere(campo));
  if (t === '') recusa(F.vazio(campo));
  if (Array.from(t).length < min) recusa(F.formato(campo));
  return esc(t);
}

/** Texto opcional: vazio depois de limpo = grupo omitido. */
function txtOpcional(s: string | null | undefined, max: number, min: number, campo: string): string | null {
  return textoDoCupom(s ?? '', max) === '' ? null : txt(s, max, min, campo);
}

// --- códigos e números -------------------------------------------------------------------------------------------------------------

/** Código aparado (' 102 ' → '102'), como na validação; vazio = null. */
const aparado = (s: string | null | undefined): string | null => (presente(s) ? s.trim() : null);

function codigo(v: string | null | undefined, re: RegExp, campo: string): string {
  const t = aparado(v);
  if (t === null || !re.test(t)) recusa(F.formato(campo));
  return t as string;
}

/** Telefone do esquema: só dígitos, de 6 a 14 (a máscara da tela sai). Vazio = omitido. */
function telefone(v: string | null | undefined, campo: string, obrigatorio: boolean): string | null {
  if (!presente(v)) return obrigatorio ? recusa(F.formato(campo)) : null;
  return codigo(v.replace(/[^0-9]/g, ''), /^[0-9]{6,14}$/, campo);
}

/** Alíquota de 0 a 100 com até 2 casas → centésimos de ponto percentual (18.5 → 1850). */
function aliquotaCentesimos(a: string | null): bigint {
  const t = aparado(a);
  if (t === null) return recusa(F.semAliquota);
  const m = /^([0-9]{1,3})(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return recusa(F.aliquota);
  const v = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
  return v > 10000n ? recusa(F.aliquota) : v;
}

const percentual2 = (c: bigint): string => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

// --- grupos de imposto (conferidos no 010h v1.03) ------------------------------------------------------------------------------------

/** CSOSN → grupo; os outros (101, 201, 202…) não entram no cupom (desenho §3.2). */
const GRUPO_CSOSN = new Map<string, string>([
  ['102', 'ICMSSN102'],
  ['103', 'ICMSSN102'],
  ['300', 'ICMSSN102'],
  ['400', 'ICMSSN102'],
  ['500', 'ICMSSN500'],
  ['900', 'ICMSSN900'],
]);
/** CST que vão só com orig + CST (os blocos opcionais do esquema ficam de fora). O 00 e o 20 têm base e alíquota. */
const GRUPO_CST_SIMPLES = new Map<string, string>([
  ['40', 'ICMS40'],
  ['41', 'ICMS40'],
  ['60', 'ICMS60'],
  ['90', 'ICMS90'],
]);

type Icms = { xml: string; vBC: bigint; vICMS: bigint };

/** `base` = valor do item menos o desconto rateado (centavos). */
function icmsDoItem(i: ItemXml, crt: Crt, base: bigint): Icms {
  const csosn = aparado(i.csosn);
  const cst = aparado(i.cstIcms);
  if ((csosn === null) === (cst === null) || CRT_COM_CSOSN.includes(crt) !== (csosn !== null)) recusa(F.regime);
  const orig = `<orig>${i.origem}</orig>`;
  if (csosn !== null) {
    const grupo = GRUPO_CSOSN.get(csosn) ?? recusa(F.codigoIcms);
    return { xml: `<ICMS><${grupo}>${orig}<CSOSN>${csosn}</CSOSN></${grupo}></ICMS>`, vBC: 0n, vICMS: 0n };
  }
  if (cst === '20') recusa(F.cst20); // barrado por ora (T6-2): o ICMS20 do esquema exige pRedBC, que o perfil não tem
  if (cst === '00') {
    const p = aliquotaCentesimos(i.aliqIcms); // CST 00 sem alíquota = recusa
    const vICMS = (base * p + 5000n) / 10000n; // metade para cima
    const xml =
      `<ICMS><ICMS00>${orig}<CST>00</CST><modBC>3</modBC><vBC>${decimal2(base)}</vBC><pICMS>${percentual2(p)}</pICMS>` +
      `<vICMS>${decimal2(vICMS)}</vICMS></ICMS00></ICMS>`;
    return { xml, vBC: base, vICMS };
  }
  const grupo = GRUPO_CST_SIMPLES.get(cst as string) ?? recusa(F.codigoIcms);
  return { xml: `<ICMS><${grupo}>${orig}<CST>${cst}</CST></${grupo}></ICMS>`, vBC: 0n, vICMS: 0n };
}

/**
 * Vazio = grupo omitido (opcional na NFC-e); 04 a 09 = PISNT/COFINSNT (só o CST); 49 e 99 = PISOutr/COFINSOutr com vBC 0.00, alíquota
 * 0.0000 e valor 0.00 (T6-3, prática do Simples). Os outros pedem alíquota (ou quantidade), que o perfil não tem: recusa.
 */
function pisCofins(valor: string | null, grupo: 'PIS' | 'COFINS'): string {
  const cst = aparado(valor);
  if (cst === null) return '';
  if ((CST_PIS_COFINS_NT as readonly string[]).includes(cst)) return `<${grupo}><${grupo}NT><CST>${cst}</CST></${grupo}NT></${grupo}>`;
  if (!(CST_PIS_COFINS_OUTR_ZERADO as readonly string[]).includes(cst)) recusa(F.pisCofins);
  return (
    `<${grupo}><${grupo}Outr><CST>${cst}</CST><vBC>0.00</vBC><p${grupo}>0.0000</p${grupo}><v${grupo}>0.00</v${grupo}>` +
    `</${grupo}Outr></${grupo}>`
  );
}

// --- conferências de entrada ---------------------------------------------------------------------------------------------------------

const TPAG_ACEITOS: readonly string[] = ['01', '03', '04', '10', '11', '17'];
const TPAG_COM_CARD: readonly string[] = ['03', '04', '17'];

function mesmosTotais(a: Totais, b: Totais): boolean {
  return (
    a.produtos === b.produtos &&
    a.desconto === b.desconto &&
    a.total === b.total &&
    a.troco === b.troco &&
    a.itens.length === b.itens.length &&
    a.itens.every((x, k) => x.bruto === b.itens[k].bruto && x.desconto === b.itens[k].desconto)
  );
}

/** Os totais recebidos têm de ser os que `calcularTotais` dá para estes itens, este desconto e estes pagamentos. */
function conferirTotais(d: DadosNfce): Totais {
  if (!Array.isArray(d.itens) || d.itens.length > 990) recusa(F.formato('a quantidade de itens do cupom'));
  if (d.itens.some((i) => !quantidadeValida(i.quantidade) || typeof i.valorUnitario !== 'bigint' || i.valorUnitario <= 0n)) {
    recusa(F.totais);
  }
  const t = calcularTotais(
    d.itens.map((i) => ({ quantidade: i.quantidade, precoCentavos: i.valorUnitario })),
    d.totais.desconto,
    d.pagamentos,
  );
  if ('erro' in t || !mesmosTotais(t, d.totais) || t.itens.some((x) => x.bruto <= 0n)) return recusa(F.totais);
  return t;
}

/** A chave tem de ser a desta nota: UF 35, mês do dhEmi em Brasília, CNPJ, modelo 65, série, número, tpEmis 1 e cNF. */
function conferirChave(d: DadosNfce, dhEmi: string): void {
  let esperada: string | null = null;
  try {
    esperada = montarChaveNfce({
      aamm: dhEmi.slice(2, 4) + dhEmi.slice(5, 7),
      cnpj: d.emitente.cnpj,
      serie: d.serie,
      numero: d.numero,
      tpEmis: 1,
      cNF: d.cNF,
    });
  } catch {
    esperada = null;
  }
  if (esperada === null || esperada !== d.chave) recusa(F.chave);
}

// --- montagem ------------------------------------------------------------------------------------------------------------------------

/** O grupo `emit` e o código do município já conferido e aparado (o mesmo vai no `cMunFG`: nenhum dado entra cru). */
function emitXml(e: EmitenteXml): { xml: string; cMun: string } {
  if (!cnpjValido(e.cnpj)) recusa(F.formato('o CNPJ da empresa'));
  if (![1, 2, 3, 4].includes(e.crt)) recusa(F.formato('o regime da empresa'));
  const xNome = txt(e.razaoSocial, 60, 2, 'a razão social da empresa');
  const xFant = txtOpcional(e.nomeFantasia, 60, 1, 'o nome fantasia da empresa');
  const xLgr = txt(e.logradouro, 60, 2, 'o logradouro da empresa');
  const nro = txt(e.numero, 60, 1, 'o número do endereço da empresa');
  const xCpl = txtOpcional(e.complemento, 60, 1, 'o complemento do endereço da empresa');
  const xBairro = txt(e.bairro, 60, 2, 'o bairro da empresa');
  const cMun = codigo(e.codMunicipio, /^[0-9]{7}$/, 'o município da empresa');
  const xMun = txt(e.municipio, 60, 2, 'o nome do município da empresa');
  const uf = codigo(e.uf, /^SP$/, 'a UF da empresa'); // cUF 35 na chave
  const cep = codigo(e.cep, /^[0-9]{8}$/, 'o CEP da empresa');
  const fone = telefone(e.telefone, 'o telefone da empresa', false);
  const ie = codigo(e.ie, /^[0-9]{2,14}$/, 'a IE da empresa');
  const xml =
    `<emit><CNPJ>${e.cnpj}</CNPJ><xNome>${xNome}</xNome>${xFant === null ? '' : `<xFant>${xFant}</xFant>`}` +
    `<enderEmit><xLgr>${xLgr}</xLgr><nro>${nro}</nro>${xCpl === null ? '' : `<xCpl>${xCpl}</xCpl>`}<xBairro>${xBairro}</xBairro>` +
    `<cMun>${cMun}</cMun><xMun>${xMun}</xMun><UF>${uf}</UF><CEP>${cep}</CEP>${fone === null ? '' : `<fone>${fone}</fone>`}</enderEmit>` +
    `<IE>${ie}</IE><CRT>${e.crt}</CRT></emit>`;
  return { xml, cMun };
}

/** Só com documento: CPF ou CNPJ + indIEDest 9; sem nome e sem endereço (desenho §5.2). */
function destXml(doc: string | null): string {
  if (doc === null) return '';
  if (/^[0-9]{11}$/.test(doc) && cpfValido(doc)) return `<dest><CPF>${doc}</CPF><indIEDest>9</indIEDest></dest>`;
  if (cnpjValido(doc)) return `<dest><CNPJ>${doc}</CNPJ><indIEDest>9</indIEDest></dest>`;
  return recusa(F.consumidor);
}

function detXml(i: ItemXml, n: number, d: DadosNfce, t: Totais): { xml: string; icms: Icms } {
  const cProd = txt(i.cProd, 60, 1, 'o código do produto');
  const nome = txt(i.xProd, 120, 1, 'o nome do produto'); // conferido também em homologação: o que a produção mandaria
  const xProd = d.tpAmb === 2 && n === 1 ? XPROD_HOMOLOGACAO : nome;
  const ncm = codigo(i.ncm, /^[0-9]{8}$/, 'o NCM do produto');
  const cest = presente(i.cest) ? codigo(i.cest, /^[0-9]{7}$/, 'o CEST do produto') : null;
  const gtin = aparado(i.gtin);
  const ean = gtin === null ? 'SEM GTIN' : gtinValido(gtin) ? gtin : recusa(F.formato('o GTIN do produto'));
  const cfop = codigo(i.cfop, /^[123567][0-9]{3}$/, 'o CFOP do produto');
  if (!Number.isInteger(i.origem) || i.origem < 0 || i.origem > 8) recusa(F.formato('a origem do produto'));
  const u = txt(i.unidade, 6, 1, 'a unidade do produto');
  const { bruto, desconto } = t.itens[n - 1];
  const q = decimal4(i.quantidade);
  const vUn = decimal2(i.valorUnitario);
  const icms = icmsDoItem(i, d.emitente.crt, bruto - desconto);
  const prod =
    `<prod><cProd>${cProd}</cProd><cEAN>${ean}</cEAN><xProd>${xProd}</xProd><NCM>${ncm}</NCM>` +
    `${cest === null ? '' : `<CEST>${cest}</CEST>`}<CFOP>${cfop}</CFOP><uCom>${u}</uCom><qCom>${q}</qCom><vUnCom>${vUn}</vUnCom>` +
    `<vProd>${decimal2(bruto)}</vProd><cEANTrib>${ean}</cEANTrib><uTrib>${u}</uTrib><qTrib>${q}</qTrib><vUnTrib>${vUn}</vUnTrib>` +
    // vDesc é TDec_1302Opc (zero não passa no esquema): só com desconto
    `${desconto > 0n ? `<vDesc>${decimal2(desconto)}</vDesc>` : ''}<indTot>1</indTot></prod>`;
  const imposto = `<imposto>${icms.xml}${pisCofins(i.pisCst, 'PIS')}${pisCofins(i.cofinsCst, 'COFINS')}</imposto>`;
  return { xml: `<det nItem="${n}">${prod}${imposto}</det>`, icms };
}

function pagXml(d: DadosNfce, t: Totais): string {
  const det = d.pagamentos.map(
    (p) =>
      `<detPag><tPag>${p.tPag}</tPag><vPag>${decimal2(p.valor)}</vPag>` +
      // card com tpIntegra 2 (sem TEF integrado) só em crédito, débito e PIX (desenho §5.2)
      `${TPAG_COM_CARD.includes(p.tPag) ? '<card><tpIntegra>2</tpIntegra></card>' : ''}</detPag>`,
  );
  return `<pag>${det.join('')}${t.troco > 0n ? `<vTroco>${decimal2(t.troco)}</vTroco>` : ''}</pag>`;
}

function respTecXml(r: RespTecXml | null): string {
  if (r === null) return '';
  if (!cnpjValido(r.cnpj)) recusa(F.formato('o CNPJ do responsável técnico'));
  const contato = txt(r.contato, 60, 2, 'o contato do responsável técnico');
  const email = txt(r.email, 60, 6, 'o e-mail do responsável técnico');
  const fone = telefone(r.fone, 'o telefone do responsável técnico', true);
  return `<infRespTec><CNPJ>${r.cnpj}</CNPJ><xContato>${contato}</xContato><email>${email}</email><fone>${fone}</fone></infRespTec>`;
}

/** A NFe sem assinatura, como documento próprio (sem declaração XML). Dado fora do padrão = MontagemNfceErro. */
export function montarNfe(d: DadosNfce): string {
  if (d.tpAmb !== 1 && d.tpAmb !== 2) recusa(F.formato('o ambiente'));
  const cNF = codigo(d.cNF, /^[0-9]{8}$/, 'o código numérico do cupom');
  if (!Number.isInteger(d.serie) || d.serie < 0 || d.serie > 889) recusa(F.formato('a série do cupom'));
  if (!Number.isInteger(d.numero) || d.numero < 1 || d.numero > 999999999) recusa(F.formato('o número do cupom'));
  const natOp = txt(d.natOp, 60, 1, 'a natureza da operação');
  const { xml: emit, cMun } = emitXml(d.emitente);
  if (!(d.dhEmi instanceof Date) || Number.isNaN(d.dhEmi.getTime())) recusa(F.chave);
  const dhEmi = dhSefaz(d.dhEmi);
  conferirChave(d, dhEmi);
  const dest = destXml(d.consumidorDoc);
  if (d.pagamentos.length < 1 || d.pagamentos.length > 100) recusa(F.totais);
  for (const p of d.pagamentos) {
    if (!TPAG_ACEITOS.includes(p.tPag)) recusa(F.formato('a forma de pagamento'));
    if (typeof p.valor !== 'bigint' || p.valor <= 0n) recusa(F.totais);
  }
  const t = conferirTotais(d);
  const dets = d.itens.map((i, k) => detXml(i, k + 1, d, t));
  const vBC = dets.reduce((a, x) => a + x.icms.vBC, 0n);
  const vICMS = dets.reduce((a, x) => a + x.icms.vICMS, 0n);
  const infCpl = txtOpcional(d.infCpl, 5000, 1, 'o texto adicional do cupom');
  const z = '0.00';

  const ide =
    `<ide><cUF>35</cUF><cNF>${cNF}</cNF><natOp>${natOp}</natOp><mod>65</mod><serie>${d.serie}</serie><nNF>${d.numero}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${cMun}</cMunFG><tpImp>4</tpImp>` +
    `<tpEmis>1</tpEmis><cDV>${d.chave[43]}</cDV><tpAmb>${d.tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal>` +
    `<indPres>1</indPres><procEmi>0</procEmi><verProc>${VER_PROC}</verProc></ide>`;
  // todos os campos obrigatórios do ICMSTot, zeros quando não há; sem vTotTrib (pergunta 3)
  const total =
    `<total><ICMSTot><vBC>${decimal2(vBC)}</vBC><vICMS>${decimal2(vICMS)}</vICMS><vICMSDeson>${z}</vICMSDeson><vFCP>${z}</vFCP>` +
    `<vBCST>${z}</vBCST><vST>${z}</vST><vFCPST>${z}</vFCPST><vFCPSTRet>${z}</vFCPSTRet><vProd>${decimal2(t.produtos)}</vProd>` +
    `<vFrete>${z}</vFrete><vSeg>${z}</vSeg><vDesc>${decimal2(t.desconto)}</vDesc><vII>${z}</vII><vIPI>${z}</vIPI>` +
    `<vIPIDevol>${z}</vIPIDevol><vPIS>${z}</vPIS><vCOFINS>${z}</vCOFINS><vOutro>${z}</vOutro><vNF>${decimal2(t.total)}</vNF>` +
    '</ICMSTot></total>';
  return (
    `<NFe xmlns="${NS_NFE}"><infNFe Id="NFe${d.chave}" versao="4.00">${ide}${emit}${dest}${dets.map((x) => x.xml).join('')}${total}` +
    `<transp><modFrete>9</modFrete></transp>${pagXml(d, t)}${infCpl === null ? '' : `<infAdic><infCpl>${infCpl}</infCpl></infAdic>`}` +
    `${respTecXml(d.respTec)}</infNFe></NFe>`
  );
}

// --- depois da assinatura ------------------------------------------------------------------------------------------------------------

const ABRE_NFE = `<NFe xmlns="${NS_NFE}"><infNFe Id="NFe`;
const FECHA_ASSINADA = '</Signature></NFe>';
/** `assinarXmlEnveloped` põe a `Signature` logo depois do `</infNFe>` (Decisão 4 da entrega 3). */
const ANTES_DA_ASSINATURA = `</infNFe><Signature xmlns="${XMLDSIG.ns}">`;
const QR_V2_ON_LINE =
  /^https?:\/\/[!-~]+\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}[134][0-9]{9})\|2\|([12])\|(?:0|[1-9][0-9]{0,5})\|[A-Fa-f0-9]{40}$/;
const URL_CHAVE_FORMATO = /^https?:\/\/[!-~]{13,77}$/; // TString de 21 a 85

/**
 * `<infNFeSupl><qrCode/><urlChave/></infNFeSupl>` entre o `</infNFe>` e a `Signature` (ordem do TNFe: infNFe, infNFeSupl, Signature).
 * Fora da assinatura (ela cobre só o infNFe). Recusa: NFe sem assinatura ou já com infNFeSupl, QR de outra chave ou de outro ambiente.
 */
export function inserirSupl(nfeAssinada: string, qrCode: string, urlChave: string): string {
  const i = nfeAssinada.indexOf(ANTES_DA_ASSINATURA);
  if (
    !nfeAssinada.startsWith(ABRE_NFE) ||
    !nfeAssinada.endsWith(FECHA_ASSINADA) ||
    i < 0 ||
    nfeAssinada.indexOf(ANTES_DA_ASSINATURA, i + 1) >= 0 ||
    nfeAssinada.includes('<infNFeSupl>')
  ) {
    throw new Error('NFe assinada fora do formato para o infNFeSupl.');
  }
  const chave = nfeAssinada.slice(ABRE_NFE.length, ABRE_NFE.length + 44);
  const m = QR_V2_ON_LINE.exec(qrCode);
  if (!m || m[1] !== chave || !nfeAssinada.includes(`<tpAmb>${m[2]}</tpAmb>`) || qrCode.length < 60 || qrCode.length > 1000) {
    throw new Error('QR Code fora do padrão v2 on-line desta nota.');
  }
  if (!URL_CHAVE_FORMATO.test(urlChave)) throw new Error('urlChave fora do padrão.');
  const ponto = i + '</infNFe>'.length;
  return (
    nfeAssinada.slice(0, ponto) +
    `<infNFeSupl><qrCode>${esc(qrCode)}</qrCode><urlChave>${esc(urlChave)}</urlChave></infNFeSupl>` +
    nfeAssinada.slice(ponto)
  );
}

/**
 * O lote síncrono com uma nota: `<enviNFe xmlns="…/nfe" versao="4.00"><idLote/><indSinc>1</indSinc><NFe…/></enviNFe>`, sem
 * declaração XML. O `nfeDadosMsg` e o envelope (`sem_prefixo`) são do adaptador (porta `autorizar(cert, ambiente, enviNFe)`, §8.3).
 * idLote de 1 a 15 dígitos; só NFe assinada e com infNFeSupl; teto de 500 KB (214).
 */
export function corpoEnviNfe(idLote: bigint, nfe: string): string {
  if (idLote < 1n || idLote >= 10n ** 15n) throw new Error('idLote fora do intervalo de 15 dígitos.');
  if (!nfe.startsWith(ABRE_NFE) || !nfe.endsWith(FECHA_ASSINADA) || !nfe.includes('</infNFe><infNFeSupl><qrCode>')) {
    throw new Error('NFe fora do formato do lote.');
  }
  const corpo = `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;
  if (Buffer.byteLength(corpo, 'utf8') > TETO_LOTE_BYTES) recusa(F.tamanho);
  return corpo;
}

/** O XML de guarda (`nfce_cupons.xml_autorizado`): a NFe enviada, byte a byte, e o `protNFe` como veio no retorno. */
export function montarNfeProc(nfe: string, protNFe: string): string {
  if (!nfe.startsWith(ABRE_NFE) || !nfe.endsWith(FECHA_ASSINADA)) throw new Error('NFe fora do formato do nfeProc.');
  if (!/^<protNFe[\s>]/.test(protNFe) || !protNFe.endsWith('</protNFe>')) throw new Error('protNFe fora do formato do nfeProc.');
  return `<nfeProc xmlns="${NS_NFE}" versao="4.00">${nfe}${protNFe}</nfeProc>`;
}
