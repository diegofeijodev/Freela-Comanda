// Importar vendas por XML (desenho 24/11, A.4): o navegador lê os XML (cupons NFC-e 65 e notas NF-e 55 emitidos pela loja em outro
// sistema) e manda só o resumo de cada documento. O servidor não confia no resumo: confere o formato, o dígito da chave, a chave × CNPJ,
// modelo, série e número, e classifica cada arquivo contra os "fatos do banco" (CNPJ da loja, Empresas, documentos já registrados,
// cupons do próprio Comanda). Puro, testado sem banco. Nada some calado: todo arquivo cai em exatamente um grupo da conta.
import { Prisma } from '@prisma/client';
import { chaveValida, normalizarChave, partesDaChave } from '../../common/fiscal/chave-acesso';
import { formatarCnpj, normalizarCnpj } from '../../common/fiscal/cnpj';
import { todaySp } from '../../common/time/dates';
import { agregarVendas, textoLimpo, type LinhaVenda } from './planilha';

export const TETO_DOCUMENTOS = 5000;
export const TETO_ITENS = 990;

export type ItemDocumento = {
  produto: string;
  quantidade: Prisma.Decimal;
  valor_unitario: Prisma.Decimal;
  valor_bruto: Prisma.Decimal;
  desconto: Prisma.Decimal;
  outros: Prisma.Decimal;
  frete: Prisma.Decimal;
  cfop: string | null;
};
export type DocumentoXml = {
  arquivo: string;
  chave: string;
  modelo: 55 | 65;
  serie: number;
  numero: number;
  emitente_cnpj: string;
  tp_amb: 1 | 2;
  dh_emi: Date;
  valor_total: Prisma.Decimal;
  itens: ItemDocumento[];
};
export type CancelamentoXml = { arquivo: string; chave: string; dh_evento: Date | null };
export type IgnoradoXml = { arquivo: string; motivo: string };
export type EnvioXml = { arquivos_lidos: number; documentos: DocumentoXml[]; cancelamentos: CancelamentoXml[]; ignorados: IgnoradoXml[] };

/** Corpo do XML que não passa na conferência do servidor (400 VALIDATION_ERROR com a frase). */
export class EnvioInvalido extends Error {}

const DECIMAL = /^\d{1,13}(\.\d{1,10})?$/;
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

function decimal(v: unknown, onde: string): Prisma.Decimal {
  if (typeof v !== 'string' || !DECIMAL.test(v)) throw new EnvioInvalido(`${onde}: valor inválido.`);
  return new Prisma.Decimal(v);
}

function dataHora(v: unknown, onde: string): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(v))
    throw new EnvioInvalido(`${onde}: data inválida.`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new EnvioInvalido(`${onde}: data inválida.`);
  return d;
}

function chaveConferida(v: unknown, onde: string): string {
  const c = typeof v === 'string' ? normalizarChave(v) : '';
  if (!chaveValida(c)) throw new EnvioInvalido(`${onde}: chave de acesso inválida (dígito verificador não confere).`);
  return c;
}

/**
 * Confere o corpo do XML (o DTO é raso de propósito: aqui cada campo é conferido, inclusive tipo, para "célula que não é texto" nunca
 * virar 500). A chave precisa bater com CNPJ, modelo, série e número informados. `arquivos_lidos` precisa fechar com o que veio.
 */
