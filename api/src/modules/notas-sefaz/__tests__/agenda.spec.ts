import {
  condicoes, decidir, liberadaEm, EM_ANDAMENTO_MAX_MS, ESPERA_MS, PRIMEIRO_TIQUE_MS, TIQUE_MS,
  type Chamada, type EntradaAgenda, type EstadoLinha,
} from '../agenda';
import { FRASE } from '../frases';

const AGORA = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const MAIS65 = new Date('2026-11-17T18:10:00Z'); // 15h10
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000);

const entrada = (chamada: Chamada, extra: Partial<EntradaAgenda> = {}): EntradaAgenda => ({
  agora: AGORA, ultNsuNosso: 100n, primeiraConsulta: false, anteriorEnviada: 'respondida', falhasSeguidas: 0,
  semRespostaSeguidas: 0, vezes656Em24h: 0, reservaAte: MAIS65, chamada, ...extra,
});
const ret = (cStat: number, ultNsu: bigint | null = 100n, maxNsu: bigint | null = 100n, documentos = 0): Chamada => ({
  tipo: 'retorno', cStat, ultNsu, maxNsu, documentos,
});
const erro = (code: 'SEFAZ_REDE' | 'SEFAZ_TLS' | 'SEFAZ_TEMPO' | 'SEFAZ_HTTP' | 'SEFAZ_RESPOSTA_INVALIDA', enviado: boolean, httpStatus?: number): Chamada => ({
  tipo: 'erro', code, enviado, httpStatus,
});

