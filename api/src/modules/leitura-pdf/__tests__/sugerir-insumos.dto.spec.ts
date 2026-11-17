import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SugerirInsumosDto } from '../sugerir-insumos.dto';

const erros = (o: unknown) => validateSync(plainToInstance(SugerirInsumosDto, o) as object, { whitelist: true, forbidNonWhitelisted: true });
const linha = { descricao: 'TOMATE', unidade: 'KG' };

describe('SugerirInsumosDto', () => {
  it('1 linha passa (unidade opcional ou null)', () => {
    expect(erros({ itens: [linha] })).toHaveLength(0);
    expect(erros({ itens: [{ descricao: 'X' }] })).toHaveLength(0);
    expect(erros({ itens: [{ descricao: 'X', unidade: null }] })).toHaveLength(0);
  });
  it('200 linhas passam; 0 e 201 falham', () => {
    expect(erros({ itens: Array(200).fill(linha) })).toHaveLength(0);
    expect(erros({ itens: [] }).length).toBeGreaterThan(0);
    expect(erros({ itens: Array(201).fill(linha) }).length).toBeGreaterThan(0);
  });
  it('descrição com 501 caracteres e unidade com 21 falham; vazia também', () => {
    expect(erros({ itens: [{ descricao: 'a'.repeat(500) }] })).toHaveLength(0);
    expect(erros({ itens: [{ descricao: 'a'.repeat(501) }] }).length).toBeGreaterThan(0);
    expect(erros({ itens: [{ descricao: 'X', unidade: 'a'.repeat(21) }] }).length).toBeGreaterThan(0);
    expect(erros({ itens: [{ descricao: '' }] }).length).toBeGreaterThan(0);
  });
  it('campo a mais (valor_total na linha, chave no topo) falha', () => {
    expect(erros({ itens: [{ ...linha, valor_total: 1 }] }).length).toBeGreaterThan(0);
    expect(erros({ itens: [linha], chave: 'x' }).length).toBeGreaterThan(0);
  });
});
