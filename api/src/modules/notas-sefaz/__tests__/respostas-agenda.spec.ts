import {
  decidirLote,
  derivaRelogio,
  DERIVA_MAX_MS,
  ESPERA_ADMIN_MS,
  LOTE_MAX,
  PAUSA_656_MS,
  PAUSA_CURTA_MS,
  PAUSA_FORA_DO_AR_MS,
  PAUSA_RELOGIO_MS,
  TENTATIVAS_MAX,
  type ChamadaLote,
  type DecisaoLote,
  type EntradaLote,
} from '../respostas-agenda';
import { FRASE_RESPOSTA } from '../frases';
import type { CodigoFault, CodigoSefazErro } from '../../sefaz/sefaz-erro';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000);

// Chaves da entrega 2 (fictícias).
const VETOR = '35261112ABC34501DE35550010000044111000044116';
const K880 = '35261111222333000181550010000008801000000887';
const PROT15 = '135260000000001';
const PROT17 = '13526000000000217';

type Ev = EntradaLote['eventos'][number];
const EV_VETOR: Ev = { id: 'ev-vetor', chave: VETOR, tpEvento: '210210', tentativas: 1 };
const EV_K880: Ev = { id: 'ev-k880', chave: K880, tpEvento: '210200', tentativas: 1 };

const entrada = (chamada: ChamadaLote, extra: Partial<EntradaLote> = {}): EntradaLote => ({
  agora: AGORA,
  eventos: [EV_VETOR, EV_K880],
  falhasSeguidas: 0,
  semRespostaSeguidas: 0,
  vezes656Em24h: 0,
  relogioNoLoteAnterior: false,
  chamada,
  ...extra,
});
type Ret = Extract<ChamadaLote, { tipo: 'retorno' }>['retornos'][number];
const ret = (chave: string | null, tpEvento: string | null, cStat: number, nProt: string | null = null, nSeq: number | null = 1): Ret => ({
  chave,
  tpEvento,
  nSeq,
  cStat,
  nProt,
});
const lote = (cStat: number, retornos: Ret[] = []): ChamadaLote => ({ tipo: 'retorno', cStat, retornos });
/** Lote 128 com o VETOR no código dado e o K880 registrado (135). */
const com128 = (cStatVetor: number, nProtVetor: string | null = null): ChamadaLote =>
  lote(128, [ret(VETOR, '210210', cStatVetor, nProtVetor), ret(K880, '210200', 135, PROT15)]);
const erro = (code: CodigoSefazErro, enviado: boolean, httpStatus?: number, fault?: CodigoFault): ChamadaLote => ({
  tipo: 'erro',
  code,
  enviado,
  ...(httpStatus !== undefined ? { httpStatus } : {}),
  ...(fault ? { fault } : {}),
});

const porId = (d: DecisaoLote, id: string) => d.eventos.find((x) => x.id === id)!;
const vetor = (d: DecisaoLote) => porId(d, 'ev-vetor');
const k880 = (d: DecisaoLote) => porId(d, 'ev-k880');
const estados = (d: DecisaoLote) => d.eventos.map((x) => [x.estado, x.gastou]);
const k880Registrada = (d: DecisaoLote) =>
  expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'registrada', gastou: true, cStat: 135, protocolo: PROT15, mensagem: null });
/** Campos do lote num 128 sem relógio: respondida, sem pausa, falhas zeradas, sem a marca do relógio. */
const lote128 = (d: DecisaoLote, situacao: DecisaoLote['situacao'] = 'ok', mensagem: string | null = null) =>
  expect(d).toMatchObject({ resultado: 'respondida', situacao, mensagem, pausaAte: null, falhasSeguidas: 0, relogio: false });