export function conferirEnvioXml(corpo: {
  arquivos_lidos?: unknown;
  documentos?: unknown;
  cancelamentos?: unknown;
  ignorados?: unknown;
}): EnvioXml {
  const docs = corpo.documentos ?? [];
  const cancs = corpo.cancelamentos ?? [];
  const igns = corpo.ignorados ?? [];
  if (!Array.isArray(docs) || !Array.isArray(cancs) || !Array.isArray(igns)) throw new EnvioInvalido('Documentos inválidos.');
  if (docs.length + cancs.length > TETO_DOCUMENTOS) throw new EnvioInvalido(`Envie até ${TETO_DOCUMENTOS} documentos de cada vez.`);
  if (igns.length > TETO_DOCUMENTOS) throw new EnvioInvalido(`Envie até ${TETO_DOCUMENTOS} arquivos de cada vez.`);
  const documentos = docs.map((d, i): DocumentoXml => {
    const onde = `Documento ${i + 1}`;
    if (!objeto(d)) throw new EnvioInvalido(`${onde}: inválido.`);
    const arquivo = texto(d.arquivo, 300) ?? '';
    const chave = chaveConferida(d.chave, `${onde} (${arquivo})`);
    const p = partesDaChave(chave)!;
    const modelo = d.modelo;
    if (modelo !== 55 && modelo !== 65) throw new EnvioInvalido(`${onde} (${arquivo}): modelo inválido.`);
    const serie = d.serie;
    const numero = d.numero;
    if (!Number.isInteger(serie) || !Number.isInteger(numero)) throw new EnvioInvalido(`${onde} (${arquivo}): série ou número inválido.`);
    const emitente = typeof d.emitente_cnpj === 'string' ? normalizarCnpj(d.emitente_cnpj) : '';
    if (p.emitente !== emitente || p.modelo !== String(modelo) || p.serie !== String(serie) || p.numero !== String(numero)) {
      throw new EnvioInvalido(`${onde} (${arquivo}): a chave de acesso não bate com o CNPJ, o modelo, a série ou o número.`);
    }
    if (d.tp_amb !== 1 && d.tp_amb !== 2) throw new EnvioInvalido(`${onde} (${arquivo}): ambiente inválido.`);
    if (!Array.isArray(d.itens) || d.itens.length === 0 || d.itens.length > TETO_ITENS) {
      throw new EnvioInvalido(`${onde} (${arquivo}): de 1 a ${TETO_ITENS} itens.`);
    }
    const itens = d.itens.map((it, k): ItemDocumento => {
      const o = `${onde} (${arquivo}), item ${k + 1}`;
      if (!objeto(it)) throw new EnvioInvalido(`${o}: inválido.`);
      const produto = textoLimpo(texto(it.produto, 500) ?? '');
      if (!produto) throw new EnvioInvalido(`${o}: produto vazio.`);
      const cfop = it.cfop == null ? null : texto(it.cfop, 4);
      if (cfop !== null && !/^\d{4}$/.test(cfop)) throw new EnvioInvalido(`${o}: CFOP inválido.`);
      return {
        produto,
        quantidade: decimal(it.quantidade, o),
        valor_unitario: decimal(it.valor_unitario, o),
        valor_bruto: decimal(it.valor_bruto, o),
        desconto: decimal(it.desconto ?? '0', o),
        outros: decimal(it.outros ?? '0', o),
        frete: decimal(it.frete ?? '0', o),
        cfop,
      };
    });
    return {
      arquivo,
      chave,
      modelo,
      serie: serie as number,
      numero: numero as number,
      emitente_cnpj: emitente,
      tp_amb: d.tp_amb,
      dh_emi: dataHora(d.dh_emi, `${onde} (${arquivo})`),
      valor_total: decimal(d.valor_total, `${onde} (${arquivo})`),
      itens,
    };
  });
  const cancelamentos = cancs.map((c, i): CancelamentoXml => {
    const onde = `Cancelamento ${i + 1}`;
    if (!objeto(c)) throw new EnvioInvalido(`${onde}: inválido.`);
    const arquivo = texto(c.arquivo, 300) ?? '';
    return {
      arquivo,
      chave: chaveConferida(c.chave, `${onde} (${arquivo})`),
      dh_evento: c.dh_evento == null ? null : dataHora(c.dh_evento, `${onde} (${arquivo})`),
    };
  });
  const ignorados = igns.map((g, i): IgnoradoXml => {
    if (!objeto(g)) throw new EnvioInvalido(`Arquivo ignorado ${i + 1}: inválido.`);
    const motivo = textoLimpo(texto(g.motivo, 200) ?? '');
    if (!motivo) throw new EnvioInvalido(`Arquivo ignorado ${i + 1}: sem motivo.`);
    return { arquivo: texto(g.arquivo, 300) ?? '', motivo };
  });
  const lidos = corpo.arquivos_lidos;
  if (!Number.isInteger(lidos) || lidos !== documentos.length + cancelamentos.length + ignorados.length) {
    throw new EnvioInvalido('A contagem de arquivos lidos não fecha com os documentos enviados.');
  }
  return { arquivos_lidos: lidos as number, documentos, cancelamentos, ignorados };
}

/** O que o banco sabe e a prévia precisa para classificar os XML. CNPJs já normalizados. */
export type FatosXml = {
  cnpjLoja: string;
  /** Empresas ativas cadastradas (menos a da loja): CNPJ → nome para a tela. */
  empresas: ReadonlyMap<string, string>;
  /** Situação em `vendas_documentos` das chaves do envio (ausente = nunca importada). */
  registrados: ReadonlyMap<string, 'autorizada' | 'cancelada'>;
  /** Chaves de cupons emitidos pelo próprio Comanda (`nfce_cupons.chave`). */
  doComanda: ReadonlySet<string>;
  /** CNPJs de Empresas marcados na prévia ("Incluir os N cupons de …"); só valem os que estão em `empresas`. */
  cnpjsIncluidos: ReadonlySet<string>;
  /** Chaves de NF-e (modelo 55) marcadas na prévia. */
  nfeIncluidas: ReadonlySet<string>;
};

