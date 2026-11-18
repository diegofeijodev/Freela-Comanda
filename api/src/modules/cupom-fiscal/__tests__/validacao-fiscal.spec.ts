import { CST_ACEITOS, erroDoItemFiscal, erroDoPerfil, motivosDoProduto, perfilValeNoRegime, type PerfilFiscal } from '../validacao-fiscal';

const p: PerfilFiscal = {
  cfop: '5102',
  csosn: '102',
  cst_icms: null,
  aliq_icms: null,
  pis_cst: null,
  cofins_cst: null,
  c_ativ_sn: null,
  ibs_sn_aliq: null,
  cbs_sn_aliq: null,
  ibscbs_cst: null,
  ibscbs_cclass_trib: null,
  ativo: true,
};
const normal: PerfilFiscal = { ...p, csosn: null, cst_icms: '00', aliq_icms: '18' };

describe('validação fiscal: perfil', () => {
  it('frases da UX §6.2 e do plano', () => {
    expect(erroDoPerfil({ ...p, csosn: '500', cfop: '5102' }, 1)).toBe('O CSOSN 500 só vale com o CFOP 5.405.');
    expect(erroDoPerfil({ ...p, csosn: null, cst_icms: '00' }, 1)).toBe('No Simples, escolha o CSOSN.');
    expect(erroDoPerfil({ ...p, csosn: '102', cst_icms: null }, 3)).toBe('No regime normal, escolha o CST.');
    expect(erroDoPerfil({ ...p, csosn: '102', cfop: '5405' }, 1)).toBe(
      'O CSOSN 102 só vale com o tipo de venda (CFOP) 5.101, 5.102, 5.103, 5.104 ou 5.115.',
    );
    expect(erroDoPerfil({ ...p, csosn: '102', cst_icms: '00' }, null)).toBe(
      'Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois.',
    );
    expect(erroDoPerfil({ ...p, cfop: '5933' }, 1)).toBe('O tipo de venda (CFOP) 5.933 não entra no cupom.');
    expect(perfilValeNoRegime({ ...p, csosn: '102' }, 3)).toBe(false);
  });

  it('perfis certos passam', () => {
    expect(erroDoPerfil(p, 1)).toBeNull();
    expect(erroDoPerfil(p, null)).toBeNull();
    expect(erroDoPerfil(normal, 3)).toBeNull();
    expect(erroDoPerfil(normal, null)).toBeNull();
    for (const cfop of ['5101', '5102', '5103', '5104', '5115'])
      for (const csosn of ['102', '103', '300', '400', '900']) expect(erroDoPerfil({ ...p, cfop, csosn }, 1)).toBeNull();
    for (const cfop of ['5405', '5656', '5667']) expect(erroDoPerfil({ ...p, cfop, csosn: '500' }, 1)).toBeNull();
    for (const cst of ['00', '40', '41', '90']) expect(erroDoPerfil({ ...normal, cst_icms: cst }, 3)).toBeNull();
    expect(erroDoPerfil({ ...normal, cst_icms: '60', cfop: '5405', aliq_icms: null }, 3)).toBeNull();
    expect(
      erroDoPerfil(
        { ...p, pis_cst: '49', cofins_cst: '49', c_ativ_sn: '01', ibs_sn_aliq: '0.1234', cbs_sn_aliq: '100', aliq_icms: '0' },
        1,
      ),
    ).toBeNull();
    expect(erroDoPerfil({ ...normal, ibscbs_cst: '000', ibscbs_cclass_trib: '000001', aliq_icms: '100.00' }, 3)).toBeNull();
  });

  it('CRT 1, 2 e 4 pedem CSOSN; CRT 3 pede CST', () => {
    expect(erroDoPerfil(p, 2)).toBeNull();
    expect(erroDoPerfil(p, 4)).toBeNull();
    expect(erroDoPerfil(normal, 2)).toBe('No Simples, escolha o CSOSN.');
    expect(erroDoPerfil(normal, 4)).toBe('No Simples, escolha o CSOSN.');
    expect(erroDoPerfil({ ...p, csosn: null }, 1)).toBe('No Simples, escolha o CSOSN.');
    expect(erroDoPerfil({ ...normal, cst_icms: null }, 3)).toBe('No regime normal, escolha o CST.');
    expect(erroDoPerfil({ ...p, csosn: null }, null)).toBe('Escolha o CSOSN (Simples) ou o CST (regime normal).');
    expect(erroDoPerfil({ ...p, csosn: '   ' }, null)).toBe('Escolha o CSOSN (Simples) ou o CST (regime normal).');
    expect(erroDoPerfil({ ...normal, csosn: '102' }, 3)).toBe('Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois.');
  });

  it('CFOP fora da lista, código fora da lista e combinações', () => {
    expect(erroDoPerfil({ ...p, cfop: '5949' }, 1)).toBe('O tipo de venda (CFOP) 5.949 não entra no cupom.');
    expect(erroDoPerfil({ ...p, cfop: '' }, 1)).toBe('Escolha o tipo de venda (CFOP).');
    expect(erroDoPerfil({ ...p, cfop: '51O2' }, 1)).toBe('Escolha o tipo de venda (CFOP).');
    expect(erroDoPerfil({ ...p, csosn: '101' }, 1)).toBe('O CSOSN 101 não entra no cupom.');
    expect(erroDoPerfil({ ...normal, cst_icms: '10' }, 3)).toBe('O CST 10 não entra no cupom.');
    expect(erroDoPerfil({ ...p, csosn: '900', cfop: '5656' }, 1)).toBe(
      'O CSOSN 900 só vale com o tipo de venda (CFOP) 5.101, 5.102, 5.103, 5.104 ou 5.115.',
    );
    expect(erroDoPerfil({ ...normal, cst_icms: '60', cfop: '5102' }, 3)).toBe('O CST 60 só vale com o tipo de venda (CFOP) 5.405.');
    expect(erroDoPerfil({ ...normal, cst_icms: '60', cfop: '5656' }, null)).toBe('O CST 60 só vale com o tipo de venda (CFOP) 5.405.');
    expect(erroDoPerfil({ ...p, csosn: '500', cfop: '5102' }, null)).toBe('O CSOSN 500 só vale com o CFOP 5.405.');
  });

  it('formatos dos outros campos (só o formato; os de 2027 não entram no cupom ainda)', () => {
    expect(erroDoPerfil({ ...normal, aliq_icms: '100.01' }, 3)).toBe('A alíquota do ICMS vai de 0 a 100, com até 2 casas.');
    expect(erroDoPerfil({ ...normal, aliq_icms: '18.005' }, 3)).toBe('A alíquota do ICMS vai de 0 a 100, com até 2 casas.');
    expect(erroDoPerfil({ ...normal, aliq_icms: '18,5' }, 3)).toBe('A alíquota do ICMS vai de 0 a 100, com até 2 casas.');
    expect(erroDoPerfil({ ...normal, aliq_icms: '-1' }, 3)).toBe('A alíquota do ICMS vai de 0 a 100, com até 2 casas.');
    expect(erroDoPerfil({ ...p, pis_cst: '1' }, 1)).toBe('O CST do PIS tem 2 números.');
    expect(erroDoPerfil({ ...p, cofins_cst: '0A' }, 1)).toBe('O CST da COFINS tem 2 números.');
    expect(erroDoPerfil({ ...p, c_ativ_sn: '123' }, 1)).toBe('A atividade no Simples (cAtivSN) tem 2 números.');
    expect(erroDoPerfil({ ...p, ibs_sn_aliq: '1.23456' }, 1)).toBe('A alíquota efetiva do IBS vai de 0 a 100, com até 4 casas.');
    expect(erroDoPerfil({ ...p, cbs_sn_aliq: '100.0001' }, 1)).toBe('A alíquota efetiva da CBS vai de 0 a 100, com até 4 casas.');
    expect(erroDoPerfil({ ...normal, ibscbs_cst: '00' }, 3)).toBe('O CST do IBS/CBS tem 3 números.');
    expect(erroDoPerfil({ ...normal, ibscbs_cclass_trib: '00000A' }, 3)).toBe('A classificação do IBS/CBS (cClassTrib) tem 6 números.');
    expect(erroDoPerfil({ ...p, pis_cst: '', c_ativ_sn: '  ' }, 1)).toBeNull();
  });

  it('CST 20 barrado por ora (o perfil não tem a redução da base): frase fixa, com e sem alíquota', () => {
    const cst20 = 'O CST 20 ainda não pode ser usado no Comanda. Fale com o contador.';
    expect(erroDoPerfil({ ...normal, cst_icms: '20' }, 3)).toBe(cst20);
    expect(erroDoPerfil({ ...normal, cst_icms: '20', aliq_icms: null }, null)).toBe(cst20);
    expect(perfilValeNoRegime({ ...normal, cst_icms: '20' }, 3)).toBe(false);
  });

  it('CST_ACEITOS = os que entram no cupom agora (sem o 20, que tem a frase própria)', () => {
    expect([...CST_ACEITOS]).toEqual(['00', '40', '41', '60', '90']);
    expect(erroDoPerfil({ ...normal, cst_icms: '10' }, 3)).toBe('O CST 10 não entra no cupom.');
  });

  it('CST 00 pede a alíquota do ICMS (os outros CST não)', () => {
    expect(erroDoPerfil({ ...normal, aliq_icms: null }, 3)).toBe('Informe a alíquota do ICMS.');
    expect(erroDoPerfil({ ...normal, aliq_icms: '  ' }, null)).toBe('Informe a alíquota do ICMS.');
    expect(erroDoPerfil({ ...normal, aliq_icms: '0' }, 3)).toBeNull();
    for (const cst of ['40', '41', '90']) expect(erroDoPerfil({ ...normal, cst_icms: cst, aliq_icms: null }, 3)).toBeNull();
  });

  it('PIS/COFINS: só 04 a 09 (sem base) e 49/99 (com zeros); os que pedem alíquota ficam barrados por ora', () => {
    const barrado = 'Este CST de PIS/COFINS ainda não pode ser usado no Comanda. Fale com o contador.';
    for (const cst of ['04', '05', '06', '07', '08', '09', '49', '99']) {
      expect(erroDoPerfil({ ...p, pis_cst: cst }, 1)).toBeNull();
      expect(erroDoPerfil({ ...p, cofins_cst: cst }, 1)).toBeNull();
    }
    for (const cst of ['01', '02', '03', '50', '70', '98']) {
      expect(erroDoPerfil({ ...p, pis_cst: cst }, 1)).toBe(barrado);
      expect(erroDoPerfil({ ...p, cofins_cst: cst }, 1)).toBe(barrado);
    }
    expect(erroDoPerfil({ ...p, pis_cst: '1' }, 1)).toBe('O CST do PIS tem 2 números.');
  });

  it('códigos com espaços em volta são aparados antes de validar', () => {
    expect(erroDoPerfil({ ...p, csosn: ' 102 ', cfop: ' 5102 ' }, 1)).toBeNull();
    expect(erroDoPerfil({ ...normal, cst_icms: ' 00 ', aliq_icms: ' 18.5 ' }, 3)).toBeNull();
    expect(erroDoPerfil({ ...p, pis_cst: ' 49 ', cofins_cst: ' 04', c_ativ_sn: '01 ' }, 1)).toBeNull();
    expect(erroDoPerfil({ ...p, csosn: ' 500 ', cfop: '5102' }, 1)).toBe('O CSOSN 500 só vale com o CFOP 5.405.');
  });

  it('perfilValeNoRegime = perfil sem erro no regime', () => {
    expect(perfilValeNoRegime(p, 1)).toBe(true);
    expect(perfilValeNoRegime(normal, 3)).toBe(true);
    expect(perfilValeNoRegime(normal, 1)).toBe(false);
    expect(perfilValeNoRegime({ ...p, csosn: '103', cfop: '5405' }, 1)).toBe(false);
  });
});

