import {
  classificarXml,
  conferirEnvioXml,
  EnvioInvalido,
  fechaContagemXml,
  MOTIVO_CANCELAMENTO_OUTRO_CNPJ,
  MOTIVO_HOMOLOGACAO,
  motivoOutroCnpj,
  vendasDoDocumento,
  type FatosXml,
} from '../documentos';

const LOJA = '12345678000195';
const OUTRA_EMPRESA = '98765432000110';
const ESTRANHO = '11222333000181';

/** Chave fictícia com DV certo (módulo 11, como `chaveValida`). */
function chave(cnpj: string, modelo: 55 | 65, serie: number, numero: number): string {
  const base = `352611${cnpj}${modelo}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${'12345678'}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return base + String(r < 2 ? 0 : 11 - r);
}

const item = (produto = 'CALDO 300ML', extra: Record<string, unknown> = {}) => ({
  produto,
  quantidade: '2.0000',
  valor_unitario: '12.00',
  valor_bruto: '24.00',
  desconto: '1.35',
  outros: '0.00',
  frete: '0.00',
  cfop: '5102',
  ...extra,
});
const doc = (numero: number, extra: Record<string, unknown> = {}) => {
  const cnpj = (extra.emitente_cnpj as string) ?? LOJA;
  const modelo = (extra.modelo as 55 | 65) ?? 65;
  return {
    arquivo: `NFCe-${numero}.xml`,
    chave: chave(cnpj, modelo, 1, numero),
    modelo,
    serie: 1,
    numero,
    emitente_cnpj: cnpj,
    tp_amb: 1,
    dh_emi: '2026-11-20T23:30:00-03:00',
    valor_total: '22.65',
    itens: [item()],
    ...extra,
  };
};
const envio = (documentos: unknown[], cancelamentos: unknown[] = [], ignorados: unknown[] = []) =>
  conferirEnvioXml({ arquivos_lidos: documentos.length + cancelamentos.length + ignorados.length, documentos, cancelamentos, ignorados });

const fatos = (extra: Partial<FatosXml> = {}): FatosXml => ({
  cnpjLoja: LOJA,
  empresas: new Map([[OUTRA_EMPRESA, 'Cana Express Ltda']]),
  registrados: new Map(),
  doComanda: new Set(),
  cnpjsIncluidos: new Set(),
  nfeIncluidas: new Set(),
  ...extra,
});

describe('conferência do corpo do XML no servidor (não confia no navegador)', () => {
  it('documento certo passa e vira Decimal/Date', () => {
    const e = envio([doc(12)]);
    expect(e.documentos[0]!.valor_total.toString()).toBe('22.65');
    expect(e.documentos[0]!.dh_emi.toISOString()).toBe('2026-11-21T02:30:00.000Z');
  });
  it('chave com DV errado = 400 (EnvioInvalido)', () => {
    const d = doc(12);
    d.chave = d.chave.slice(0, 43) + String((Number(d.chave[43]) + 1) % 10);
    expect(() => envio([d])).toThrow(EnvioInvalido);
    expect(() => envio([d])).toThrow(/dígito verificador/);
  });
  it('chave × CNPJ, modelo, série e número', () => {
    expect(() => envio([{ ...doc(12), numero: 13 }])).toThrow(/não bate/);
    expect(() => envio([{ ...doc(12), emitente_cnpj: ESTRANHO }])).toThrow(/não bate/);
    expect(() => envio([{ ...doc(12), modelo: 55 }])).toThrow(/não bate/);
  });
  it('campo com tipo errado não vira 500: número no lugar de texto decimal, item sem produto', () => {
    expect(() => envio([{ ...doc(12), itens: [item('X', { quantidade: 2 })] }])).toThrow(EnvioInvalido);
    expect(() => envio([{ ...doc(12), itens: [item('   ')] }])).toThrow(/produto vazio/);
    expect(() => envio([{ ...doc(12), itens: [] }])).toThrow(/de 1 a 990 itens/);
    expect(() => envio([{ ...doc(12), dh_emi: '20/11/2026' }])).toThrow(/data inválida/);
    expect(() => envio(['texto'])).toThrow(EnvioInvalido);
  });
  it('a contagem de arquivos lidos precisa fechar', () => {
    expect(() => conferirEnvioXml({ arquivos_lidos: 3, documentos: [doc(12)], cancelamentos: [], ignorados: [] })).toThrow(/não fecha/);
  });
});

describe('classificação dos arquivos (cada um em exatamente um grupo)', () => {
  it('a tabela de A.4, linha a linha', () => {
    const jaImportada = doc(20);
    const jaCancelada = doc(21);
    const doComanda = doc(22);
    const canceladaJunto = doc(23);
    const nfe = doc(24, { modelo: 55, itens: [item('CAIXA', { cfop: '5949' }), item('CALDO', { cfop: '5102' })] });
    const deOutraEmpresa = doc(25, { emitente_cnpj: OUTRA_EMPRESA });
    const deEstranho = doc(26, { emitente_cnpj: ESTRANHO });
    const homologacao = doc(27, { tp_amb: 2 });
    const e = envio(
      [doc(10), doc(10), jaImportada, jaCancelada, doComanda, canceladaJunto, nfe, deOutraEmpresa, deEstranho, homologacao],
      [
        { arquivo: 'canc-23.xml', chave: canceladaJunto.chave, dh_evento: '2026-11-21T10:00:00-03:00' },
        { arquivo: 'canc-20.xml', chave: jaImportada.chave, dh_evento: null },
        { arquivo: 'canc-99.xml', chave: chave(LOJA, 65, 1, 99), dh_evento: null },
        { arquivo: 'canc-x.xml', chave: chave(ESTRANHO, 65, 1, 5), dh_evento: null },
      ],
      [{ arquivo: 'inutilizacao.xml', motivo: 'inutilização de numeração' }],
    );
    const r = classificarXml(
      e,
      fatos({
        registrados: new Map([
          [jaImportada.chave, 'autorizada'],
          [jaCancelada.chave, 'cancelada'],
        ]),
        doComanda: new Set([doComanda.chave]),
      }),
    );
    expect(r.novos.map((d) => d.numero)).toEqual([10]);
    expect(r.cancelar).toEqual([
      { chave: canceladaJunto.chave, dh_evento: new Date('2026-11-21T13:00:00Z'), importado: false },
      { chave: jaImportada.chave, dh_evento: null, importado: true },
      { chave: chave(LOJA, 65, 1, 99), dh_evento: null, importado: false },
    ]);
    const c = r.contagem;
    expect({
      lidos: c.arquivos_lidos,
      novas: c.vendas_novas,
      ja_importados: c.ja_importados,
      ja_cancelados: c.ja_cancelados,
      comanda: c.do_proprio_comanda,
      junto: c.cancelados_no_envio,
      repetidos: c.repetidos_no_envio,
      cancelamentos: c.arquivos_cancelamento,
    }).toEqual({ lidos: 15, novas: 1, ja_importados: 1, ja_cancelados: 1, comanda: 1, junto: 1, repetidos: 1, cancelamentos: 3 });
    expect(c.nfe_fora).toEqual([
      { chave: nfe.chave, serie: 1, numero: 24, dh_emi: '2026-11-21T02:30:00.000Z', valor_centavos: 2265, cfops: ['5102', '5949'] },
    ]);
    expect(c.outros_cnpjs).toEqual([{ cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 1, incluido: false }]);
    expect(c.ignorados).toEqual([
      { motivo: 'inutilização de numeração', arquivos: ['inutilizacao.xml'] },
      { motivo: MOTIVO_CANCELAMENTO_OUTRO_CNPJ, arquivos: ['canc-x.xml'] },
      { motivo: motivoOutroCnpj(ESTRANHO), arquivos: ['NFCe-26.xml'] },
      { motivo: MOTIVO_HOMOLOGACAO, arquivos: ['NFCe-27.xml'] },
    ]);
    expect(motivoOutroCnpj(ESTRANHO)).toBe('emitido por outro CNPJ (11.222.333/0001-81). Se for uma compra, use Entrada de Notas.');
    expect(fechaContagemXml(c)).toBe(true);
  });

  it('CNPJ de Empresas só entra quando marcado; NF-e só quando marcada', () => {
    const outra = doc(25, { emitente_cnpj: OUTRA_EMPRESA });
    const nfe = doc(24, { modelo: 55 });
    const r = classificarXml(envio([outra, nfe]), fatos({ cnpjsIncluidos: new Set([OUTRA_EMPRESA]), nfeIncluidas: new Set([nfe.chave]) }));
    expect(r.novos.map((d) => d.numero)).toEqual([25, 24]);
    expect(r.contagem.outros_cnpjs).toEqual([{ cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 1, incluido: true }]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });

  it('CNPJ marcado que NÃO está em Empresas continua de fora (a tela não amplia a loja)', () => {
    const r = classificarXml(envio([doc(26, { emitente_cnpj: ESTRANHO })]), fatos({ cnpjsIncluidos: new Set([ESTRANHO]) }));
    expect(r.novos).toEqual([]);
    expect(r.contagem.ignorados.map((g) => g.motivo)).toEqual([motivoOutroCnpj(ESTRANHO)]);
  });

  it('só cancelamentos (o .zip que chega semanas depois): nenhuma venda nova, cancelamento a aplicar', () => {
    const c20 = chave(LOJA, 65, 1, 20);
    const r = classificarXml(envio([], [{ arquivo: 'canc.xml', chave: c20, dh_evento: null }]), fatos({ registrados: new Map([[c20, 'autorizada']]) }));
    expect(r.novos).toEqual([]);
    expect(r.cancelar).toEqual([{ chave: c20, dh_evento: null, importado: true }]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });
});

describe('as vendas de um documento (a mesma projeção do cupom do Comanda)', () => {
  it('pedido "NFC-e série-número" com as letras do sistema, data e hora em Brasília, valor = vProd − vDesc, produto repetido somado', () => {
    const e = envio([doc(12, { dh_emi: '2026-11-21T01:30:00Z', itens: [item('CALDO  300ML'), item('CALDO 300ML'), item('PASTEL', { desconto: '0.00' })] })]);
    const v = vendasDoDocumento(e.documentos[0]!, 'PV-');
    expect(v.map((x) => [x.pedido, x.data, x.hora, x.produto_relatorio, x.quantidade.toString(), x.valor_total.toString(), x.desconto.toString()])).toEqual([
      ['PV-NFC-e 1-12', '2026-11-20', '22:30:00', 'CALDO 300ML', '4', '45.3', '2.7'],
      ['PV-NFC-e 1-12', '2026-11-20', '22:30:00', 'PASTEL', '2', '24', '0'],
    ]);
  });
  it('NF-e vira "NF-e série-número"', () => {
    const e = envio([doc(24, { modelo: 55 })]);
    expect(vendasDoDocumento(e.documentos[0]!, '')[0]!.pedido).toBe('NF-e 1-24');
  });
});