export type NfeFora = { chave: string; serie: number; numero: number; dh_emi: string; valor_centavos: number; cfops: string[] };
export type OutroCnpj = { cnpj: string; nome_em_empresas: string; documentos: number; incluido: boolean };
export type ContagemXml = {
  arquivos_lidos: number;
  vendas_novas: number;
  ja_importados: number;
  ja_cancelados: number;
  do_proprio_comanda: number;
  cancelados_no_envio: number;
  repetidos_no_envio: number;
  arquivos_cancelamento: number;
  /** NF-e (55) que ficaram de fora (desmarcadas). */
  nfe_fora: NfeFora[];
  /** Cupons de outra empresa cadastrada em Empresas (incluídos ou não). Os não incluídos ficam de fora. */
  outros_cnpjs: OutroCnpj[];
  /** Por motivo (do navegador e do servidor), com os nomes dos arquivos. */
  ignorados: { motivo: string; arquivos: string[] }[];
};
export type ClassificacaoXml = {
  novos: DocumentoXml[];
  /** Cancelamentos a aplicar: `importado` = a venda já estava no Comanda (sai das vendas); senão, só registra o documento cancelado. */
  cancelar: { chave: string; dh_evento: Date | null; importado: boolean }[];
  contagem: ContagemXml;
};

export const MOTIVO_HOMOLOGACAO = 'modo de teste da SEFAZ (não vale como venda)';
export const motivoOutroCnpj = (cnpj: string) => `emitido por outro CNPJ (${formatarCnpj(cnpj)}). Se for uma compra, use Entrada de Notas.`;
export const MOTIVO_CANCELAMENTO_OUTRO_CNPJ = 'cancelamento de cupom de outro CNPJ';

/** Data e hora do documento em Brasília (a venda entra no dia em que foi emitida no caixa). */
export function dataHoraSp(d: Date): { data: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return { data: todaySp(d), hora: `${v('hour')}:${v('minute')}:${v('second')}` };
}

/** Pedido da venda do documento: o mesmo formato do cupom do Comanda (`NFC-e <série>-<número>`), com as letras do sistema na frente. */
export const pedidoDoDocumento = (d: Pick<DocumentoXml, 'modelo' | 'serie' | 'numero'>, prefixo: string, sufixo = '') =>
  `${prefixo}${d.modelo === 65 ? 'NFC-e' : 'NF-e'} ${d.serie}-${d.numero}${sufixo}`;

/**
 * As linhas de `vendas` de um documento (igual à projeção do cupom): `valor_total` = vProd − vDesc, `desconto` = vDesc, `taxa` = vOutro,
 * `frete` = vFrete. Uma linha por item (`linha` = nº do item); o mesmo produto repetido no documento é somado depois, em `agregarVendas`
 * (o pedido é o do documento, então a soma não mistura documentos).
 */
export function linhasDoDocumento(d: DocumentoXml, prefixo: string, sufixo = ''): LinhaVenda[] {
  const { data, hora } = dataHoraSp(d.dh_emi);
  const pedido = pedidoDoDocumento(d, prefixo, sufixo);
  return d.itens.map((it, k): LinhaVenda => ({
    linha: k + 1,
    pedido,
    data,
    hora,
    produto_relatorio: it.produto,
    quantidade: it.quantidade,
    valor_total: it.valor_bruto.sub(it.desconto),
    preco_unitario: it.valor_unitario,
    desconto: it.desconto,
    taxa: it.outros,
    frete: it.frete,
  }));
}

/** As vendas de um documento já somadas por produto. */
export const vendasDoDocumento = (d: DocumentoXml, prefixo: string): LinhaVenda[] => agregarVendas(linhasDoDocumento(d, prefixo)).vendas;

const centavosDe = (d: Prisma.Decimal) => d.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();

