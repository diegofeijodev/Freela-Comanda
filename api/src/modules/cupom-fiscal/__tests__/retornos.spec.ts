import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProtocoloNfce, RespostaAutorizacao, RespostaConsulta, RespostaEvento, RespostaStatus } from '../../sefaz/nfce.port';
import { sefazErro, type SefazErro } from '../../sefaz/sefaz-erro';
import { FRASE_ERRO, FRASE_RETORNO, FRASES_VALIDACAO } from '../frases';
import {
  acaoAutorizacao,
  acaoCancelamento,
  acaoConsulta,
  acaoStatus,
  familiaDoCodigo,
  motivoSefaz,
  mensagemDoAmbiente,
  relogioDiverge,
  type AcaoRetorno,
  type AcaoStatus,
  type ContextoRetorno,
  type Familia,
  type Recusa,
} from '../retornos';
import type { SituacaoCupom } from '../situacao-cupom';

const ENVIO = new Date('2026-11-17T17:05:00Z'); // 14h05 em Brasília
const AGORA = new Date('2026-11-17T17:05:20Z'); // a resposta chega 20 s depois
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;
const HORA = 60 * MIN;
const CHAVE = '35261112345678000195650020000000121000000127'; // fictícia: série 2, nº 12

const ctx = (extra: Partial<ContextoRetorno> = {}): ContextoRetorno => ({
  ambiente: 'homologacao',
  serie: 2,
  numero: 12,
  agora: AGORA,
  enviadoEm: ENVIO,
  ultimo656: null,
  ...extra,
});

const prot = (cStat: number, extra: Partial<ProtocoloNfce> = {}): ProtocoloNfce => ({
  cStat,
  xMotivo: `Rejeição: motivo ${cStat}`,
  chave: CHAVE,
  dhRecbto: '2026-11-17T14:05:20-03:00',
  nProt: cStat < 200 || cStat === 301 || cStat === 302 ? '135260000000012' : null,
  digVal: 'ZGlnVmFs',
  cMsg: null,
  xMsg: null,
  xml: '<protNFe versao="4.00"/>',
  ...extra,
});
/** Lote processado (104) com o protNFe da nota. */
const aut = (cStat: number, extra: Partial<ProtocoloNfce> = {}): RespostaAutorizacao => ({
  cStatLote: 104,
  xMotivoLote: 'Lote processado',
  dhRecbto: '2026-11-17T14:05:20-03:00',
  protocolo: prot(cStat, extra),
  xmlRetorno: '<retEnviNFe/>',
});
/** Só o código do lote, sem protNFe. */
const lote = (cStatLote: number, xMotivoLote = `Rejeição: lote ${cStatLote}`): RespostaAutorizacao => ({
  cStatLote,
  xMotivoLote,
  dhRecbto: '2026-11-17T14:05:20-03:00',
  protocolo: null,
  xmlRetorno: '<retEnviNFe/>',
});
const recusa = (codigo: number, familia: Familia, frase: string, x_motivo = `motivo ${codigo}`): Recusa => ({
  codigo,
  familia,
  frase,
  x_motivo,
});

// Frases literais da UX §6.1 com os valores do teste (envio 14h05 → consulta 14h07; 656 às 14h05:20 → 15h10).
const U = {
  jaTem: 'A SEFAZ já tem este cupom. Consulte a partir das 14h07 para ver a situação.',
  serie539:
    'A SEFAZ diz que o número 12 da série 2 já foi usado por outra nota: o caixa de hoje pode estar usando esta série. A emissão parou. Descarte este cupom e troque a série em Configurações → Cupom fiscal.',
  hora704: 'O cupom demorou para sair e a SEFAZ recusou a hora dele. Toque em Enviar de novo: a hora é refeita.',
  foraDoAr108:
    'A SEFAZ está fora do ar agora (código 108). Tente de novo mais tarde ou emita esta venda pelo caixa de hoje e descarte este cupom.',
  bloqueio15h10:
    'A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as 15h10.',
  duasVezes:
    'A SEFAZ bloqueou este sistema duas vezes em 24 horas. Por segurança, a emissão foi desligada. Fale com o contador e com o suporte do Freela Comanda antes de ligar de novo.',
  credenciada781:
    'A loja não está credenciada para emitir cupom fiscal neste modo (código 781). Peça ao contador para credenciar no portal da NFC-e da SEFAZ-SP.',
  certificado285:
    'A emissão parou: a SEFAZ recusou o certificado digital (código 285). Confira o certificado em Configurações e ligue a emissão de novo.',
  sistema225: 'A emissão parou por um erro do sistema (código 225). Fale com o suporte do Freela Comanda e informe este código.',
  qr394Teste:
    'A SEFAZ recusou o QR Code do cupom (código 394). Confira o código de segurança (CSC) e o número dele (IdCSC) do modo de teste em Configurações → Cupom fiscal.',
  qr394Valendo:
    'A SEFAZ recusou o QR Code do cupom (código 394). Confira o código de segurança (CSC) e o número dele (IdCSC) valendo em Configurações → Cupom fiscal.',
  produto: 'A SEFAZ recusou um dado fiscal de um produto deste cupom. Confira os produtos (ou peça ao contador) e toque em Enviar de novo.',
  consumidor: 'A SEFAZ recusou o CPF ou CNPJ do cliente. Descarte este cupom e emita de novo com o documento certo, ou sem ele.',
  valores780:
    'A SEFAZ recusou os valores do cupom. É um erro do sistema: descarte este cupom, emita de novo e avise o suporte do Freela Comanda, informando o código 780.',
  outra600:
    'A SEFAZ recusou o cupom (código 600). Veja a mensagem abaixo: se ela falar de um produto, confira os produtos; se não, fale com o suporte do Freela Comanda.',
  denegado110: 'A SEFAZ negou o uso do cupom (código 110): motivo 110. O número foi gasto. Fale com o contador.',
  cancelamento501: 'A SEFAZ não aceitou o cancelamento (código 501): motivo 501. O cupom continua valendo.',
};

