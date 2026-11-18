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

/** ": <motivo>" sem o ponto final dele (a frase já termina com ponto); motivo vazio = nada, para não sobrar ": ." */
const comMotivo = (s: string) => {
  const m = s.trim().replace(/[\s.]+$/u, '');
  return m === '' ? '' : `: ${m}`;
};

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

/** UX 3.1 (literal): a 2ª frase da caixa do `cancelando`. */
const consulteCancelando = (d: Date) =>
  `Consulte a partir das ${horaSp(d)}. Até lá, o cupom continua valendo e a venda continua no estoque.`;

/** Retornos da SEFAZ: UX §6.1 (a de cancelamento recusado é da UX 4.3; as do "Testar a conexão", da UX 5.1). Horas de Brasília (`horaSp`). */
export const FRASE_RETORNO = {
  autorizado: (autorizadaEm: Date, nProt: string) => `Autorizado às ${horaSp(autorizadaEm)} · protocolo ${nProt}`,
  autorizadoComAlerta: (xMsg: string) => `Autorizado, com um aviso da SEFAZ: “${xMsg}”. O cupom vale. Mostre o aviso ao contador.`,
  denegado: (codigo: number, motivo: string) =>
    `A SEFAZ negou o uso do cupom (código ${codigo})${comMotivo(motivo)}. O número foi gasto. Fale com o contador.`,
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
    `A SEFAZ não aceitou o cancelamento (código ${codigo})${comMotivo(motivo)}. O cupom continua valendo.`,
  /**
   * `cancelando` na tela do cupom (UX 3.1, literais; Tarefa 13, nota 2: a frase sai do estado, a de qualquer leitura): o pedido nosso
   * saiu e a SEFAZ não respondeu, ou respondeu 573 (o diário diz qual); nos dois, mais a do "Consulte a partir das …".
   */
  cancelandoSemResposta: (pedidoEm: Date, consultarAPartirDe: Date) =>
    `O pedido de cancelamento saiu às ${horaSp(pedidoEm)} e a SEFAZ não respondeu. ${consulteCancelando(consultarAPartirDe)}`,
  cancelandoJaRecebido: (consultarAPartirDe: Date) =>
    `A SEFAZ diz que já recebeu um pedido de cancelamento deste cupom. ${consulteCancelando(consultarAPartirDe)}`,
  /**
   * A consulta disse "cancelada" sem mandar o evento deste cupom (Ruling T12 fix-1, literal): a frase do `cancelando` sem pedido nosso e a
   * resposta do clique "Consultar" nesse caso (fonte única; leva pré-final, item 9).
   */
  cancelandoSemComprovante: 'A SEFAZ informa que este cupom foi cancelado, mas não mandou o comprovante. Consulte de novo mais tarde.',
  // "Testar a conexão" (UX 5.1, a linha sob o botão; o certificado, o 656 e as paradas usam as frases acima)
  statusOk: (respondeuEm: Date) => `A SEFAZ respondeu às ${horaSp(respondeuEm)}: o serviço está funcionando.`,
  statusSemContato: 'Não consegui falar com a SEFAZ. Nada foi enviado.',
  statusForaDoAr: (codigo: number) => `A SEFAZ está fora do ar agora (código ${codigo}).`,
  /** Nova (a UX não fixa), no estilo da UX §6.3. */
  statusOutroCodigo: (codigo: number) =>
    `A SEFAZ não confirmou que o serviço está funcionando (código ${codigo}). Fale com o suporte do Freela Comanda e informe este código.`,
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
/** As ações da tela mais os dois arquivos (UX 3.5: "Baixar o arquivo do cupom (XML)" / "… do cancelamento (XML)"). */
export type AcaoDaFrase = AcaoCupom | 'baixar_xml' | 'baixar_xml_cancelamento';
const ACAO_CUPOM: Record<AcaoDaFrase, string> = {
  enviar_de_novo: 'enviar de novo',
  consultar: 'consultar na SEFAZ',
  cancelar: 'cancelar',
  descartar: 'descartar',
  lancar_venda: 'lançar a venda no estoque',
  imprimir: 'imprimir',
  baixar_xml: 'baixar o arquivo do cupom (XML)',
  baixar_xml_cancelamento: 'baixar o arquivo do cancelamento (XML)',
};

/** Erros de validação e travas: UX §6.2, pelo código do erro (`NFCE_PARADA` = a mensagem guardada no ambiente). */
export const FRASE_ERRO = {
  NFCE_DESLIGADA: 'A emissão de cupom fiscal não está ativada neste servidor.',
  /**
   * Nova (onda final, item 6; a UX não fixa), no estilo da UX §6.3: o cupom é do OUTRO ambiente (o servidor trocou entre o modo de teste e
   * o valendo com ele pendente). O de teste não vale nada; o valendo precisa do servidor de volta no valendo (suporte).
   */
  NFCE_OUTRO_AMBIENTE: (cupom: AmbienteSefaz, acao: AcaoDaFrase) =>
    cupom === 'homologacao'
      ? `Este é um cupom de teste, e o Freela Comanda agora emite cupons valendo; não dá para ${ACAO_CUPOM[acao]}.`
      : `Este cupom vale como documento fiscal, e o Freela Comanda agora está no modo de teste da SEFAZ; não dá para ${ACAO_CUPOM[acao]}. Fale com o suporte do Freela Comanda.`,
  NFCE_EMISSAO_DESLIGADA: 'A emissão de cupons está desligada. Ligue em Configurações → Cupom fiscal.',
  NFCE_CONFIG_INCOMPLETA: (itens: readonly string[]) => `Falta configurar o cupom fiscal: ${lista(itens)}.`,
  NFCE_SEM_ITENS: 'Adicione pelo menos um produto.',
  NFCE_ITEM_INDISPONIVEL: (produto: string, motivo: MotivoProduto) => `${produto} não pode entrar no cupom: ${MOTIVO_PRODUTO[motivo]}.`,
  /** Nova (leva pré-final, item 2; a UX não fixa), no estilo da UX §6.3: um item que arredonda para 0 centavo (ex.: 0,0001 × R$ 0,01). */
  NFCE_ITEM_SEM_VALOR: 'Cada produto do cupom tem de valer pelo menos R$ 0,01. Confira a quantidade.',
  NFCE_DESCONTO_INVALIDO: (valorProdutos: bigint) => `O desconto tem de ser menor que o valor dos produtos (${reais(valorProdutos)}).`,
  NFCE_PAGAMENTO_INSUFICIENTE: (soma: bigint, total: bigint) =>
    `A soma dos pagamentos (${reais(soma)}) é menor que o total (${reais(total)}).`,
  NFCE_TROCO_INVALIDO: 'Troco só sai do dinheiro, e no máximo o valor recebido em dinheiro.',
  NFCE_DOC_INVALIDO: (tipo: 'cpf' | 'cnpj') =>
    tipo === 'cpf' ? 'Este CPF não confere. Confira os números.' : 'Este CNPJ não confere. Confira os 14 caracteres.',
  NFCE_DOC_OBRIGATORIO: 'Acima de R$ 10.000,00, o CPF ou CNPJ do consumidor é obrigatório.',
  NFCE_SITUACAO: (situacao: SituacaoCupom, acao: AcaoDaFrase) => `Este cupom ${ESTADO_CUPOM[situacao]}; não dá para ${ACAO_CUPOM[acao]}.`,
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
  // limite do cancelamento por cupom (rodada de correção 1): a UX não fixa; no molde do NFCE_CONSULTA_CEDO e do NFCE_LIMITE_ENVIOS
  NFCE_CANCELAMENTO_CEDO: (ate: Date) =>
    `Espere até as ${horaSp(ate)} para pedir o cancelamento de novo: a SEFAZ bloqueia pedidos repetidos.`,
  NFCE_LIMITE_CANCELAMENTOS:
    'O cancelamento deste cupom já foi pedido 3 vezes. Para não bloquear o CNPJ, não sai outro pedido: fale com o contador.',
  NFCE_BLOQUEADA: FRASE_RETORNO.bloqueio656,
  NFCE_MUITAS_RECUSAS: FRASE_RETORNO.muitasRecusas,
  // desenho §8.4 (a UX 6.2 não lista): a do desenho nomeia o produto, mas o POST não manda os preços que a tela viu, então o servidor
  // não sabe QUAL preço mudou; a frase diz o total novo e a tela relê `GET /produtos` (Tarefa 11)
  NFCE_TOTAL_MUDOU: (total: bigint) => `O preço de algum produto mudou. O total agora é ${reais(total)}: confira antes de emitir.`,
  // desenho §8.4 (literal)
  NFCE_CHAVE_REUSADA: 'Esta venda já foi enviada com outros dados. Abra o cupom emitido ou comece uma venda nova.',
} as const;

/** Emissão (Tarefa 11): o que a UX não fixa, no estilo da UX §6.3 (a das três confirmações é da UX 5.1, literal). */
export const FRASES_EMISSAO = {
  /** UX 5.1 (literal): ligar valendo sem as três marcações. */
  confirmacoes: 'Marque as três confirmações.',
  /** A venda chegou sem a chave de idempotência (só a tela gera; um uuid). */
  chaveDaVenda: 'Esta venda chegou sem identificação. Recarregue a página e monte a venda de novo.',
  /** Desconto e total esperado: centavos inteiros de 0 em diante. */
  valorEmCentavos: 'Os valores da venda chegaram fora do formato. Recarregue a página e monte a venda de novo.',
  /** vNF de R$ 200.000,00 em diante (B.3). */
  valorMaximo: 'O total do cupom tem de ser menor que R$ 200.000,00.',
  /** Nova (leva pré-final, item 2): preço negativo chegando aos totais (o cardápio já barra antes, como "sem preço de venda"). */
  precoInvalido: 'O preço de algum produto não confere. Confira o preço de venda no cardápio.',
  /** A linha "A venda deste cupom não baixou o estoque: <frase>." quando o erro não é uma recusa da função do banco. */
  vendaErro: 'o servidor não conseguiu gravar a venda agora',
} as const;

/** Rótulo do documento fiscal, como a tag da UX 3.1, em minúscula. */
const ROTULO_DOCUMENTO: Partial<Record<SituacaoCupom, string>> = {
  autorizado: 'autorizado',
  cancelando: 'cancelando',
  denegado: 'uso negado',
  cancelado: 'cancelado',
};

/**
 * Leitura (Tarefa 13): o que a UX não fixa, no estilo da UX §6.3. Os motivos vão na coluna "motivo" de `numeros-nao-usados.csv` (o
 * arquivo do mês para o contador, desenho §4.3 e §7.4): por que o número da série não virou cupom.
 */
export const FRASES_LEITURA = {
  /** O cupom cancelado sem o arquivo do cancelamento no diário (não deve acontecer: o `cancelado` só nasce do evento conferido). */
  semArquivoDoCancelamento: 'O arquivo do cancelamento deste cupom não ficou guardado. Fale com o suporte do Freela Comanda.',
  /** O documento do mês cujo arquivo falta (rodada de correção 1): a linha do csv e o `AVISOS.txt` do zip. */
  aviso: {
    /** Decisão do controlador (literal). */
    cancelamentoIndisponivel: 'cancelado — comprovante do cancelamento indisponível, peça ao suporte',
    /** O mesmo molde, para o documento sem o próprio arquivo (o rótulo é o da tag da UX 3.1). */
    cupomIndisponivel: (s: SituacaoCupom) => `${ROTULO_DOCUMENTO[s] ?? s} — arquivo do cupom indisponível, peça ao suporte`,
    titulo: (mes: string, ambiente: AmbienteSefaz) =>
      `Cupons de ${mes.slice(5, 7)}/${mes.slice(0, 4)} (${ambiente === 'producao' ? 'valendo' : 'modo de teste'}) com arquivo faltando neste zip. Fale com o suporte do Freela Comanda antes de mandar ao contador:`,
    linha: (serie: number, numero: number | bigint, motivo: string) => `Série ${serie}, nº ${numero}: ${motivo}.`,
  },
  naoUsado: {
    semResposta: 'Enviado à SEFAZ sem resposta: só a consulta diz se o número foi usado.',
    outraNota: 'A SEFAZ diz que outra nota já usa este número (código 539).',
    notaSemArquivo: 'A SEFAZ tem uma nota com este número, mas o arquivo dela não está no Comanda.',
    descartado: 'Descartado: a SEFAZ não registrou este número.',
    naoSaiu: 'Não saiu: a SEFAZ não recebeu este cupom (ainda pendente no Comanda).',
    naoConsta: 'A SEFAZ confirmou que não tem este cupom (ainda pendente no Comanda).',
    recusado: (codigo: number | null) =>
      `Recusado pela SEFAZ${codigo === null ? '' : ` (código ${codigo})`}: a SEFAZ não registrou este número (ainda pendente no Comanda).`,
    /** Onda final, item 2 (literal do controlador): a faixa pulada em Configurações, com o dia (DD/MM, Brasília) e quem pulou. */
    puladoAMao: (dia: string, nome: string | null) => `pulado à mão em ${dia}${nome ? ` por ${nome}` : ''}`,
  },
} as const;

// ===================================================================================================== cadastro (Tarefa 10)
// Vinham de `frases-cadastro.ts` (juntadas aqui na leva pré-final, item 6: fonte única): a empresa no cupom, a numeração e o CSC, os
// perfis, os produtos e a lista "Para ligar a emissão, falta:". As da UX §5.1–§5.7 são literais (a UX vale letra por letra); as que a
// UX não fixa seguem a UX §6.3 ("não confere", "modo de teste", "valendo", "caixa de hoje"). Nunca valor de CSC, chave ou CPF numa frase.

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
  /** A série do caixa de hoje igual à do Comanda (num dos dois ambientes): os dois emitiriam na mesma série (539). */
  serieDoComanda: (serie: number) => `A série ${serie} é a do Comanda. O caixa de hoje precisa usar outra série.`,
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
