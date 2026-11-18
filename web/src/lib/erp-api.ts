// Chamadas da API do Freela ERP — substituem as consultas `supabase.from(...)` / `rpc(...)` do protótipo, uma a uma.
// O fio é snake_case com os mesmos nomes do banco (numeric = number, date = "AAAA-MM-DD"), então os tipos espelham as tabelas.
import { isAxiosError } from 'axios';
import { api } from '@/modules/shared/infrastructure/http';
import type { AuthUser, Perfil } from '@/modules/auth/infrastructure/auth.storage';

const get = async <T>(url: string, params?: Record<string, unknown>) => (await api.get<T>(url, { params })).data;
const post = async <T>(url: string, body?: unknown) => (await api.post<T>(url, body ?? {})).data;
const patch = async <T>(url: string, body: unknown) => (await api.patch<T>(url, body)).data;
const put = async <T>(url: string, body: unknown) => (await api.put<T>(url, body)).data;
const del = async <T = { ok: true }>(url: string) => (await api.delete<T>(url)).data;

// ---------- tipos (linhas das tabelas)
export type Config = {
  id: number;
  nome_unidade: string;
  dia_inventario: number;
  tolerancia_pct: number;
  tolerancia_abs_kg: number;
  tolerancia_abs_un: number;
  max_recontagens: number;
  custo_preparo_pct: number;
  margem_seguranca_pct: number;
  mkup_padrao: number;
  estoque_seguranca_pct: number;
  semanas_media: number;
  loja_pode_abrir: boolean;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  endereco: string;
};
export type Sazonalidade = { mes: number; fator_pct: number };
export type Subgrupo = { id: string; nome: string; grupo: string; ordem: number };
export type Fornecedor = { id: string; nome: string; contato: string | null; telefone: string | null; cnpj: string | null; created_at: string };
export type ItemEstoque = {
  id: string;
  codigo: string | null;
  nome: string;
  tipo: string;
  subgrupo: string;
  unidade: string;
  preco_unitario: number | null;
  embalagem_compra: string | null;
  qtd_por_embalagem: number;
  fornecedor: string | null;
  consumo_semanal_manual: number | null;
  usar_manual: boolean;
  estoque_seguranca_pct: number | null;
  objetivo_manual: number | null;
  tolerancia_pct: number | null;
  tolerancia_abs: number | null;
  ativo: boolean;
  created_at: string;
};
export type ItemCardapio = {
  id: string;
  codigo: string | null;
  nome: string;
  categoria: string;
  grupo: string;
  unidade_venda: string;
  preco_venda: number | null;
  mkup: number | null;
  ncm: string | null;
  cfop: string | null;
  cst: string | null;
  aliquota: number | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
};
export type FichaResumo = {
  id: string;
  nome: string;
  categoria: string;
  codigo: string | null;
  preco_venda: number | null;
  mkup: number;
  custo_ingredientes: number;
  custo_preparo: number;
  custo_total: number;
  custo_margem: number;
  preco_sugerido: number;
  n_ingredientes: number;
  tem_sem_preco: boolean;
};
export type Ingrediente = {
  id: string;
  item_cardapio_id: string;
  item_estoque_id: string;
  quantidade: number;
  unidade: string | null;
  rendimento: number | null;
  observacao: string | null;
  ordem: number;
  itens_estoque: { nome: string; unidade: string; preco_unitario: number | null } | null;
};
export type FichaLoja = {
  id: string;
  nome: string;
  categoria: string;
  observacoes: string | null;
  ingredientes: { insumo: string; quantidade: number; unidade: string; observacao: string | null }[];
};
export type Venda = {
  pedido: string;
  data: string;
  hora: string | null;
  produto_relatorio: string;
  item_cardapio_id: string | null;
  quantidade: number;
  valor_total: number;
  preco_unitario: number;
};
export type Movimentacao = {
  id: string;
  data: string;
  item_estoque_id: string;
  tipo: string;
  quantidade: number;
  custo_unitario: number | null;
  referencia: string | null;
  observacao: string | null;
  created_at: string;
};
export type Saldo = { item_estoque_id: string; saldo: number; data_ultimo_inventario: string | null };
export type Inventario = {
  id: string;
  data: string;
  status: 'aberto' | 'em_contagem' | 'aguardando_aprovacao' | 'fechado';
  inicial: boolean;
  periodicidade: string;
  created_at: string;
  fechado_em: string | null;
};
export type LojaItem = {
  id: string;
  nome: string;
  unidade: string;
  embalagem: string | null;
  grupo: string;
  subgrupo: string;
  ordem: number;
  situacao: 'pendente' | 'recontar' | 'contado';
  contagens: number;
};
export type InventarioItem = {
  id: string;
  inventario_id: string;
  item_estoque_id: string;
  teorico_snapshot: number | null;
  contagem_1: number | null;
  hora_1: string | null;
  contagem_2: number | null;
  hora_2: string | null;
  contagem_3: number | null;
  hora_3: string | null;
  final: number | null;
  status: 'pendente' | 'recontar' | 'ok' | 'recontado_ok' | 'diferenca_confirmada';
  justificativa: string | null;
  itens_estoque: { nome: string; unidade: string; subgrupo: string; preco_unitario: number | null } | null;
};
export type HistoricoItem = {
  inventario_id: string;
  final: number | null;
  teorico_snapshot: number | null;
  itens_estoque: { nome: string; preco_unitario: number | null } | null;
};
export type CmvLinha = { inventario_id: string; data: string; data_anterior: string | null; item_estoque_id: string; cmv_valor: number | null };
export type Lista = { id: string; inventario_id: string | null; data: string; mes: number; status: 'gerada' | 'enviada' | 'recebida_parcial' | 'recebida'; created_at: string };
export type ItemLista = {
  id: string;
  descricao: string;
  subgrupo: string | null;
  fornecedor: string | null;
  unidade: string | null;
  embalagem: string | null;
  qtd_por_embalagem: number;
  pedido: number;
  embalagens: number;
  item_estoque_id?: string | null;
  preco_unitario?: number | null;
  qtd_recebida?: number | null;
  preco_pago?: number | null;
  recebido?: boolean;
  estoque_contado?: number | null;
  objetivo?: number | null;
};
export type Nota = {
  id: string;
  numero: string | null;
  fornecedor_nome: string;
  data_entrada: string;
  valor_total: number;
  forma_pagamento: string;
  origem: string;
  serie: string | null;
  repetida_de: string | null;
};
/** Nota já lançada que parece a mesma (igual à `NotaParecida` da API). */
export type NotaParecida = {
  id: string;
  numero: string | null;
  serie: string | null;
  fornecedor_nome: string;
  data_emissao: string;
  data_entrada: string;
  valor_total: number;
  origem: string;
  created_at: string;
};
export type Vinculo = { codigo_fornecedor: string; item_estoque_id: string; fator: number };
export type Conta = {
  id: string;
  descricao: string;
  fornecedor_nome: string | null;
  nota_id: string | null;
  parcela: string | null;
  valor: number;
  vencimento: string;
  forma_pagamento: string;
  categoria: string;
  status: string;
  pago_em: string | null;
  valor_pago: number | null;
  plano_conta_id: string | null;
  centro_custo_id: string | null;
  linha_digitavel: string | null;
  origem_dda: boolean;
};
export type PlanoConta = { id: string; grupo: string; subgrupo: string; conta: string; ativo: boolean };
export type CentroCusto = { id: string; nome: string; ativo: boolean };
export type DreSub = { id: string; nome: string; sigla: string; meta_pct: number | null; ordem: number; is_cmv: boolean; is_imposto: boolean };
export type CaixaDia = {
  id: string;
  data: string;
  dinheiro: number;
  debito: number;
  credito: number;
  pix: number;
  ifood: number;
  delivery_proprio: number;
  cartao_alimentacao: number;
  sangria: number;
  sangria_cofre: number;
};
export type Importacao = { id: string; tipo: string; arquivo: string | null; linhas: number; erros: number; created_at: string };
export type DePara = { produto_relatorio: string; item_cardapio_id: string | null; ignorar: boolean };
export type Usuario = { id: string; nome: string; email: string; perfil: Perfil | null };