describe('acaoAutorizacao (desenho §5.3, tabela "Autorização"; UX §6.1)', () => {
  const nula = { rejeicao: false, recusa: null };

  it.each<[string, RespostaAutorizacao | SefazErro, AcaoRetorno]>([
    ['100 autorizado', aut(100), { cupom: 'autorizado', ...nula }],
    ['150 autorizado fora de prazo', aut(150), { cupom: 'autorizado', ...nula }],
    [
      '120 autorizado com alerta: recusa nula e o alerta passa adiante',
      aut(120, { cMsg: '7', xMsg: 'Alerta: confira o NCM' }),
      { cupom: 'autorizado', ...nula, alerta: { c_msg: '7', x_msg: 'Alerta: confira o NCM' } },
    ],
    [
      '110 uso denegado',
      aut(110, { xMotivo: 'motivo 110.' }),
      { cupom: 'denegado', rejeicao: false, recusa: recusa(110, 'outra', U.denegado110, 'motivo 110.') },
    ],
    [
      '301 uso denegado',
      aut(301),
      { cupom: 'denegado', rejeicao: false, recusa: recusa(301, 'outra', FRASE_RETORNO.denegado(301, 'motivo 301')) },
    ],
    [
      '302 uso denegado',
      aut(302),
      { cupom: 'denegado', rejeicao: false, recusa: recusa(302, 'outra', FRASE_RETORNO.denegado(302, 'motivo 302')) },
    ],
    ['204 duplicidade: a consulta decide', aut(204), { cupom: 'sem_resposta', rejeicao: true, recusa: recusa(204, 'outra', U.jaTem) }],
    [
      '539 número usado por outra chave: número bloqueado e emissão parada',
      aut(539),
      {
        cupom: 'rejeitado',
        rejeicao: true,
        numeroReaproveitavel: false,
        ambiente: 'parada_serie_em_uso',
        recusa: recusa(539, 'outra', U.serie539),
      },
    ],
    ['704 hora atrasada', aut(704), { cupom: 'rejeitado', rejeicao: true, recusa: recusa(704, 'hora', U.hora704) }],
    [
      '108 serviço parado (lote): número livre, sem rejeição',
      lote(108, 'Serviço Paralisado Momentaneamente (curto prazo)'),
      {
        cupom: 'nao_enviado',
        rejeicao: false,
        recusa: recusa(108, 'outra', U.foraDoAr108, 'Serviço Paralisado Momentaneamente (curto prazo)'),
      },
    ],
    [
      '109 serviço parado (lote)',
      lote(109),
      { cupom: 'nao_enviado', rejeicao: false, recusa: recusa(109, 'outra', FRASE_RETORNO.foraDoAr(109), 'lote 109') },
    ],
    [
      '656 (lote): bloqueia por 65 min',
      lote(656),
      {
        cupom: 'nao_enviado',
        rejeicao: true,
        bloquear656: true,
        bloqueadoAte: mais(AGORA, 65 * MIN),
        recusa: recusa(656, 'outra', U.bloqueio15h10, 'lote 656'),
      },
    ],
    [
      '781 não credenciado: parada de configuração',
      lote(781),
      { cupom: 'nao_enviado', rejeicao: true, ambiente: 'parada_configuracao', recusa: recusa(781, 'outra', U.credenciada781, 'lote 781') },
    ],
    [
      '285 certificado: parada do certificado',
      lote(285),
      { cupom: 'nao_enviado', rejeicao: true, ambiente: 'parada_certificado', recusa: recusa(285, 'outra', U.certificado285, 'lote 285') },
    ],
    [
      '225 esquema: parada de configuração',
      lote(225),
      { cupom: 'nao_enviado', rejeicao: true, ambiente: 'parada_configuracao', recusa: recusa(225, 'outra', U.sistema225, 'lote 225') },
    ],
    [
      '394 QR (modo de teste): rejeitado e parada de configuração',
      aut(394),
      { cupom: 'rejeitado', rejeicao: true, ambiente: 'parada_configuracao', recusa: recusa(394, 'outra', U.qr394Teste) },
    ],
    ['386 NCM: família produto', aut(386), { cupom: 'rejeitado', rejeicao: true, recusa: recusa(386, 'produto', U.produto) }],
    [
      '786 CPF do destinatário: família consumidor',
      aut(786),
      { cupom: 'rejeitado', rejeicao: true, recusa: recusa(786, 'consumidor', U.consumidor) },
    ],
    [
      '780 valores (não confundir com o 781)',
      aut(780),
      { cupom: 'rejeitado', rejeicao: true, recusa: recusa(780, 'valores', U.valores780) },
    ],
    ['600 sem família', aut(600), { cupom: 'rejeitado', rejeicao: true, recusa: recusa(600, 'outra', U.outra600) }],
    ['SefazErro antes de enviar: número livre', sefazErro('SEFAZ_REDE', false), { cupom: 'nao_enviado', ...nula }],
    ['SefazErro depois de enviar: número preso', sefazErro('SEFAZ_TEMPO', true), { cupom: 'sem_resposta', ...nula }],
    ['SefazErro HTTP (enviado)', sefazErro('SEFAZ_HTTP', true, 500), { cupom: 'sem_resposta', ...nula }],
    // Lote aceito sem protNFe (acréscimo do controlador): a SEFAZ pode ter autorizado; a consulta pela chave decide.
    ['104 lote processado sem protNFe', lote(104, 'Lote processado'), { cupom: 'sem_resposta', ...nula }],
    ['103 lote recebido sem protNFe', lote(103, 'Lote recebido com sucesso'), { cupom: 'sem_resposta', ...nula }],
    ['105 lote em processamento sem protNFe', lote(105, 'Lote em processamento'), { cupom: 'sem_resposta', ...nula }],
    ['100 no lote sem protNFe', lote(100, 'Autorizado o uso da NF-e'), { cupom: 'sem_resposta', ...nula }],
    ['110 no lote sem protNFe', lote(110, 'Uso Denegado'), { cupom: 'sem_resposta', ...nula }],
    ['301 no lote sem protNFe', lote(301, 'Uso Denegado'), { cupom: 'sem_resposta', ...nula }],
    ['999 erro não catalogado: a consulta decide', aut(999), { cupom: 'sem_resposta', rejeicao: true, recusa: null }],
  ])('%s', (_nome, r, esperado) => {
    expect(acaoAutorizacao(r, ctx())).toEqual(esperado);
  });

  // Rodada de correção 1: o 656 no lote conta (65 min; 2º em 24 h = parada_656) mesmo com protNFe; o cupom segue o protNFe.
  it('lote 656 com protNFe 386: rejeitado pela família e o ambiente bloqueia 65 min', () => {
    const a = acaoAutorizacao({ ...aut(386), cStatLote: 656 }, ctx());
    expect(a).toEqual({
      cupom: 'rejeitado',
      rejeicao: true,
      bloquear656: true,
      bloqueadoAte: mais(AGORA, 65 * MIN),
      recusa: recusa(386, 'produto', U.produto),
    });
    expect(mensagemDoAmbiente(a)).toBe(U.bloqueio15h10);
  });

  it('lote 656 com protNFe 100: autorizado (o número é da nota), conta no teto e bloqueia', () => {
    const a = acaoAutorizacao({ ...aut(100), cStatLote: 656 }, ctx());
    expect(a).toEqual({ cupom: 'autorizado', rejeicao: true, bloquear656: true, bloqueadoAte: mais(AGORA, 65 * MIN), recusa: null });
    expect(mensagemDoAmbiente(a)).toBe(U.bloqueio15h10);
  });

  it('lote 656 (2º em 24 h) com protNFe 539: a parada_656 vale sobre a da série; o número continua bloqueado', () => {
    const a = acaoAutorizacao({ ...aut(539), cStatLote: 656 }, ctx({ ultimo656: mais(AGORA, -HORA) }));
    expect(a).toEqual({
      cupom: 'rejeitado',
      rejeicao: true,
      numeroReaproveitavel: false,
      ambiente: 'parada_656',
      bloquear656: true,
      bloqueadoAte: mais(AGORA, 65 * MIN),
      recusa: recusa(539, 'outra', U.serie539),
    });
    expect(mensagemDoAmbiente(a)).toBe(U.duasVezes);
  });

  it('mensagemDoAmbiente: a frase da parada ou do bloqueio; nula sem efeito no ambiente', () => {
    expect(mensagemDoAmbiente(acaoAutorizacao(aut(539), ctx()))).toBe(U.serie539);
    expect(mensagemDoAmbiente(acaoAutorizacao(lote(285), ctx()))).toBe(U.certificado285);
    expect(mensagemDoAmbiente(acaoAutorizacao(lote(656), ctx()))).toBe(U.bloqueio15h10);
    expect(mensagemDoAmbiente(acaoAutorizacao(lote(656), ctx({ ultimo656: mais(AGORA, -HORA) })))).toBe(U.duasVezes);
    expect(mensagemDoAmbiente(acaoAutorizacao(aut(100), ctx()))).toBeNull();
    expect(mensagemDoAmbiente(acaoAutorizacao(aut(386), ctx()))).toBeNull();
  });

  it('o protNFe vale sobre o código do lote', () => {
    expect(acaoAutorizacao({ ...aut(386), cStatLote: 656 }, ctx()).cupom).toBe('rejeitado');
    expect(acaoAutorizacao({ ...aut(100), cStatLote: 225 }, ctx()).cupom).toBe('autorizado');
  });

  it('código especial dentro do protNFe segue a mesma tabela (656, 285 e 108)', () => {
    expect(acaoAutorizacao(aut(656), ctx())).toMatchObject({ cupom: 'nao_enviado', bloquear656: true });
    expect(acaoAutorizacao(aut(285), ctx())).toMatchObject({ cupom: 'nao_enviado', ambiente: 'parada_certificado' });
    expect(acaoAutorizacao(aut(108), ctx())).toMatchObject({ cupom: 'nao_enviado', rejeicao: false });
  });

  it('656: o 2º em 24 h para a emissão (parada_656); 24 h e 1 ms depois do anterior, não', () => {
    expect(acaoAutorizacao(lote(656), ctx({ ultimo656: mais(AGORA, -23 * HORA) }))).toEqual({
      cupom: 'nao_enviado',
      rejeicao: true,
      bloquear656: true,
      bloqueadoAte: mais(AGORA, 65 * MIN),
      ambiente: 'parada_656',
      recusa: recusa(656, 'outra', U.duasVezes, 'lote 656'),
    });
    expect(acaoAutorizacao(lote(656), ctx({ ultimo656: mais(AGORA, -24 * HORA) })).ambiente).toBe('parada_656');
    const depois = acaoAutorizacao(lote(656), ctx({ ultimo656: mais(AGORA, -24 * HORA - 1) }));
    expect(depois.ambiente).toBeUndefined();
    expect(depois.recusa?.frase).toBe(U.bloqueio15h10);
  });

  it('QR valendo usa "valendo" no lugar de "do modo de teste"', () => {
    expect(acaoAutorizacao(aut(394), ctx({ ambiente: 'producao' })).recusa?.frase).toBe(U.qr394Valendo);
  });

  // Rodada de correção 1: o 373 é a recusa do nome do 1º item em homologação (§5.2; `XPROD_HOMOLOGACAO`), defeito nosso, não o QR.
  it('373 (nome do 1º item em homologação): rejeitado + parada_configuracao, com a frase de erro do sistema', () => {
    expect(acaoAutorizacao(aut(373), ctx())).toEqual({
      cupom: 'rejeitado',
      rejeicao: true,
      ambiente: 'parada_configuracao',
      recusa: recusa(
        373,
        'outra',
        'A emissão parou por um erro do sistema (código 373). Fale com o suporte do Freela Comanda e informe este código.',
      ),
    });
  });

  it.each([394, 395])('QR %i: rejeitado + parada_configuracao', (c) => {
    expect(acaoAutorizacao(aut(c), ctx())).toMatchObject({ cupom: 'rejeitado', ambiente: 'parada_configuracao' });
  });

  it.each([213, 280, 283, 286, 290, 297, 298])('certificado/assinatura %i: nao_enviado + parada_certificado', (c) => {
    expect(acaoAutorizacao(lote(c), ctx())).toMatchObject({ cupom: 'nao_enviado', ambiente: 'parada_certificado' });
  });

  it.each([214, 215, 225, 402, 404, 516, 517, 587, 588])('esquema e lote %i: nao_enviado + parada_configuracao', (c) => {
    expect(acaoAutorizacao(lote(c), ctx())).toMatchObject({ cupom: 'nao_enviado', ambiente: 'parada_configuracao' });
  });

  it.each([279, 287, 289, 299, 212])('vizinho dos intervalos %i: rejeição comum, sem parada', (c) => {
    const a = acaoAutorizacao(aut(c), ctx());
    expect(a).toMatchObject({ cupom: 'rejeitado', rejeicao: true });
    expect(a.ambiente).toBeUndefined();
  });

  it('204: a hora da consulta é a do envio + 2 min (a mesma base de consultar_a_partir_de)', () => {
    const a = acaoAutorizacao(aut(204), ctx({ enviadoEm: new Date('2026-11-17T17:30:00Z') }));
    expect(a.recusa?.frase).toBe('A SEFAZ já tem este cupom. Consulte a partir das 14h32 para ver a situação.');
  });

  it('539 usa a série e o número do cupom do contexto', () => {
    expect(acaoAutorizacao(aut(539), ctx({ serie: 7, numero: 300 })).recusa?.frase).toContain('o número 300 da série 7 já foi usado');
  });

  // Decisão do controlador (T9-4): sem protocolo não há prova nem DANFE; o adaptador anula o nProt fora do formato.
  it.each([100, 150, 120, 110, 301, 302])('%i com protNFe mas sem nProt válido → sem_resposta (consultar pela chave)', (c) => {
    expect(acaoAutorizacao(aut(c, { nProt: null, cMsg: '7', xMsg: 'Aviso' }), ctx())).toEqual({
      cupom: 'sem_resposta',
      rejeicao: false,
      recusa: null,
    });
  });
});

