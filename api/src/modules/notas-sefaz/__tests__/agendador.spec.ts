import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { AgendadorSefaz } from '../agendador';
import type { CicloSefazService, ResumoCiclo } from '../ciclo.service';
import type { RespostasSefazService, ResumoRespostas } from '../respostas.service';

const MIN = 60_000;

function montar(ambiente: 'desligado' | 'homologacao' | 'producao', ciclo?: jest.Mock, processar?: jest.Mock) {
  const falso = {
    ambiente: jest.fn(() => ambiente),
    ciclo: ciclo ?? jest.fn(async (): Promise<ResumoCiclo> => ({ fim: 'aguarde', paginas: 0 })),
    classificarPendentes: jest.fn(async () => 0),
  };
  const respostas = { processar: processar ?? jest.fn(async (): Promise<ResumoRespostas> => ({ fim: 'vazia', enviados: 0 })) };
  const ag = new AgendadorSefaz(falso as unknown as CicloSefazService, respostas as unknown as RespostasSefazService);
  ag.onApplicationBootstrap();
  return { ag, falso, respostas };
}

describe('AgendadorSefaz', () => {
  let erros: string[];
  beforeEach(() => {
    jest.useFakeTimers();
    erros = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...a: unknown[]) => void erros.push(a.map(String).join(' ')));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('desligado: nenhum timer e nenhum ciclo', async () => {
    const { falso, respostas } = montar('desligado');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(11 * MIN);
    expect(falso.ciclo).not.toHaveBeenCalled();
    expect(falso.classificarPendentes).not.toHaveBeenCalled();
    expect(respostas.processar).not.toHaveBeenCalled();
  });

  it('o tique chama as respostas DEPOIS da busca e da classificação, uma vez por tique', async () => {
    const { falso, respostas } = montar('producao');
    await jest.advanceTimersByTimeAsync(MIN);
    expect(respostas.processar).toHaveBeenCalledTimes(1);
    const ordem = (m: jest.Mock) => m.mock.invocationCallOrder[0];
    expect(ordem(falso.ciclo)).toBeLessThan(ordem(falso.classificarPendentes));
    expect(ordem(falso.classificarPendentes)).toBeLessThan(ordem(respostas.processar));
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(respostas.processar).toHaveBeenCalledTimes(2);
  });

  it('erro das respostas vira logger.error (classe e code, sem a mensagem) e não derruba o tique nem a busca', async () => {
    const processar = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('texto da biblioteca <evento>'), { code: 'P2002' }))
      .mockResolvedValue({ fim: 'vazia', enviados: 0 });
    const { ag, falso } = montar('producao', undefined, processar);
    await jest.advanceTimersByTimeAsync(MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(1);
    expect(falso.classificarPendentes).toHaveBeenCalledTimes(1);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('respostas');
    expect(erros[0]).toContain('P2002');
    expect(erros[0]).not.toContain('texto da biblioteca');
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(2);
    expect(processar).toHaveBeenCalledTimes(2);
    processar.mockRejectedValue('não é Error');
    await expect(ag.tique()).resolves.toBeUndefined();
  });

  it('a busca e a classificação falhando, as respostas rodam mesmo assim', async () => {
    const ciclo = jest.fn().mockRejectedValue(new Error('x'));
    const { falso, respostas } = montar('producao', ciclo);
    falso.classificarPendentes.mockRejectedValue(new Error('y'));
    await jest.advanceTimersByTimeAsync(MIN);
    expect(respostas.processar).toHaveBeenCalledTimes(1);
    expect(erros).toHaveLength(2);
  });

  it('producao: 1º tique 1 min depois do boot, depois a cada 5 min', async () => {
    const { falso } = montar('producao');
    await jest.advanceTimersByTimeAsync(MIN - 1);
    expect(falso.ciclo).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(falso.ciclo).toHaveBeenCalledTimes(1);
    expect(falso.ciclo).toHaveBeenLastCalledWith('agendada', null);
    expect(falso.classificarPendentes).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(3);
    expect(falso.classificarPendentes).toHaveBeenCalledTimes(3);
  });

  it('homologacao também agenda', async () => {
    const { falso } = montar('homologacao');
    await jest.advanceTimersByTimeAsync(MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(1);
  });

  it('tique lento: com o ciclo pendente, o intervalo seguinte não começa outro', async () => {
    let soltar: (r: ResumoCiclo) => void = () => undefined;
    const ciclo = jest.fn(() => new Promise<ResumoCiclo>((r) => (soltar = r)));
    const { falso } = montar('producao', ciclo);
    await jest.advanceTimersByTimeAsync(11 * MIN);
    expect(ciclo).toHaveBeenCalledTimes(1);
    soltar({ fim: 'feito', paginas: 1 });
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(ciclo).toHaveBeenCalledTimes(2);
    expect(falso.classificarPendentes).toHaveBeenCalledTimes(1);
  });

  it('erro: vira logger.error com a classe e o code, sem a mensagem, e o tique seguinte roda', async () => {
    const ciclo = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('mensagem da biblioteca <resNFe>'), { code: 'P1001' }))
      .mockResolvedValue({ fim: 'aguarde', paginas: 0 });
    const { falso } = montar('producao', ciclo);
    await jest.advanceTimersByTimeAsync(MIN);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('Error');
    expect(erros[0]).toContain('P1001');
    expect(erros[0]).not.toContain('mensagem da biblioteca');
    expect(falso.classificarPendentes).toHaveBeenCalledTimes(1); // a classificação roda mesmo com o ciclo falhando
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(ciclo).toHaveBeenCalledTimes(2);
  });

  it('tique direto nunca lança', async () => {
    const ciclo = jest.fn().mockRejectedValue('não é Error');
    const { ag, falso } = montar('producao', ciclo);
    falso.classificarPendentes.mockRejectedValue(new TypeError('x'));
    await expect(ag.tique()).resolves.toBeUndefined();
    expect(erros).toHaveLength(2);
  });

  it('destruição: depois de onModuleDestroy, nenhum ciclo novo', async () => {
    const { ag, falso } = montar('producao');
    await jest.advanceTimersByTimeAsync(MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(1);
    ag.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(20 * MIN);
    expect(falso.ciclo).toHaveBeenCalledTimes(1);
  });

  it('destruição antes do 1º tique', async () => {
    const { ag, falso } = montar('producao');
    ag.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(20 * MIN);
    expect(falso.ciclo).not.toHaveBeenCalled();
  });

  it('o main.ts liga os ganchos de desligamento antes de ouvir (sem eles o onModuleDestroy não roda no SIGTERM do Docker)', () => {
    const main = readFileSync(join(__dirname, '..', '..', '..', 'main.ts'), 'utf8');
    const ganchos = main.indexOf('app.enableShutdownHooks()');
    expect(ganchos).toBeGreaterThan(-1);
    expect(ganchos).toBeLessThan(main.indexOf('await app.listen('));
  });
});