// Frases literais da UX §8 ("Paradas e esperas" e a linha da resposta), com as horas dos vetores: +15 = 14h20, +60 = 15h05, +65 = 15h10.
const F = {
  foraDoAr15h05: 'A SEFAZ está fora do ar. As respostas saem de novo às 15h05.',
  foraDoAr14h20: 'A SEFAZ está fora do ar. As respostas saem de novo às 14h20.',
  semContato14h20: 'Não consegui falar com a SEFAZ. Nova tentativa às 14h20.',
  esperar15h10: 'A SEFAZ pediu para esperar. As respostas saem de novo às 15h10.',
  relogio15h05:
    'O relógio do servidor está diferente do da SEFAZ. As respostas esperam até 15h05; se repetir, fale com o suporte do Freela Comanda.',
  relogioParou: 'As respostas pararam: o relógio do servidor está fora da hora certa. Fale com o suporte do Freela Comanda.',
  bloqueouDuasVezes:
    'A SEFAZ bloqueou as respostas duas vezes em 24 horas. Por segurança, elas foram desligadas. Fale com o suporte do Freela Comanda antes de ligar de novo.',
  certificado: (n: number) =>
    `A SEFAZ recusou o certificado digital (código ${n}). Confira o certificado digital em Configurações e ligue as respostas de novo.`,
  tresIlegiveis:
    'As respostas pararam: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda.',
  outroCodigo: (n: number) =>
    `As respostas pararam por um problema que o sistema não resolve sozinho (código ${n}). Fale com o suporte do Freela Comanda e informe este código.`,
  canceladaOuDenegada: 'A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada.',
  foraDoPrazo: 'A SEFAZ não aceitou a resposta: passou o prazo.',
  jaRespondida: 'Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal.',
  outraEmpresa: 'A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa.',
  chaveInvalida: 'A SEFAZ não aceitou a resposta: a chave de acesso não confere.',
  recusadaCodigo: (n: number) => `A SEFAZ não aceitou a resposta (código ${n}). Fale com o seu contador.`,
};

describe('FRASE_RESPOSTA (literais da UX §8)', () => {
  it('as de lote ("Paradas e esperas")', () => {
    expect(FRASE_RESPOSTA.foraDoAr('15h05')).toBe(F.foraDoAr15h05);
    expect(FRASE_RESPOSTA.semContato('14h20')).toBe(F.semContato14h20);
    expect(FRASE_RESPOSTA.esperar('15h10')).toBe(F.esperar15h10);
    expect(FRASE_RESPOSTA.relogio('15h05')).toBe(F.relogio15h05);
    expect(FRASE_RESPOSTA.relogioParou).toBe(F.relogioParou);
    expect(FRASE_RESPOSTA.bloqueouDuasVezes).toBe(F.bloqueouDuasVezes);
    expect(FRASE_RESPOSTA.certificadoRecusado(283)).toBe(F.certificado(283));
    expect(FRASE_RESPOSTA.tresIlegiveis).toBe(F.tresIlegiveis);
    expect(FRASE_RESPOSTA.outroCodigo(1234)).toBe(F.outroCodigo(1234));
  });
  it('as de recusa da linha da resposta', () => {
    expect(FRASE_RESPOSTA.recusadaCanceladaOuDenegada).toBe(F.canceladaOuDenegada);
    expect(FRASE_RESPOSTA.recusadaForaDoPrazo).toBe(F.foraDoPrazo);
    expect(FRASE_RESPOSTA.recusadaJaRespondida).toBe(F.jaRespondida);
    expect(FRASE_RESPOSTA.recusadaOutraEmpresa).toBe(F.outraEmpresa);
    expect(FRASE_RESPOSTA.recusadaChaveInvalida).toBe(F.chaveInvalida);
    expect(FRASE_RESPOSTA.recusadaCodigo(1234)).toBe(F.recusadaCodigo(1234));
  });
});

describe('constantes (no código, nunca em env)', () => {
  it('lote de 20, 3 tentativas, 60 s do admin, deriva de 2 min, pausas +60/+65/+15/+60', () => {
    expect([LOTE_MAX, TENTATIVAS_MAX, ESPERA_ADMIN_MS, DERIVA_MAX_MS]).toEqual([20, 3, 60_000, 120_000]);
    expect([PAUSA_FORA_DO_AR_MS, PAUSA_656_MS, PAUSA_CURTA_MS, PAUSA_RELOGIO_MS]).toEqual([3_600_000, 3_900_000, 900_000, 3_600_000]);
  });
});

