import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfigurarBuscaDto, ConfigurarRespostasDto, IgnorarNotaSefazDto } from '../notas-sefaz.dto';

const erros = <T extends object>(cls: new () => T, o: unknown) =>
  validateSync(plainToInstance(cls, o) as object, { whitelist: true, forbidNonWhitelisted: true });

describe('IgnorarNotaSefazDto', () => {
  it('motivo válido passa, com ou sem texto', () => {
    expect(erros(IgnorarNotaSefazDto, { motivo: 'nao_e_compra' })).toHaveLength(0);
    expect(erros(IgnorarNotaSefazDto, { motivo: 'outro', texto: 'Nota de outra filial' })).toHaveLength(0);
    expect(erros(IgnorarNotaSefazDto, { motivo: 'outro', texto: null })).toHaveLength(0);
  });
  it('motivo ausente dá a frase "Escolha o motivo."', () => {
    const e = erros(IgnorarNotaSefazDto, {});
    expect(e.flatMap((x) => Object.values(x.constraints ?? {}))).toContain('Escolha o motivo.');
  });
  it('motivo fora da lista falha', () => {
    expect(erros(IgnorarNotaSefazDto, { motivo: 'xyz' }).length).toBeGreaterThan(0);
  });
  it('texto de 300 passa e de 301 falha', () => {
    expect(erros(IgnorarNotaSefazDto, { motivo: 'outro', texto: 'a'.repeat(300) })).toHaveLength(0);
    expect(erros(IgnorarNotaSefazDto, { motivo: 'outro', texto: 'a'.repeat(301) }).length).toBeGreaterThan(0);
  });
  it('campo extra falha', () => {
    expect(erros(IgnorarNotaSefazDto, { motivo: 'outro', texto: 'x', extra: 1 }).length).toBeGreaterThan(0);
  });
  it('"A compra não aconteceu" é um motivo aceito, com a justificativa e o aviso', () => {
    expect(
      erros(IgnorarNotaSefazDto, { motivo: 'compra_nao_aconteceu', texto: 'Pedido cancelado pelo fornecedor', avisar_sefaz: true }),
    ).toHaveLength(0);
  });
  it('avisar_sefaz é opcional e só aceita booleano', () => {
    expect(erros(IgnorarNotaSefazDto, { motivo: 'nao_reconheco', avisar_sefaz: true })).toHaveLength(0);
    expect(erros(IgnorarNotaSefazDto, { motivo: 'nao_e_compra', avisar_sefaz: false })).toHaveLength(0);
    for (const v of ['sim', 1, 'true']) {
      const e = erros(IgnorarNotaSefazDto, { motivo: 'nao_reconheco', avisar_sefaz: v });
      expect(e.map((x) => x.property)).toEqual(['avisar_sefaz']);
    }
  });
});

describe('ConfigurarBuscaDto', () => {
  it('só aceita booleano', () => {
    expect(erros(ConfigurarBuscaDto, { busca_ligada: true })).toHaveLength(0);
    expect(erros(ConfigurarBuscaDto, { busca_ligada: 'sim' }).length).toBeGreaterThan(0);
    expect(erros(ConfigurarBuscaDto, {}).length).toBeGreaterThan(0);
  });
});

describe('ConfigurarRespostasDto', () => {
  it('só aceita booleano em ligadas, que é obrigatório', () => {
    expect(erros(ConfigurarRespostasDto, { ligadas: true })).toHaveLength(0);
    expect(erros(ConfigurarRespostasDto, { ligadas: false })).toHaveLength(0);
    expect(erros(ConfigurarRespostasDto, { ligadas: 'sim' }).length).toBeGreaterThan(0);
    expect(erros(ConfigurarRespostasDto, {}).length).toBeGreaterThan(0);
    expect(erros(ConfigurarRespostasDto, { ligadas: true, busca_ligada: true }).length).toBeGreaterThan(0);
  });
});