// ---------- chave de IA (leitura de PDF): a chave só vai; o que volta é o provedor e os 4 últimos caracteres
export type ProvedorIa = 'anthropic' | 'openai' | 'gemini';
export type StatusIa = {
  origem: 'configuracoes' | 'servidor' | null;
  provedor: ProvedorIa | null;
  nome: string | null;
  dica: string | null;
  modelo: string | null;
  atualizado_em: string | null;
};
export const statusIa = () => get<StatusIa>('/v1/ia-chave');
export const salvarChaveIa = (provedor: ProvedorIa, chave: string) => put<StatusIa>('/v1/ia-chave', { provedor, chave });
export const removerChaveIa = () => del<StatusIa>('/v1/ia-chave');

// ---------- sugestão de insumo por IA para os itens do XML: só descrição e unidade vão; volta uma sugestão por item, na mesma ordem (a API numera e casa por posição)
export type SugestaoInsumo = { item_estoque_id: string | null; novo: { nome: string; unidade: string; subgrupo: string | null } | null; fator: number };
export const sugerirInsumosItens = async (itens: { descricao: string; unidade: string | null }[], signal?: AbortSignal) =>
  (await api.post<{ itens: SugestaoInsumo[] }>('/v1/notas/sugerir-insumos', { itens: itens.map((it) => ({ descricao: it.descricao, unidade: it.unidade })) }, { signal })).data;

// ---------- certificado digital A1 (admin). O arquivo e a senha só vão no envio e nunca voltam; datas chegam como string ISO.
export type SituacaoCertificado = 'ausente' | 'sem_segredo' | 'ilegivel' | 'vencido' | 'vencendo' | 'valido';
export type ItemHistoricoCertificado = {
  evento: 'enviado' | 'substituido' | 'removido';
  feito_por_nome: string;
  feito_em: string;
  valido_ate: string;
  cnpj: string;
  titular: string;
};
export type CertificadoStatus = {
  situacao: SituacaoCertificado;
  titular: string | null;
  cnpj: string | null;
  cnpj_confere: 'igual' | 'mesma_raiz' | 'diferente' | 'empresa_sem_cnpj' | null;
  tipo: 'A1' | 'SE-S' | 'outro' | null;
  politica_oid: string | null;
  emissor: string | null;
  valido_de: string | null;
  valido_ate: string | null;
  dias_restantes: number | null;
  cadeia_conferida: boolean | null;
  enviado_em: string | null;
  enviado_por_nome: string | null;
  historico: ItemHistoricoCertificado[];
};
export const statusCertificado = () => get<CertificadoStatus>('/v1/certificado-digital');
export const enviarCertificado = (arquivo_base64: string, senha: string) =>
  put<CertificadoStatus>('/v1/certificado-digital', { arquivo_base64, senha });
export const removerCertificado = () => del<CertificadoStatus>('/v1/certificado-digital');

// ---------- configurações e cadastros
export const getConfig = () => get<Config>('/v1/configuracoes');
export const salvarConfig = (patchConfig: Partial<Config>) => patch<Config>('/v1/configuracoes', patchConfig);
export const listarSazonalidade = () => get<Sazonalidade[]>('/v1/sazonalidade');
export const salvarSazonalidade = (mes: number, fator_pct: number) => patch<Sazonalidade>(`/v1/sazonalidade/${mes}`, { fator_pct });
export const listarSubgrupos = () => get<Subgrupo[]>('/v1/subgrupos');
export const criarSubgrupo = (s: { nome: string; grupo: string; ordem?: number }) => post<Subgrupo>('/v1/subgrupos', s);
export const excluirSubgrupo = (id: string) => del(`/v1/subgrupos/${id}`);
export const listarFornecedores = () => get<Fornecedor[]>('/v1/fornecedores');
export const criarFornecedor = (f: { nome: string; telefone?: string }) => post<Fornecedor>('/v1/fornecedores', f);
export const excluirFornecedor = (id: string) => del(`/v1/fornecedores/${id}`);
export const listarPlanoContas = (ativo?: boolean) => get<PlanoConta[]>('/v1/plano-contas', ativo ? { ativo: 'true' } : undefined);
export const criarPlanoConta = (p: { grupo: string; subgrupo?: string; conta: string }) => post<PlanoConta>('/v1/plano-contas', p);
export const importarPlanoContas = (linhas: { grupo: string; subgrupo: string; conta: string }[]) =>
  post<{ importadas: number }>('/v1/plano-contas/lote', { linhas });
