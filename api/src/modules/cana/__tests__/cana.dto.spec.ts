import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AnularCanaDto, CorrigirCanaDto, LancamentoCanaDto, ParametrosCanaDto, ProdutoCanaDto } from '../dto/cana.dto';
import { camposDoLancamento, conferirData, conferirMotivo } from '../regras';

const mensagens = (cls: new () => object, o: unknown) =>
  validateSync(plainToInstance(cls, o) as object, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('LancamentoCanaDto (formato; as regras por tipo ficam em camposDoLancamento)', () => {
  it('recebimento completo passa (com chave de repetição)', () => {
    expect(
      mensagens(LancamentoCanaDto, {
        tipo: 'recebimento',
        data: '2026-11-24',
        duzias: 12.5,
        fornecedor: 'Sítio Boa Vista',
        observacao: 'chegou cedo',
        chave_idempotencia: '0d9c1a52-7f0b-4b0e-9a55-3d6c0b9e2f11',
      }),
    ).toEqual([]);
  });
  it('tipo inválido, data inválida e número com casas demais', () => {
    expect(mensagens(LancamentoCanaDto, { tipo: 'venda', data: '2026-02-31', duzias: 1.234 }).sort()).toEqual(
      ['Tipo de lançamento inválido', 'deve ser uma data AAAA-MM-DD', 'Dúzias com até 2 casas'].sort(),
    );
  });
  it('número negativo e grande demais são recusados no formato', () => {
    expect(mensagens(LancamentoCanaDto, { tipo: 'contagem', data: '2026-11-24', duzias: -1, litros_caldo: 1_000_000 })).toEqual([
      'Dúzias não podem ser negativas',
      'Litros de caldo: no máximo 100.000',
    ]);
  });
  it('texto como número e campo a mais são recusados', () => {
    expect(mensagens(LancamentoCanaDto, { tipo: 'recebimento', data: '2026-11-24', duzias: '12' }).length).toBeGreaterThan(0);
    expect(mensagens(LancamentoCanaDto, { tipo: 'recebimento', data: '2026-11-24', duzias: 12, substitui_id: 'x' }).length).toBeGreaterThan(
      0,
    );
  });
  it('chave de repetição precisa ser uuid', () => {
    expect(mensagens(LancamentoCanaDto, { tipo: 'recebimento', data: '2026-11-24', duzias: 1, chave_idempotencia: 'abc' })).toEqual([
      'chave_idempotencia deve ser um uuid',
    ]);
  });
});

describe('AnularCanaDto e CorrigirCanaDto', () => {
  it('o formato do motivo é texto até 300; o mínimo de 3 letras é regra (400 CANA_MOTIVO_OBRIGATORIO, conferirMotivo)', () => {
    expect(mensagens(AnularCanaDto, { motivo: 'abc' })).toEqual([]);
    expect(mensagens(AnularCanaDto, {})).toEqual([]);
    expect(mensagens(AnularCanaDto, { motivo: 'x'.repeat(301) })).toEqual(['O motivo tem no máximo 300 letras.']);
    expect(conferirMotivo('  abc ')).toBe('abc');
    expect(conferirMotivo('  ab  ')).toBeNull();
    expect(conferirMotivo(undefined)).toBeNull();
  });
  it('corrigir: motivo + os campos novos (sem tipo: o tipo é o do lançamento corrigido)', () => {
    expect(mensagens(CorrigirCanaDto, { motivo: 'Número errado', data: '2026-11-24', duzias: 10 })).toEqual([]);
    expect(
      mensagens(CorrigirCanaDto, { motivo: 'Número errado', data: '2026-11-24', duzias: 10, tipo: 'producao' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('ParametrosCanaDto e ProdutoCanaDto', () => {
  it('nulo é "não informado"; zero ou negativo não', () => {
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: null, rendimento_frozen: null })).toEqual([]);
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: 5.5, rendimento_frozen: 1.25 })).toEqual([]);
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: 0, rendimento_frozen: -1 })).toEqual([
      'Use um número maior que zero (ex.: 5,5).',
      'Use um número maior que zero (ex.: 5,5).',
    ]);
  });
  it('casas = as da coluna: litros esperados por dúzia com até 3 (DECIMAL(10,3)), rendimento do frozen com até 4 (DECIMAL(10,4))', () => {
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: 5.125, rendimento_frozen: 1.2575 })).toEqual([]);
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: 5.1255, rendimento_frozen: null })).toEqual([
      'Use um número com até 3 casas.',
    ]);
    expect(mensagens(ParametrosCanaDto, { litros_por_duzia_esperado: null, rendimento_frozen: 1.25755 })).toEqual([
      'Use um número com até 4 casas.',
    ]);
  });
  it('produto: ml maior que zero, frozen e ativo obrigatórios', () => {
    expect(mensagens(ProdutoCanaDto, { ml_por_unidade: 300, frozen: false, ativo: true })).toEqual([]);
    expect(mensagens(ProdutoCanaDto, { ml_por_unidade: 0, frozen: false, ativo: true })).toEqual(['Digite os ml (maior que zero).']);
    expect(mensagens(ProdutoCanaDto, { ml_por_unidade: 300 }).length).toBe(2);
  });
});

