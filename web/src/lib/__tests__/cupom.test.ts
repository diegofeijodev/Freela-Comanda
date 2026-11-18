import { describe, expect, it } from 'vitest';
import { calcularTotais, decimal2, decimal4, precoCentavos, quantidadeValida, ratearDesconto, valorItemCentavos } from '../cupom';

const itens = [
  { quantidade: '2', precoCentavos: 1200n },
  { quantidade: '3', precoCentavos: 990n },
];
const pag = [{ tPag: '01' as const, valor: 6000n }];

describe('totais do cupom (centavos)', () => {
  it('quantidadeValida: até 4 casas, ponto, maior que zero', () => {
    expect(quantidadeValida('0,350')).toBe(false);
    expect(quantidadeValida('0')).toBe(false);
    expect(quantidadeValida('0.0000')).toBe(false);
    expect(quantidadeValida('-1')).toBe(false);
    expect(quantidadeValida('1.23456')).toBe(false);
    expect(quantidadeValida('0.350')).toBe(true);
    expect(quantidadeValida('1234567.1234')).toBe(true);
    expect(quantidadeValida('12345678')).toBe(false);
  });

  it('precoCentavos arredonda uma vez, metade para cima', () => {
    expect(precoCentavos('12.345')).toBe(1235n);
    expect(precoCentavos('12.344')).toBe(1234n);
    expect(precoCentavos('9.9')).toBe(990n);
    expect(precoCentavos('12')).toBe(1200n);
    expect(precoCentavos('0.005')).toBe(1n);
  });

  it('valorItemCentavos: quantidade com 4 casas, arredondado uma vez', () => {
    expect(valorItemCentavos('0.3335', 1000n)).toBe(334n);
    expect(valorItemCentavos('0.3334', 1000n)).toBe(333n);
    expect(valorItemCentavos('2', 1200n)).toBe(2400n);
  });

  it('ratearDesconto: piso proporcional e sobra para os maiores', () => {
    expect(ratearDesconto([2400n, 2970n], 370n)).toEqual([165n, 205n]);
    expect(ratearDesconto([100n, 100n, 100n], 2n)).toEqual([1n, 1n, 0n]);
    expect(ratearDesconto([100n, 100n], 0n)).toEqual([0n, 0n]);
  });

  it('calcularTotais: produtos, desconto, total e troco', () => {
    const t = calcularTotais(itens, 370n, pag);
    expect(t).toMatchObject({ produtos: 5370n, desconto: 370n, total: 5000n, troco: 1000n });
    expect(t).toMatchObject({ itens: [{ bruto: 2400n, desconto: 165n }, { bruto: 2970n, desconto: 205n }] });
  });

  it('calcularTotais: erros na ordem do contrato', () => {
    expect(calcularTotais([], 0n, pag)).toEqual({ erro: 'SEM_ITENS' });
    expect(calcularTotais(itens, 5370n, pag)).toEqual({ erro: 'DESCONTO_INVALIDO' });
    expect(calcularTotais([{ quantidade: '1', precoCentavos: 20_000_000n }], 0n, pag)).toEqual({ erro: 'VALOR_MAXIMO' });
    expect(calcularTotais(itens, 0n, [{ tPag: '01', valor: 5000n }])).toEqual({ erro: 'PAGAMENTO_INSUFICIENTE' });
    expect(calcularTotais(itens, 0n, [{ tPag: '17', valor: 6000n }])).toEqual({ erro: 'TROCO_INVALIDO' });
    expect(calcularTotais(itens, 0n, [{ tPag: '01', valor: 1000n }, { tPag: '17', valor: 5500n }])).toEqual({ erro: 'TROCO_INVALIDO' });
  });

  it('decimal2 e decimal4', () => {
    expect(decimal2(2400n)).toBe('24.00');
    expect(decimal2(5n)).toBe('0.05');
    expect(decimal4('2')).toBe('2.0000');
    expect(decimal4('0.35')).toBe('0.3500');
  });
});

// ===================================================================================================== regras da tela (Tarefa 14)
import type { SituacaoCupomFiscal } from '../erp-api';
import {
  atalhosDinheiro,
  buscarProdutos,
  caixaDoCupom,
  caixaDoTopo,
  chaveEmBlocos,
  dataHoraDanfe,
  depoisDoEnvio,
  desfechoDoErro,
  linhasDosPagamentos,
  linkDoAtalho,
  toqueNoBotao,
  novaChaveIdempotencia,
  valorDanfe,
  vendaDoCupom,
  centavosDaTela,
  erroDocumento,
  erroQuantidade,
  falhaIncerta,
  linhaPrazoCancelar,
  linhasConferir,
  mascaraCnpj,
  mascaraCpf,
  pagamentosDaTela,
  quantidadeDaTela,
  quantidadeParaTela,
  reais,
  rotuloBotaoEmitir,
  somarQuantidade,
  tagDoCupom,
  TAG_MOTIVO,
  toastDaConsulta,
  type EstadoEmitir,
} from '../cupom';
import { qrSvg } from '../qrcode';

const vazio: EstadoEmitir = {
  itens: 0,
  produtosComAviso: false,
  formaEscolhida: false,
  falta: 0n,
  pagamentoComErro: false,
  documento: { tipo: 'cpf', erro: false },
  bloqueio: null,
};
const pronto: EstadoEmitir = { ...vazio, itens: 2, formaEscolhida: true };