describe('acaoConsulta (desenho §5.3, tabela "Consulta"; §5.1 "Consultar")', () => {
  const cons = (cStat: number, extra: Partial<RespostaConsulta> = {}): RespostaConsulta => ({
    cStat,
    xMotivo: `Rejeição: consulta ${cStat}`,
    protocolo: null,
    cancelamento: null,
    xmlRetorno: '<retConsSitNFe/>',
    ...extra,
  });
  const autorizada = (extra: Partial<RespostaConsulta> = {}) =>
    cons(100, { xMotivo: 'Autorizado o uso da NF-e', protocolo: prot(100), ...extra });
  const evento = (cStat = 135) => ({ cStat, nProt: '135260000000099', chave: null, tpAmb: null, xml: '<procEventoNFe/>' });

  it.each<[string, RespostaConsulta | SefazErro, SituacaoCupom, Partial<AcaoRetorno>]>([
    ['217 em sem_resposta → nao_consta', cons(217), 'sem_resposta', { cupom: 'nao_consta', rejeicao: true, recusa: null }],
    ['217 em enviando vencido → nao_consta', cons(217), 'enviando', { cupom: 'nao_consta' }],
    ['217 em rejeitado → nao_consta', cons(217), 'rejeitado', { cupom: 'nao_consta' }],
    ['217 em autorizado: temos o protocolo, nada muda', cons(217), 'autorizado', { cupom: 'autorizado' }],
    ['217 em cancelando: nada muda', cons(217), 'cancelando', { cupom: 'cancelando' }],
    ['autorizada em sem_resposta → autorizado', autorizada(), 'sem_resposta', { cupom: 'autorizado', rejeicao: false, recusa: null }],
    ['autorizada em nao_enviado → autorizado', autorizada(), 'nao_enviado', { cupom: 'autorizado' }],
    [
      'procEventoNFe de cancelamento em cancelando → cancelado',
      autorizada({ cStat: 101, cancelamento: evento() }),
      'cancelando',
      { cupom: 'cancelado', rejeicao: false, recusa: null },
    ],
    [
      'cancelamento 155 (fora de prazo, homologado) → cancelado',
      autorizada({ cancelamento: evento(155) }),
      'cancelando',
      { cupom: 'cancelado' },
    ],
    ['evento de cancelamento em autorizado → cancelado', autorizada({ cancelamento: evento() }), 'autorizado', { cupom: 'cancelado' }],
    ['101 (nota cancelada) sem procEventoNFe → cancelado', cons(101), 'cancelando', { cupom: 'cancelado' }],
    ['sem evento, nota autorizada, em cancelando → autorizado', autorizada(), 'cancelando', { cupom: 'autorizado', recusa: null }],
    ['evento com código não registrado não cancela', autorizada({ cancelamento: evento(573) }), 'cancelando', { cupom: 'autorizado' }],
    [
      'denegada em sem_resposta → denegado',
      cons(110, { protocolo: prot(110, { xMotivo: 'Uso Denegado' }) }),
      'sem_resposta',
      { cupom: 'denegado', rejeicao: false, recusa: recusa(110, 'outra', FRASE_RETORNO.denegado(110, 'Uso Denegado'), 'Uso Denegado') },
    ],
    ['108 em sem_resposta: continua', cons(108), 'sem_resposta', { cupom: 'sem_resposta', rejeicao: false, recusa: null }],
    ['108 em cancelando: continua', cons(108), 'cancelando', { cupom: 'cancelando' }],
    ['outro código em sem_resposta: continua', cons(600), 'sem_resposta', { cupom: 'sem_resposta', rejeicao: true, recusa: null }],
    ['999 em sem_resposta: continua', cons(999), 'sem_resposta', { cupom: 'sem_resposta' }],
    ['SefazErro em sem_resposta: continua', sefazErro('SEFAZ_TEMPO', true), 'sem_resposta', { cupom: 'sem_resposta', rejeicao: false }],
    ['SefazErro em enviando vencido → sem_resposta', sefazErro('SEFAZ_REDE', false), 'enviando', { cupom: 'sem_resposta' }],
    ['SefazErro em cancelando: continua', sefazErro('SEFAZ_TEMPO', true), 'cancelando', { cupom: 'cancelando' }],
    ['cancelado é final', autorizada(), 'cancelado', { cupom: 'cancelado' }],
    ['denegado é final', cons(217), 'denegado', { cupom: 'denegado' }],
    ['descartado é final', autorizada(), 'descartado', { cupom: 'descartado' }],
  ])('%s', (_nome, r, atual, esperado) => {
    const a = acaoConsulta(r, atual, ctx());
    expect(a).toMatchObject(esperado);
    // Consulta nunca libera nem bloqueia número, nem marca reenvio.
    expect(a.numeroReaproveitavel).toBeUndefined();
    expect(a.cupom).not.toBe('nao_enviado');
  });

  it('120 na consulta: autorizado com o alerta', () => {
    const r = cons(100, { protocolo: prot(120, { cMsg: '9', xMsg: 'Aviso' }) });
    expect(acaoConsulta(r, 'sem_resposta', ctx())).toEqual({
      cupom: 'autorizado',
      rejeicao: false,
      recusa: null,
      alerta: { c_msg: '9', x_msg: 'Aviso' },
    });
  });

  it('656 na consulta: o cupom fica como está e o ambiente bloqueia 65 min', () => {
    expect(acaoConsulta(cons(656), 'cancelando', ctx())).toEqual({
      cupom: 'cancelando',
      rejeicao: true,
      bloquear656: true,
      bloqueadoAte: mais(AGORA, 65 * MIN),
      recusa: recusa(656, 'outra', U.bloqueio15h10, 'consulta 656'),
    });
    expect(acaoConsulta(cons(656), 'sem_resposta', ctx({ ultimo656: mais(AGORA, -HORA) }))).toMatchObject({
      cupom: 'sem_resposta',
      ambiente: 'parada_656',
    });
  });

  // T9-4: a SEFAZ indica que tem a nota (autorizada ou denegada), mas sem nProt válido → sem_resposta: o número fica preso, mesmo que o
  // cupom estivesse num estado de número livre (rejeitado, nao_enviado, nao_consta). Com protocolo nosso (autorizado/cancelando), nada muda.
  it.each<[string, RespostaConsulta, SituacaoCupom, SituacaoCupom]>([
    ['autorizada sem nProt, em sem_resposta', autorizada({ protocolo: prot(100, { nProt: null }) }), 'sem_resposta', 'sem_resposta'],
    ['autorizada sem nProt, em rejeitado', autorizada({ protocolo: prot(100, { nProt: null }) }), 'rejeitado', 'sem_resposta'],
    ['autorizada sem nProt, em nao_enviado', autorizada({ protocolo: prot(150, { nProt: null }) }), 'nao_enviado', 'sem_resposta'],
    ['autorizada sem nProt, em nao_consta', autorizada({ protocolo: prot(120, { nProt: null }) }), 'nao_consta', 'sem_resposta'],
    ['autorizada sem protNFe, em rejeitado', cons(100), 'rejeitado', 'sem_resposta'],
    ['denegada sem nProt, em sem_resposta', cons(110, { protocolo: prot(110, { nProt: null }) }), 'sem_resposta', 'sem_resposta'],
    ['denegada sem protNFe, em nao_enviado', cons(302), 'nao_enviado', 'sem_resposta'],
    ['autorizada sem nProt, em cancelando: continua', autorizada({ protocolo: prot(100, { nProt: null }) }), 'cancelando', 'cancelando'],
    ['autorizada sem nProt, em autorizado: continua', autorizada({ protocolo: prot(100, { nProt: null }) }), 'autorizado', 'autorizado'],
  ])('%s → %s', (_nome, r, atual, esperado) => {
    expect(acaoConsulta(r, atual, ctx())).toEqual({ cupom: esperado, rejeicao: false, recusa: null });
  });

  it('certificado e esquema na consulta: o cupom fica e o ambiente para', () => {
    expect(acaoConsulta(cons(285), 'sem_resposta', ctx())).toMatchObject({ cupom: 'sem_resposta', ambiente: 'parada_certificado' });
    expect(acaoConsulta(cons(225), 'cancelando', ctx())).toMatchObject({ cupom: 'cancelando', ambiente: 'parada_configuracao' });
    expect(acaoConsulta(cons(285), 'cancelado', ctx())).toMatchObject({ cupom: 'cancelado', ambiente: 'parada_certificado' });
  });
});