describe('decidirLote: tabela "Lote" do desenho', () => {
  it('128: lê cada retEvento (VETOR 135 com protocolo, K880 573 sem protocolo)', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 135, PROT15), ret(K880, '210200', 573)])));
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'ok', mensagem: null, pausaAte: null, falhasSeguidas: 0, relogio: false });
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'registrada', gastou: true, cStat: 135, protocolo: PROT15, mensagem: null });
    expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'registrada', gastou: true, cStat: 573, protocolo: null, mensagem: null });
  });
  it('128 zera as falhas seguidas de antes', () => {
    expect(decidirLote(entrada(com128(135), { falhasSeguidas: 2 })).falhasSeguidas).toBe(0);
  });
  it.each([108, 109])('%i: todos voltam à fila sem gastar; +60 min; "fora do ar"', (c) => {
    const d = decidirLote(entrada(lote(c)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({
      resultado: 'respondida',
      situacao: 'ok',
      mensagem: F.foraDoAr15h05,
      pausaAte: min(60),
      falhasSeguidas: 0,
      relogio: false,
    });
    expect(d.eventos.every((x) => x.cStat === null && x.protocolo === null && x.mensagem === null)).toBe(true);
  });
  it.each([
    [500, undefined],
    [500, 'Receiver'],
    [503, undefined],
    [599, 'Receiver'],
  ] as const)('HTTP %i (Fault %s): como 108/109, mas conta como lote sem resposta útil', (st, fault) => {
    const d = decidirLote(entrada(erro('SEFAZ_HTTP', true, st, fault)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'sem_resposta', situacao: 'ok', mensagem: F.foraDoAr15h05, pausaAte: min(60), falhasSeguidas: 0 });
  });
  it.each(['Sender', 'VersionMismatch', 'MustUnderstand', 'DataEncodingUnknown'] as const)(
    'HTTP 500 com Fault %s: a SEFAZ recusou o pedido; voltam sem gastar e param',
    (fault) => {
      const d = decidirLote(entrada(erro('SEFAZ_HTTP', true, 500, fault)));
      expect(estados(d)).toEqual([
        ['na_fila', false],
        ['na_fila', false],
      ]);
      expect(d).toMatchObject({
        resultado: 'respondida',
        situacao: 'parada_configuracao',
        mensagem: F.outroCodigo(500),
        pausaAte: null,
        falhasSeguidas: 0,
      });
    },
  );
  it('656: voltam sem gastar; +65 min; "pediu para esperar"', () => {
    const d = decidirLote(entrada(lote(656)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'ok', mensagem: F.esperar15h10, pausaAte: min(65), falhasSeguidas: 0 });
  });
  it.each([
    [0, 15, '14h20'],
    [1, 30, '14h35'],
    [2, 60, '15h05'],
    [5, 60, '15h05'],
  ])('falha antes de enviar com %i falhas antes: voltam sem gastar; recuo de %i min', (antes, mins, hora) => {
    const d = decidirLote(entrada(erro('SEFAZ_REDE', false), { falhasSeguidas: antes }));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({
      resultado: 'falha_antes_de_enviar',
      situacao: 'ok',
      mensagem: `Não consegui falar com a SEFAZ. Nova tentativa às ${hora}.`,
      pausaAte: min(mins),
      falhasSeguidas: antes + 1,
    });
  });
  it('falha antes de enviar no TLS é a mesma regra', () => {
    expect(decidirLote(entrada(erro('SEFAZ_TLS', false)))).toMatchObject({ resultado: 'falha_antes_de_enviar', pausaAte: min(15) });
  });
  it.each([
    ['SEFAZ_TEMPO', true],
    ['SEFAZ_REDE', true],
    ['SEFAZ_RESPOSTA_INVALIDA', true],
  ] as const)('enviado sem resposta útil (%s): voltam GASTANDO; +15 min', (code, enviado) => {
    const d = decidirLote(entrada(erro(code, enviado)));
    expect(estados(d)).toEqual([
      ['na_fila', true],
      ['na_fila', true],
    ]);
    expect(d).toMatchObject({
      resultado: 'sem_resposta',
      situacao: 'ok',
      mensagem: F.semContato14h20,
      pausaAte: min(15),
      falhasSeguidas: 1,
    });
  });
  it.each([280, 283, 286])('%i: certificado recusado; voltam sem gastar; param', (c) => {
    const d = decidirLote(entrada(lote(c)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({
      resultado: 'respondida',
      situacao: 'parada_certificado',
      mensagem: F.certificado(c),
      pausaAte: null,
      falhasSeguidas: 0,
    });
  });
  it('HTTP 403: certificado recusado; voltam sem gastar; param', () => {
    const d = decidirLote(entrada(erro('SEFAZ_HTTP', true, 403)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'parada_certificado', mensagem: F.certificado(403), pausaAte: null, falhasSeguidas: 0 });
  });
  it.each([214, 225, 252, 402, 404, 516, 517, 587, 588])('%i: defeito nosso; voltam sem gastar; param com o código', (c) => {
    const d = decidirLote(entrada(lote(c)));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({
      resultado: 'respondida',
      situacao: 'parada_configuracao',
      mensagem: F.outroCodigo(c),
      pausaAte: null,
      falhasSeguidas: 0,
    });
  });
  it('999: voltam gastando; +15 min', () => {
    const d = decidirLote(entrada(lote(999)));
    expect(estados(d)).toEqual([
      ['na_fila', true],
      ['na_fila', true],
    ]);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'ok', mensagem: F.foraDoAr14h20, pausaAte: min(15), falhasSeguidas: 0 });
  });
  it.each([
    ['lote 1234 (4 dígitos)', lote(1234), 1234],
    ['lote 135 (código de evento no lote)', lote(135), 135],
    ['lote 100', lote(100), 100],
    ['HTTP 400', erro('SEFAZ_HTTP', true, 400), 400],
    ['HTTP 404', erro('SEFAZ_HTTP', true, 404), 404],
    ['HTTP 415 com Fault Sender', erro('SEFAZ_HTTP', true, 415, 'Sender'), 415],
  ] as const)('outro código ou outro HTTP 4xx (%s): param com o código na frase', (_nome, chamada, n) => {
    const d = decidirLote(entrada(chamada));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'parada_configuracao', mensagem: F.outroCodigo(n), pausaAte: null, falhasSeguidas: 0 });
  });
});