describe('validação fiscal: produto pronto para o cupom', () => {
  const pronto = { ativo: true, preco_venda: '12.00', ncm: '16025000', perfil: p, nome_cupom: 'Espetinho de carne' };

  it('motivos na ordem do tipo', () => {
    expect(motivosDoProduto({ ativo: true, preco_venda: null, ncm: '2106909', perfil: null, nome_cupom: 'X' }, 1)).toEqual([
      'falta_ncm',
      'falta_perfil',
      'sem_preco',
    ]);
    expect(motivosDoProduto({ ...pronto, preco_venda: '9.90', ncm: '22030000', perfil: { ...p, csosn: '102' } }, 3)).toEqual([
      'perfil_fora_do_regime',
    ]);
    expect(motivosDoProduto(pronto, 1)).toEqual([]);
    expect(motivosDoProduto({ ...pronto, ativo: false, ncm: null }, 1)).toEqual(['falta_ncm', 'inativo']);
    expect(motivosDoProduto({ ...pronto, ativo: false, perfil: { ...p, ativo: false } }, 1)).toEqual(['inativo', 'perfil_inativo']);
  });

  it('preço: nulo, zero, menos de meio centavo, negativo ou torto = sem preço', () => {
    for (const preco_venda of [null, '0', '0.00', '0.004', '-1', '1e-8', ''])
      expect(motivosDoProduto({ ...pronto, preco_venda }, 1)).toEqual(['sem_preco']);
    expect(motivosDoProduto({ ...pronto, preco_venda: '0.005' }, 1)).toEqual([]);
  });

  it('nome no cupom fora do que a SEFAZ aceita (emoji, símbolo) ou vazio = nome_fora_do_padrao; teclado e acento passam', () => {
    for (const nome_cupom of ['Chopp 🍺', 'Feito ✓', '', '  ', null])
      expect(motivosDoProduto({ ...pronto, nome_cupom }, 1)).toEqual(['nome_fora_do_padrao']);
    for (const nome_cupom of ['\u201CEspecial\u201D \u2013 P\u00E3o', 'Cafe\u0301 & "Lager" <300>', 'Linha 1\nLinha 2'])
      expect(motivosDoProduto({ ...pronto, nome_cupom }, 1)).toEqual([]);
    expect(motivosDoProduto({ ...pronto, ncm: ' 16025000 ', nome_cupom: '🍺', ativo: false }, 1)).toEqual([
      'inativo',
      'nome_fora_do_padrao',
    ]);
  });

  it('perfil desativado esconde o regime; regime nulo não confere o perfil', () => {
    expect(motivosDoProduto({ ...pronto, perfil: { ...normal, ativo: false } }, 1)).toEqual(['perfil_inativo']);
    expect(motivosDoProduto({ ...pronto, perfil: normal }, 1)).toEqual(['perfil_fora_do_regime']);
    expect(motivosDoProduto({ ...pronto, perfil: normal }, null)).toEqual([]);
    expect(motivosDoProduto({ ...pronto, perfil: p }, null)).toEqual([]);
  });
});