describe('acaoCancelamento (desenho §5.4)', () => {
  const ev = (cStat: number | null, extra: Partial<RespostaEvento> = {}): RespostaEvento => ({
    cStatLote: 128,
    xMotivoLote: 'Lote de evento processado',
    cStat,
    xMotivo: cStat === null ? null : `Rejeição: motivo ${cStat}`,
    nProt: cStat === 135 ? '135260000000099' : null,
    dhRegEvento: '2026-11-17T14:20:00-03:00',
    xmlRetorno: '<retEnvEvento/>',
    ...extra,
  });
  const loteEv = (cStatLote: number): RespostaEvento => ({
    cStatLote,
    xMotivoLote: `Rejeição: lote ${cStatLote}`,
    cStat: null,
    xMotivo: null,
    nProt: null,
    dhRegEvento: null,
    xmlRetorno: '<retEnvEvento/>',
  });
  const nula = { rejeicao: false, recusa: null };

  it.each<[string, RespostaEvento | SefazErro, AcaoRetorno]>([
    ['135 → cancelado', ev(135), { cupom: 'cancelado', ...nula }],
    ['155 → cancelado', ev(155), { cupom: 'cancelado', ...nula }],
    ['573 duplicidade do evento → cancelando', ev(573), { cupom: 'cancelando', rejeicao: true, recusa: null }],
    ['SefazErro depois de enviar → cancelando', sefazErro('SEFAZ_TEMPO', true), { cupom: 'cancelando', ...nula }],
    ['SefazErro antes de enviar → continua autorizado', sefazErro('SEFAZ_REDE', false), { cupom: 'autorizado', ...nula }],
    ['lote 128 sem retEvento → cancelando (a consulta decide)', ev(null), { cupom: 'cancelando', ...nula }],
    ['136 (não reconhecido, não é rejeição) → cancelando', ev(136), { cupom: 'cancelando', ...nula }],
    ['999 → cancelando', ev(999), { cupom: 'cancelando', rejeicao: true, recusa: null }],
    [
      '501 (recusa do evento) → continua autorizado, com a frase',
      ev(501),
      { cupom: 'autorizado', rejeicao: true, recusa: recusa(501, 'outra', U.cancelamento501) },
    ],
    [
      '108 → continua autorizado, sem rejeição',
      ev(108),
      { cupom: 'autorizado', rejeicao: false, recusa: recusa(108, 'outra', FRASE_RETORNO.cancelamentoRecusado(108, 'motivo 108')) },
    ],
    [
      '656 no evento → continua autorizado e bloqueia',
      ev(656),
      {
        cupom: 'autorizado',
        rejeicao: true,
        bloquear656: true,
        bloqueadoAte: mais(AGORA, 65 * MIN),
        recusa: recusa(656, 'outra', U.bloqueio15h10),
      },
    ],
    [
      '656 no lote → continua autorizado e bloqueia',
      loteEv(656),
      {
        cupom: 'autorizado',
        rejeicao: true,
        bloquear656: true,
        bloqueadoAte: mais(AGORA, 65 * MIN),
        recusa: recusa(656, 'outra', U.bloqueio15h10, 'lote 656'),
      },
    ],
    [
      '285 → continua autorizado e para o certificado',
      ev(285),
      { cupom: 'autorizado', rejeicao: true, ambiente: 'parada_certificado', recusa: recusa(285, 'outra', U.certificado285) },
    ],
    [
      'lote 225 → continua autorizado e para a configuração',
      loteEv(225),
      { cupom: 'autorizado', rejeicao: true, ambiente: 'parada_configuracao', recusa: recusa(225, 'outra', U.sistema225, 'lote 225') },
    ],
  ])('%s', (_nome, r, esperado) => {
    expect(acaoCancelamento(r, ctx())).toEqual(esperado);
  });
});