export const excluirPlanoConta = (id: string) => del(`/v1/plano-contas/${id}`);
export const listarCentros = (ativo?: boolean) => get<CentroCusto[]>('/v1/centros-custo', ativo ? { ativo: 'true' } : undefined);
export const criarCentro = (nome: string) => post<CentroCusto>('/v1/centros-custo', { nome });
export const excluirCentro = (id: string) => del(`/v1/centros-custo/${id}`);
export const listarDreSubs = () => get<DreSub[]>('/v1/dre-subgrupos');
export const criarDreSub = (s: { nome: string; sigla: string; meta_pct: number | null; ordem: number }) => post<DreSub>('/v1/dre-subgrupos', s);
export const salvarDreMeta = (id: string, meta_pct: number | null) => patch<DreSub>(`/v1/dre-subgrupos/${id}`, { meta_pct });

// ---------- estoque
export const listarItensEstoque = (opts?: { ativo?: boolean; ordem?: 'nome' | 'subgrupo' }) =>
  get<ItemEstoque[]>('/v1/itens-estoque', { ...(opts?.ativo ? { ativo: 'true' } : {}), ...(opts?.ordem ? { ordem: opts.ordem } : {}) });
export const criarItemEstoque = (nome: string) => post<ItemEstoque>('/v1/itens-estoque', { nome });
export const atualizarItemEstoque = (id: string, p: Partial<ItemEstoque>) => patch<ItemEstoque>(`/v1/itens-estoque/${id}`, p);
export const excluirItemEstoque = (id: string) => del(`/v1/itens-estoque/${id}`);
export const listarSaldos = () => get<Saldo[]>('/v1/estoque/saldos');
export const listarConsumoSemanal = () => get<{ item_estoque_id: string; consumo_calc: number }[]>('/v1/estoque/consumo-semanal');
export const estoqueObjetivo = (mes: number) =>
  get<{ item_estoque_id: string; consumo_base: number | null; objetivo: number | null }[]>('/v1/estoque/objetivo', { mes });
export const listarMovimentacoes = (itemId: string) => get<Movimentacao[]>('/v1/movimentacoes', { item_estoque_id: itemId });
export const lancarMovimentacao = (m: { item_estoque_id: string; tipo: string; data: string; quantidade: number; observacao: string | null }) =>
  post<Movimentacao>('/v1/movimentacoes', m);

// ---------- cardápio / fichas
export const fichasResumo = (somenteAtivos = false) => get<FichaResumo[]>('/v1/fichas/resumo', somenteAtivos ? { ativos: 'true' } : undefined);
export const fichasLoja = () => get<FichaLoja[]>('/v1/fichas/loja');
export const listarCardapio = () => get<ItemCardapio[]>('/v1/itens-cardapio');
export const itemCardapio = (id: string) => get<ItemCardapio>(`/v1/itens-cardapio/${id}`);
export const criarItemCardapio = (nome: string) => post<{ id: string }>('/v1/itens-cardapio', { nome });
export const atualizarItemCardapio = (id: string, p: Partial<ItemCardapio>) => patch<ItemCardapio>(`/v1/itens-cardapio/${id}`, p);
export const excluirItemCardapio = (id: string) => del(`/v1/itens-cardapio/${id}`);
export const duplicarItemCardapio = (id: string) => post<{ id: string }>(`/v1/itens-cardapio/${id}/duplicar`);
export const listarIngredientes = (id: string) => get<Ingrediente[]>(`/v1/itens-cardapio/${id}/ingredientes`);
export const adicionarIngrediente = (id: string, i: { item_estoque_id: string; quantidade: number; unidade?: string | null; ordem?: number }) =>
  post<Ingrediente>(`/v1/itens-cardapio/${id}/ingredientes`, i);
export const atualizarIngrediente = (id: string, p: { quantidade?: number; rendimento?: number | null }) => patch<Ingrediente>(`/v1/ficha-ingredientes/${id}`, p);
export const removerIngrediente = (id: string) => del(`/v1/ficha-ingredientes/${id}`);

// ---------- vendas
export const listarVendas = (ini: string, fim: string) => get<Venda[]>('/v1/vendas', { ini, fim });

// ---------- inventário
export const listarInventarios = () => get<Inventario[]>('/v1/inventarios');
export const inventarioAtual = async () => (await get<{ inventario: Inventario | null }>('/v1/inventarios/atual')).inventario;
export const inventario = (id: string) => get<Inventario>(`/v1/inventarios/${id}`);
export const abrirInventario = (data: string, periodicidade = 'semanal') => post<{ id: string }>('/v1/inventarios', { data, periodicidade });
export const itensContagem = (id: string) => get<LojaItem[]>(`/v1/inventarios/${id}/contagem`);
export const registrarContagem = (itemId: string, quantidade: number) =>
  post<{ resultado: 'ok' | 'recontar' }>(`/v1/inventario-itens/${itemId}/contagem`, { quantidade });
export const itensInventarioAdmin = (id: string) => get<InventarioItem[]>(`/v1/inventarios/${id}/itens`);
export const definirFinal = (itemId: string, final: number, justificativa: string) =>
  patch<InventarioItem>(`/v1/inventario-itens/${itemId}/final`, { final, justificativa });
export const fecharInventario = (id: string) => post<{ lista_id: string }>(`/v1/inventarios/${id}/fechar`);
export const historicoInventarios = () => get<HistoricoItem[]>('/v1/inventarios/historico');
export const cmvPeriodos = () => get<CmvLinha[]>('/v1/inventarios/cmv');

