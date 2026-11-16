/** Os MESMOS esquemas e instruções do protótipo (src/lib/notas.functions.ts e dda.functions.ts). */

export const FORMAS_PGTO = ['boleto', 'pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'cheque', 'outros'] as const;

export const SCHEMA_NOTA = {
  type: 'object',
  additionalProperties: false,
  required: ['chave', 'numero', 'serie', 'emitente_nome', 'emitente_cnpj', 'data_emissao', 'valor_total', 'forma_pagamento', 'itens', 'parcelas'],
  properties: {
    chave: { type: ['string', 'null'], description: 'Chave de acesso de 44 dígitos, só números' },
    numero: { type: ['string', 'null'] },
    serie: { type: ['string', 'null'] },
    emitente_nome: { type: 'string' },
    emitente_cnpj: { type: ['string', 'null'], description: 'Só números' },
    data_emissao: { type: 'string', description: 'aaaa-mm-dd' },
    valor_total: { type: 'number' },
    forma_pagamento: { type: 'string', enum: [...FORMAS_PGTO] },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descricao', 'unidade', 'quantidade', 'valor_unitario', 'valor_total'],
        properties: {
          codigo: { type: ['string', 'null'] },
          descricao: { type: 'string' },
          unidade: { type: ['string', 'null'] },
          quantidade: { type: 'number' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
        },
      },
    },
    parcelas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['numero', 'vencimento', 'valor'],
        properties: { numero: { type: 'string' }, vencimento: { type: 'string', description: 'aaaa-mm-dd' }, valor: { type: 'number' } },
      },
    },
  },
};

export const INSTRUCOES_NOTA =
  'Você extrai dados de DANFE / cupom fiscal brasileiro. Leia todos os itens com quantidade, unidade, preço unitário e total. ' +
  "Identifique a forma de pagamento; se houver duplicatas/fatura com vencimentos, use 'boleto' e liste as parcelas. " +
  'Números com ponto decimal. Datas aaaa-mm-dd. Campos ausentes = null.';

const itensNota = SCHEMA_NOTA.properties.itens.items;

/** Esquema da nota com a indicação do insumo do estoque em cada item (ou a sugestão de cadastrar um novo). */
export const SCHEMA_NOTA_SUGESTAO = {
  ...SCHEMA_NOTA,
  properties: {
    ...SCHEMA_NOTA.properties,
    itens: {
      type: 'array',
      items: {
        ...itensNota,
        required: [...itensNota.required, 'insumo', 'novo_nome', 'novo_unidade', 'novo_subgrupo', 'fator'],
        properties: {
          ...itensNota.properties,
          insumo: { type: ['string', 'null'], description: 'Nome EXATO do insumo da lista, ou null se nenhum for esse produto' },
          novo_nome: { type: ['string', 'null'], description: 'Quando insumo é null: nome limpo e curto para cadastrar' },
          novo_unidade: { type: ['string', 'null'], description: 'Quando insumo é null: unidade do estoque (KG, L, UN...)' },
          novo_subgrupo: { type: ['string', 'null'], description: 'Quando insumo é null: um subgrupo da lista' },
          fator: { type: 'number', description: 'Unidades do estoque em 1 unidade da nota (CX C/12 = 12); 1 se não der para saber' },
        },
      },
    },
  },
};

export const INSTRUCOES_NOTA_SUGESTAO =
  INSTRUCOES_NOTA +
  ' Você também recebe a lista de insumos do estoque e os subgrupos existentes. Em cada item, devolva em "insumo" o nome EXATO de um item da lista, só o nome, sem a unidade entre parênteses, ' +
  'quando o produto da nota for esse insumo, e null quando não houver. Quando for null, preencha "novo_nome" (nome limpo e curto, sem marca nem embalagem quando fizer sentido), ' +
  '"novo_unidade" (KG, L, UN...) e "novo_subgrupo" (um da lista de subgrupos). "fator" = quantas unidades do estoque há em uma unidade da nota ' +
  '(ex.: "CX C/12" = 12); use 1 quando não der para saber.';

export const SCHEMA_DDA = {
  type: 'object',
  additionalProperties: false,
  required: ['boletos'],
  properties: {
    boletos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['beneficiario', 'cnpj', 'vencimento', 'valor', 'linha_digitavel'],
        properties: {
          beneficiario: { type: 'string' },
          cnpj: { type: ['string', 'null'], description: 'Só números' },
          vencimento: { type: 'string', description: 'aaaa-mm-dd' },
          valor: { type: 'number' },
          linha_digitavel: { type: ['string', 'null'], description: 'Só números' },
        },
      },
    },
  },
};

export const INSTRUCOES_DDA =
  'Você lê relatórios de DDA (Débito Direto Autorizado) de bancos brasileiros. Liste TODOS os boletos: beneficiário, CNPJ, vencimento, valor e linha digitável. Números com ponto decimal. Datas aaaa-mm-dd.';