describe('acaoStatus ("Testar a conexão"; UX 5.1; decisão T9-3)', () => {
  const st = (cStat: number, xMotivo = `Rejeição: status ${cStat}`): RespostaStatus => ({
    cStat,
    xMotivo,
    dhRecbto: '2026-11-17T14:05:20-03:00',
    tMed: 1,
  });
  const ctxStatus = (ultimo656: Date | null = null) => ({ agora: AGORA, ultimo656 });

  it.each<[string, RespostaStatus | SefazErro, AcaoStatus]>([
    [
      '107 em operação',
      st(107, 'Serviço em Operação'),
      { emOperacao: true, rejeicao: false, codigo: 107, frase: 'A SEFAZ respondeu às 14h05: o serviço está funcionando.' },
    ],
    ['108 fora do ar', st(108), { emOperacao: false, rejeicao: false, codigo: 108, frase: 'A SEFAZ está fora do ar agora (código 108).' }],
    ['109 fora do ar', st(109), { emOperacao: false, rejeicao: false, codigo: 109, frase: 'A SEFAZ está fora do ar agora (código 109).' }],
    [
      'SefazErro antes de enviar',
      sefazErro('SEFAZ_REDE', false),
      { emOperacao: false, rejeicao: false, codigo: null, frase: 'Não consegui falar com a SEFAZ. Nada foi enviado.' },
    ],
    [
      'SefazErro depois de enviar',
      sefazErro('SEFAZ_TEMPO', true),
      { emOperacao: false, rejeicao: false, codigo: null, frase: 'Não consegui falar com a SEFAZ. Nada foi enviado.' },
    ],
    [
      '656: conta como nos outros serviços',
      st(656),
      { emOperacao: false, rejeicao: true, codigo: 656, bloquear656: true, bloqueadoAte: mais(AGORA, 65 * MIN), frase: U.bloqueio15h10 },
    ],
    [
      '285 certificado: a frase do certificado e a parada',
      st(285),
      { emOperacao: false, rejeicao: true, codigo: 285, ambiente: 'parada_certificado', frase: U.certificado285 },
    ],
    [
      '225 esquema: parada de configuração',
      st(225),
      { emOperacao: false, rejeicao: true, codigo: 225, ambiente: 'parada_configuracao', frase: U.sistema225 },
    ],
    [
      '781 não credenciado: parada de configuração',
      st(781),
      { emOperacao: false, rejeicao: true, codigo: 781, ambiente: 'parada_configuracao', frase: U.credenciada781 },
    ],
    [
      '252 outra rejeição: conta no teto, sem parada',
      st(252),
      { emOperacao: false, rejeicao: true, codigo: 252, frase: FRASE_RETORNO.statusOutroCodigo(252) },
    ],
    [
      '106 (1xx desconhecido): não é rejeição',
      st(106),
      { emOperacao: false, rejeicao: false, codigo: 106, frase: FRASE_RETORNO.statusOutroCodigo(106) },
    ],
  ])('%s', (_nome, r, esperado) => {
    expect(acaoStatus(r, ctxStatus())).toEqual(esperado);
  });

  it('o 2º 656 em 24 h também para a emissão no status', () => {
    expect(acaoStatus(st(656), ctxStatus(mais(AGORA, -2 * HORA)))).toEqual({
      emOperacao: false,
      rejeicao: true,
      codigo: 656,
      bloquear656: true,
      bloqueadoAte: mais(AGORA, 65 * MIN),
      ambiente: 'parada_656',
      frase: U.duasVezes,
    });
  });
});