describe('camposDoLancamento (o que cada tipo pede)', () => {
  it('recebimento: dúzias > 0; fornecedor e observação aparados (vazio = nulo); sem litros', () => {
    expect(camposDoLancamento('recebimento', { duzias: 12, fornecedor: '  Sítio  ', observacao: ' ' })).toEqual({
      ok: true,
      dados: { duzias: 12, litros_caldo: null, litros_frozen: null, fornecedor: 'Sítio', observacao: null },
    });
    expect(camposDoLancamento('recebimento', { duzias: 0 })).toEqual({
      ok: false,
      mensagem: 'Digite quantas dúzias chegaram (maior que zero).',
    });
    expect(camposDoLancamento('recebimento', {})).toEqual({ ok: false, mensagem: 'Digite quantas dúzias chegaram (maior que zero).' });
    expect(camposDoLancamento('recebimento', { duzias: 1, litros_caldo: 2 })).toEqual({
      ok: false,
      mensagem: 'Recebimento de cana é só em dúzias.',
    });
  });
  it('produção: litros > 0; dúzias moídas opcionais (> 0); sem frozen nem fornecedor', () => {
    expect(camposDoLancamento('producao', { litros_caldo: 25 })).toEqual({
      ok: true,
      dados: { duzias: null, litros_caldo: 25, litros_frozen: null, fornecedor: null, observacao: null },
    });
    expect(camposDoLancamento('producao', { litros_caldo: 25, duzias: 5 })).toMatchObject({ ok: true, dados: { duzias: 5 } });
    expect(camposDoLancamento('producao', { litros_caldo: 0 })).toEqual({
      ok: false,
      mensagem: 'Digite quantos litros de caldo saíram (maior que zero).',
    });
    expect(camposDoLancamento('producao', { litros_caldo: 1, duzias: 0 })).toEqual({
      ok: false,
      mensagem: 'As dúzias moídas, se informadas, têm de ser maiores que zero.',
    });
    expect(camposDoLancamento('producao', { litros_caldo: 1, litros_frozen: 1 })).toEqual({
      ok: false,
      mensagem: 'Frozen só entra na contagem.',
    });
    expect(camposDoLancamento('producao', { litros_caldo: 1, fornecedor: 'x' })).toEqual({
      ok: false,
      mensagem: 'Fornecedor só entra no recebimento.',
    });
  });
  it('contagem: dúzias e litros de caldo ≥ 0 (0 = não sobrou); frozen opcional', () => {
    expect(camposDoLancamento('contagem', { duzias: 0, litros_caldo: 0 })).toMatchObject({
      ok: true,
      dados: { duzias: 0, litros_caldo: 0, litros_frozen: null },
    });
    expect(camposDoLancamento('contagem', { duzias: 6, litros_caldo: 5, litros_frozen: 2 })).toMatchObject({
      ok: true,
      dados: { litros_frozen: 2 },
    });
    expect(camposDoLancamento('contagem', { litros_caldo: 5 })).toEqual({
      ok: false,
      mensagem: 'Digite as dúzias de cana que sobraram (não sobrou? digite 0).',
    });
    expect(camposDoLancamento('contagem', { duzias: 6 })).toEqual({
      ok: false,
      mensagem: 'Digite os litros de caldo que sobraram (não sobrou? digite 0).',
    });
  });
});

describe('conferirData (loja: hoje ou ontem; admin: até hoje)', () => {
  const hoje = '2026-11-24';
  it('loja', () => {
    expect(conferirData('2026-11-24', hoje, false)).toBeNull();
    expect(conferirData('2026-11-23', hoje, false)).toBeNull();
    expect(conferirData('2026-11-21', hoje, false)).toBe('A loja lança só hoje ou ontem.');
    expect(conferirData('2026-11-25', hoje, false)).toBe('Data no futuro.');
  });
  it('admin', () => {
    expect(conferirData('2026-10-01', hoje, true)).toBeNull();
    expect(conferirData('2026-11-25', hoje, true)).toBe('Data no futuro.');
  });
});