// ---------- listas de compra
export const listarListas = () => get<Lista[]>('/v1/listas-compra');
export const lista = (id: string) => get<Lista>(`/v1/listas-compra/${id}`);
export const gerarLista = () => post<{ id: string }>('/v1/listas-compra/gerar');
export const itensLista = (id: string) => get<ItemLista[]>(`/v1/listas-compra/${id}/itens`);
export const atualizarItemLista = (id: string, p: { embalagens?: number; qtd_recebida?: number | null; preco_pago?: number | null }) =>
  patch<ItemLista>(`/v1/listas-compra-itens/${id}`, p);
export const removerItemLista = (id: string) => del(`/v1/listas-compra-itens/${id}`);
export const itemAvulso = (id: string, descricao: string, quantidade: number) => post<ItemLista>(`/v1/listas-compra/${id}/itens`, { descricao, quantidade });
export const marcarEnviada = (id: string) => post<Lista>(`/v1/listas-compra/${id}/enviada`);
export const receberLista = (id: string, atualizar_preco: boolean) => post<Lista>(`/v1/listas-compra/${id}/receber`, { atualizar_preco });

// ---------- notas
export const notasRecentes = (limite = 30) => get<Nota[]>('/v1/notas', { limite });
export const notaPelaChave = async (chave: string) => (await get<{ existe: boolean; nota: NotaParecida | null }>('/v1/notas/existe', { chave })).nota;
export const notasRepetidas = (p: { cnpj: string; numero: string; serie: string | null }) =>
  get<NotaParecida[]>('/v1/notas/repetidas', { cnpj: p.cnpj, numero: p.numero, serie: p.serie ?? undefined });
export const vinculos = (cnpj: string) => get<Vinculo[]>('/v1/vinculos', { cnpj });
// ---------- Notas da SEFAZ (admin; etapa 1, só leitura). Tipos iguais aos da API (caixa.service.ts); datas chegam como string ISO.
export type MotivoIgnorar = 'lancada_de_outro_jeito' | 'nao_e_compra' | 'nao_reconheco' | 'compra_nao_aconteceu' | 'cancelamento_conferido' | 'outro';
export type SituacaoNotaSefaz = 'cancelada_depois_de_lancada' | 'ignorada' | 'cancelada' | 'denegada' | 'ja_lancada' | 'parece_lancada' | 'falta_lancar';
export type SituacaoBuscaSefaz =
  | { ambiente: 'desligado' }
  | {
      ambiente: 'producao' | 'homologacao';
      cnpj: string | null;
      busca_ligada: boolean;
      situacao: 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_conflito' | 'parada_656';
      mensagem: string | null;
      aviso: string | null;
      ultima_consulta: { em: string; novas: number } | null;
      primeira_consulta_em: string | null;
      proxima_consulta_em: string | null;
      bloqueado_ate: string | null;
      em_andamento: boolean;
      lacunas: number;
      dias_sem_buscar: number | null;
      ligada_por_nome: string | null;
      ligada_em: string | null;
      outro_cnpj_ou_modo: boolean;
      certificado: { ok: boolean; code: string | null; mensagem: string | null; avisos: string[] };
      contagem: { falta_lancar: number; parece_lancada: number; cancelada_depois_de_lancada: number };
      canceladas_depois: { id: string; numero: string; serie: string; emitente_nome: string }[];
      historico: { evento: 'ligada' | 'desligada' | 'parada_automatica'; feito_por_nome: string | null; feito_em: string; c_stat: number | null }[];
      respostas: RespostasSefaz;
    };
/**
 * Quadro "Respostas à SEFAZ" (entrega 3). Sem `SEFAZ_MANIFESTACAO=ligada` no servidor: `disponivel = false` e o resto vazio, menos
 * `prazos_perto` (lido do banco: o aviso dos 90 dias não depende da variável). Numa parada, `ligadas` continua true (só `situacao` muda).
 */
export type RespostasSefaz = {
  disponivel: boolean;
  ligadas: boolean;
  situacao: 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_656' | 'parada_relogio';
  mensagem: string | null;
  pausa_ate: string | null;
  ligadas_por_nome: string | null;
  ligadas_em: string | null;
  na_fila: number;
  falharam: number;
  /** As notas no aviso do prazo (`prazo_perto`), a que vence primeiro antes. */
  prazos_perto: { id: string; numero: string; serie: string; emitente_nome: string; prazo_final: string }[];
};
export type EstadoEventoSefaz = 'na_fila' | 'enviando' | 'registrada' | 'recusada' | 'falhou' | 'cancelada';
/** `em` = última mudança; `mensagem` = a frase da recusa (pelo código) ou do evento que não assinou, senão null. */
export type EstadoResposta = { estado: EstadoEventoSefaz; em: string; protocolo: string | null; c_stat: number | null; mensagem: string | null };
/** `pode_responder` NÃO olha se as respostas estão ligadas: a tela combina com `respostas.ligadas`. */
export type RespostaNota = {
  ciencia: EstadoResposta | null;
  final: (EstadoResposta & { tipo: 'confirmacao' | 'nao_reconheco' | 'nao_aconteceu'; origem: 'ciencia_automatica' | 'dar_entrada' | 'admin' }) | null;
  prazo_final: string | null;
  prazo_perto: boolean;
  prazo_passou: boolean;
  pode_responder: boolean;
};
export type SituacaoSefazLigada = Exclude<SituacaoBuscaSefaz, { ambiente: 'desligado' }>;
export type NotaSefaz = {
  id: string;
  chave: string;
  emitente_cnpj: string;
  emitente_nome: string;
  numero: string;
  serie: string;
  emitida_em: string | null;
  autorizada_em: string | null;
  valor_total: number | null;
  situacao_sefaz: 'autorizada' | 'denegada' | 'cancelada';
  cancelada_em: string | null;
  situacao: SituacaoNotaSefaz;
  lancada: NotaParecida | null;
  parecidas: NotaParecida[];
  pode_conferir: boolean;
  nao_parece_compra: boolean;
  ignorada: { em: string; por_nome: string | null; motivo: MotivoIgnorar; texto: string | null } | null;
  /** null com a variável `SEFAZ_MANIFESTACAO` desligada. */
  resposta: RespostaNota | null;
};
export const situacaoSefaz = () => get<SituacaoBuscaSefaz>('/v1/notas-sefaz/situacao');
export const configurarBuscaSefaz = (busca_ligada: boolean) => put<SituacaoBuscaSefaz>('/v1/notas-sefaz/configuracao', { busca_ligada });
export const configurarRespostasSefaz = (ligadas: boolean) => put<SituacaoBuscaSefaz>('/v1/notas-sefaz/respostas', { ligadas });
export const buscarSefazAgora = () => post<{ iniciada: true }>('/v1/notas-sefaz/buscar');
export const listarNotasSefaz = (filtro: 'a_conferir' | 'todas') => get<NotaSefaz[]>('/v1/notas-sefaz', { filtro, limite: 500 });
// `responseType: 'text'`: o corpo do erro (`{ error: { code, message } }`) também chega como TEXTO. Volta a ser objeto aqui, para o
// errMsg/errCode acharem a frase e o código do servidor (senão a tela mostraria "Request failed with status code 409").
export const xmlNotaSefaz = async (id: string) => {
  try {
    return (await api.get<string>(`/v1/notas-sefaz/${id}/xml`, { responseType: 'text' })).data;
  } catch (e) {
    if (isAxiosError(e) && e.response && typeof e.response.data === 'string') e.response.data = corpoDoErroXml(e.response.data);
    throw e;
  }
};
function corpoDoErroXml(texto: string): unknown {
  try {
    const j = JSON.parse(texto) as { error?: { message?: unknown } } | null;
    if (typeof j?.error?.message === 'string' && j.error.message) return j;
  } catch {
    // não é o JSON da API (proxy, HTML…): fica a frase fixa
  }
  return { error: { message: 'Não consegui abrir o XML desta nota. Tente de novo.' } };
}
/** `avisarSefaz` pede o evento do motivo à SEFAZ (só vale com as respostas ligadas); ausente = o Ignorar da entrega 2 (nada sai). */
export const ignorarNotaSefaz = (id: string, motivo: MotivoIgnorar, texto?: string, avisarSefaz?: boolean) =>
  post<NotaSefaz>(`/v1/notas-sefaz/${id}/ignorar`, { motivo, ...(texto ? { texto } : {}), ...(avisarSefaz === undefined ? {} : { avisar_sefaz: avisarSefaz }) });
