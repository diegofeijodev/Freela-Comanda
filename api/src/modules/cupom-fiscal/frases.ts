// Frases do cupom fiscal (NFC-e): fonte única do texto que o servidor manda. São as das tabelas 6.1 (retornos da SEFAZ) e 6.2 (erros de
// validação) da UX (`docs/superpowers/specs/2026-11-17-cupom-fiscal-ux.md`), letra por letra, com hora `14h05` de Brasília (`horaSp`);
// a de cancelamento recusado é a da UX 4.3. Frase que a UX não fixa segue a UX §6.3 ("não confere", "modo de teste", "valendo",
// "caixa de hoje"). O teste `retornos.spec.ts` procura cada uma, com os valores de exemplo, no arquivo da UX.
// Módulo folha: só importa tipos (e o `horaSp`), para validacao-fiscal, montagem-xml, travas e retornos importarem daqui sem ciclo.
// Nunca texto vindo da SEFAZ, a não ser o `<motivo>`/`<xMsg>` das linhas que a UX manda mostrar (já limpos por `motivoSefaz`).

import { horaSp } from '../../common/time/dates';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import type { AcaoCupom, SituacaoCupom } from './situacao-cupom';
import type { MotivoProduto } from './validacao-fiscal';

/** Centavos → "R$ 1.234,56" (espaço comum depois de "R$": o `Intl` pt-BR põe U+00A0). */
export function reais(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const inteiro = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiro},${(a % 100n).toString().padStart(2, '0')}`;
}

/** "a", "a e b", "a, b e c". */
function lista(itens: readonly string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** O motivo da SEFAZ dentro de uma frase que já termina com ponto: sem o ponto final dele. */
const semPontoFinal = (s: string) => s.replace(/[\s.]+$/u, '');

/** Formata o CFOP como na tela: 5405 → 5.405. */
const cfopTexto = (c: string) => `${c[0]}.${c.slice(1)}`;
const listaCfop = (cs: readonly string[]) => {
  const t = cs.map(cfopTexto);
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}`;
};

/**
 * Validação fiscal do perfil e do item (Tasks 5 e 6; vieram de `validacao-fiscal.ts`). As listas de CFOP que entram na frase ficam lá
 * (regra) e chegam aqui por parâmetro.
 */
export const FRASES_VALIDACAO = {
  // UX §6.2 (literais)
  csosn500: 'O CSOSN 500 só vale com o CFOP 5.405.',
  simplesSemCsosn: 'No Simples, escolha o CSOSN.',
  normalSemCst: 'No regime normal, escolha o CST.',
  // plano (Task 5)
  osDois: 'Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois.',
  csosnSemSt: (csosn: string, cfops: readonly string[]) => `O CSOSN ${csosn} só vale com o tipo de venda (CFOP) ${listaCfop(cfops)}.`,
  cfopFora: (cfop: string) => `O tipo de venda (CFOP) ${cfopTexto(cfop)} não entra no cupom.`,
  // UX §5.7 (literal)
  gtin: 'Este código de barras não confere. Confira os números (8, 12, 13 ou 14).',
  // decisões do controlador na rodada da Tarefa 6 (literais)
  cst20: 'O CST 20 ainda não pode ser usado no Comanda. Fale com o contador.',
  semAliqIcms: 'Informe a alíquota do ICMS.',
  pisCofinsBarrado: 'Este CST de PIS/COFINS ainda não pode ser usado no Comanda. Fale com o contador.',
  // texto fora do TString do esquema (U+0020–U+00FF), no estilo "não confere" da UX §6.3
  nomeCaractere: 'O nome no cupom não confere: a SEFAZ não aceita emoji nem símbolos.',
  unidadeCaractere: 'A unidade no cupom não confere: a SEFAZ não aceita emoji nem símbolos.',
  // UX §5.7 (literais)
  ncm: 'O NCM tem 8 números.',
  cest: 'O CEST tem 7 números.',
  // novas, no estilo da UX §6.3 (as de formato dão nome ao campo do "Use 2 números." da UX §5.6/§5.7)
  semCfop: 'Escolha o tipo de venda (CFOP).',
  semCodigo: 'Escolha o CSOSN (Simples) ou o CST (regime normal).',
  csosnFora: (csosn: string) => `O CSOSN ${csosn} não entra no cupom.`,
  cstFora: (cst: string) => `O CST ${cst} não entra no cupom.`,
  cst60: (cfops: readonly string[]) => `O CST 60 só vale com o tipo de venda (CFOP) ${listaCfop(cfops)}.`,
  aliqIcms: 'A alíquota do ICMS vai de 0 a 100, com até 2 casas.',
  pisCst: 'O CST do PIS tem 2 números.',
  cofinsCst: 'O CST da COFINS tem 2 números.',
  cAtivSn: 'A atividade no Simples (cAtivSN) tem 2 números.',
  ibsSnAliq: 'A alíquota efetiva do IBS vai de 0 a 100, com até 4 casas.',
  cbsSnAliq: 'A alíquota efetiva da CBS vai de 0 a 100, com até 4 casas.',
  ibscbsCst: 'O CST do IBS/CBS tem 3 números.',
  ibscbsCclassTrib: 'A classificação do IBS/CBS (cClassTrib) tem 6 números.',
  origem: 'A origem vai de 0 a 8.',
  descricao: 'O nome no cupom tem até 120 letras.',
  unidade: 'A unidade no cupom tem até 6 letras.',
} as const;