describe('tela do cupom: dinheiro, quantidade e botão', () => {
  it('atalhosDinheiro: os 2 primeiros diferentes entre o próximo múltiplo de 10, 50 e 100 acima do total', () => {
    expect(atalhosDinheiro(5370n)).toEqual([6000n, 10000n]);
    expect(atalhosDinheiro(4730n)).toEqual([5000n, 10000n]);
    expect(atalhosDinheiro(5000n)).toEqual([6000n, 10000n]);
    expect(atalhosDinheiro(9500n)).toEqual([10000n]);
    expect(atalhosDinheiro(12345n)).toEqual([13000n, 15000n]);
  });

  it('quantidadeDaTela troca a vírgula por ponto; quantidadeParaTela volta', () => {
    expect(quantidadeDaTela('0,350')).toBe('0.350');
    expect(quantidadeDaTela(' 2 ')).toBe('2');
    expect(quantidadeParaTela('2.0000')).toBe('2');
    expect(quantidadeParaTela('0.3500')).toBe('0,35');
  });

  it('somarQuantidade e erroQuantidade', () => {
    expect(somarQuantidade('2', 1)).toBe('3');
    expect(somarQuantidade('0,350', 1)).toBe('1,35');
    expect(somarQuantidade('3', -1)).toBe('2');
    expect(somarQuantidade('1', -1)).toBe('1');
    expect(erroQuantidade('0,350')).toBeNull();
    expect(erroQuantidade('0')).toBe('A quantidade tem de ser maior que zero.');
    expect(erroQuantidade('')).toBe('A quantidade tem de ser maior que zero.');
    expect(erroQuantidade('1,23456')).toBe('Use até 4 casas depois da vírgula.');
  });

  it('reais e centavosDaTela', () => {
    expect(reais(1000n)).toBe('R$ 10,00');
    expect(reais(123456789n)).toBe('R$ 1.234.567,89');
    expect(centavosDaTela('60')).toBe(6000n);
    expect(centavosDaTela('60,5')).toBe(6050n);
    expect(centavosDaTela('1.234,56')).toBe(123456n);
    expect(centavosDaTela('60.25')).toBe(6025n);
    expect(centavosDaTela('R$ 10,00')).toBe(1000n);
    expect(centavosDaTela('  ')).toBe('vazio');
    expect(centavosDaTela('abc')).toBe('invalido');
    expect(centavosDaTela('1,234')).toBe('invalido');
  });

  it('rotuloBotaoEmitir diz o que falta, na ordem da UX 2.5', () => {
    expect(rotuloBotaoEmitir({ ...vazio })).toEqual({ rotulo: 'Adicione um produto', alvo: 'busca' });
    expect(rotuloBotaoEmitir({ ...pronto, produtosComAviso: true })).toEqual({ rotulo: 'Confira os produtos', alvo: 'produtos' });
    expect(rotuloBotaoEmitir({ ...pronto, formaEscolhida: false })).toEqual({ rotulo: 'Escolha o pagamento', alvo: 'pagamento' });
    expect(rotuloBotaoEmitir({ ...pronto, falta: 1000n })).toEqual({ rotulo: 'Falta R$ 10,00', alvo: 'pagamento' });
    expect(rotuloBotaoEmitir({ ...pronto, documento: { tipo: 'cpf', erro: true } })).toEqual({ rotulo: 'Confira o CPF', alvo: 'documento' });
    expect(rotuloBotaoEmitir({ ...pronto, documento: { tipo: 'cnpj', erro: true } })).toEqual({ rotulo: 'Confira o CNPJ', alvo: 'documento' });
    expect(rotuloBotaoEmitir({ ...pronto, bloqueio: 'Envio volta às 15h10' })).toEqual({ rotulo: 'Envio volta às 15h10', alvo: 'topo' });
    expect(rotuloBotaoEmitir(pronto)).toEqual({ rotulo: 'Conferir e emitir', alvo: 'conferir' });
  });

  it('qrSvg desenha o QR em SVG', () => {
    const svg = qrSvg('https://x/?p=1');
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('fill="black"');
  });
});

