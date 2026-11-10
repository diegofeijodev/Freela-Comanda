/**
 * O que o importador sabe do NOSSO banco (migrações 20261028220000_init e 20261028220100_regras), escrito à mão de propósito:
 * a carga usa só estas listas, e na hora de rodar o importador confere que o banco conectado é exatamente isto (tabelas, colunas,
 * gatilhos, nenhuma sequence). Migração nova que mexa nestas tabelas = atualizar aqui (o `esquema.spec.ts` acusa).
 */

export type Tabela = { nome: string; colunas: readonly string[] };

/** As 23 tabelas de negócio, em ordem de chave estrangeira (mãe antes da filha). Nomes e colunas iguais aos do Supabase do Lovable. */
export const TABELAS: readonly Tabela[] = [
  {
    nome: 'configuracoes',
    colunas: [
      'id',
      'nome_unidade',
      'dia_inventario',
      'tolerancia_pct',
      'tolerancia_abs_kg',
      'tolerancia_abs_un',
      'max_recontagens',
      'custo_preparo_pct',
      'margem_seguranca_pct',
      'mkup_padrao',
      'estoque_seguranca_pct',
      'semanas_media',
      'loja_pode_abrir',
      'razao_social',
      'nome_fantasia',
      'cnpj',
      'endereco',
    ],
  },
  { nome: 'sazonalidade', colunas: ['mes', 'fator_pct'] },
  { nome: 'subgrupos', colunas: ['id', 'nome', 'grupo', 'ordem'] },
  { nome: 'fornecedores', colunas: ['id', 'nome', 'contato', 'telefone', 'created_at', 'cnpj'] },
  {
    nome: 'itens_estoque',
    colunas: [
      'id',
      'codigo',
      'nome',
      'tipo',
      'subgrupo',
      'unidade',
      'preco_unitario',
      'embalagem_compra',
      'qtd_por_embalagem',
      'fornecedor',
      'consumo_semanal_manual',
      'usar_manual',
      'estoque_seguranca_pct',
      'objetivo_manual',
      'tolerancia_pct',
      'tolerancia_abs',
      'ativo',
      'created_at',
    ],
  },
  {
    nome: 'itens_cardapio',
    colunas: [
      'id',
      'codigo',
      'nome',
      'categoria',
      'grupo',
      'unidade_venda',
      'preco_venda',
      'mkup',
      'ncm',
      'cfop',
      'cst',
      'aliquota',
      'observacoes',
      'ativo',
      'created_at',
    ],
  },
  {
    nome: 'ficha_ingredientes',
    colunas: ['id', 'item_cardapio_id', 'item_estoque_id', 'quantidade', 'unidade', 'rendimento', 'observacao', 'ordem'],
  },
  { nome: 'de_para_produtos', colunas: ['produto_relatorio', 'item_cardapio_id', 'ignorar', 'updated_at'] },
  { nome: 'importacoes', colunas: ['id', 'tipo', 'arquivo', 'linhas', 'erros', 'usuario_id', 'created_at'] },
  {
    nome: 'vendas',
    colunas: [
      'id',
      'pedido',
      'data',
      'hora',
      'produto_relatorio',
      'item_cardapio_id',
      'preco_unitario',
      'quantidade',
      'desconto',
      'taxa',
      'frete',
      'valor_total',
      'importacao_id',
      'created_at',
    ],
  },
  {
    nome: 'movimentacoes',
    colunas: [
      'id',
      'data',
      'item_estoque_id',
      'tipo',
      'quantidade',
      'custo_unitario',
      'referencia',
      'venda_id',
      'usuario_id',
      'observacao',
      'created_at',
    ],
  },
  {
    nome: 'inventarios',
    colunas: ['id', 'data', 'status', 'inicial', 'aberto_por', 'fechado_por', 'fechado_em', 'created_at', 'periodicidade'],
  },
  {
    nome: 'inventario_itens',
    colunas: [
      'id',
      'inventario_id',
      'item_estoque_id',
      'teorico_snapshot',
      'contagem_1',
      'usuario_1',
      'hora_1',
      'contagem_2',
      'usuario_2',
      'hora_2',
      'contagem_3',
      'usuario_3',
      'hora_3',
      'final',
      'status',
      'justificativa',
    ],
  },
  { nome: 'listas_compra', colunas: ['id', 'inventario_id', 'data', 'mes', 'status', 'created_at'] },
  {
    nome: 'listas_compra_itens',
    colunas: [
      'id',
      'lista_id',
      'item_estoque_id',
      'descricao',
      'subgrupo',
      'fornecedor',
      'unidade',
      'embalagem',
      'qtd_por_embalagem',
      'estoque_contado',
      'objetivo',
      'pedido',
      'embalagens',
      'preco_unitario',
      'qtd_recebida',
      'preco_pago',
      'recebido',
    ],
  },
  {
    nome: 'notas_entrada',
    colunas: [
      'id',
      'chave',
      'numero',
      'serie',
      'fornecedor_nome',
      'fornecedor_cnpj',
      'data_emissao',
      'data_entrada',
      'valor_total',
      'forma_pagamento',
      'origem',
      'status',
      'observacao',
      'usuario_id',
      'created_at',
    ],
  },
  {
    nome: 'notas_entrada_itens',
    colunas: [
      'id',
      'nota_id',
      'codigo_fornecedor',
      'descricao',
      'unidade',
      'quantidade',
      'valor_unitario',
      'valor_total',
      'item_estoque_id',
      'fator',
      'ordem',
    ],
  },
  { nome: 'vinculos_produto', colunas: ['id', 'fornecedor_cnpj', 'codigo_fornecedor', 'descricao', 'item_estoque_id', 'fator'] },
  { nome: 'plano_contas', colunas: ['id', 'grupo', 'subgrupo', 'conta', 'ativo', 'created_at'] },
  { nome: 'centros_custo', colunas: ['id', 'nome', 'ativo', 'created_at'] },
  {
    nome: 'contas_pagar',
    colunas: [
      'id',
      'descricao',
      'fornecedor_nome',
      'nota_id',
      'parcela',
      'valor',
      'vencimento',
      'forma_pagamento',
      'categoria',
      'status',
      'pago_em',
      'valor_pago',
      'observacao',
      'created_at',
      'plano_conta_id',
      'centro_custo_id',
      'linha_digitavel',
      'origem_dda',
    ],
  },
  { nome: 'dre_subgrupos', colunas: ['id', 'nome', 'sigla', 'meta_pct', 'ordem', 'is_cmv', 'is_imposto'] },
  {
    nome: 'caixa_fechamentos',
    colunas: [
      'id',
      'data',
      'dinheiro',
      'debito',
      'credito',
      'pix',
      'ifood',
      'delivery_proprio',
      'cartao_alimentacao',
      'sangria',
      'sangria_cofre',
      'observacao',
      'created_at',
    ],
  },
];