/** Retornos da SEFAZ: UX §6.1 (a de cancelamento recusado é da UX 4.3). As horas são de Brasília (`horaSp`). */
export const FRASE_RETORNO = {
  autorizado: (autorizadaEm: Date, nProt: string) => `Autorizado às ${horaSp(autorizadaEm)} · protocolo ${nProt}`,
  autorizadoComAlerta: (xMsg: string) => `Autorizado, com um aviso da SEFAZ: “${xMsg}”. O cupom vale. Mostre o aviso ao contador.`,
  denegado: (codigo: number, motivo: string) =>
    `A SEFAZ negou o uso do cupom (código ${codigo}): ${semPontoFinal(motivo)}. O número foi gasto. Fale com o contador.`,
  jaTem: (consultarAPartirDe: Date) =>
    `A SEFAZ já tem este cupom. Consulte a partir das ${horaSp(consultarAPartirDe)} para ver a situação.`,
  serieEmUso: (serie: number, numero: number | bigint) =>
    `A SEFAZ diz que o número ${numero} da série ${serie} já foi usado por outra nota: o caixa de hoje pode estar usando esta série. A emissão parou. Descarte este cupom e troque a série em Configurações → Cupom fiscal.`,
  horaAtrasada: 'O cupom demorou para sair e a SEFAZ recusou a hora dele. Toque em Enviar de novo: a hora é refeita.',
  foraDoAr: (codigo: number) =>
    `A SEFAZ está fora do ar agora (código ${codigo}). Tente de novo mais tarde ou emita esta venda pelo caixa de hoje e descarte este cupom.`,
  bloqueio656: (bloqueadoAte: Date) =>
    `A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as ${horaSp(bloqueadoAte)}.`,
  bloqueouDuasVezes:
    'A SEFAZ bloqueou este sistema duas vezes em 24 horas. Por segurança, a emissão foi desligada. Fale com o contador e com o suporte do Freela Comanda antes de ligar de novo.',
  naoCredenciada:
    'A loja não está credenciada para emitir cupom fiscal neste modo (código 781). Peça ao contador para credenciar no portal da NFC-e da SEFAZ-SP.',
  certificado: (codigo: number) =>
    `A emissão parou: a SEFAZ recusou o certificado digital (código ${codigo}). Confira o certificado em Configurações e ligue a emissão de novo.`,
  erroDoSistema: (codigo: number) =>
    `A emissão parou por um erro do sistema (código ${codigo}). Fale com o suporte do Freela Comanda e informe este código.`,
  /** "do modo de teste" em homologação; "valendo" em produção (UX 6.1 e 5.1: "… do modo de teste" / "… valendo"). */
  qrCode: (codigo: number, ambiente: AmbienteSefaz) =>
    `A SEFAZ recusou o QR Code do cupom (código ${codigo}). Confira o código de segurança (CSC) e o número dele (IdCSC) ${ambiente === 'producao' ? 'valendo' : 'do modo de teste'} em Configurações → Cupom fiscal.`,
  relogio:
    'A emissão parou: o relógio do servidor está diferente do da SEFAZ, e cada cupom seria recusado. Fale com o suporte do Freela Comanda.',
  muitasRecusas: (ate: Date) =>
    `Muitas recusas da SEFAZ na última hora. Para não bloquear o CNPJ, o envio volta às ${horaSp(ate)}. Enquanto isso, confira os dados dos produtos.`,
  recusaProduto:
    'A SEFAZ recusou um dado fiscal de um produto deste cupom. Confira os produtos (ou peça ao contador) e toque em Enviar de novo.',
  recusaEmpresa:
    'A SEFAZ recusou um dado da empresa (inscrição estadual, endereço ou regime). Confira em Configurações → Cupom fiscal e toque em Enviar de novo.',
  recusaConsumidor: 'A SEFAZ recusou o CPF ou CNPJ do cliente. Descarte este cupom e emita de novo com o documento certo, ou sem ele.',
  recusaValores: (codigo: number) =>
    `A SEFAZ recusou os valores do cupom. É um erro do sistema: descarte este cupom, emita de novo e avise o suporte do Freela Comanda, informando o código ${codigo}.`,
  recusaOutra: (codigo: number) =>
    `A SEFAZ recusou o cupom (código ${codigo}). Veja a mensagem abaixo: se ela falar de um produto, confira os produtos; se não, fale com o suporte do Freela Comanda.`,
  naoEnviado: 'Não consegui falar com a SEFAZ. Nada foi enviado; tente de novo.',
  semResposta: (consultarAPartirDe: Date) =>
    `A SEFAZ não respondeu. O cupom pode ter sido autorizado. Consulte a partir das ${horaSp(consultarAPartirDe)} e não emita outro cupom para esta venda até lá.`,
  cancelamentoRecusado: (codigo: number, motivo: string) =>
    `A SEFAZ não aceitou o cancelamento (código ${codigo}): ${semPontoFinal(motivo)}. O cupom continua valendo.`,
} as const;