export const responderDeNovoSefaz = (id: string) => post<NotaSefaz>(`/v1/notas-sefaz/${id}/responder-de-novo`);
export const reabrirNotaSefaz = (id: string) => post<NotaSefaz>(`/v1/notas-sefaz/${id}/reabrir`);
export const lancarNota = (n: unknown) => post<{ id: string; contas: number; a_vista: boolean; insumos_criados: number }>('/v1/notas', n);
const enviarPdf = async <T>(url: string, f: File) => {
  const fd = new FormData();
  fd.append('arquivo', f, f.name);
  return (await api.post<T>(url, fd)).data;
};
export const lerPdfNota = <T>(f: File) => enviarPdf<T>('/v1/notas/ler-pdf', f);
export const lerPdfDDA = <T>(f: File) => enviarPdf<T>('/v1/dda/ler-pdf', f);
export const lerFotoNota = async <T>(fotos: File[]) => {
  const fd = new FormData();
  for (const f of fotos) fd.append('arquivo', f, f.name);
  return (await api.post<T>('/v1/notas/ler-foto', fd)).data;
};

// ---------- Cupom fiscal (NFC-e; admin). Tipos copiados das rotas da API (`api/src/modules/cupom-fiscal`: controller, dto, cadastro,
// emissão, leitura e danfe); datas chegam como string ISO; dinheiro em centavos inteiros (`*_centavos`, na tela `BigInt(n)`). O CSC só vai.
export type AmbienteSefaz = 'homologacao' | 'producao';
export type AmbienteServidor = AmbienteSefaz | 'desligado';
export type SituacaoCupom =
  | 'enviando' | 'nao_enviado' | 'sem_resposta' | 'nao_consta' | 'rejeitado' | 'autorizado' | 'cancelando' | 'denegado' | 'cancelado' | 'descartado';
export type AcaoCupom = 'enviar_de_novo' | 'consultar' | 'cancelar' | 'descartar' | 'lancar_venda' | 'imprimir';
export type VendaEstoque = 'lancada' | 'pendente' | 'desfeita' | 'desfazer_pendente' | 'teste' | 'nao_lanca';
export type TipoPendente = 'sem_resposta' | 'nao_saiu' | 'recusado' | 'venda_pendente';
export type SituacaoAmbienteCupom = 'ok' | 'parada_656' | 'parada_certificado' | 'parada_configuracao' | 'parada_serie_em_uso';
export type FamiliaRecusa = 'produto' | 'empresa' | 'consumidor' | 'valores' | 'hora' | 'outra';
export type MotivoProduto =
  'falta_ncm' | 'falta_perfil' | 'sem_preco' | 'inativo' | 'perfil_inativo' | 'perfil_fora_do_regime' | 'nome_fora_do_padrao';
export type CodigoFalta =
  | 'certificado' | 'cnpj' | 'ie' | 'crt' | 'endereco' | 'serie' | 'csc' | 'produto_pronto' | 'teste_homologacao' | 'lanca_venda'
  | 'series_outro_sistema';