/** Tabelas de contas do Lovable que viram a nossa `users` (com `auth.users`); não são carregadas como tabela. */
export const TABELAS_DE_CONTAS = ['profiles', 'user_roles'] as const;
export const COLUNAS_USERS = ['id', 'email', 'nome', 'password_hash', 'perfil', 'created_at'] as const;
/** Tabelas que só existem no nosso banco (fora da comparação com o Lovable). */
export const TABELAS_SO_NOSSAS = ['users', '_prisma_migrations'] as const;

/** A migração `regras` semeia estas três; a carga aceita exatamente esses seeds e os SUBSTITUI pelos do Lovable. */
export const TABELAS_COM_SEED = ['configuracoes', 'sazonalidade', 'subgrupos'] as const;
export const SEED_SAZONALIDADE: readonly [number, string][] = Array.from({ length: 12 }, (_, i) => [
  i + 1,
  i + 1 === 11 ? '20' : i + 1 === 12 ? '50' : '0',
]);
export const SEED_SUBGRUPOS: readonly [string, string, number][] = [
  ['Carnes e Proteínas', 'Insumos', 1],
  ['Espetinhos', 'Insumos', 2],
  ['Congelados', 'Insumos', 3],
  ['Mercearia', 'Insumos', 4],
  ['Frios, Laticínios e Ovos', 'Insumos', 5],
  ['Hortifruti', 'Insumos', 6],
  ['Padaria', 'Insumos', 7],
  ['Molhos e Sachês', 'Insumos', 8],
  ['Chopp', 'Produtos de venda', 9],
  ['Bebidas', 'Produtos de venda', 10],
];