/** Motivo do produto fora do cupom, em minúscula, com as palavras da tag (UX 6.2 e 5.7); os sem tag no estilo da UX §6.3. */
const MOTIVO_PRODUTO: Record<MotivoProduto, string> = {
  falta_ncm: 'falta NCM',
  falta_perfil: 'falta perfil fiscal',
  sem_preco: 'sem preço de venda',
  inativo: 'inativo',
  perfil_inativo: 'perfil desativado',
  perfil_fora_do_regime: 'o perfil fiscal não vale no regime da empresa',
  nome_fora_do_padrao: 'o nome no cupom tem emoji ou símbolo',
};

/** "Este cupom <estado>; não dá para <ação>." (UX 6.2: o rótulo da tag, nunca o nome interno; vocabulário da UX §6.3). */
const ESTADO_CUPOM: Record<SituacaoCupom, string> = {
  enviando: 'ainda está sendo enviado à SEFAZ',
  sem_resposta: 'está sem resposta da SEFAZ',
  nao_enviado: 'não saiu',
  nao_consta: 'não está na SEFAZ',
  rejeitado: 'foi recusado pela SEFAZ',
  autorizado: 'está autorizado',
  cancelando: 'está sendo cancelado',
  denegado: 'teve o uso negado',
  cancelado: 'já foi cancelado',
  descartado: 'foi descartado',
};
const ACAO_CUPOM: Record<AcaoCupom, string> = {
  enviar_de_novo: 'enviar de novo',
  consultar: 'consultar na SEFAZ',
  cancelar: 'cancelar',
  descartar: 'descartar',
  lancar_venda: 'lançar a venda no estoque',
  imprimir: 'imprimir',
};