describe('familiaDoCodigo (desenho §11, ponto 10.4)', () => {
  it.each([
    [386, 'produto'],
    [725, 'produto'],
    [391, 'valores'],
    [436, 'valores'],
    [610, 'valores'],
    [629, 'valores'],
    [780, 'valores'],
    [857, 'valores'],
    [869, 'valores'],
    [899, 'valores'],
    [963, 'valores'],
    [786, 'consumidor'],
    [787, 'consumidor'],
    [788, 'consumidor'],
    [704, 'hora'],
    [781, 'outra'],
    [539, 'outra'],
    [999, 'outra'],
  ])('%i → %s', (c, f) => {
    expect(familiaDoCodigo(c)).toBe(f);
  });
});

// Rodada de correção 1: sem motivo, a frase não fica com ": ." (o xMotivo do evento pode vir nulo).
describe('motivo vazio nas frases com <motivo>', () => {
  it.each(['', '   ', '.', null])('denegado e cancelamento recusado com motivo %p', (m) => {
    expect(FRASE_RETORNO.denegado(110, motivoSefaz(m))).toBe(
      'A SEFAZ negou o uso do cupom (código 110). O número foi gasto. Fale com o contador.',
    );
    expect(FRASE_RETORNO.cancelamentoRecusado(501, motivoSefaz(m))).toBe(
      'A SEFAZ não aceitou o cancelamento (código 501). O cupom continua valendo.',
    );
  });

  it('pelas ações: evento 501 com xMotivo nulo e denegado com xMotivo vazio', () => {
    const ev: RespostaEvento = {
      cStatLote: 128,
      xMotivoLote: 'Lote de evento processado',
      cStat: 501,
      xMotivo: null,
      nProt: null,
      dhRegEvento: null,
      xmlRetorno: '<retEnvEvento/>',
    };
    expect(acaoCancelamento(ev, ctx()).recusa).toEqual(
      recusa(501, 'outra', 'A SEFAZ não aceitou o cancelamento (código 501). O cupom continua valendo.', ''),
    );
    expect(acaoAutorizacao(aut(110, { xMotivo: '' }), ctx()).recusa).toEqual(
      recusa(110, 'outra', 'A SEFAZ negou o uso do cupom (código 110). O número foi gasto. Fale com o contador.', ''),
    );
  });
});