describe('decidirLote: tabela "Evento" do desenho (VETOR 210210 no código da linha, K880 210200 com 135)', () => {
  it.each([135, 136])('%i: registrada, com o protocolo', (c) => {
    const d = decidirLote(entrada(com128(c, PROT17)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'registrada', gastou: true, cStat: c, protocolo: PROT17, mensagem: null });
    k880Registrada(d);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'ok', mensagem: null, pausaAte: null, falhasSeguidas: 0, relogio: false });
  });
  it('573: registrada (duplicidade = o mesmo evento já existia), pode vir sem protocolo', () => {
    const d = decidirLote(entrada(com128(573)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'registrada', gastou: true, cStat: 573, protocolo: null, mensagem: null });
    k880Registrada(d);
    lote128(d);
  });
  it('655 na ciência: recusada, já respondida por outro sistema', () => {
    const d = decidirLote(entrada(com128(655)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'recusada', gastou: true, cStat: 655, protocolo: null, mensagem: F.jaRespondida });
    k880Registrada(d);
    lote128(d);
  });
  it('655 numa resposta final não é a linha do 655 (só ciência): cai em "outro", código 655', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 135, PROT15), ret(K880, '210200', 655)])));
    expect(k880(d)).toEqual({
      id: 'ev-k880',
      estado: 'recusada',
      gastou: true,
      cStat: 655,
      protocolo: null,
      mensagem: F.recusadaCodigo(655),
    });
    expect(vetor(d)).toMatchObject({ estado: 'registrada', gastou: true, cStat: 135 });
    lote128(d);
  });
  it.each([650, 651])('%i: recusada, nota cancelada ou denegada', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toEqual({
      id: 'ev-vetor',
      estado: 'recusada',
      gastou: true,
      cStat: c,
      protocolo: null,
      mensagem: F.canceladaOuDenegada,
    });
    k880Registrada(d);
    lote128(d);
  });
  it('596: recusada, fora do prazo', () => {
    const d = decidirLote(entrada(com128(596)));
    expect(vetor(d)).toMatchObject({ estado: 'recusada', gastou: true, cStat: 596, mensagem: F.foraDoPrazo });
    k880Registrada(d);
    lote128(d);
  });
  it('575: recusada, a nota não é para este CNPJ', () => {
    const d = decidirLote(entrada(com128(575)));
    expect(vetor(d)).toMatchObject({ estado: 'recusada', gastou: true, cStat: 575, mensagem: F.outraEmpresa });
    k880Registrada(d);
    lote128(d);
  });
  it.each([236, 496, 614, 615, 616, 617, 618, 619])('%i: recusada, chave inválida', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toMatchObject({ estado: 'recusada', gastou: true, cStat: c, mensagem: F.chaveInvalida });
    k880Registrada(d);
    lote128(d);
  });
  it.each([577, 578, 579])('%i: relógio; volta à fila sem gastar; +60 min; marca o lote', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'na_fila', gastou: false, cStat: c, protocolo: null, mensagem: null });
    k880Registrada(d);
    expect(d).toMatchObject({
      resultado: 'respondida',
      situacao: 'ok',
      mensagem: F.relogio15h05,
      pausaAte: min(60),
      relogio: true,
      falhasSeguidas: 0,
    });
  });
  it('250: cOrgao 91 recusado; volta sem gastar; param', () => {
    const d = decidirLote(entrada(com128(250)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'na_fila', gastou: false, cStat: 250, protocolo: null, mensagem: null });
    k880Registrada(d);
    lote128(d, 'parada_configuracao', F.outroCodigo(250));
  });
  it.each([213, 290, 293, 296])('%i: certificado da assinatura; volta sem gastar; param', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toMatchObject({ estado: 'na_fila', gastou: false, cStat: c, mensagem: null });
    k880Registrada(d);
    lote128(d, 'parada_certificado', F.certificado(c));
  });
  it.each([252, 489, 490, 491, 492, 493, 572, 594, 595, 297, 298])('%i: defeito nosso; volta sem gastar; param', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toMatchObject({ estado: 'na_fila', gastou: false, cStat: c, mensagem: null });
    k880Registrada(d);
    lote128(d, 'parada_configuracao', F.outroCodigo(c));
  });
  it('999: volta gastando (sem pausa do lote: a tabela do evento não põe uma; o teto de tentativas limita)', () => {
    const d = decidirLote(entrada(com128(999)));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'na_fila', gastou: true, cStat: 999, protocolo: null, mensagem: null });
    k880Registrada(d);
    lote128(d);
  });
  it('999 na 3ª tentativa: falhou', () => {
    const d = decidirLote(entrada(com128(999), { eventos: [{ ...EV_VETOR, tentativas: 3 }, EV_K880] }));
    expect(vetor(d)).toEqual({ id: 'ev-vetor', estado: 'falhou', gastou: true, cStat: 999, protocolo: null, mensagem: null });
    k880Registrada(d);
    lote128(d);
  });
  it.each([1234, 100, 101, 400, 9999])('outro código (%i): recusada, "código N"; não repete', (c) => {
    const d = decidirLote(entrada(com128(c)));
    expect(vetor(d)).toEqual({
      id: 'ev-vetor',
      estado: 'recusada',
      gastou: true,
      cStat: c,
      protocolo: null,
      mensagem: F.recusadaCodigo(c),
    });
    k880Registrada(d);
    lote128(d);
  });
});