describe('decidir (tabela do desenho)', () => {
  it('1: 138 com ultNSU < maxNSU continua na hora', () => {
    const a = decidir(entrada(ret(138, 150n, 300n)));
    expect(a).toMatchObject({ resultado: 'respondida', ultNsu: 150n, maxNsu: 300n, proximaConsultaEm: AGORA, bloqueadoAte: null, situacao: 'ok', mensagem: null, maisPaginas: true, falhasSeguidas: 0 });
  });
  it('1b: falhas anteriores zeram numa resposta', () => {
    expect(decidir(entrada(ret(138, 150n, 300n), { falhasSeguidas: 2 })).falhasSeguidas).toBe(0);
  });
  it('2: 138 com ultNSU == maxNSU espera 65 min', () => {
    const a = decidir(entrada(ret(138, 300n, 300n)));
    expect(a).toMatchObject({ ultNsu: 300n, proximaConsultaEm: MAIS65, bloqueadoAte: null, situacao: 'ok', mensagem: null, maisPaginas: false });
  });
  it('3: 137 espera 65 min', () => {
    expect(decidir(entrada(ret(137)))).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, situacao: 'ok', mensagem: null, maisPaginas: false });
  });
  it('4: ultNSU devolvido menor que o nosso mantém o nosso e registra alerta', () => {
    const a = decidir(entrada(ret(137, 90n)));
    expect(a).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, alerta: 'ultNSU devolvido menor que o nosso' });
  });
  it('4b: 138 com ultNSU menor também não recua', () => {
    expect(decidir(entrada(ret(138, 90n, 300n))).ultNsu).toBe(100n);
  });
  it('1c: 138 sem avanço do NSU, com maxNSU maior, não continua na hora (espera do 137)', () => {
    const a = decidir(entrada(ret(138, 100n, 300n)));
    expect(a).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, maisPaginas: false, situacao: 'ok' });
    expect(a.alerta).not.toBeNull();
  });
  it('13b: resposta perdida com 656 nas últimas 24 h para a busca', () => {
    const a = decidir(entrada(ret(656, 130n), { anteriorEnviada: 'sem_resposta', vezes656Em24h: 1 }));
    expect(a).toMatchObject({ ultNsu: 130n, situacao: 'parada_656', mensagem: FRASE.bloqueouDuasVezes, lacuna: { causa: 'resposta_perdida' } });
  });
  it('15c: 1ª consulta com NSU nosso > 0 e pulo registra a lacuna', () => {
    const a = decidir(entrada(ret(656, 130n), { primeiraConsulta: true, anteriorEnviada: null }));
    expect(a).toMatchObject({ situacao: 'parada_conflito', lacuna: { nsuDe: 101n, nsuAte: 130n, causa: 'outro_sistema' } });
  });
  it('5: 1ª consulta com 138 e documentos traz o aviso D1 e não para', () => {
    const a = decidir(entrada(ret(138, 40n, 40n, 40), { primeiraConsulta: true, ultNsuNosso: 0n, anteriorEnviada: null }));
    expect(a).toMatchObject({ ultNsu: 40n, proximaConsultaEm: MAIS65, situacao: 'ok', aviso: FRASE.indicioD1 });
  });
  it('5b: fora da 1ª consulta não há aviso D1', () => {
    expect(decidir(entrada(ret(138, 40n, 40n, 40))).aviso).toBeNull();
  });
  it.each([108, 109])('6: %i = fora do ar, +65', (c) => {
    expect(decidir(entrada(ret(c)))).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, situacao: 'ok', mensagem: FRASE.foraDoAr('15h10'), resultado: 'respondida' });
  });
  it.each([500, 503, 599])('7: HTTP %i enviado = fora do ar, +65', (st) => {
    expect(decidir(entrada(erro('SEFAZ_HTTP', true, st)))).toMatchObject({ resultado: 'respondida', proximaConsultaEm: MAIS65, situacao: 'ok', mensagem: FRASE.foraDoAr('15h10') });
  });
  it.each([
    [0, 15, '14h20'],
    [1, 30, '14h35'],
    [2, 60, '15h05'],
    [5, 60, '15h05'],
  ])('8: falha antes de enviar com %i falhas antes = +%i min', (antes, mins, hora) => {
    const a = decidir(entrada(erro('SEFAZ_REDE', false), { falhasSeguidas: antes }));
    expect(a).toMatchObject({ resultado: 'falha_antes_de_enviar', ultNsu: 100n, proximaConsultaEm: min(mins), bloqueadoAte: null, situacao: 'ok', mensagem: FRASE.semContato(hora), falhasSeguidas: antes + 1 });
  });
  it('8b: handshake TLS recusado antes de enviar é a mesma regra', () => {
    expect(decidir(entrada(erro('SEFAZ_TLS', false))).resultado).toBe('falha_antes_de_enviar');
  });
  it('9: enviado sem resposta conta como consulta feita e mantém a reserva', () => {
    const a = decidir(entrada(erro('SEFAZ_TEMPO', true)));
    expect(a).toMatchObject({ resultado: 'sem_resposta', ultNsu: 100n, proximaConsultaEm: MAIS65, situacao: 'ok', mensagem: FRASE.semContato('15h10'), falhasSeguidas: 1 });
  });
  it('9b: com 1 sem resposta antes ainda é a linha 9', () => {
    expect(decidir(entrada(erro('SEFAZ_RESPOSTA_INVALIDA', true), { semRespostaSeguidas: 1 })).situacao).toBe('ok');
  });
  it('9c: conexão caída depois do envio também é sem resposta', () => {
    expect(decidir(entrada(erro('SEFAZ_REDE', true))).resultado).toBe('sem_resposta');
  });
  it.each(['SEFAZ_TEMPO', 'SEFAZ_RESPOSTA_INVALIDA'] as const)('10: %s na 3ª seguida para a busca', (code) => {
    const a = decidir(entrada(erro(code, true), { semRespostaSeguidas: 2 }));
    expect(a).toMatchObject({ resultado: 'sem_resposta', proximaConsultaEm: MAIS65, situacao: 'parada_configuracao', mensagem: FRASE.tresIlegiveis });
  });
  it('11: 656 sem ultNSU maior bloqueia por 65 min', () => {
    expect(decidir(entrada(ret(656)))).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, bloqueadoAte: MAIS65, situacao: 'ok', mensagem: FRASE.esperar('15h10'), lacuna: null });
  });
  it('11b: 656 sem ultNSU (nulo) é o mesmo', () => {
    expect(decidir(entrada(ret(656, null, null))).bloqueadoAte).toEqual(MAIS65);
  });
  it('12: o 2º 656 em 24 h desliga', () => {
    expect(decidir(entrada(ret(656), { vezes656Em24h: 1 }))).toMatchObject({ bloqueadoAte: MAIS65, situacao: 'parada_656', mensagem: FRASE.bloqueouDuasVezes });
  });
  it.each(['sem_resposta', 'interrompida'] as const)('13: 656 com ultNSU maior depois de %s = resposta perdida, não desliga', (ant) => {
    const a = decidir(entrada(ret(656, 130n), { anteriorEnviada: ant }));
    expect(a).toMatchObject({ ultNsu: 130n, proximaConsultaEm: MAIS65, bloqueadoAte: MAIS65, situacao: 'ok', mensagem: null, lacuna: { nsuDe: 101n, nsuAte: 130n, causa: 'resposta_perdida' } });
  });
  it('14: 656 com ultNSU maior depois de consulta respondida = D2', () => {
    expect(decidir(entrada(ret(656, 130n)))).toMatchObject({ ultNsu: 130n, proximaConsultaEm: MAIS65, bloqueadoAte: MAIS65, situacao: 'parada_conflito', mensagem: FRASE.conflito, lacuna: { nsuDe: 101n, nsuAte: 130n, causa: 'outro_sistema' } });
  });
  it('14b: depois de falha antes de enviar nada se perdeu: também é D2', () => {
    expect(decidir(entrada(ret(656, 130n), { anteriorEnviada: 'falha_antes_de_enviar' })).situacao).toBe('parada_conflito');
  });
  it('15: 656 com ultNSU maior na 1ª consulta = D2 sem lacuna', () => {
    expect(decidir(entrada(ret(656, 130n), { primeiraConsulta: true, ultNsuNosso: 0n, anteriorEnviada: null }))).toMatchObject({ ultNsu: 130n, bloqueadoAte: MAIS65, situacao: 'parada_conflito', mensagem: FRASE.conflito, lacuna: null });
  });
  it('15b: na 1ª consulta a resposta perdida não existe: 656 maior também é D2', () => {
    expect(decidir(entrada(ret(656, 130n), { primeiraConsulta: true, ultNsuNosso: 0n, anteriorEnviada: 'sem_resposta' })).situacao).toBe('parada_conflito');
  });
  it.each([280, 283, 286, 473])('16: retorno %i = certificado recusado', (c) => {
    expect(decidir(entrada(ret(c)))).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, bloqueadoAte: null, situacao: 'parada_certificado', mensagem: FRASE.certificadoRecusado(c) });
  });
  it('16b: HTTP 403 = certificado recusado', () => {
    expect(decidir(entrada(erro('SEFAZ_HTTP', true, 403)))).toMatchObject({ situacao: 'parada_certificado', mensagem: FRASE.certificadoRecusado(403), proximaConsultaEm: MAIS65 });
  });
  it('17: 593 = CNPJ diferente', () => {
    expect(decidir(entrada(ret(593)))).toMatchObject({ ultNsu: 100n, situacao: 'parada_configuracao', mensagem: FRASE.cnpj593, bloqueadoAte: null });
  });
  it.each([214, 215, 238, 239, 252, 402, 404, 489, 589, 999, 123])('18: retorno %i = erro de configuração, NSU não avança', (c) => {
    expect(decidir(entrada(ret(c, 500n, 600n)))).toMatchObject({ ultNsu: 100n, proximaConsultaEm: MAIS65, bloqueadoAte: null, situacao: 'parada_configuracao', mensagem: FRASE.outroCodigo(c) });
  });
  it('18b: HTTP 415 = erro de configuração', () => {
    expect(decidir(entrada(erro('SEFAZ_HTTP', true, 415)))).toMatchObject({ situacao: 'parada_configuracao', mensagem: FRASE.outroCodigo(415) });
  });
  it('não usa o relógio global: o resultado depende só do "agora" recebido', () => {
    const outro = new Date('2027-03-02T09:00:00Z');
    const a = decidir(entrada(ret(137), { agora: outro, reservaAte: outro }));
    expect(a.proximaConsultaEm.getTime()).toBe(outro.getTime() + ESPERA_MS);
  });
});