describe('motivoSefaz (o xMotivo à parte, para o <details>)', () => {
  it('tira o prefixo "Rejeição:" e apara', () => {
    expect(motivoSefaz('Rejeição: NCM inexistente ')).toBe('NCM inexistente');
    expect(motivoSefaz('Rejeicao:NCM inexistente')).toBe('NCM inexistente');
    expect(motivoSefaz('Uso Denegado: Irregularidade fiscal do emitente')).toBe('Uso Denegado: Irregularidade fiscal do emitente');
    expect(motivoSefaz(null)).toBe('');
  });

  it('corta em 255 caracteres (sem partir emoji)', () => {
    expect(Array.from(motivoSefaz('a'.repeat(300)))).toHaveLength(255);
    expect(motivoSefaz('😀'.repeat(300))).toBe('😀'.repeat(255));
  });
});

describe('relogioDiverge (§4.4, regra 8)', () => {
  const agora = new Date('2026-11-17T17:05:00Z');
  it.each([
    ['2026-11-17T14:07:00-03:00', false], // 120 s
    ['2026-11-17T14:07:01-03:00', true], // 121 s adiantado
    ['2026-11-17T14:02:59-03:00', true], // 121 s atrasado
    ['2026-11-17T17:06:00Z', false],
    ['2026-11-17T14:10:00', false], // sem fuso: não dá para comparar
    ['lixo', false],
  ])('%s → %s', (dh, esperado) => {
    expect(relogioDiverge(dh, agora)).toBe(esperado);
  });
});