export type TPagCupom = '01' | '03' | '04' | '10' | '11' | '17';
/** O atalho que conserta a recusa (calculado no servidor, em `retornos.ts`, junto da frase): a tela só mostra o que vier. */
export type AtalhoCupom = 'certificado' | 'csc' | 'perfil' | 'produtos';
/** O que a SEFAZ disse (código, família, a frase da UX 6.1 e o `xMotivo` à parte). */
export type RecusaCupom = { codigo: number; familia: FamiliaRecusa; frase: string; x_motivo: string };
export type SituacaoCupomFiscal = {
  ambiente: AmbienteServidor;
  agora: string;
  emissao_ligada: boolean;
  situacao: SituacaoAmbienteCupom;
  mensagem: string | null;
  bloqueado_ate: string | null;
  serie: number | null;
  proximo_numero: number;
  falta: { codigo: CodigoFalta; texto: string }[];
  certificado: { ok: boolean; mensagem: string | null };
  pendentes: { total: number; primeiro: { id: string; serie: number; numero: number; tipo: TipoPendente } | null };
};
export type EmitenteCupom = {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  ie: string | null;
  crt: number | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cod_municipio: string;
  municipio: string;
  uf: string;
  telefone: string | null;
  nat_op: string;
  inf_cpl: string | null;
  resp_tec_cnpj: string | null;
  resp_tec_contato: string | null;
  resp_tec_email: string | null;
  resp_tec_fone: string | null;
  series_outro_sistema: number[];
  sem_outro_sistema: boolean;
  cupom_lanca_venda: boolean | null;
  cupom_lanca_venda_por_nome: string | null;
  cupom_lanca_venda_em: string | null;
  tp_regime_ibscbs: number | null;
  atualizado_por_nome: string | null;
  atualizado_em: string | null;
};
/** PUT emitente: cada quadro manda só os seus campos (o que não vem fica). */
export type SalvarEmitenteCupom = Partial<Omit<EmitenteCupom,
  'cnpj' | 'razao_social' | 'nome_fantasia' | 'uf' | 'cupom_lanca_venda_por_nome' | 'cupom_lanca_venda_em' | 'atualizado_por_nome' | 'atualizado_em'>>;
export type AmbienteCupom = {
  ambiente: AmbienteSefaz;
  serie: number | null;
  proximo_numero: number;
  ultimo_numero_usado: number | null;
  pendentes_na_serie: { total: number; primeiro_id: string | null };
  id_csc: number | null;
  /** Só os 4 últimos caracteres: o CSC nunca volta. */
  csc_dica: string | null;
  emissao_ligada: boolean;
  situacao: SituacaoAmbienteCupom;
  mensagem: string | null;
  bloqueado_ate: string | null;
  alterada_por_nome: string | null;
  alterada_em: string | null;
  historico: { evento: string; campos: string[]; mensagem: string | null; feito_por_nome: string | null; feito_em: string }[];
};
export type SalvarAmbienteCupom = { serie?: number | null; proximo_numero?: number | null; id_csc?: number | null; csc?: string | null };
export type TesteConexaoCupom = { em_operacao: boolean; codigo: number | null; frase: string; agora: string; testar_de_novo_em: string };
/** Alíquotas (%) chegam como número (o `wire.ts` converte o numeric); não são dinheiro. */
export type PerfilFiscal = {
  id: string;
  nome: string;
  cfop: string;
  csosn: string | null;
  cst_icms: string | null;
  aliq_icms: number | null;
  pis_cst: string | null;
  cofins_cst: string | null;
  c_ativ_sn: string | null;
  ibs_sn_aliq: number | null;
  cbs_sn_aliq: number | null;
  ibscbs_cst: string | null;
  ibscbs_cclass_trib: string | null;
  ativo: boolean;
  produtos: number;
  vale_no_regime: boolean | null;
  atualizado_por_nome: string | null;
  atualizado_em: string | null;
};
export type SalvarPerfilFiscal = {
  nome?: string;
  cfop?: string;
  csosn?: string | null;
  cst_icms?: string | null;
  aliq_icms?: string | null;
  pis_cst?: string | null;
  cofins_cst?: string | null;
  c_ativ_sn?: string | null;
  ibs_sn_aliq?: string | null;
  cbs_sn_aliq?: string | null;
  ibscbs_cst?: string | null;
  ibscbs_cclass_trib?: string | null;
  ativo?: boolean;
};
/** Uma linha de GET produtos: a grade da aba Produtos e a busca da aba Emitir. */
export type ProdutoCupom = {
  item_cardapio_id: string;
  nome: string;
  categoria: string;
  unidade_venda: string;
  /** O preço do cardápio já arredondado UMA vez pelo servidor; null = sem preço que sirva. */
  preco_venda_centavos: number | null;
  ativo: boolean;
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  origem: number;
  descricao_cupom: string | null;
  unidade: string | null;
  perfil_fiscal_id: string | null;
  perfil_nome: string | null;
  pronto: boolean;
  motivos: MotivoProduto[];
};
export type SalvarProdutoCupom = {
  ncm?: string | null;
  cest?: string | null;
  gtin?: string | null;
  origem?: number | null;
  descricao_cupom?: string | null;
  unidade?: string | null;
  perfil_fiscal_id?: string | null;
};
export type ItemDoCupom = {
  n_item: number;
  item_cardapio_id: string | null;
  nome_cardapio: string;
  x_prod: string;
  unidade: string;
  /** Com 4 casas ("2.0000"): não é dinheiro. */
  quantidade: string;
  valor_unitario_centavos: number;
  valor_bruto_centavos: number;
  valor_desconto_centavos: number;
  perfil_nome: string;
};
/** O cupom (GET cupons/:id e a resposta de todos os POST do cupom): horas e ações calculadas no servidor; CPF completo. */
export type CupomDetalhe = {
  id: string;
  ambiente: AmbienteSefaz;
  serie: number;
  numero: number;
  chave: string;
  situacao: SituacaoCupom;
  dh_emi: string;
  envios: number;
  numero_reaproveitavel: boolean;
  consumidor_doc: string | null;
  valor_produtos_centavos: number;
  valor_desconto_centavos: number;
  valor_total_centavos: number;
  valor_troco_centavos: number;
  itens: ItemDoCupom[];
  pagamentos: { t_pag: string; valor_centavos: number }[];
  autorizada_em: string | null;
  n_prot: string | null;
  c_stat: number | null;
  x_motivo: string | null;
  alerta: { c_msg: string | null; x_msg: string | null } | null;
  cancelado_em: string | null;
  cancelamento_motivo: string | null;
  cancelamento_n_prot: string | null;
  cancelamento_pedido_em: string | null;
  venda_estoque: VendaEstoque | null;
  venda_erro: string | null;
  descartado_em: string | null;
  descarte_motivo: string | null;
  emitido_por_nome: string | null;
  criado_em: string;
  /** A hora do servidor (a contagem da tela não depende do relógio do aparelho). */
  agora: string;
  consultar_a_partir_de: string | null;
  cancelar_ate: string | null;
  acoes: AcaoCupom[];
  recusa: RecusaCupom | null;
  /** O atalho que conserta a `recusa` (UX 6.1), decidido no servidor; null = nenhum. */
  atalho: AtalhoCupom | null;
  mensagem: string | null;
};
/** Uma linha de Emitidos: sem itens; o CPF mascarado (`***.982.247-**`). */
export type CupomLinha = {
  id: string;
  ambiente: AmbienteSefaz;
  serie: number;
  numero: number;
  chave: string;
  situacao: SituacaoCupom;
  dh_emi: string;
  criado_em: string;
  autorizada_em: string | null;
  cancelado_em: string | null;
  descartado_em: string | null;
  envios: number;
  valor_total_centavos: number;
  pagamentos: { t_pag: string; valor_centavos: number }[];
  consumidor_doc: string | null;
  venda_estoque: VendaEstoque | null;
  acoes: AcaoCupom[];
  consultar_a_partir_de: string | null;
  cancelar_ate: string | null;
};
export type FiltroCupons = {
  ambiente?: AmbienteSefaz;
  ini?: string;
  fim?: string;
  situacao?: SituacaoCupom[];
  atencao?: boolean;
  chave_idempotencia?: string;
  limite?: number;
};
/** POST cupons: os preços são do servidor; a tela manda só o total que mostrou (`total_esperado_centavos`). */
export type EmitirCupom = {
  chave_idempotencia: string;
  itens: { item_cardapio_id: string; quantidade: string }[];
  desconto_centavos: number;
  pagamentos: { t_pag: TPagCupom; valor_centavos: number }[];
  consumidor_doc: string | null;
  total_esperado_centavos: number;
};
/** Os dados do DANFE, só do XML autorizado guardado: valores como texto do XML ("24.00", "2.0000"). */
export type DanfeItem = { nItem: number; cProd: string; xProd: string; qCom: string; uCom: string; vUnCom: string; vProd: string; vDesc: string | null };
export type Danfe = {
  emit: {
    CNPJ: string;
    xNome: string;
    xFant: string | null;
    IE: string | null;
    enderEmit: {
      xLgr: string | null; nro: string | null; xCpl: string | null; xBairro: string | null; xMun: string | null; UF: string | null;
      CEP: string | null; fone: string | null;
    };
  };
  det: DanfeItem[];
  total: { qItens: number; vProd: string; vDesc: string; vFrete: string; vSeg: string; vOutro: string; vNF: string };
  pag: { detPag: { tPag: string; xPag: string | null; vPag: string }[]; vTroco: string | null };
  chave: string;
  urlChave: string | null;
  qrCode: string | null;
  dest: { CPF: string | null; CNPJ: string | null; idEstrangeiro: string | null; xNome: string | null } | null;
  ide: { nNF: string; serie: string; dhEmi: string; tpEmis: string };
  nProt: string | null;
  dhRecbto: string | null;
  homologacao: boolean;
  infCpl: string | null;
  cMsg: string | null;
  xMsg: string | null;
};
const CF = '/v1/cupom-fiscal';
export const situacaoCupomFiscal = () => get<SituacaoCupomFiscal>(`${CF}/situacao`);
export const emitenteCupom = () => get<EmitenteCupom>(`${CF}/emitente`);
export const salvarEmitenteCupom = (dto: SalvarEmitenteCupom) => put<EmitenteCupom>(`${CF}/emitente`, dto);
export const ambienteCupom = (a: AmbienteSefaz) => get<AmbienteCupom>(`${CF}/ambientes/${a}`);
export const salvarAmbienteCupom = (a: AmbienteSefaz, dto: SalvarAmbienteCupom) => put<AmbienteCupom>(`${CF}/ambientes/${a}`, dto);
/** "Ligar a emissão de cupons" / "Desligar a emissão" → a situação. Valendo, ligar pede `confirmado` (as três marcações). */
export const ligarEmissaoCupom = (a: AmbienteSefaz, ligada: boolean, confirmado?: boolean) =>
  put<SituacaoCupomFiscal>(`${CF}/ambientes/${a}/emissao`, { ligada, ...(confirmado === undefined ? {} : { confirmado }) });
