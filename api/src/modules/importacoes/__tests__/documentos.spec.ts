import {
  classificarXml,
  conferirEnvioXml,
  EnvioInvalido,
  fechaContagemXml,
  MOTIVO_CANCELAMENTO_OUTRO_CNPJ,
  MOTIVO_HOMOLOGACAO,
  motivoOutroCnpj,
  periodoDosCancelamentos,
  vendasDoDocumento,
  vendasDosNovos,
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
  doComanda: new Map(),
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
        doComanda: new Map([[doComanda.chave, 'autorizado']]),
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
    expect(c.outros_cnpjs).toEqual([
      { cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 1, cancelamentos: 0, incluido: false },
    ]);
    expect(c.com_problema).toEqual([]);
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
    expect(r.contagem.outros_cnpjs).toEqual([
      { cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 1, cancelamentos: 0, incluido: true },
    ]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });

  it('CNPJ marcado que NÃO está em Empresas continua de fora (a tela não amplia a loja)', () => {
    const r = classificarXml(envio([doc(26, { emitente_cnpj: ESTRANHO })]), fatos({ cnpjsIncluidos: new Set([ESTRANHO]) }));
    expect(r.novos).toEqual([]);
    expect(r.contagem.ignorados.map((g) => g.motivo)).toEqual([motivoOutroCnpj(ESTRANHO)]);
  });

  it('só cancelamentos (o .zip que chega semanas depois): nenhuma venda nova, cancelamento a aplicar', () => {
    const c20 = chave(LOJA, 65, 1, 20);
    const r = classificarXml(
      envio([], [{ arquivo: 'canc.xml', chave: c20, dh_evento: null }]),
      fatos({ registrados: new Map([[c20, 'autorizada']]) }),
    );
    expect(r.novos).toEqual([]);
    expect(r.cancelar).toEqual([{ chave: c20, dh_evento: null, importado: true }]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });
});