// As frases do servidor são o texto final da UX (§6.1 e §6.2), letra por letra: o teste procura cada uma, com os valores de exemplo da UX,
// no próprio arquivo da UX (e as que a UX diz "igual ao desenho", no desenho).
describe('frases.ts = UX §6.1 e §6.2, literais', () => {
  const specs = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'superpowers', 'specs');
  const UX = readFileSync(join(specs, '2026-11-17-cupom-fiscal-ux.md'), 'utf8');
  const DESENHO = readFileSync(join(specs, '2026-11-17-cupom-fiscal-design.md'), 'utf8');
  const sp = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00-03:00`);
  const comN = (s: string, n: number) => s.replace(`código ${n}`, 'código N');
  const F = FRASE_RETORNO;
  const E = FRASE_ERRO;

  it('a frase do 539 com a série 2 e o número 12 é a da UX 6.1', () => {
    expect(F.serieEmUso(2, 12)).toBe(U.serie539);
    expect(UX).toContain(`"${F.serieEmUso(2, 12)}"`);
  });

  it.each<[string, string]>([
    ['autorizado', F.autorizado(sp('14:05'), '…')],
    ['120', F.autorizadoComAlerta('<xMsg>')],
    ['denegado', comN(F.denegado(110, '<motivo>'), 110)],
    ['204', F.jaTem(sp('14:07'))],
    ['704', F.horaAtrasada],
    ['108/109', comN(F.foraDoAr(108), 108)],
    ['656', F.bloqueio656(sp('15:10'))],
    ['2º 656', F.bloqueouDuasVezes],
    ['781', F.naoCredenciada],
    ['certificado', comN(F.certificado(285), 285)],
    ['esquema', comN(F.erroDoSistema(225), 225)],
    ['QR', comN(F.qrCode(394, 'homologacao'), 394)],
    ['relógio', F.relogio],
    ['teto de recusas', F.muitasRecusas(sp('15:10'))],
    ['produto', F.recusaProduto],
    ['empresa', F.recusaEmpresa],
    ['consumidor', F.recusaConsumidor],
    ['valores', comN(F.recusaValores(780), 780)],
    ['sem família', comN(F.recusaOutra(600), 600)],
    ['SefazErro não enviado', F.naoEnviado],
    ['SefazErro enviado', F.semResposta(sp('14:07'))],
    ['cancelamento recusado (UX 4.3)', comN(F.cancelamentoRecusado(501, '<motivo>'), 501)],
    ['Testar a conexão: funcionando (UX 5.1)', F.statusOk(sp('14:05'))],
    ['Testar a conexão: sem contato (UX 5.1)', F.statusSemContato],
    ['Testar a conexão: fora do ar (UX 5.1)', comN(F.statusForaDoAr(108), 108)],
  ])('6.1 %s', (_nome, frase) => {
    expect(UX).toContain(`"${frase}"`);
  });

  it.each<[string, string]>([
    ['NFCE_DESLIGADA', E.NFCE_DESLIGADA],
    ['NFCE_EMISSAO_DESLIGADA', E.NFCE_EMISSAO_DESLIGADA],
    ['NFCE_CONFIG_INCOMPLETA', E.NFCE_CONFIG_INCOMPLETA(['inscrição estadual', 'código de segurança (CSC)'])],
    ['NFCE_SEM_ITENS', E.NFCE_SEM_ITENS],
    ['NFCE_ITEM_INDISPONIVEL', E.NFCE_ITEM_INDISPONIVEL('Chopp 1 litro', 'falta_ncm')],
    ['NFCE_DESCONTO_INVALIDO', E.NFCE_DESCONTO_INVALIDO(5370n)],
    ['NFCE_PAGAMENTO_INSUFICIENTE', E.NFCE_PAGAMENTO_INSUFICIENTE(4000n, 5000n)],
    ['NFCE_TROCO_INVALIDO', E.NFCE_TROCO_INVALIDO],
    ['NFCE_DOC_INVALIDO cpf', E.NFCE_DOC_INVALIDO('cpf')],
    ['NFCE_DOC_INVALIDO cnpj', E.NFCE_DOC_INVALIDO('cnpj')],
    ['NFCE_DOC_OBRIGATORIO', E.NFCE_DOC_OBRIGATORIO],
    ['NFCE_SITUACAO', E.NFCE_SITUACAO('cancelado', 'imprimir')],
    ['NFCE_CONSULTA_CEDO', E.NFCE_CONSULTA_CEDO(sp('14:07'))],
    ['NFCE_LIMITE_ENVIOS', E.NFCE_LIMITE_ENVIOS],
    ['NFCE_CANCELAMENTO_FORA_DO_PRAZO', E.NFCE_CANCELAMENTO_FORA_DO_PRAZO(sp('14:05'))],
    ['NFCE_MOTIVO cancelar', E.NFCE_MOTIVO('cancelar')],
    ['NFCE_MOTIVO descartar', E.NFCE_MOTIVO('descartar')],
    ['NFCE_SERIE_INVALIDA', E.NFCE_SERIE_INVALIDA],
    ['NFCE_SERIE_COM_PENDENTES', E.NFCE_SERIE_COM_PENDENTES],
    ['NFCE_CSC_INVALIDO csc', E.NFCE_CSC_INVALIDO('csc')],
    ['NFCE_CSC_INVALIDO id_csc', E.NFCE_CSC_INVALIDO('id_csc')],
    ['NFCE_PERFIL_INVALIDO Simples', FRASES_VALIDACAO.simplesSemCsosn],
    ['NFCE_PERFIL_INVALIDO normal', FRASES_VALIDACAO.normalSemCst],
    ['NFCE_PERFIL_INVALIDO 500', FRASES_VALIDACAO.csosn500],
    ['NFCE_PRODUCAO_SEM_TESTE', E.NFCE_PRODUCAO_SEM_TESTE],
    ['NFCE_LANCA_VENDA_PENDENTE', E.NFCE_LANCA_VENDA_PENDENTE],
    ['NFCE_TESTE_CEDO', E.NFCE_TESTE_CEDO(sp('14:10'))],
    ['NFCE_BLOQUEADA = 656 da 6.1', E.NFCE_BLOQUEADA(sp('15:10'))],
    ['NFCE_MUITAS_RECUSAS = teto da 6.1', E.NFCE_MUITAS_RECUSAS(sp('15:10'))],
    ['GTIN (UX §5.7)', FRASES_VALIDACAO.gtin],
  ])('6.2 %s', (_nome, frase) => {
    expect(UX).toContain(`"${frase}"`);
  });

  it('6.2 NFCE_NUMERO_INVALIDO: "igual ao desenho"', () => {
    const f = E.NFCE_NUMERO_INVALIDO(11, 2).replace('maior que 11,', 'maior que N,').replace('série 2.', 'série S.');
    expect(DESENHO).toContain(`"${f}"`);
  });

  it('dinheiro com ponto de milhar e espaço comum (sem U+00A0)', () => {
    expect(E.NFCE_PAGAMENTO_INSUFICIENTE(123456789n, 5n)).toBe('A soma dos pagamentos (R$ 1.234.567,89) é menor que o total (R$ 0,05).');
  });

  it('lista de configuração: 1, 2 e 3 itens', () => {
    expect(E.NFCE_CONFIG_INCOMPLETA(['inscrição estadual'])).toBe('Falta configurar o cupom fiscal: inscrição estadual.');
    expect(E.NFCE_CONFIG_INCOMPLETA(['a', 'b', 'c'])).toBe('Falta configurar o cupom fiscal: a, b e c.');
  });

  it('hora em Brasília também com TZ=UTC (14h05, nunca 17h05)', () => {
    expect(F.autorizado(new Date('2026-11-17T17:05:31Z'), '135260000000012')).toBe('Autorizado às 14h05 · protocolo 135260000000012');
  });
});
