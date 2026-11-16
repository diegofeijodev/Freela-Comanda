// Chamadas da API do Freela ERP — substituem as consultas `supabase.from(...)` / `rpc(...)` do protótipo, uma a uma.
// O fio é snake_case com os mesmos nomes do banco (numeric = number, date = "AAAA-MM-DD"), então os tipos espelham as tabelas.
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
export const notaExiste = async (chave: string) => (await get<{ existe: boolean }>('/v1/notas/existe', { chave })).existe;
export const vinculos = (cnpj: string) => get<Vinculo[]>('/v1/vinculos', { cnpj });
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