describe('decidirLote: casos de borda', () => {
  it('128 com só o retorno do VETOR: K880 volta à fila gastando', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 135, PROT15)])));
    expect(vetor(d)).toMatchObject({ estado: 'registrada', gastou: true });
    expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'na_fila', gastou: true, cStat: null, protocolo: null, mensagem: null });
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'ok', mensagem: null, pausaAte: null });
  });
  it('128 sem nenhum retEvento: todos voltam gastando', () => {
    expect(estados(decidirLote(entrada(lote(128))))).toEqual([
      ['na_fila', true],
      ['na_fila', true],
    ]);
  });
  it('128 sem retorno na 3ª tentativa: falhou', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 135, PROT15)]), { eventos: [EV_VETOR, { ...EV_K880, tentativas: 3 }] }));
    expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'falhou', gastou: true, cStat: null, protocolo: null, mensagem: null });
  });
  it.each([
    ['nSeq nulo', ret(K880, '210200', 135, PROT15, null)],
    ['nSeq 2', ret(K880, '210200', 135, PROT15, 2)],
    ['tpEvento nulo', ret(K880, null, 135, PROT15)],
    ['outro tpEvento', ret(K880, '210210', 135, PROT15)],
    ['chave nula', ret(null, '210200', 135, PROT15)],
  ])('o retEvento casa por (chave, tpEvento, nSeq) exatos: com %s, K880 volta gastando', (_nome, r) => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 135, PROT15), r])));
    expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'na_fila', gastou: true, cStat: null, protocolo: null, mensagem: null });
  });
  it('retEvento de uma chave que não é do lote é ignorado', () => {
    const d = decidirLote(
      entrada(lote(128, [ret('35261199999999000191550010000000011000000015', '210210', 135, PROT15), ...com128Retornos()])),
    );
    expect(estados(d)).toEqual([
      ['registrada', true],
      ['registrada', true],
    ]);
  });
  it('TEMPO enviado com K880 em tentativas = 3: K880 falhou com mensagem nula, VETOR volta à fila', () => {
    const d = decidirLote(entrada(erro('SEFAZ_TEMPO', true), { eventos: [EV_VETOR, { ...EV_K880, tentativas: 3 }] }));
    expect(vetor(d)).toMatchObject({ estado: 'na_fila', gastou: true });
    expect(k880(d)).toEqual({ id: 'ev-k880', estado: 'falhou', gastou: true, cStat: null, protocolo: null, mensagem: null });
    expect(d).toMatchObject({ resultado: 'sem_resposta', situacao: 'ok', pausaAte: min(15) });
  });
  it('lote 999 na 3ª tentativa: falhou', () => {
    const d = decidirLote(entrada(lote(999), { eventos: [{ ...EV_VETOR, tentativas: 3 }, EV_K880] }));
    expect(estados(d)).toEqual([
      ['falhou', true],
      ['na_fila', true],
    ]);
  });
  it('voltar sem gastar nunca vira falhou, mesmo na 3ª tentativa', () => {
    const d = decidirLote(
      entrada(lote(108), {
        eventos: [
          { ...EV_VETOR, tentativas: 3 },
          { ...EV_K880, tentativas: 3 },
        ],
      }),
    );
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
  });
  it.each(['SEFAZ_TEMPO', 'SEFAZ_RESPOSTA_INVALIDA'] as const)(
    '%s com semRespostaSeguidas = 2: as respostas param (3 ilegíveis)',
    (code) => {
      const d = decidirLote(entrada(erro(code, true), { semRespostaSeguidas: 2 }));
      expect(estados(d)).toEqual([
        ['na_fila', true],
        ['na_fila', true],
      ]);
      expect(d).toMatchObject({
        resultado: 'sem_resposta',
        situacao: 'parada_configuracao',
        mensagem: F.tresIlegiveis,
        pausaAte: min(15),
        falhasSeguidas: 1,
      });
    },
  );
  it('3º sem resposta seguido com os eventos na 3ª tentativa: falhou E parada_configuracao', () => {
    const d = decidirLote(
      entrada(erro('SEFAZ_TEMPO', true), {
        semRespostaSeguidas: 2,
        eventos: [
          { ...EV_VETOR, tentativas: 3 },
          { ...EV_K880, tentativas: 3 },
        ],
      }),
    );
    expect(estados(d)).toEqual([
      ['falhou', true],
      ['falhou', true],
    ]);
    expect(d).toMatchObject({ situacao: 'parada_configuracao', mensagem: F.tresIlegiveis });
  });
  it('semRespostaSeguidas = 1 ainda não para', () => {
    expect(decidirLote(entrada(erro('SEFAZ_TEMPO', true), { semRespostaSeguidas: 1 })).situacao).toBe('ok');
  });
  it.each([[undefined], ['Receiver']] as const)('HTTP 500 (Fault %s) com semRespostaSeguidas = 2: as respostas param', (fault) => {
    const d = decidirLote(entrada(erro('SEFAZ_HTTP', true, 500, fault), { semRespostaSeguidas: 2 }));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'sem_resposta', situacao: 'parada_configuracao', mensagem: F.tresIlegiveis, pausaAte: min(60) });
  });
  it('HTTP 500 com Fault fora da lista ("outro"): código desconhecido nunca repete; param', () => {
    const d = decidirLote(entrada(erro('SEFAZ_HTTP', true, 500, 'outro')));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ resultado: 'respondida', situacao: 'parada_configuracao', mensagem: F.outroCodigo(500), pausaAte: null });
  });
  it('HTTP sem status (como em agenda.ts): fora do ar, +60', () => {
    const d = decidirLote(entrada(erro('SEFAZ_HTTP', true)));
    expect(d).toMatchObject({ resultado: 'sem_resposta', situacao: 'ok', mensagem: F.foraDoAr15h05, pausaAte: min(60) });
  });
  it('HTTP 302 (como em agenda.ts): param com o código', () => {
    expect(decidirLote(entrada(erro('SEFAZ_HTTP', true, 302)))).toMatchObject({
      situacao: 'parada_configuracao',
      mensagem: F.outroCodigo(302),
    });
  });
  it('577 com relogioNoLoteAnterior: as respostas param (parada_relogio)', () => {
    const d = decidirLote(entrada(com128(577), { relogioNoLoteAnterior: true }));
    expect(vetor(d)).toMatchObject({ estado: 'na_fila', gastou: false, cStat: 577 });
    k880Registrada(d);
    expect(d).toMatchObject({ situacao: 'parada_relogio', mensagem: F.relogioParou, pausaAte: min(60), relogio: true });
  });
  it('relogioNoLoteAnterior sem relógio neste lote: nada muda', () => {
    expect(decidirLote(entrada(com128(135), { relogioNoLoteAnterior: true }))).toMatchObject({
      situacao: 'ok',
      mensagem: null,
      relogio: false,
    });
  });
  it('656 com vezes656Em24h = 1: as respostas param (parada_656), e a pausa de +65 continua', () => {
    const d = decidirLote(entrada(lote(656), { vezes656Em24h: 1 }));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ situacao: 'parada_656', mensagem: F.bloqueouDuasVezes, pausaAte: min(65) });
  });
  it('lote 1234 (4 dígitos, desconhecido): parada_configuracao com "(código 1234)"', () => {
    const d = decidirLote(entrada(lote(1234)));
    expect(d.situacao).toBe('parada_configuracao');
    expect(d.mensagem).toContain('(código 1234)');
  });
  it('evento 1234: recusada, "código 1234"', () => {
    const d = decidirLote(entrada(com128(1234)));
    expect(vetor(d).estado).toBe('recusada');
    expect(vetor(d).mensagem).toContain('código 1234');
  });
  it('duas paradas no mesmo lote: vale a do 1º evento da entrada; o registrado continua registrado', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 213), ret(K880, '210200', 250)])));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ situacao: 'parada_certificado', mensagem: F.certificado(213) });
    const inv = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 213), ret(K880, '210200', 250)]), { eventos: [EV_K880, EV_VETOR] }));
    expect(inv).toMatchObject({ situacao: 'parada_configuracao', mensagem: F.outroCodigo(250) });
  });
  it('relógio e parada no mesmo lote: a parada vale para a frase, e a pausa do relógio continua', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 577), ret(K880, '210200', 250)])));
    expect(estados(d)).toEqual([
      ['na_fila', false],
      ['na_fila', false],
    ]);
    expect(d).toMatchObject({ situacao: 'parada_configuracao', mensagem: F.outroCodigo(250), pausaAte: min(60), relogio: true });
  });
  it('parada e recusa no mesmo lote: a recusa continua definitiva', () => {
    const d = decidirLote(entrada(lote(128, [ret(VETOR, '210210', 650), ret(K880, '210200', 489)])));
    expect(estados(d)).toEqual([
      ['recusada', true],
      ['na_fila', false],
    ]);
    expect(d.situacao).toBe('parada_configuracao');
  });
  it('não usa o relógio global: as pausas dependem só do "agora" recebido', () => {
    const outro = new Date('2027-03-02T09:00:00Z');
    expect(decidirLote(entrada(lote(108), { agora: outro })).pausaAte).toEqual(new Date(outro.getTime() + PAUSA_FORA_DO_AR_MS));
    expect(decidirLote(entrada(lote(656), { agora: outro })).pausaAte).toEqual(new Date(outro.getTime() + PAUSA_656_MS));
  });
});

