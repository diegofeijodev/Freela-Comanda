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
  outroCodigo: (n: number) =>
    `A busca parou por um problema que o sistema não resolve sozinho (código ${n}). Fale com o suporte do Freela Comanda e informe este código.`,
  indicioD1:
    'A SEFAZ já tinha notas separadas para este CNPJ, então algum sistema (talvez o do seu contador) usou a busca nos últimos 60 dias. Se ele ainda busca, a SEFAZ vai bloquear os dois, e a busca daqui se desliga sozinha.',
};