const linha = (x: Partial<EstadoLinha> = {}): EstadoLinha => ({
  busca_ligada: true, ult_nsu: 100n, proxima_consulta_em: null, bloqueado_ate: null, em_andamento_desde: null, falhas_seguidas: 0, ...x,
});

describe('condicoes', () => {
  it('sem linha ou desligada = nao_ligada, antes de qualquer outra', () => {
    expect(condicoes(null, AGORA)).toBe('nao_ligada');
    expect(condicoes(linha({ busca_ligada: false, em_andamento_desde: min(-1), proxima_consulta_em: min(5) }), AGORA)).toBe('nao_ligada');
  });
  it('em andamento há menos de 2 min = ocupada (e vem antes de aguarde)', () => {
    expect(condicoes(linha({ em_andamento_desde: min(-1), proxima_consulta_em: min(60) }), AGORA)).toBe('ocupada');
  });
  it('fronteira dos 2 min: exatamente 2 min ainda ocupa; um segundo depois libera', () => {
    const volta = (ms: number) => new Date(AGORA.getTime() - ms);
    expect(condicoes(linha({ em_andamento_desde: volta(EM_ANDAMENTO_MAX_MS) }), AGORA)).toBe('ocupada');
    expect(condicoes(linha({ em_andamento_desde: volta(EM_ANDAMENTO_MAX_MS + 1000) }), AGORA)).toBe('ok');
  });
  it('em andamento há 3 min com a próxima já passada = ok', () => {
    expect(condicoes(linha({ em_andamento_desde: min(-3), proxima_consulta_em: min(-1) }), AGORA)).toBe('ok');
  });
  it('próxima: um segundo antes aguarda, na hora e um segundo depois libera', () => {
    const p = new Date(AGORA.getTime() + 1000);
    expect(condicoes(linha({ proxima_consulta_em: p }), AGORA)).toBe('aguarde');
    expect(condicoes(linha({ proxima_consulta_em: p }), p)).toBe('ok');
    expect(condicoes(linha({ proxima_consulta_em: p }), new Date(p.getTime() + 1000))).toBe('ok');
  });
  it('bloqueado_ate no futuro aguarda mesmo com a próxima já passada', () => {
    const b = new Date(AGORA.getTime() + 1000);
    expect(condicoes(linha({ proxima_consulta_em: min(-10), bloqueado_ate: b }), AGORA)).toBe('aguarde');
    expect(condicoes(linha({ proxima_consulta_em: min(-10), bloqueado_ate: b }), b)).toBe('ok');
  });
  it('linha sem datas = ok', () => {
    expect(condicoes(linha(), AGORA)).toBe('ok');
  });
});