export const testarConexaoCupom = () => post<TesteConexaoCupom>(`${CF}/testar-conexao`);
export const vendasCupomNoPeriodo = (ini: string, fim: string) =>
  get<{ quantidade: number; valor_centavos: number }>(`${CF}/vendas-no-periodo`, { ini, fim });
export const listarCupons = (f: FiltroCupons = {}) =>
  get<CupomLinha[]>(`${CF}/cupons`, {
    ...(f.ambiente ? { ambiente: f.ambiente } : {}),
    ...(f.ini ? { ini: f.ini } : {}),
    ...(f.fim ? { fim: f.fim } : {}),
    ...(f.situacao && f.situacao.length > 0 ? { situacao: f.situacao.join(',') } : {}),
    ...(f.atencao === undefined ? {} : { atencao: String(f.atencao) }),
    ...(f.chave_idempotencia ? { chave_idempotencia: f.chave_idempotencia } : {}),
    ...(f.limite === undefined ? {} : { limite: f.limite }),
  });
export const cupomFiscal = (id: string) => get<CupomDetalhe>(`${CF}/cupons/${id}`);
export const danfeCupom = (id: string) => get<Danfe>(`${CF}/cupons/${id}/danfe`);
/** 201 = emitido agora; 200 = o cupom que a mesma chave e o mesmo corpo já tinham emitido. Nos dois, o cupom. */
export const emitirCupom = (v: EmitirCupom) => post<CupomDetalhe>(`${CF}/cupons`, v);
export const reenviarCupom = (id: string) => post<CupomDetalhe>(`${CF}/cupons/${id}/reenviar`);
export const consultarCupom = (id: string) => post<CupomDetalhe>(`${CF}/cupons/${id}/consultar`);
export const cancelarCupom = (id: string, motivo: string) => post<CupomDetalhe>(`${CF}/cupons/${id}/cancelar`, { motivo });
export const descartarCupom = (id: string, motivo: string) => post<CupomDetalhe>(`${CF}/cupons/${id}/descartar`, { motivo });
export const lancarVendaCupom = (id: string) => post<CupomDetalhe>(`${CF}/cupons/${id}/lancar-venda`);
export const perfisFiscais = () => get<PerfilFiscal[]>(`${CF}/perfis`);
export const criarPerfilFiscal = (dto: SalvarPerfilFiscal & { nome: string; cfop: string }) => post<PerfilFiscal>(`${CF}/perfis`, dto);
export const atualizarPerfilFiscal = (id: string, dto: SalvarPerfilFiscal) => patch<PerfilFiscal>(`${CF}/perfis/${id}`, dto);
/** `true` só os prontos (busca da aba Emitir); `false` só os que faltam dados; sem o filtro, todos. */
export const produtosCupom = (prontos?: boolean) =>
  get<ProdutoCupom[]>(`${CF}/produtos`, prontos === undefined ? undefined : { prontos: String(prontos) });