/**
 * TODOS os gatilhos das nossas migrações e o que a carga faz com cada um. Gatilho que não estiver aqui = o importador recusa
 * (alguém criou um gatilho novo sem decidir o que ele faria durante a carga).
 */
export const GATILHOS: readonly { tabela: string; nome: string; porque: string }[] = [
  {
    tabela: 'vendas',
    nome: 'vendas_baixa_trg',
    porque:
      'desligado durante a carga e religado no fim: as baixas de estoque das vendas já vêm prontas em movimentacoes (senão dobrariam)',
  },
];

/** Colunas com id de conta SEM chave estrangeira (como no Lovable): só avisamos quando apontam para conta que não veio. */
export const COLUNAS_COM_CONTA: readonly [string, string][] = [
  ['inventarios', 'aberto_por'],
  ['inventarios', 'fechado_por'],
  ['inventario_itens', 'usuario_1'],
  ['inventario_itens', 'usuario_2'],
  ['inventario_itens', 'usuario_3'],
  ['movimentacoes', 'usuario_id'],
  ['importacoes', 'usuario_id'],
  ['notas_entrada', 'usuario_id'],
];

export type View = {
  nome: string;
  oque: string;
  chave: readonly string[];
  colunas: Readonly<Record<string, string>>;
  principal: string;
  dependeDaSemana?: boolean;
};

/** As views comparadas Lovable × nosso (resultado linha a linha, pela chave). */
export const VIEWS: readonly View[] = [
  {
    nome: 'v_saldo_teorico',
    oque: 'saldo teórico de cada insumo = último inventário fechado + movimentações depois dele',
    chave: ['item_estoque_id'],
    colunas: { item_estoque_id: 'uuid', saldo: 'numeric', data_ultimo_inventario: 'date' },
    principal: 'saldo',
  },
  {
    nome: 'v_fichas_resumo',
    oque: 'custo e preço sugerido de cada ficha = Σ(quantidade × preço do insumo) × preparo × margem × markup',
    chave: ['id'],
    colunas: {
      id: 'uuid',
      nome: 'text',
      categoria: 'text',
      codigo: 'text',
      preco_venda: 'numeric',
      mkup: 'numeric',
      custo_ingredientes: 'numeric',
      custo_preparo: 'numeric',
      custo_total: 'numeric',
      custo_margem: 'numeric',
      preco_sugerido: 'numeric',
      n_ingredientes: 'bigint',
      tem_sem_preco: 'boolean',
    },
    principal: 'preco_sugerido',
  },
  {
    nome: 'v_cmv_periodo',
    oque: 'CMV de cada insumo entre dois inventários fechados = (estoque inicial + entradas − estoque atual) × custo médio',
    chave: ['inventario_id', 'item_estoque_id'],
    colunas: {
      inventario_id: 'uuid',
      data: 'date',
      data_anterior: 'date',
      item_estoque_id: 'uuid',
      estoque_inicial: 'numeric',
      entradas: 'numeric',
      estoque_atual: 'numeric',
      consumo_qtd: 'numeric',
      custo_unit: 'numeric',
      cmv_valor: 'numeric',
    },
    principal: 'cmv_valor',
  },
  {
    nome: 'v_consumo_semanal',
    oque: 'consumo semanal de cada insumo = baixas de venda das últimas N semanas completas ÷ N',
    chave: ['item_estoque_id'],
    colunas: { item_estoque_id: 'uuid', consumo_calc: 'numeric' },
    principal: 'consumo_calc',
    dependeDaSemana: true,
  },
];

/** Casas decimais na comparação das views (as duas pontas arredondadas igual; divisão pode variar no fim entre versões do Postgres). */
export const CASAS_VIEWS = 6;