describe('validação fiscal: dados do item', () => {
  it('GTIN (frase da UX §5.7)', () => {
    const frase = 'Este código de barras não confere. Confira os números (8, 12, 13 ou 14).';
    expect(erroDoItemFiscal({ gtin: '7891000315508' })).toBe(frase);
    expect(erroDoItemFiscal({ gtin: '7891000315507' })).toBeNull();
    expect(erroDoItemFiscal({ gtin: ' 7891000315507 ' })).toBeNull();
    expect(erroDoItemFiscal({ gtin: 'SEM GTIN' })).toBe(frase);
  });

  it('códigos aparados; origem nula = ausente; nome e unidade fora do que a SEFAZ aceita', () => {
    expect(erroDoItemFiscal({ ncm: ' 16025000 ', cest: ' 0300700 ' })).toBeNull();
    expect(erroDoItemFiscal({ origem: null })).toBeNull();
    expect(erroDoItemFiscal({ descricao_cupom: 'Chopp 🍺' })).toBe('O nome no cupom não confere: a SEFAZ não aceita emoji nem símbolos.');
    expect(erroDoItemFiscal({ unidade: 'C✓' })).toBe('A unidade no cupom não confere: a SEFAZ não aceita emoji nem símbolos.');
    expect(erroDoItemFiscal({ descricao_cupom: '\u201CEspecial\u201D', unidade: 'UN' })).toBeNull();
  });

  it('formatos de NCM, CEST, origem, nome e unidade', () => {
    expect(erroDoItemFiscal({ ncm: '1602.50.00' })).toBe('O NCM tem 8 números.');
    expect(erroDoItemFiscal({ ncm: '2106909' })).toBe('O NCM tem 8 números.');
    expect(erroDoItemFiscal({ cest: '0300700' })).toBeNull();
    expect(erroDoItemFiscal({ cest: '03.007.00' })).toBe('O CEST tem 7 números.');
    expect(erroDoItemFiscal({ origem: 9 })).toBe('A origem vai de 0 a 8.');
    expect(erroDoItemFiscal({ origem: 1.5 })).toBe('A origem vai de 0 a 8.');
    expect(erroDoItemFiscal({ origem: -1 })).toBe('A origem vai de 0 a 8.');
    expect(erroDoItemFiscal({ origem: 8 })).toBeNull();
    expect(erroDoItemFiscal({ descricao_cupom: 'é'.repeat(120) })).toBeNull();
    expect(erroDoItemFiscal({ descricao_cupom: 'ç'.repeat(120) })).toBeNull();
    expect(erroDoItemFiscal({ descricao_cupom: 'a'.repeat(121) })).toBe('O nome no cupom tem até 120 letras.');
    expect(erroDoItemFiscal({ unidade: 'GARRAF' })).toBeNull();
    expect(erroDoItemFiscal({ unidade: 'GARRAFA' })).toBe('A unidade no cupom tem até 6 letras.');
  });

  it('vazio = ausente; o primeiro erro na ordem dos campos', () => {
    expect(erroDoItemFiscal({})).toBeNull();
    expect(erroDoItemFiscal({ ncm: null, cest: '', gtin: '  ', descricao_cupom: undefined, unidade: ' ' })).toBeNull();
    expect(erroDoItemFiscal({ ncm: '123', cest: '1', gtin: '1' })).toBe('O NCM tem 8 números.');
    expect(erroDoItemFiscal({ ncm: '16025000', cest: '1', gtin: '1' })).toBe('O CEST tem 7 números.');
  });
});