describe('cancelamentos (revisão de 24/11)', () => {
  it('cupom de outra Empresa já importado: o cancelamento sai, mesmo sem marcar a empresa nesta prévia', () => {
    const c25 = chave(OUTRA_EMPRESA, 65, 1, 25);
    const r = classificarXml(
      envio([], [{ arquivo: 'canc-25.xml', chave: c25, dh_evento: null }]),
      fatos({ registrados: new Map([[c25, 'autorizada']]) }),
    );
    expect(r.cancelar).toEqual([{ chave: c25, dh_evento: null, importado: true }]);
    expect(r.contagem.arquivos_cancelamento).toBe(1);
    expect(r.contagem.ignorados).toEqual([]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });

  it('cupom já importado de um CNPJ que saiu de Empresas: o cancelamento também sai (quem decidiu foi a importação da venda)', () => {
    const c5 = chave(ESTRANHO, 65, 1, 5);
    const r = classificarXml(envio([], [{ arquivo: 'canc-5.xml', chave: c5, dh_evento: null }]), fatos({ registrados: new Map([[c5, 'autorizada']]) }));
    expect(r.cancelar).toEqual([{ chave: c5, dh_evento: null, importado: true }]);
  });

  it('só o cancelamento de outra Empresa (a venda nunca entrou): aparece em "outra empresa sua" para incluir; marcado, registra', () => {
    const c26 = chave(OUTRA_EMPRESA, 65, 1, 26);
    const e = envio([], [{ arquivo: 'canc-26.xml', chave: c26, dh_evento: null }]);
    const fora = classificarXml(e, fatos());
    expect(fora.cancelar).toEqual([]);
    expect(fora.contagem.outros_cnpjs).toEqual([
      { cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 0, cancelamentos: 1, incluido: false },
    ]);
    expect(fora.contagem.ignorados).toEqual([]);
    expect(fechaContagemXml(fora.contagem)).toBe(true);
    const dentro = classificarXml(e, fatos({ cnpjsIncluidos: new Set([OUTRA_EMPRESA]) }));
    expect(dentro.cancelar).toEqual([{ chave: c26, dh_evento: null, importado: false }]);
    expect(dentro.contagem.outros_cnpjs).toEqual([
      { cnpj: OUTRA_EMPRESA, nome_em_empresas: 'Cana Express Ltda', documentos: 0, cancelamentos: 1, incluido: true },
    ]);
    expect(fechaContagemXml(dentro.contagem)).toBe(true);
  });

  it('cancelamento de cupom do próprio Comanda: não é aplicado e é contado à parte, com os que o Comanda ainda tem como autorizados', () => {
    const c30 = chave(LOJA, 65, 1, 30);
    const c31 = chave(LOJA, 65, 1, 31);
    const c32 = chave(LOJA, 65, 1, 32);
    const r = classificarXml(
      envio(
        [],
        [
          { arquivo: 'canc-30.xml', chave: c30, dh_evento: null },
          { arquivo: 'canc-31.xml', chave: c31, dh_evento: null },
          { arquivo: 'canc-32.xml', chave: c32, dh_evento: null },
        ],
      ),
      fatos({
        doComanda: new Map([
          [c30, 'autorizado'],
          [c31, 'cancelado'],
          [c32, 'descartado'], // nunca autorizado: não é "continua autorizado"
        ]),
      }),
    );
    expect(r.cancelar).toEqual([]);
    expect(r.contagem.do_proprio_comanda).toBe(0);
    expect(r.contagem.cancelamentos_do_comanda).toEqual({ arquivos: 3, ainda_autorizados: 1 });
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });

  it('cancelamento de cupom que não veio por XML (nem agora nem antes): fica na lista para o aviso da planilha', () => {
    const c40 = chave(LOJA, 65, 1, 40);
    const c41 = chave(LOJA, 65, 1, 41);
    const c42 = chave(LOJA, 65, 1, 42);
    const r = classificarXml(
      envio(
        [doc(41)],
        [
          { arquivo: 'canc-40.xml', chave: c40, dh_evento: '2026-11-21T00:30:00-03:00' },
          { arquivo: 'canc-41.xml', chave: c41, dh_evento: null },
          { arquivo: 'canc-42.xml', chave: c42, dh_evento: null },
        ],
      ),
      fatos({ registrados: new Map([[c42, 'autorizada']]) }),
    );
    expect(r.sem_venda_xml).toEqual([{ chave: c40, dh_evento: new Date('2026-11-21T03:30:00Z') }]);
  });

  it('período dos cancelamentos: o dia do evento em Brasília; sem o dia, o mês da chave', () => {
    expect(periodoDosCancelamentos([])).toBeNull();
    expect(
      periodoDosCancelamentos([
        { chave: chave(LOJA, 65, 1, 1), dh_evento: new Date('2026-11-21T02:30:00Z') },
        { chave: chave(LOJA, 65, 1, 2), dh_evento: new Date('2026-11-18T15:00:00Z') },
      ]),
    ).toEqual({ ini: '2026-11-18', fim: '2026-11-20' });
    // chave de novembro/2026 (AAMM 2611) sem data do evento: o mês inteiro
    expect(periodoDosCancelamentos([{ chave: chave(LOJA, 65, 1, 1), dh_evento: null }])).toEqual({ ini: '2026-11-01', fim: '2026-11-30' });
  });
});

describe('soma dos itens × total do documento (vNF), no servidor', () => {
  it('Σ(vProd − vDesc + vOutro + vFrete + vSeg) igual ao vNF: entra', () => {
    const d = doc(50, {
      valor_total: '30.65',
      itens: [item('CALDO', { outros: '3.00', frete: '4.00', seguro: '1.00' })],
    });
    const r = classificarXml(envio([d]), fatos());
    expect(r.novos.map((x) => x.numero)).toEqual([50]);
    expect(r.contagem.com_problema).toEqual([]);
  });

  it('diferente do vNF: fica de fora como "com problema", com o motivo e os dois valores', () => {
    const d = doc(51, { valor_total: '1250.00' });
    const r = classificarXml(envio([d]), fatos());
    expect(r.novos).toEqual([]);
    expect(r.contagem.com_problema).toEqual([
      { arquivo: 'NFCe-51.xml', motivo: 'a soma dos itens (R$ 22,65) não bate com o total do cupom (R$ 1.250,00)' },
    ]);
    expect(fechaContagemXml(r.contagem)).toBe(true);
  });

  it('tolerância de R$ 0,02 por item (arredondamento do rateio)', () => {
    const tres = [item('A'), item('B'), item('C')]; // 3 × 22,65 = 67,95
    expect(classificarXml(envio([doc(52, { valor_total: '68.01', itens: tres })]), fatos()).novos).toHaveLength(1);
    expect(classificarXml(envio([doc(53, { valor_total: '68.02', itens: tres })]), fatos()).contagem.com_problema).toHaveLength(1);
  });

  it('NF-e marcada com soma diferente: "da nota"; já importado não é conferido de novo', () => {
    const nfe = doc(54, { modelo: 55, valor_total: '10.00' });
    const r = classificarXml(envio([nfe]), fatos({ nfeIncluidas: new Set([nfe.chave]) }));
    expect(r.contagem.com_problema[0]!.motivo).toBe('a soma dos itens (R$ 22,65) não bate com o total da nota (R$ 10,00)');
    const ja = doc(55, { valor_total: '10.00' });
    const r2 = classificarXml(envio([ja]), fatos({ registrados: new Map([[ja.chave, 'autorizada']]) }));
    expect([r2.contagem.ja_importados, r2.contagem.com_problema.length]).toEqual([1, 0]);
  });
});

describe('vendas dos documentos novos (o pedido liga a venda ao documento)', () => {
  it('cada linha leva a chave do documento; outro CNPJ incluído leva o CNPJ no pedido', () => {
    const e = envio([doc(60), doc(60, { emitente_cnpj: OUTRA_EMPRESA })]);
    const r = vendasDosNovos(e.documentos, 'PV-', LOJA);
    expect(r.linhas.map((l) => l.pedido)).toEqual(['PV-NFC-e 1-60', `PV-NFC-e 1-60 ${OUTRA_EMPRESA}`]);
    expect(r.documentoDaVenda.get('PV-NFC-e 1-60')).toBe(e.documentos[0]!.chave);
  });

  it('dois documentos novos com o mesmo pedido (chaves diferentes) = 400 com os dois arquivos', () => {
    const a = doc(61);
    const b = { ...doc(61), arquivo: 'NFCe-61-b.xml', chave: chave(LOJA, 65, 1, 61).slice(0, 35) + '99999999' };
    const base = b.chave.slice(0, 43);
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    b.chave = base + String(soma % 11 < 2 ? 0 : 11 - (soma % 11));
    const e = envio([a, b]);
    expect(() => vendasDosNovos(e.documentos, '', LOJA)).toThrow(EnvioInvalido);
    expect(() => vendasDosNovos(e.documentos, '', LOJA)).toThrow(
      'Os arquivos NFCe-61.xml e NFCe-61-b.xml têm o mesmo número (NFC-e 1-61) com chaves de acesso diferentes. Tire o arquivo errado e escolha de novo.',
    );
  });
});

describe('as vendas de um documento (a mesma projeção do cupom do Comanda)', () => {
  it('pedido "NFC-e série-número" com as letras do sistema, data e hora em Brasília, valor = vProd − vDesc, produto repetido somado', () => {
    const e = envio([
      doc(12, { dh_emi: '2026-11-21T01:30:00Z', itens: [item('CALDO  300ML'), item('CALDO 300ML'), item('PASTEL', { desconto: '0.00' })] }),
    ]);
    const v = vendasDoDocumento(e.documentos[0]!, 'PV-');
    expect(
      v.map((x) => [
        x.pedido,
        x.data,
        x.hora,
        x.produto_relatorio,
        x.quantidade.toString(),
        x.valor_total.toString(),
        x.desconto.toString(),
      ]),
    ).toEqual([
      ['PV-NFC-e 1-12', '2026-11-20', '22:30:00', 'CALDO 300ML', '4', '45.3', '2.7'],
      ['PV-NFC-e 1-12', '2026-11-20', '22:30:00', 'PASTEL', '2', '24', '0'],
    ]);
  });
  it('NF-e vira "NF-e série-número"', () => {
    const e = envio([doc(24, { modelo: 55 })]);
    expect(vendasDoDocumento(e.documentos[0]!, '')[0]!.pedido).toBe('NF-e 1-24');
  });
});
