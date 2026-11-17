// Frases fixas da busca na SEFAZ (UX §4). {h} = horaSp(...), {n} = código. Nunca texto vindo da SEFAZ.
export const FRASE = {
  foraDoAr: (h: string) => `A SEFAZ está fora do ar. Nova tentativa às ${h}.`,
  semContato: (h: string) => `Não consegui falar com a SEFAZ. Nova tentativa às ${h}.`,
  esperar: (h: string) => `A SEFAZ pediu para esperar. Próxima busca às ${h}.`,
  bloqueouDuasVezes:
    'A SEFAZ bloqueou a busca duas vezes em 24 horas. Por segurança, a busca foi desligada. Fale com o seu contador e com o suporte do Freela Comanda antes de ligar de novo.',
  conflito:
    'Outro sistema também está buscando as notas deste CNPJ na SEFAZ (provavelmente o do contador). Com dois sistemas, a SEFAZ bloqueia os dois por 1 hora. A busca foi desligada: fale com o contador antes de ligar de novo.',
  certificadoRecusado: (n: number) =>
    `A SEFAZ recusou o certificado digital (código ${n}). Confira o certificado digital em Configurações e ligue a busca de novo.`,
  cnpj593:
    'A SEFAZ diz que o CNPJ consultado não é da mesma empresa do certificado (código 593). Confira o CNPJ no quadro Empresa.',
  tresIlegiveis:
    'A busca parou: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda.',
  gravacaoFalhou: 'A busca parou: não consegui guardar as notas que a SEFAZ mandou. Avise o suporte antes de ligar de novo.',
  outroCodigo: (n: number) =>
    `A busca parou por um problema que o sistema não resolve sozinho (código ${n}). Fale com o suporte do Freela Comanda e informe este código.`,
  indicioD1:
    'A SEFAZ já tinha notas separadas para este CNPJ, então algum sistema (talvez o do seu contador) usou a busca nos últimos 60 dias. Se ele ainda busca, a SEFAZ vai bloquear os dois, e a busca daqui se desliga sozinha.',
};

// Frases fixas das respostas à SEFAZ (UX §8). As de lote ("Paradas e esperas") vão para `sefaz_manifestacao.mensagem`; as de recusa
// (linha da resposta) para `sefaz_manifestacoes.mensagem`. {h} = horaSp(...), {n} = código. Nunca texto vindo da SEFAZ.
export const FRASE_RESPOSTA = {
  foraDoAr: (h: string) => `A SEFAZ está fora do ar. As respostas saem de novo às ${h}.`,
  semContato: (h: string) => `Não consegui falar com a SEFAZ. Nova tentativa às ${h}.`,
  esperar: (h: string) => `A SEFAZ pediu para esperar. As respostas saem de novo às ${h}.`,
  relogio: (h: string) =>
    `O relógio do servidor está diferente do da SEFAZ. As respostas esperam até ${h}; se repetir, fale com o suporte do Freela Comanda.`,
  relogioParou: 'As respostas pararam: o relógio do servidor está fora da hora certa. Fale com o suporte do Freela Comanda.',
  bloqueouDuasVezes:
    'A SEFAZ bloqueou as respostas duas vezes em 24 horas. Por segurança, elas foram desligadas. Fale com o suporte do Freela Comanda antes de ligar de novo.',
  certificadoRecusado: (n: number) =>
    `A SEFAZ recusou o certificado digital (código ${n}). Confira o certificado digital em Configurações e ligue as respostas de novo.`,
  tresIlegiveis:
    'As respostas pararam: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda.',
  outroCodigo: (n: number) =>
    `As respostas pararam por um problema que o sistema não resolve sozinho (código ${n}). Fale com o suporte do Freela Comanda e informe este código.`,
  recusadaCanceladaOuDenegada: 'A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.',
  recusadaForaDoPrazo: 'A SEFAZ não aceitou a resposta: passou o prazo.',
  recusadaJaRespondida: 'Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.',
  recusadaOutraEmpresa: 'A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa.',
  recusadaChaveInvalida: 'A SEFAZ não aceitou a resposta: a chave de acesso não confere.',
  recusadaCodigo: (n: number) => `A SEFAZ não aceitou a resposta (código ${n}). Fale com o seu contador.`,
};