describe('"Buscar agora" usa o mesmo relógio', () => {
  it('a 1ª busca depois de ligar sai em até 5 minutos, e o botão não fura o intervalo', () => {
    expect(PRIMEIRO_TIQUE_MS).toBeLessThanOrEqual(TIQUE_MS);
    const ligadoEm = AGORA;
    const l = linha({ proxima_consulta_em: new Date(ligadoEm.getTime() + PRIMEIRO_TIQUE_MS) });
    expect(condicoes(l, new Date(ligadoEm.getTime() + PRIMEIRO_TIQUE_MS - 1000))).toBe('aguarde');
    expect(condicoes(l, new Date(ligadoEm.getTime() + PRIMEIRO_TIQUE_MS + 1000))).toBe('ok');
    // o 1º tique depois disso cai dentro de TIQUE_MS
    expect(PRIMEIRO_TIQUE_MS + TIQUE_MS).toBeLessThanOrEqual(6 * 60_000);
  });
  it('depois de 137 o botão também espera os 65 min (um segundo antes aguarda, um depois libera)', () => {
    const a = decidir(entrada(ret(137)));
    const l = linha({ proxima_consulta_em: a.proximaConsultaEm });
    expect(condicoes(l, new Date(a.proximaConsultaEm.getTime() - 1000))).toBe('aguarde');
    expect(condicoes(l, new Date(a.proximaConsultaEm.getTime() + 1000))).toBe('ok');
  });
});

describe('liberadaEm', () => {
  it('é o maior entre a próxima e o bloqueio', () => {
    expect(liberadaEm(linha({ proxima_consulta_em: min(10), bloqueado_ate: min(65) }))).toEqual(min(65));
    expect(liberadaEm(linha({ proxima_consulta_em: min(65), bloqueado_ate: min(10) }))).toEqual(min(65));
    expect(liberadaEm(linha({ proxima_consulta_em: min(7) }))).toEqual(min(7));
    expect(liberadaEm(linha({ bloqueado_ate: min(8) }))).toEqual(min(8));
    expect(liberadaEm(linha())).toBeNull();
  });
});