/** Erros de validação e travas: UX §6.2, pelo código do erro (`NFCE_PARADA` = a mensagem guardada no ambiente). */
export const FRASE_ERRO = {
  NFCE_DESLIGADA: 'A emissão de cupom fiscal não está ativada neste servidor.',
  NFCE_EMISSAO_DESLIGADA: 'A emissão de cupons está desligada. Ligue em Configurações → Cupom fiscal.',
  NFCE_CONFIG_INCOMPLETA: (itens: readonly string[]) => `Falta configurar o cupom fiscal: ${lista(itens)}.`,
  NFCE_SEM_ITENS: 'Adicione pelo menos um produto.',
  NFCE_ITEM_INDISPONIVEL: (produto: string, motivo: MotivoProduto) => `${produto} não pode entrar no cupom: ${MOTIVO_PRODUTO[motivo]}.`,
  NFCE_DESCONTO_INVALIDO: (valorProdutos: bigint) => `O desconto tem de ser menor que o valor dos produtos (${reais(valorProdutos)}).`,
  NFCE_PAGAMENTO_INSUFICIENTE: (soma: bigint, total: bigint) =>
    `A soma dos pagamentos (${reais(soma)}) é menor que o total (${reais(total)}).`,
  NFCE_TROCO_INVALIDO: 'Troco só sai do dinheiro, e no máximo o valor recebido em dinheiro.',
  NFCE_DOC_INVALIDO: (tipo: 'cpf' | 'cnpj') =>
    tipo === 'cpf' ? 'Este CPF não confere. Confira os números.' : 'Este CNPJ não confere. Confira os 14 caracteres.',
  NFCE_DOC_OBRIGATORIO: 'Acima de R$ 10.000,00, o CPF ou CNPJ do consumidor é obrigatório.',
  NFCE_SITUACAO: (situacao: SituacaoCupom, acao: AcaoCupom) => `Este cupom ${ESTADO_CUPOM[situacao]}; não dá para ${ACAO_CUPOM[acao]}.`,
  NFCE_CONSULTA_CEDO: (ate: Date) => `Espere até as ${horaSp(ate)} para consultar: a SEFAZ bloqueia consultas repetidas.`,
  NFCE_LIMITE_ENVIOS: 'Este cupom já foi enviado 3 vezes. Descarte e emita outro.',
  NFCE_CANCELAMENTO_FORA_DO_PRAZO: (autorizadaEm: Date) =>
    `Passaram 30 minutos da autorização (às ${horaSp(autorizadaEm)}). A SEFAZ não aceita mais cancelar este cupom. Fale com o contador.`,
  NFCE_MOTIVO: (acao: 'cancelar' | 'descartar') =>
    acao === 'cancelar' ? 'Escreva o motivo com pelo menos 15 letras (no máximo 255).' : 'Escolha ou escreva o motivo do descarte.',
  NFCE_SERIE_INVALIDA: 'A série vai de 0 a 889 e não pode ser uma das séries do caixa de hoje.',
  NFCE_SERIE_COM_PENDENTES: 'Há cupons pendentes nesta série. Resolva antes de trocar a série.',
  NFCE_NUMERO_INVALIDO: (ultimo: number | bigint, serie: number) =>
    `O próximo número tem de ser maior que ${ultimo}, o último já usado na série ${serie}.`,
  NFCE_CSC_INVALIDO: (campo: 'csc' | 'id_csc') =>
    campo === 'csc' ? 'O código de segurança tem de 16 a 36 letras e números.' : 'O número do código vai de 1 a 999999.',
  NFCE_PRODUCAO_SEM_TESTE: 'Antes de ligar valendo, emita e cancele um cupom no modo de teste.',
  NFCE_LANCA_VENDA_PENDENTE: 'Responda quem conta no estoque as vendas emitidas aqui (quadro Caixa de hoje).',
  NFCE_TESTE_CEDO: (ate: Date) => `Pode testar de novo às ${horaSp(ate)}.`,
  NFCE_BLOQUEADA: FRASE_RETORNO.bloqueio656,
  NFCE_MUITAS_RECUSAS: FRASE_RETORNO.muitasRecusas,
} as const;