export const perfilEmLoteCupom = (itens: string[], perfil_fiscal_id: string) =>
  put<{ atualizados: number; perfil_fiscal_id: string; perfil_nome: string }>(`${CF}/produtos/perfil`, { itens, perfil_fiscal_id });
export const salvarProdutoCupom = (itemCardapioId: string, dto: SalvarProdutoCupom) =>
  put<ProdutoCupom>(`${CF}/produtos/${itemCardapioId}`, dto);
/**
 * O arquivo do cupom (`nota`) ou do cancelamento, como texto. Com `responseType: 'text'` o corpo do erro também chega como texto: volta a
 * ser objeto aqui (como em `xmlNotaSefaz`), para o `errMsg` achar a frase do servidor.
 */
export const xmlCupom = async (id: string, tipo: 'nota' | 'cancelamento') => {
  try {
    return (await api.get<string>(`${CF}/cupons/${id}/xml`, { params: { tipo }, responseType: 'text' })).data;
  } catch (e) {
    if (isAxiosError(e) && e.response && typeof e.response.data === 'string') e.response.data = corpoDoErroArquivo(e.response.data, 'Não consegui baixar o arquivo do cupom. Tente de novo.');
    throw e;
  }
};
/** O zip do mês para o contador (`mes` = "AAAA-MM"; sem ambiente, o do servidor). O erro volta a ser objeto, como no XML. */
export const xmlDoMesCupom = async (mes: string, ambiente?: AmbienteSefaz) => {
  try {
    return (await api.get<Blob>(`${CF}/xml-do-mes`, { params: { mes, ...(ambiente ? { ambiente } : {}) }, responseType: 'blob' })).data;
  } catch (e) {
    if (isAxiosError(e) && e.response && e.response.data instanceof Blob) {
      e.response.data = corpoDoErroArquivo(await e.response.data.text(), 'Não consegui preparar o arquivo agora. Tente de novo.');
    }
    throw e;
  }
};
/** O status HTTP de um erro do axios (null = sem resposta): a aba Emitir separa o erro da API do "não sei se saiu" (UX 2.7). */
export const statusDoErro = (e: unknown): number | null => (isAxiosError(e) ? (e.response?.status ?? null) : null);
function corpoDoErroArquivo(texto: string, frase: string): unknown {
  try {
    const j = JSON.parse(texto) as { error?: { code?: unknown; message?: unknown } } | null;
    if (typeof j?.error?.message === 'string' && j.error.message) return j;
  } catch {
    // não é o JSON da API (proxy, HTML…): fica a frase fixa
  }
  return { error: { message: frase } };
}

// ---------- contas / DRE / caixa
export const listarContas = () => get<Conta[]>('/v1/contas-pagar');
export const criarConta = (c: Record<string, unknown>) => post<Conta>('/v1/contas-pagar', c);
export const liquidarContas = (l: { ids: string[]; pago_em: string; plano_conta_id: string; centro_custo_id: string }) =>
  post<{ liquidadas: number }>('/v1/contas-pagar/liquidar', l);
export const reabrirConta = (id: string) => post<Conta>(`/v1/contas-pagar/${id}/reabrir`);
export const excluirConta = (id: string) => del(`/v1/contas-pagar/${id}`);
export const pagosNoMes = (mes: string) => get<{ plano_conta_id: string | null; valor: number; valor_pago: number | null }[]>('/v1/dre/pagos', { mes });
export const listarCaixa = (mes?: string) => get<CaixaDia[]>('/v1/caixa', mes ? { mes } : undefined);
export const salvarCaixa = (c: Record<string, unknown>) => put<CaixaDia>('/v1/caixa', c);
export const excluirCaixa = (id: string) => del(`/v1/caixa/${id}`);

// ---------- importações
export const importacoesRecentes = () => get<Importacao[]>('/v1/importacoes', { limite: 10 });
export const importar = (tipo: 'insumos' | 'fichas' | 'vendas', corpo: { arquivo: string; modo: string; linhas: Record<string, string>[]; erros: number }) =>
  post<Record<string, number>>(`/v1/importacoes/${tipo}`, corpo);
export const listarDePara = () => get<DePara[]>('/v1/de-para');
export const mapearDePara = (produto_relatorio: string, item_cardapio_id: string | null) =>
  put<{ vendas: number }>('/v1/de-para', { produto_relatorio, item_cardapio_id });

// ---------- usuários
export const listarUsuarios = () => get<Usuario[]>('/v1/usuarios');
export const criarUsuario = (u: { nome: string; email: string; senha: string; perfil: Perfil }) => post<{ id: string }>('/v1/usuarios', u);
export const trocarPerfil = (id: string, perfil: Perfil) => patch<Usuario>(`/v1/usuarios/${id}/perfil`, { perfil });
export const redefinirSenha = (id: string, senha: string) => put<{ ok: true }>(`/v1/usuarios/${id}/senha`, { senha });
export const excluirUsuario = (id: string) => del(`/v1/usuarios/${id}`);
export const trocarMinhaSenha = (senha_atual: string, senha_nova: string) => post<{ ok: true }>('/v1/auth/trocar-senha', { senha_atual, senha_nova });
export const existeAdmin = async () => (await get<{ existe: boolean }>('/v1/auth/existe-admin')).existe;
export type { AuthUser };
