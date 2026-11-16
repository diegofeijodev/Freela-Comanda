import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LancarNotaDto } from '../dto/notas.dto';

const base = {
  fornecedor_nome: 'Forn',
  data_entrada: '2026-11-16',
  valor_total: 10,
  forma_pagamento: 'pix',
  origem: 'foto',
  atualizar_preco: true,
  parcelas: [],
  itens: [{ descricao: 'X', quantidade: 1, valor_unitario: 10, novo_insumo: { nome: 'Requeijão', unidade: 'un' } }],
};
const erros = (o: unknown) => validateSync(plainToInstance(LancarNotaDto, o) as object, { whitelist: true, forbidNonWhitelisted: true });

describe('LancarNotaDto', () => {
  it('item com novo_insumo válido e origem foto passa', () => {
    expect(erros(base)).toHaveLength(0);
  });
  it('novo_insumo sem nome falha', () => {
    const o = { ...base, itens: [{ ...base.itens[0], novo_insumo: { unidade: 'un' } }] };
    expect(erros(o).length).toBeGreaterThan(0);
  });
  it('novo_insumo com nome vazio falha', () => {
    const o = { ...base, itens: [{ ...base.itens[0], novo_insumo: { nome: '', unidade: 'un' } }] };
    expect(erros(o).length).toBeGreaterThan(0);
  });
  it('origem inválida falha', () => {
    expect(erros({ ...base, origem: 'x' }).length).toBeGreaterThan(0);
  });
});
