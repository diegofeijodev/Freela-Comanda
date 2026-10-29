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