/** Classifica cada arquivo do envio em exatamente um grupo (a identidade da conta está em `fechaContagemXml`). */
export function classificarXml(env: EnvioXml, f: FatosXml): ClassificacaoXml {
  const c: ContagemXml = {
    arquivos_lidos: env.arquivos_lidos,
    vendas_novas: 0,
    ja_importados: 0,
    ja_cancelados: 0,
    do_proprio_comanda: 0,
    cancelados_no_envio: 0,
    repetidos_no_envio: 0,
    arquivos_cancelamento: 0,
    nfe_fora: [],
    outros_cnpjs: [],
    ignorados: [],
  };
  const ignorar = (motivo: string, arquivo: string) => {
    const g = c.ignorados.find((x) => x.motivo === motivo);
    if (g) g.arquivos.push(arquivo);
    else c.ignorados.push({ motivo, arquivos: [arquivo] });
  };
  for (const g of env.ignorados) ignorar(g.motivo, g.arquivo);
  const emitenteAceito = (cnpj: string) => cnpj === f.cnpjLoja || (f.empresas.has(cnpj) && f.cnpjsIncluidos.has(cnpj));

  // cancelamentos primeiro: a venda que chegou no mesmo envio nem entra
  const cancelar: ClassificacaoXml['cancelar'] = [];
  const canceladasNoEnvio = new Set<string>();
  for (const k of env.cancelamentos) {
    const emit = k.chave.slice(6, 20);
    if (canceladasNoEnvio.has(k.chave)) c.repetidos_no_envio++;
    else if (f.doComanda.has(k.chave)) c.do_proprio_comanda++;
    else if (!emitenteAceito(emit)) ignorar(MOTIVO_CANCELAMENTO_OUTRO_CNPJ, k.arquivo);
    else if (f.registrados.get(k.chave) === 'cancelada') c.ja_cancelados++;
    else {
      canceladasNoEnvio.add(k.chave);
      cancelar.push({ chave: k.chave, dh_evento: k.dh_evento, importado: f.registrados.get(k.chave) === 'autorizada' });
      c.arquivos_cancelamento++;
    }
    canceladasNoEnvio.add(k.chave);
  }

  const novos: DocumentoXml[] = [];
  const vistos = new Set<string>();
  const outros = new Map<string, OutroCnpj>();
  for (const d of env.documentos) {
    if (vistos.has(d.chave)) {
      c.repetidos_no_envio++;
      continue;
    }
    vistos.add(d.chave);
    if (d.tp_amb === 2) ignorar(MOTIVO_HOMOLOGACAO, d.arquivo);
    else if (f.doComanda.has(d.chave)) c.do_proprio_comanda++;
    else if (d.emitente_cnpj !== f.cnpjLoja && !f.empresas.has(d.emitente_cnpj)) ignorar(motivoOutroCnpj(d.emitente_cnpj), d.arquivo);
    else if (d.emitente_cnpj !== f.cnpjLoja && !f.cnpjsIncluidos.has(d.emitente_cnpj)) {
      const o = outros.get(d.emitente_cnpj) ?? {
        cnpj: d.emitente_cnpj,
        nome_em_empresas: f.empresas.get(d.emitente_cnpj)!,
        documentos: 0,
        incluido: false,
      };
      o.documentos++;
      outros.set(d.emitente_cnpj, o);
    } else if (d.modelo === 55 && !f.nfeIncluidas.has(d.chave)) {
      c.nfe_fora.push({
        chave: d.chave,
        serie: d.serie,
        numero: d.numero,
        dh_emi: d.dh_emi.toISOString(),
        valor_centavos: centavosDe(d.valor_total),
        cfops: [...new Set(d.itens.map((i) => i.cfop).filter((x): x is string => !!x))].sort(),
      });
    } else if (f.registrados.get(d.chave) === 'autorizada') c.ja_importados++;
    else if (f.registrados.get(d.chave) === 'cancelada') c.ja_cancelados++;
    else if (canceladasNoEnvio.has(d.chave)) c.cancelados_no_envio++;
    else {
      if (d.emitente_cnpj !== f.cnpjLoja) {
        const o = outros.get(d.emitente_cnpj) ?? {
          cnpj: d.emitente_cnpj,
          nome_em_empresas: f.empresas.get(d.emitente_cnpj)!,
          documentos: 0,
          incluido: true,
        };
        o.documentos++;
        outros.set(d.emitente_cnpj, o);
      }
      novos.push(d);
      c.vendas_novas++;
    }
  }
  c.outros_cnpjs = [...outros.values()];
  return { novos, cancelar, contagem: c };
}

/** A conta do cartão "Cupons de venda novos" fecha: cada arquivo lido está em exatamente um grupo. */
export function fechaContagemXml(c: ContagemXml): boolean {
  const fora = c.outros_cnpjs.filter((o) => !o.incluido).reduce((s, o) => s + o.documentos, 0);
  const ign = c.ignorados.reduce((s, g) => s + g.arquivos.length, 0);
  return (
    c.arquivos_lidos ===
    c.vendas_novas +
      c.ja_importados +
      c.ja_cancelados +
      c.do_proprio_comanda +
      c.cancelados_no_envio +
      c.repetidos_no_envio +
      c.arquivos_cancelamento +
      c.nfe_fora.length +
      fora +
      ign
  );
}