function com128Retornos(): Ret[] {
  return [ret(VETOR, '210210', 135, PROT15), ret(K880, '210200', 135, PROT15)];
}

describe('decidirLote: invariantes (nunca em laço, um resultado por evento)', () => {
  const chamadas: [string, ChamadaLote, Partial<EntradaLote>][] = [
    ...[108, 109, 656, 999, 280, 286, 214, 588, 1234].map((c): [string, ChamadaLote, Partial<EntradaLote>] => [`lote ${c}`, lote(c), {}]),
    ['656 duas vezes', lote(656), { vezes656Em24h: 1 }],
    ...[135, 136, 573, 655, 650, 596, 575, 236, 577, 250, 213, 489, 999, 1234].map((c): [string, ChamadaLote, Partial<EntradaLote>] => [
      `evento ${c}`,
      com128(c),
      {},
    ]),
    ['577 seguido', com128(577), { relogioNoLoteAnterior: true }],
    ['128 vazio', lote(128), {}],
    ['falha antes', erro('SEFAZ_REDE', false), {}],
    ['TEMPO', erro('SEFAZ_TEMPO', true), {}],
    ['TEMPO 3º', erro('SEFAZ_TEMPO', true), { semRespostaSeguidas: 2 }],
    ['HTTP 500', erro('SEFAZ_HTTP', true, 500), {}],
    ['HTTP 500 Sender', erro('SEFAZ_HTTP', true, 500, 'Sender'), {}],
    ['HTTP 403', erro('SEFAZ_HTTP', true, 403), {}],
    ['HTTP 400', erro('SEFAZ_HTTP', true, 400), {}],
  ];
  it.each(chamadas)('%s: cada evento aparece uma vez, na ordem, nunca "enviando" nem "cancelada"', (_n, chamada, extra) => {
    const d = decidirLote(entrada(chamada, extra));
    expect(d.eventos.map((x) => x.id)).toEqual(['ev-vetor', 'ev-k880']);
    expect(d.eventos.some((x) => x.estado === 'enviando' || x.estado === 'cancelada')).toBe(false);
  });
  it.each(chamadas)('%s: evento de volta à fila gasta tentativa, ou tem pausa no futuro, ou as respostas param', (_n, chamada, extra) => {
    const d = decidirLote(entrada(chamada, extra));
    for (const x of d.eventos.filter((y) => y.estado === 'na_fila')) {
      expect(x.gastou || (d.pausaAte !== null && d.pausaAte > AGORA) || d.situacao !== 'ok').toBe(true);
    }
  });
  it.each(chamadas)('%s: falhou só gastando e na 3ª tentativa; registrada/recusada sempre com o código do evento', (_n, chamada, extra) => {
    const eventos = [
      { ...EV_VETOR, tentativas: 3 },
      { ...EV_K880, tentativas: 2 },
    ];
    const d = decidirLote(entrada(chamada, { ...extra, eventos }));
    for (const x of d.eventos) {
      if (x.estado === 'falhou') expect(x.gastou && x.id === 'ev-vetor').toBe(true);
      if (x.estado === 'registrada' || x.estado === 'recusada') expect(x.cStat).not.toBeNull();
      if (x.estado !== 'recusada') expect(x.mensagem).toBeNull();
    }
  });
});

