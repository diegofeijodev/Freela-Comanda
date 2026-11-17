/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma falso em memória, formato livre */
import type { PrismaService } from '../../../common/database/prisma.service';
import { CadastrosService } from '../cadastros.service';

function montar() {
  const c: { update: any[]; create: any[] } = { update: [], create: [] };
  const prisma = {
    configuracoes: { update: async (a: any) => (c.update.push(a), {}) },
    fornecedores: { create: async (a: any) => (c.create.push(a), {}) },
  } as unknown as PrismaService;
  return { svc: new CadastrosService(prisma), c };
}

describe('CadastrosService (CNPJ com letras)', () => {
  it('salvarConfig normaliza o CNPJ com letras', async () => {
    const { svc, c } = montar();
    await svc.salvarConfig({ cnpj: '12.abc.345/01de-35' });
    expect(c.update[0].data.cnpj).toBe('12ABC34501DE35');
  });

  it('salvarConfig aceita o CNPJ numérico válido da empresa', async () => {
    const { svc, c } = montar();
    await svc.salvarConfig({ cnpj: '44.527.294/0001-80' });
    expect(c.update[0].data.cnpj).toBe('44527294000180');
  });

  it('salvarConfig com DV errado: 400 CNPJ_INVALIDO sem update', async () => {
    const { svc, c } = montar();
    await expect(svc.salvarConfig({ cnpj: '12.345.678/0001-94' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'CNPJ_INVALIDO', message: 'CNPJ inválido. Confira os 14 caracteres (pode ter letras).' },
    });
    expect(c.update).toHaveLength(0);
  });

  it("salvarConfig com '  ' grava ''", async () => {
    const { svc, c } = montar();
    await svc.salvarConfig({ cnpj: '  ' });
    expect(c.update[0].data.cnpj).toBe('');
  });

  it('salvarConfig sem a chave cnpj não mexe no cnpj', async () => {
    const { svc, c } = montar();
    await svc.salvarConfig({ mkup_padrao: 2 });
    expect('cnpj' in c.update[0].data).toBe(false);
    expect(c.update[0].data.mkup_padrao).toBe(2);
  });

  it('criarFornecedor normaliza o CNPJ/CPF', async () => {
    const { svc, c } = montar();
    await svc.criarFornecedor({ nome: 'A', cnpj: '12.abc.345/01de-35' });
    await svc.criarFornecedor({ nome: 'B', cnpj: '123.456.789-09' });
    await svc.criarFornecedor({ nome: 'C', cnpj: '' });
    expect(c.create.map((x) => x.data.cnpj)).toEqual(['12ABC34501DE35', '12345678909', null]);
  });
});
