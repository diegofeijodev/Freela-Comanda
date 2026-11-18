// Frases do cadastro do cupom fiscal (Tarefa 10): o complemento de `frases.ts` para a empresa no cupom, a numeração e o CSC, os perfis, os
// produtos e a lista "Para ligar a emissão, falta:". As da UX §5.1–§5.7 são literais (a UX vale letra por letra); as que a UX não fixa
// seguem a UX §6.3 ("não confere", "modo de teste", "valendo", "caixa de hoje"). Módulo folha: só tipos.
// Nunca valor de CSC, chave ou CPF numa frase.

import type { AmbienteSefaz } from '../sefaz/distribuicao.port';

/** Os 11 códigos de `falta` (desenho §8.2; UX ponto 10.5), na ordem da tabela da UX 5.1. */
export type CodigoFalta =
  | 'certificado'
  | 'cnpj'
  | 'ie'
  | 'crt'
  | 'endereco'
  | 'serie'
  | 'csc'
  | 'produto_pronto'
  | 'teste_homologacao'
  | 'lanca_venda'
  | 'series_outro_sistema';

const doAmbiente = (a: AmbienteSefaz) => (a === 'producao' ? 'valendo' : 'do modo de teste');

/** Texto de cada item de "Para ligar a emissão, falta:" (UX 5.1, literal). */
export const TEXTO_FALTA = {
  certificado: 'Certificado digital válido, do mesmo CNPJ da empresa',
  cnpj: 'CNPJ da empresa',
  ie: 'Inscrição estadual',
  crt: 'Regime da empresa',
  endereco: 'Endereço da empresa (rua, número, bairro e CEP)',
  serie: (a: AmbienteSefaz) => `Série e próximo número ${doAmbiente(a)}`,
  csc: (a: AmbienteSefaz) => `Código de segurança (CSC) e número do código (IdCSC) ${doAmbiente(a)}`,
  produto_pronto: 'Pelo menos 1 produto pronto para o cupom',
  teste_homologacao: 'Um cupom autorizado e um cancelado no modo de teste',
  lanca_venda: 'Resposta: quem conta no estoque as vendas emitidas aqui',
  series_outro_sistema: 'Séries do caixa de hoje (ou “nenhum outro sistema”), diferentes da série daqui',
} as const;

/** Rótulo de cada campo de texto da empresa no cupom, para as frases de tamanho e de caractere. */
export const ROTULO_EMITENTE = {
  logradouro: 'A rua',
  numero: 'O número',
  complemento: 'O complemento',
  bairro: 'O bairro',
  municipio: 'O nome do município',
  nat_op: 'A natureza da operação',
  inf_cpl: 'O texto do pé do cupom',
  resp_tec_contato: 'O nome do contato',
  resp_tec_email: 'O e-mail',
} as const;

export const FRASES_CADASTRO = {
  // UX 5.2 (literais)
  ie: 'A inscrição estadual de SP tem 12 números.',
  crt: 'Escolha o regime da empresa.',
  cep: 'O CEP tem 8 números.',
  codMunicipio: 'O código do município tem 7 números.',
  telefone: 'Use DDD + número.',
  natOpLonga: 'Use até 60 letras.',
  infCplLongo: 'Use no máximo 500 letras.',
  // UX 5.4 e 5.5 (literais)
  serieOutroSistema: 'A série vai de 0 a 889.',
  respTecTudoOuNada: 'Preencha os quatro campos, ou deixe todos vazios.',
  respTecCnpj: 'Este CNPJ não confere.',
  // UX 5.1 (literal)
  trioMudou: 'O CNPJ ou a série mudou desde que a emissão foi ligada. Ligue de novo.',
  // UX 5.6 e 5.7 (literais)
  perfilSemNome: 'Dê um nome ao perfil.',
  perfilRepetido: 'Já existe um perfil com este nome.',
  semPerfil: 'Escolha o perfil fiscal.',
  // plano, Review Focus 1 (literal)
  quantidade: 'Quantidade com até 4 casas, ponto como separador e maior que zero.',
  // novas, no estilo da UX §6.3
  municipioDeSp: 'O município tem de ser de SP (código começando com 35).',
  semMunicipio: 'Preencha o nome do município.',
  semNatOp: 'Preencha a natureza da operação (por exemplo, VENDA).',
  campoLongo: (rotulo: string, max: number) => `${rotulo} tem até ${max} letras.`,
  caractere: (rotulo: string) => `${rotulo} não confere: a SEFAZ não aceita emoji nem símbolos.`,
  email: 'Este e-mail não confere.',
  semOutroComSeries: 'Marque “nenhum outro sistema” ou informe as séries do caixa de hoje, não os dois.',
  tpRegimeIbscbs: 'O regime do IBS/CBS não confere.',
  numeroForaDaFaixa: 'O número do próximo cupom vai de 1 a 999999999.',
  /** Sem `CERTIFICADO_SECRET` o CSC não é gravado (a frase do certificado, para o código de segurança). */
  semSegredo: 'O servidor ainda não está pronto para guardar o código de segurança. Fale com o suporte do Freela Comanda.',
  certificadoSemCnpj: 'Preencha o CNPJ da empresa na aba Geral para conferir o certificado digital.',
  certificadoOutraEmpresa: 'O certificado digital é de outra empresa (outro CNPJ). Envie o certificado da empresa em Configurações.',
  perfilNomeLongo: 'O nome do perfil tem até 60 letras.',
  perfilDesativado: 'Este perfil fiscal está desativado. Escolha outro.',
  loteTamanho: 'Escolha de 1 a 500 produtos.',
  produtoSumiu: 'Algum produto escolhido não existe mais. Recarregue a lista.',
  tPag: 'Escolha a forma de pagamento.',
  valorPagamento: 'O valor de cada pagamento tem de ser maior que zero.',
  naoEncontrado: 'Não encontrado.',
} as const;