describe('derivaRelogio', () => {
  it('|diferença| em ms entre o dhResp da SEFAZ e o fim da consulta', () => {
    expect(derivaRelogio('2026-11-17T14:08:00-03:00', AGORA)).toBe(180_000);
    expect(derivaRelogio('2026-11-17T14:02:00-03:00', AGORA)).toBe(180_000);
    expect(derivaRelogio('2026-11-17T17:05:00Z', AGORA)).toBe(0);
    expect(derivaRelogio('2026-11-17T14:06:00.500-03:00', AGORA)).toBe(60_500);
  });
  it('ilegível ou ausente = null', () => {
    expect(derivaRelogio('lixo', AGORA)).toBeNull();
    expect(derivaRelogio('', AGORA)).toBeNull();
    expect(derivaRelogio(null, AGORA)).toBeNull();
    expect(derivaRelogio('2026-11-17T14:08:00-03:00', null)).toBeNull();
    expect(derivaRelogio('2026-11-17T14:08:00-03:00', new Date(Number.NaN))).toBeNull();
    expect(derivaRelogio('2026-13-45T14:08:00-03:00', AGORA)).toBeNull();
  });
  it('sem fuso = ilegível (não depende do TZ do processo)', () => {
    expect(derivaRelogio('2026-11-17T14:08:00', AGORA)).toBeNull();
    expect(derivaRelogio('2026-11-17', AGORA)).toBeNull();
  });
});