describe('tela do cupom: pagamento e documento', () => {
  it('uma forma sem ser dinheiro paga o total', () => {
    const p = pagamentosDaTela(5000n, [{ tPag: '17', valor: '' }]);
    expect(p).toMatchObject({ falta: 0n, troco: 0n, erros: [null], pagamentos: [{ tPag: '17', valor: 5000n }] });
  });

  it('dinheiro: vazio = valor certo; acima = troco; abaixo = falta com a frase', () => {
    expect(pagamentosDaTela(5370n, [{ tPag: '01', valor: '' }])).toMatchObject({ falta: 0n, troco: 0n, pagamentos: [{ valor: 5370n }] });
    expect(pagamentosDaTela(5370n, [{ tPag: '01', valor: '60' }])).toMatchObject({ troco: 630n, pagamentos: [{ valor: 6000n }] });
    const abaixo = pagamentosDaTela(5000n, [{ tPag: '01', valor: '42,70' }]);
    expect(abaixo.falta).toBe(730n);
    expect(abaixo.erros[0]).toBe('Falta R$ 7,30. Receba o resto em outra forma ou corrija o valor.');
  });

  it('duas formas: a linha automática fica com o que falta; PIX acima do que falta = erro', () => {
    const p = pagamentosDaTela(5000n, [{ tPag: '17', valor: '20' }, { tPag: '01', valor: '', auto: true }]);
    expect(p).toMatchObject({ falta: 0n, valores: [2000n, 3000n], pagamentos: [{ tPag: '17', valor: 2000n }, { tPag: '01', valor: 3000n }] });
    const falta = pagamentosDaTela(5000n, [{ tPag: '17', valor: '20' }, { tPag: '04', valor: '20' }]);
    expect(falta.falta).toBe(1000n);
    const acima = pagamentosDaTela(5000n, [{ tPag: '01', valor: '10' }, { tPag: '17', valor: '55' }]);
    expect(acima.erros[1]).toBe('No PIX, o valor não pode passar do que falta pagar (R$ 50,00). Troco só em dinheiro.');
    expect(acima.erro).toBe(true);
  });

  it('mascaraCpf, mascaraCnpj e erroDocumento', () => {
    expect(mascaraCpf('52998224725')).toBe('529.982.247-25');
    expect(mascaraCpf('5299')).toBe('529.9');
    expect(mascaraCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(erroDocumento('cpf', '529.982.247', false)).toBe('Faltam números no CPF (são 11).');
    expect(erroDocumento('cpf', '529.982.247-24', false)).toBe('Este CPF não confere. Confira os números.');
    expect(erroDocumento('cpf', '529.982.247-25', false)).toBeNull();
    expect(erroDocumento('cnpj', '12.345.678/0001-00', false)).toBe('Este CNPJ não confere. Confira os 14 caracteres.');
    expect(erroDocumento('cnpj', '11.222.333/0001-81', false)).toBeNull();
    expect(erroDocumento('cpf', '', false)).toBeNull();
    expect(erroDocumento('cpf', '', true)).toBe('Acima de R$ 10.000,00, o CPF ou CNPJ é obrigatório.');
  });

  it('falhaIncerta: sem resposta, 502/504 e corpo sem código = "não sei se saiu"; erro da API = antes do envio', () => {
    expect(falhaIncerta(null, 'SEM_CONEXAO')).toBe(true);
    expect(falhaIncerta(502, null)).toBe(true);
    expect(falhaIncerta(504, null)).toBe(true);
    expect(falhaIncerta(500, 'INTERNAL_ERROR')).toBe(true);
    expect(falhaIncerta(422, 'NFCE_ITEM_INDISPONIVEL')).toBe(false);
    expect(falhaIncerta(409, 'NFCE_TOTAL_MUDOU')).toBe(false);
    expect(falhaIncerta(503, 'NFCE_DESLIGADA')).toBe(false);
  });
});

describe('tela do cupom: busca, conferir, situação e prazo', () => {
  const p = (nome: string, extra: Partial<Parameters<typeof buscarProdutos>[0][number]> = {}) => ({
    item_cardapio_id: nome,
    nome,
    categoria: 'Geral',
    preco_venda_centavos: 990,
    ativo: true,
    gtin: null,
    descricao_cupom: null,
    pronto: true,
    motivos: [],
    ...extra,
  });
  const lista = [
    p('Chopp 300 ml'),
    p('Chá gelado'),
    p('Chopp 1 litro', { pronto: false, motivos: ['falta_ncm'] }),
    p('Água', { gtin: '7891234567895' }),
    p('Chopp antigo', { ativo: false }),
  ];

  it('buscarProdutos: sem acento e sem maiúscula, GTIN completo, os que não entram à parte', () => {
    const r = buscarProdutos(lista, 'CHA');
    expect(r.prontos.map((x) => x.nome)).toEqual(['Chá gelado']);
    const c = buscarProdutos(lista, 'cho');
    expect(c.prontos.map((x) => x.nome)).toEqual(['Chopp 300 ml']);
    expect(c.fora.map((x) => x.nome)).toEqual(['Chopp 1 litro']);
    expect(buscarProdutos(lista, '7891234567895').prontos.map((x) => x.nome)).toEqual(['Água']);
    expect(buscarProdutos(lista, '').prontos).toEqual([]);
  });

  it('buscarProdutos: até 8 e o resto contado', () => {
    const muitos = Array.from({ length: 11 }, (_, i) => p(`Espeto ${i + 1}`));
    const r = buscarProdutos(muitos, 'esp');
    expect(r.prontos).toHaveLength(8);
    expect(r.mais).toBe(3);
  });

  it('TAG_MOTIVO: as palavras da tag, com "Nome com emoji ou símbolo"', () => {
    expect(TAG_MOTIVO.falta_ncm).toBe('Falta NCM');
    expect(TAG_MOTIVO.falta_perfil).toBe('Falta perfil fiscal');
    expect(TAG_MOTIVO.nome_fora_do_padrao).toBe('Nome com emoji ou símbolo');
  });

  it('linhasConferir: mais de 5 produtos = os 4 primeiros + "e mais N produtos"', () => {
    const itens = Array.from({ length: 7 }, (_, i) => ({ nome: `P${i}`, quantidade: '1', valor: 100n }));
    const r = linhasConferir(itens);
    expect(r.linhas).toHaveLength(4);
    expect(r.resto).toBe('e mais 3 produtos');
    expect(linhasConferir(itens.slice(0, 5)).linhas).toHaveLength(5);
    expect(linhasConferir([{ nome: 'Espetinho de carne', quantidade: '2', valor: 2400n }]).linhas[0]).toEqual({
      texto: '2 × Espetinho de carne',
      valor: 'R$ 24,00',
    });
  });

  it('tagDoCupom: ícone + texto de cada situação', () => {
    expect(tagDoCupom('autorizado')).toEqual({ tom: 'ok', icone: 'ok', texto: 'Autorizado' });
    expect(tagDoCupom('sem_resposta')).toEqual({ tom: 'warn', icone: 'alerta', texto: 'Sem resposta da SEFAZ' });
    expect(tagDoCupom('denegado')).toEqual({ tom: 'bad', icone: 'ban', texto: 'Uso negado' });
    expect(tagDoCupom('enviando').icone).toBe('carregando');
  });

  it('linhaPrazoCancelar: curto na página, longo no diálogo, âmbar nos 5 min, fim', () => {
    const ate = '2026-11-17T17:34:00.000Z'; // 14h34 em Brasília
    expect(linhaPrazoCancelar(ate, new Date('2026-11-17T17:07:00.000Z'), 'curto')).toEqual({
      texto: 'Dá para cancelar até 14h34 (faltam 27 min)',
      perto: false,
      acabou: false,
    });
    expect(linhaPrazoCancelar(ate, new Date('2026-11-17T17:11:00.000Z'), 'longo').texto).toBe(
      'Dá para cancelar até 14h34 (faltam 23 minutos).',
    );
    expect(linhaPrazoCancelar(ate, new Date('2026-11-17T17:30:00.000Z'), 'longo')).toEqual({
      texto: 'Faltam 4 minutos para o prazo.',
      perto: true,
      acabou: false,
    });
    expect(linhaPrazoCancelar(ate, new Date('2026-11-17T17:34:01.000Z'), 'curto')).toEqual({
      texto: 'O prazo para cancelar terminou às 14h34.',
      perto: false,
      acabou: true,
    });
  });

  it('caixaDoCupom: textos da UX 3.1', () => {
    const base = {
      numero: 12,
      dh_emi: '2026-11-17T17:05:00.000Z',
      autorizada_em: null,
      n_prot: null,
      cancelado_em: null,
      cancelamento_motivo: null,
      descartado_em: null,
      descarte_motivo: null,
      numero_reaproveitavel: true,
      c_stat: null,
      x_motivo: null,
      recusa: null,
      mensagem: null,
    };
    expect(caixaDoCupom({ ...base, situacao: 'enviando' }).textos).toEqual(['Enviado à SEFAZ às 14h05. Esperando a resposta.']);
    expect(caixaDoCupom({ ...base, situacao: 'sem_resposta' }).textos).toEqual([
      'A SEFAZ não respondeu. O cupom pode ter sido autorizado. Consulte antes de qualquer outra coisa e não emita outro cupom para esta venda até lá.',
    ]);
    expect(
      caixaDoCupom({ ...base, situacao: 'autorizado', autorizada_em: '2026-11-17T17:05:00.000Z', n_prot: '135260000000012' }).textos,
    ).toEqual(['Autorizado às 14h05 · protocolo 135260000000012']);
    expect(
      caixaDoCupom({ ...base, situacao: 'cancelado', cancelado_em: '2026-11-17T17:20:00.000Z', cancelamento_motivo: 'Cliente desistiu da compra.' })
        .textos,
    ).toEqual(['Cancelado às 14h20. Motivo: Cliente desistiu da compra.']);
    expect(
      caixaDoCupom({ ...base, situacao: 'descartado', descartado_em: '2026-11-17T17:30:00.000Z', descarte_motivo: 'Emiti por engano' }).textos,
    ).toEqual(['Descartado em 17/11 às 14h30. Motivo: Emiti por engano. O número 12 vai para o próximo cupom.']);
    expect(
      caixaDoCupom({ ...base, situacao: 'descartado', numero_reaproveitavel: false, descartado_em: '2026-11-17T17:30:00.000Z', descarte_motivo: 'x' })
        .textos[0],
    ).toMatch(/O número 12 não volta a ser usado\.$/);
    const rec = caixaDoCupom({
      ...base,
      situacao: 'rejeitado',
      recusa: { codigo: 386, familia: 'produto', frase: 'A SEFAZ recusou um dado fiscal…', x_motivo: 'NCM inexistente' },
    });
    expect(rec).toMatchObject({ tom: 'bad', textos: ['A SEFAZ recusou um dado fiscal…'], detalhe: { codigo: 386, texto: 'NCM inexistente' } });
  });

  it('toastDaConsulta: uma frase por resultado', () => {
    const d = (situacao: Parameters<typeof toastDaConsulta>[1]['situacao'], extra = {}) => ({
      situacao,
      recusa: null,
      consultar_a_partir_de: null,
      ...extra,
    });
    expect(toastDaConsulta('sem_resposta', d('autorizado'))).toBe('A SEFAZ autorizou este cupom.');
    expect(toastDaConsulta('sem_resposta', d('nao_consta'))).toBe('A SEFAZ não tem este cupom.');
    expect(toastDaConsulta('sem_resposta', d('denegado'))).toBe('A SEFAZ negou o uso deste cupom.');
    expect(toastDaConsulta('cancelando', d('cancelado'))).toBe('Cancelamento registrado na SEFAZ.');
    expect(toastDaConsulta('cancelando', d('autorizado'))).toBe('O cancelamento não entrou na SEFAZ; o cupom continua valendo.');
    expect(
      toastDaConsulta(
        'sem_resposta',
        d('sem_resposta', { recusa: { codigo: 204, familia: 'outra', frase: '', x_motivo: '' }, consultar_a_partir_de: '2026-11-17T17:09:00.000Z' }),
      ),
    ).toBe('O cupom continua sem resposta (código 204). Tente de novo às 14h09.');
  });
});

describe('tela do cupom: caixa do topo e venda refeita', () => {
  const sit = (extra: Partial<SituacaoCupomFiscal> = {}): SituacaoCupomFiscal => ({
    ambiente: 'homologacao',
    agora: '2026-11-17T17:00:00.000Z',
    emissao_ligada: true,
    situacao: 'ok',
    mensagem: null,
    bloqueado_ate: null,
    serie: 2,
    proximo_numero: 12,
    falta: [],
    certificado: { ok: true, mensagem: null },
    pendentes: { total: 0, primeiro: null },
    ...extra,
  });
  const agora = new Date('2026-11-17T17:00:00.000Z');

  it('caixaDoTopo: a 1ª linha que se aplica (UX 2.1)', () => {
    expect(caixaDoTopo(sit({ ambiente: 'desligado' }), agora)).toEqual({ linha: 1, formulario: false });
    expect(caixaDoTopo(sit({ falta: [{ codigo: 'ie', texto: 'Inscrição estadual' }] }), agora)).toMatchObject({ linha: 2 });
    expect(caixaDoTopo(sit({ emissao_ligada: false }), agora)).toMatchObject({ linha: 3, formulario: false });
    expect(caixaDoTopo(sit({ emissao_ligada: false, situacao: 'parada_656', mensagem: 'Bloqueou duas vezes.' }), agora)).toMatchObject({
      linha: 4,
      formulario: true,
      texto: 'Bloqueou duas vezes.',
      link: null,
      botao: 'A emissão parou',
    });
    expect(
      caixaDoTopo(sit({ falta: [{ codigo: 'certificado', texto: 'x' }], certificado: { ok: false, mensagem: 'Certificado vencido.' } }), agora),
    ).toMatchObject({ linha: 5, botao: 'Confira o certificado', texto: 'Certificado vencido.' });
    expect(caixaDoTopo(sit({ bloqueado_ate: '2026-11-17T18:10:00.000Z' }), agora)).toMatchObject({
      linha: 6,
      tom: 'warn',
      botao: 'Envio volta às 15h10',
      texto:
        'A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as 15h10.',
    });
    expect(caixaDoTopo(sit({ bloqueado_ate: '2026-11-17T16:10:00.000Z' }), agora)).toBeNull();
    expect(caixaDoTopo(sit(), agora)).toBeNull();
  });

  it('vendaDoCupom e linhasDosPagamentos: a venda volta para a aba Emitir', () => {
    const v = vendaDoCupom({
      itens: [
        {
          n_item: 1,
          item_cardapio_id: 'a',
          nome_cardapio: 'Picanha',
          x_prod: 'PICANHA',
          unidade: 'KG',
          quantidade: '0.3500',
          valor_unitario_centavos: 1,
          valor_bruto_centavos: 1,
          valor_desconto_centavos: 0,
          perfil_nome: 'x',
        },
      ],
      valor_desconto_centavos: 370,
      pagamentos: [{ t_pag: '01', valor_centavos: 6000 }],
      consumidor_doc: null,
    });
    expect(v.itens[0]).toEqual({ item_cardapio_id: 'a', nome: 'Picanha', quantidade: '0,35' });
    expect(linhasDosPagamentos(v.pagamentos)).toEqual([{ tPag: '01', valor: '60,00' }]);
    expect(linhasDosPagamentos([{ t_pag: '17', valor_centavos: 5000 }])).toEqual([{ tPag: '17', valor: '' }]);
    expect(linhasDosPagamentos([{ t_pag: '17', valor_centavos: 2000 }, { t_pag: '01', valor_centavos: 3000 }])).toEqual([
      { tPag: '17', valor: '20,00' },
      { tPag: '01', valor: '30,00' },
    ]);
  });

  it('valores do DANFE pelo texto do XML', () => {
    expect(valorDanfe('24.00')).toBe('24,00');
    expect(valorDanfe('1234.56')).toBe('1.234,56');
    expect(dataHoraDanfe('2026-11-17T14:05:31-03:00')).toBe('17/11/2026 14:05:31');
    expect(chaveEmBlocos('35261112345678000195650020000000121012345678')).toBe(
      '3526 1112 3456 7800 0195 6500 2000 0000 1210 1234 5678',
    );
    expect(novaChaveIdempotencia()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('rodada de correção 1: trava e chave da venda (I1) e o atalho do servidor (I2)', () => {
  const travada = { chave: 'chave-1', travada: true };
  const solta = { chave: 'chave-1', travada: false };
  const nova = () => 'chave-2';

  it('incerta → erro definitivo (4xx com código ou 503) destrava, com a MESMA chave', () => {
    expect(depoisDoEnvio(travada, desfechoDoErro(422, 'NFCE_ITEM_INDISPONIVEL'), nova)).toEqual(solta);
    expect(depoisDoEnvio(travada, desfechoDoErro(409, 'NFCE_TOTAL_MUDOU'), nova)).toEqual(solta);
    expect(depoisDoEnvio(travada, desfechoDoErro(503, 'NFCE_DESLIGADA'), nova)).toEqual(solta);
  });

  it('incerta → rede de novo (ou a leitura pela chave falhou) continua travada, com a MESMA chave', () => {
    expect(depoisDoEnvio(travada, desfechoDoErro(null, 'SEM_CONEXAO'), nova)).toEqual(travada);
    expect(depoisDoEnvio(travada, desfechoDoErro(504, null), nova)).toEqual(travada);
    expect(depoisDoEnvio(solta, 'incerta', nova)).toEqual(travada);
  });

  it('a leitura pela chave voltou [] ("Nada foi emitido") destrava com a MESMA chave', () => {
    expect(depoisDoEnvio(travada, 'nada', nova)).toEqual(solta);
  });

  it('resposta com cupom: a chave nova é da próxima venda; nenhum outro desfecho troca a chave', () => {
    expect(depoisDoEnvio(travada, 'cupom', nova)).toEqual({ chave: 'chave-2', travada: false });
    expect(depoisDoEnvio(solta, 'cupom', nova)).toEqual({ chave: 'chave-2', travada: false });
    for (const d of ['erro', 'incerta', 'nada'] as const) expect(depoisDoEnvio(travada, d, nova).chave).toBe('chave-1');
  });

  it('o botão só reabre o "não sei se saiu" com a venda travada; fora disso segue o alvo', () => {
    expect(toqueNoBotao(true, 'produtos')).toBe('reabrir');
    expect(toqueNoBotao(true, 'conferir')).toBe('reabrir');
    expect(toqueNoBotao(false, 'produtos')).toBe('produtos');
    expect(toqueNoBotao(false, 'conferir')).toBe('conferir');
  });

  it('linkDoAtalho: só o atalho que o servidor manda (sem tabela de códigos na tela)', () => {
    expect(linkDoAtalho('produtos', 'c1')).toEqual({ rotulo: 'Corrigir os produtos', href: '/cupom?aba=produtos&cupom=c1', primario: true });
    expect(linkDoAtalho('certificado', 'c1')).toEqual({
      rotulo: 'Ir para o certificado',
      href: '/configuracoes#certificado-digital',
      primario: false,
    });
    expect(linkDoAtalho('csc', 'c1')).toEqual({ rotulo: 'Ir para Configurações', href: '/configuracoes?aba=cupom', primario: false });
    expect(linkDoAtalho('empresa', 'c1')).toEqual({ rotulo: 'Ir para Configurações', href: '/configuracoes?aba=cupom', primario: false });
    expect(linkDoAtalho('serie', 'c1')).toEqual({ rotulo: 'Trocar a série', href: '/configuracoes?aba=cupom', primario: false });
    expect(linkDoAtalho(null, 'c1')).toBeNull();
  });
});

// ======================================================================================================= Tarefa 15 (telas do cupom)
import type { CupomLinha, PerfilFiscal, ProdutoCupom } from '../erp-api';
import {
  alvoDaFalta, avisoTrocaRegime, botaoDaEmissao, documentoNaLista, errosDoPerfil, filtrarProdutos, formDoPerfil, formDoProduto,
  intervaloDoPeriodo, linhaCscGuardado, linhaCupomDaFicha, linhaDoPerfil, linhasHistoricoCupom, linkPendentes, mascaraCep, mascaraCest, mascaraIe, mascaraNcm,
  mesesDoContador, mesPadraoContador, motivoCfopFora, nomeDoMes, ordenarFalta, perfilParaSalvar, periodoDoArquivo, produtoParaSalvar,
  proximaAcao, quandoNaLista, tagDaEmissao, textoAvisoImportacao, textoPendentes, textoVendasPendentes,
} from '../cupom';

describe('Tarefa 15: faixa de pendentes, importação e inventário', () => {
  it('textoPendentes: nenhum = null; um de cada tipo; vários', () => {
    expect(textoPendentes({ total: 0, primeiro: null })).toBeNull();
    expect(textoPendentes({ total: 1, primeiro: { serie: 2, numero: 12, tipo: 'sem_resposta' } })).toBe(
      '1 cupom ficou sem resposta da SEFAZ. Consulte antes de emitir outro para a mesma venda.',
    );
    expect(textoPendentes({ total: 1, primeiro: { serie: 2, numero: 11, tipo: 'nao_saiu' } })).toBe(
      'O cupom nº 11 não saiu. Envie de novo ou descarte.',
    );
    expect(textoPendentes({ total: 1, primeiro: { serie: 2, numero: 11, tipo: 'recusado' } })).toBe(
      'O cupom nº 11 não saiu. Envie de novo ou descarte.',
    );
    expect(textoPendentes({ total: 1, primeiro: { serie: 2, numero: 9, tipo: 'venda_pendente' } })).toBe(
      'O cupom nº 9 está autorizado, mas a venda não baixou o estoque.',
    );
    expect(textoPendentes({ total: 3, primeiro: { serie: 2, numero: 9, tipo: 'venda_pendente' } })).toBe('3 cupons precisam de você.');
  });

  it('linkPendentes: um = "Ver o cupom" direto; vários = "Ver", em "Precisam de você"', () => {
    expect(linkPendentes({ total: 0, primeiro: null })).toBeNull();
    expect(linkPendentes({ total: 1, primeiro: { id: 'c1', serie: 2, numero: 11, tipo: 'recusado' } })).toEqual({
      rotulo: 'Ver o cupom',
      href: '/cupom/c1',
    });
    expect(linkPendentes({ total: 2, primeiro: { id: 'c1', serie: 2, numero: 11, tipo: 'recusado' } })).toEqual({
      rotulo: 'Ver',
      href: '/cupom?aba=emitidos&situacao=atencao',
    });
  });

  it('textoAvisoImportacao: o texto da UX 5.8; nenhum cupom = null; 1 no singular', () => {
    expect(textoAvisoImportacao({ quantidade: 4, valor_centavos: 21050 })).toBe(
      'Neste período, o Freela Comanda já lançou 4 cupons no estoque (R$ 210,50). Se essas vendas também estão neste arquivo, vão contar duas vezes.',
    );
    expect(textoAvisoImportacao({ quantidade: 0, valor_centavos: 0 })).toBeNull();
    expect(textoAvisoImportacao({ quantidade: 1, valor_centavos: 1990 })).toContain('já lançou 1 cupom no estoque (R$ 19,90)');
  });

  it('periodoDoArquivo: menor e maior data AAAA-MM-DD; as outras não contam', () => {
    expect(periodoDoArquivo(['2026-11-03', '2026-10-30', 'x', undefined, '2026-11-01'])).toEqual({ ini: '2026-10-30', fim: '2026-11-03' });
    expect(periodoDoArquivo(['', '03/11/2026'])).toBeNull();
  });

  it('textoVendasPendentes: singular e plural', () => {
    expect(textoVendasPendentes(0)).toBeNull();
    expect(textoVendasPendentes(1)).toBe('1 cupom autorizado ainda não baixou o estoque.');
    expect(textoVendasPendentes(2)).toBe('2 cupons autorizados ainda não baixaram o estoque.');
  });
});

describe('Tarefa 15: Emitidos', () => {
  const agora = new Date('2026-11-17T17:20:00Z'); // 14h20 em Brasília
  const linha = (x: Partial<CupomLinha>): CupomLinha => ({
    id: 'c1', ambiente: 'producao', serie: 2, numero: 12, chave: 'k', situacao: 'autorizado', dh_emi: '2026-11-17T17:05:00Z',
    criado_em: '2026-11-17T17:05:00Z', autorizada_em: '2026-11-17T17:05:00Z', cancelado_em: null, descartado_em: null, envios: 1,
    valor_total_centavos: 5370, pagamentos: [{ t_pag: '01', valor_centavos: 6000 }], consumidor_doc: null, venda_estoque: 'lancada',
    acoes: ['imprimir', 'consultar', 'cancelar'], consultar_a_partir_de: null, cancelar_ate: '2026-11-17T17:34:00Z', ...x,
  });

  it('proximaAcao: a linha da UX 4.1 (e some depois do prazo de cancelar)', () => {
    expect(proximaAcao(linha({}), agora)).toBe('Dá para cancelar até 14h34');
    expect(proximaAcao(linha({ acoes: ['imprimir', 'consultar'] }), new Date('2026-11-17T17:40:00Z'))).toBeNull();
    expect(proximaAcao(linha({ situacao: 'sem_resposta', acoes: ['consultar'], consultar_a_partir_de: '2026-11-17T17:07:00Z', venda_estoque: null }), agora)).toBe(
      'Consulte a partir das 14h07',
    );
    expect(proximaAcao(linha({ situacao: 'rejeitado', acoes: ['enviar_de_novo', 'consultar', 'descartar'], venda_estoque: null }), agora)).toBe(
      'Envie de novo ou descarte',
    );
    expect(proximaAcao(linha({ venda_estoque: 'pendente', acoes: ['imprimir', 'consultar', 'cancelar', 'lancar_venda'] }), agora)).toBe(
      'A venda não baixou o estoque',
    );
  });

  it('documentoNaLista: o CPF já mascarado pelo servidor fica como veio; CNPJ formatado; sem documento = —', () => {
    expect(documentoNaLista('***.982.247-**')).toBe('***.982.247-**');
    expect(documentoNaLista('12345678000195')).toBe('12.345.678/0001-95');
    expect(documentoNaLista(null)).toBe('—');
  });

  it('quandoNaLista: "Hoje às 14h05", "Ontem às …", "Em 14/11 às …"', () => {
    expect(quandoNaLista('2026-11-17T17:05:00Z', agora)).toBe('Hoje às 14h05');
    expect(quandoNaLista('2026-11-16T17:05:00Z', agora)).toBe('Ontem às 14h05');
    expect(quandoNaLista('2026-11-14T12:00:00Z', agora)).toBe('Em 14/11 às 09h00');
  });

  it('intervaloDoPeriodo: dias de Brasília (hoje, ontem, 7 dias, este mês, mês passado; virada de ano)', () => {
    expect(intervaloDoPeriodo('hoje', '2026-11-17')).toEqual({ ini: '2026-11-17', fim: '2026-11-17' });
    expect(intervaloDoPeriodo('ontem', '2026-11-01')).toEqual({ ini: '2026-10-31', fim: '2026-10-31' });
    expect(intervaloDoPeriodo('7dias', '2026-11-03')).toEqual({ ini: '2026-10-28', fim: '2026-11-03' });
    expect(intervaloDoPeriodo('mes', '2026-11-17')).toEqual({ ini: '2026-11-01', fim: '2026-11-17' });
    expect(intervaloDoPeriodo('mes_passado', '2026-01-05')).toEqual({ ini: '2025-12-01', fim: '2025-12-31' });
  });

  it('para o contador: mês passado até o dia 10, este mês depois; nome do mês', () => {
    expect(mesPadraoContador('2026-11-10')).toBe('2026-10');
    expect(mesPadraoContador('2026-11-11')).toBe('2026-11');
    expect(mesPadraoContador('2026-01-03')).toBe('2025-12');
    expect(mesesDoContador('2026-02-15', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(nomeDoMes('2026-10')).toBe('outubro/2026');
  });
});

describe('Tarefa 15: Produtos e perfis fiscais', () => {
  const produto = (x: Partial<ProdutoCupom>): ProdutoCupom => ({
    item_cardapio_id: 'p1', nome: 'Espetinho de carne', categoria: 'Espetos', unidade_venda: 'UN', preco_venda_centavos: 1200, ativo: true,
    ncm: '16025000', cest: null, gtin: null, origem: 0, descricao_cupom: null, unidade: null, perfil_fiscal_id: 'pf1', perfil_nome: 'Prato da casa',
    pronto: true, motivos: [], ...x,
  });
  const perfil = (x: Partial<PerfilFiscal>): PerfilFiscal => ({
    id: 'pf1', nome: 'Prato da casa', cfop: '5101', csosn: '102', cst_icms: null, aliq_icms: null, pis_cst: null, cofins_cst: null,
    c_ativ_sn: null, ibs_sn_aliq: null, cbs_sn_aliq: null, ibscbs_cst: null, ibscbs_cclass_trib: null, ativo: true, produtos: 64,
    vale_no_regime: true, atualizado_por_nome: null, atualizado_em: null, ...x,
  });

  it('máscaras enquanto digita: NCM, CEST, IE e CEP', () => {
    expect(mascaraNcm('16025000')).toBe('1602.50.00');
    expect(mascaraNcm('1602')).toBe('1602');
    expect(mascaraNcm('160250')).toBe('1602.50');
    expect(mascaraCest('0300100')).toBe('03.001.00');
    expect(mascaraIe('123456789012')).toBe('123.456.789.012');
    expect(mascaraCep('13270000')).toBe('13270-000');
  });

  it('filtrarProdutos: só ativos; faltam/prontos/todos; busca sem acento; os de um cupom', () => {
    const ps = [
      produto({}),
      produto({ item_cardapio_id: 'p2', nome: 'Chopp 1 litro', categoria: 'Chopp', ncm: null, pronto: false, motivos: ['falta_ncm'] }),
      produto({ item_cardapio_id: 'p3', nome: 'Porção velha', ativo: false, pronto: false, motivos: ['inativo'] }),
    ];
    expect(filtrarProdutos(ps, { busca: '', filtro: 'faltam', categoria: null, so: null }).map((p) => p.item_cardapio_id)).toEqual(['p2']);
    expect(filtrarProdutos(ps, { busca: '', filtro: 'todos', categoria: null, so: null }).map((p) => p.item_cardapio_id)).toEqual(['p1', 'p2']);
    expect(filtrarProdutos(ps, { busca: 'CHÓPP', filtro: 'todos', categoria: null, so: null }).map((p) => p.item_cardapio_id)).toEqual(['p2']);
    expect(filtrarProdutos(ps, { busca: '', filtro: 'todos', categoria: 'Espetos', so: null }).map((p) => p.item_cardapio_id)).toEqual(['p1']);
    expect(filtrarProdutos(ps, { busca: '', filtro: 'todos', categoria: null, so: ['p3'] }).map((p) => p.item_cardapio_id)).toEqual(['p3']);
  });

  it('produtoParaSalvar: só o que mudou, sem máscara, "" = null (o perfil igual não vai)', () => {
    const p = produto({});
    const f = formDoProduto(p);
    expect(f.ncm).toBe('1602.50.00');
    expect(produtoParaSalvar(p, f)).toEqual({});
    expect(produtoParaSalvar(p, { ...f, ncm: ' 2004.10.00 ', descricao_cupom: '  Espeto  ', gtin: '' })).toEqual({
      ncm: '20041000',
      descricao_cupom: 'Espeto',
    });
    expect(produtoParaSalvar(p, { ...f, perfil_fiscal_id: '' })).toEqual({ perfil_fiscal_id: null });
  });

  it('CFOP desabilitado pelo código do imposto, com o motivo', () => {
    expect(motivoCfopFora('5101', { csosn: '500', cst_icms: null })).toBe('O CSOSN 500 só vale com o CFOP 5.405.');
    expect(motivoCfopFora('5405', { csosn: '500', cst_icms: null })).toBeNull();
    expect(motivoCfopFora('5405', { csosn: '102', cst_icms: null })).toBe(
      'O CSOSN 102 só vale com o tipo de venda (CFOP) 5.101, 5.102, 5.103, 5.104 ou 5.115.',
    );
    expect(motivoCfopFora('5101', { csosn: null, cst_icms: '60' })).toBe('O CST 60 só vale com o tipo de venda (CFOP) 5.405.');
    expect(motivoCfopFora('5101', { csosn: null, cst_icms: '00' })).toBeNull();
  });

  it('errosDoPerfil: o regime decide o código; CST 00 pede alíquota; formatos', () => {
    const vazio = formDoPerfil(null);
    expect(errosDoPerfil(vazio, 1)).toMatchObject({ nome: 'Dê um nome ao perfil.', csosn: 'No Simples, escolha o CSOSN.' });
    expect(errosDoPerfil(vazio, 3)).toMatchObject({ cst_icms: 'No regime normal, escolha o CST.' });
    expect(errosDoPerfil({ ...vazio, nome: 'X', cst_icms: '00', cfop: '5101' }, 3)).toEqual({ aliq_icms: 'Informe a alíquota do ICMS.' });
    expect(errosDoPerfil({ ...vazio, nome: 'X', cst_icms: '00', cfop: '5101', aliq_icms: '101' }, 3)).toEqual({
      aliq_icms: 'Use um número de 0 a 100, com até 2 casas.',
    });
    expect(errosDoPerfil({ ...vazio, nome: 'X', csosn: '500', cfop: '5101' }, 1)).toEqual({ cfop: 'O CSOSN 500 só vale com o CFOP 5.405.' });
    expect(errosDoPerfil({ ...vazio, nome: 'X', csosn: '102', cfop: '5101', c_ativ_sn: '1' }, 1)).toEqual({ c_ativ_sn: 'Use 2 números.' });
  });

  it('perfilParaSalvar: o código do outro regime vai nulo; alíquota com ponto; espaços aparados', () => {
    const f = { ...formDoPerfil(perfil({})), nome: ' Prato da casa ', cst_icms: '00', aliq_icms: '18,5' };
    expect(perfilParaSalvar(f, 1)).toMatchObject({ nome: 'Prato da casa', csosn: '102', cst_icms: null, aliq_icms: null, cfop: '5101' });
    expect(perfilParaSalvar({ ...f, csosn: '' }, 3)).toMatchObject({ csosn: null, cst_icms: '00', aliq_icms: '18.5' });
  });

  it('linhaCupomDaFicha: completa com "Editar"; incompleta diz o que falta, com "Completar" (a folha do produto)', () => {
    expect(linhaCupomDaFicha(produto({}))).toEqual({
      texto: 'Cupom fiscal: NCM 1602.50.00 · perfil Prato da casa',
      acao: 'Editar',
      href: '/cupom?aba=produtos&item=p1',
    });
    expect(linhaCupomDaFicha(produto({ ncm: null, perfil_nome: null })).texto).toBe('Cupom fiscal: faltam NCM e perfil');
    expect(linhaCupomDaFicha(produto({ perfil_nome: null }))).toMatchObject({ texto: 'Cupom fiscal: falta perfil', acao: 'Completar' });
  });

  it('linhaDoPerfil e o aviso de trocar o regime', () => {
    expect(linhaDoPerfil(perfil({}))).toBe('Prato da casa — CFOP 5.101 · CSOSN 102 · 64 produtos');
    expect(linhaDoPerfil(perfil({ csosn: null, cst_icms: '00', produtos: 1 }))).toBe('Prato da casa — CFOP 5.101 · CST 00 · 1 produto');
    const ps = [perfil({}), perfil({ id: 'b' }), perfil({ id: 'c' }), perfil({ id: 'd', ativo: false })];
    expect(avisoTrocaRegime(ps, 1, 3)).toBe(
      'Os 3 perfis fiscais usam códigos do Simples (CSOSN). No regime normal, eles deixam de valer até você trocar por CST, e os produtos desses perfis saem do cupom até lá.',
    );
    expect(avisoTrocaRegime(ps, 1, 4)).toBeNull();
    expect(avisoTrocaRegime(ps, null, 3)).toBeNull();
  });
});

describe('Tarefa 15: Configurações → Cupom fiscal', () => {
  const agora = new Date('2026-11-17T17:20:00Z');
  const s = (x: Record<string, unknown>) =>
    ({
      ambiente: 'homologacao', agora: agora.toISOString(), emissao_ligada: false, situacao: 'ok', mensagem: null, bloqueado_ate: null, serie: 2,
      proximo_numero: 1, falta: [], certificado: { ok: true, mensagem: null }, pendentes: { total: 0, primeiro: null }, ...x,
    }) as SituacaoCupomFiscal;

  it('ordenarFalta: a ordem da UX 5.1, mesmo que o servidor mande fora de ordem', () => {
    const f = [
      { codigo: 'csc', texto: 'C' },
      { codigo: 'certificado', texto: 'A' },
      { codigo: 'series_outro_sistema', texto: 'S' },
      { codigo: 'ie', texto: 'I' },
    ];
    expect(ordenarFalta(f).map((x) => x.codigo)).toEqual(['certificado', 'ie', 'csc', 'series_outro_sistema']);
  });

  it('tag e botão da emissão', () => {
    expect(tagDaEmissao(s({}), agora)).toEqual({ tom: 'muted', texto: 'Emissão desligada' });
    expect(tagDaEmissao(s({ emissao_ligada: true }), agora)).toEqual({ tom: 'ok', texto: 'Emissão ligada' });
    expect(tagDaEmissao(s({ situacao: 'parada_certificado' }), agora)).toEqual({ tom: 'bad', texto: 'Parada' });
    expect(tagDaEmissao(s({ emissao_ligada: true, bloqueado_ate: '2026-11-17T18:10:00Z' }), agora)).toEqual({ tom: 'warn', texto: 'Esperando a SEFAZ' });
    expect(botaoDaEmissao(s({ ambiente: 'desligado' }))).toBeNull();
    expect(botaoDaEmissao(s({}))).toBe('ligar');
    expect(botaoDaEmissao(s({ emissao_ligada: true }))).toBe('desligar');
    expect(botaoDaEmissao(s({ situacao: 'parada_656' }))).toBe('ligar_de_novo');
    // só a parada do 656 desliga a emissão no banco: nas outras ela segue "ligada", e a ação é ligar de novo (limpa a parada)
    expect(botaoDaEmissao(s({ emissao_ligada: true, situacao: 'parada_certificado' }))).toBe('ligar_de_novo');
  });

  it('alvoDaFalta: o campo de cada item (aba e id), ou a outra tela', () => {
    expect(alvoDaFalta('certificado', 'homologacao')).toEqual({ rotulo: 'Ir para o certificado', aba: 'geral', id: 'certificado-digital' });
    expect(alvoDaFalta('ie', 'homologacao')).toEqual({ rotulo: 'Preencher', aba: 'cupom', id: 'cupom-ie' });
    expect(alvoDaFalta('csc', 'producao')).toEqual({ rotulo: 'Preencher', aba: 'cupom', id: 'cupom-csc-producao' });
    expect(alvoDaFalta('produto_pronto', 'homologacao')).toEqual({ rotulo: 'Ver produtos', href: '/cupom?aba=produtos' });
  });

  it('histórico do ambiente e o CSC guardado (o nome do campo, nunca o valor)', () => {
    const h = [
      { evento: 'configuracao', campos: ['serie', 'csc'], mensagem: null, feito_por_nome: 'Diego', feito_em: '2026-11-18T12:10:00Z' },
      { evento: 'parada_automatica', campos: [], mensagem: 'A emissão parou.', feito_por_nome: null, feito_em: '2026-11-17T18:00:00Z' },
      { evento: 'ligada', campos: [], mensagem: null, feito_por_nome: 'Diego', feito_em: '2026-11-17T13:05:00Z' },
    ];
    expect(linhasHistoricoCupom(h)).toEqual([
      'Diego mudou a série e o código de segurança em 18/11/2026 às 09h10',
      'Parou sozinha em 17/11/2026 às 15h00: A emissão parou.',
      'Ligada por Diego em 17/11/2026 às 10h05',
    ]);
    expect(linhaCscGuardado({ csc_dica: '1234', historico: h, alterada_por_nome: 'Ana', alterada_em: '2026-11-19T12:00:00Z' })).toBe(
      'Guardado: ••••1234 (por Diego em 18/11/2026)',
    );
    expect(linhaCscGuardado({ csc_dica: null, historico: h, alterada_por_nome: null, alterada_em: null })).toBeNull();
  });
});
