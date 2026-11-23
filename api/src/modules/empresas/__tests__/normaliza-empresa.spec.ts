import { dadosEmpresa, enderecoEmUmaLinha } from '../normaliza-empresa';
import type { EmpresaDto } from '../dto/empresa.dto';

const base: EmpresaDto = { razao_social: '  Chopp & Espeto Ltda ', cnpj: '11.222.333/0001-81' };

describe('empresas — normalização do formulário', () => {
  it('normaliza CNPJ, CEP, código IBGE, CPF e troca vazio por null', () => {
    const d = dadosEmpresa({
      ...base,
      nome_fantasia: '',
      cep: '13270-000',
      cod_municipio: '3556206',
      uf: 'SP',
      responsavel_cpf: '529.982.247-25',
      inscricao_estadual: 'isento',
      email: 'Contato@Exemplo.COM',
      regime_tributario: '',
    });
    expect(d).toMatchObject({
      razao_social: 'Chopp & Espeto Ltda',
      nome_fantasia: null,
      cnpj: '11222333000181',
      cep: '13270000',
      cod_municipio: '3556206',
      responsavel_cpf: '52998224725',
      inscricao_estadual: 'ISENTO',
      email: 'contato@exemplo.com',
      regime_tributario: null,
      data_abertura: null,
      ativo: true,
    });
  });

  it('aceita CNPJ alfanumérico (não apaga as letras)', () => {
    expect(dadosEmpresa({ ...base, cnpj: '12.ABC.345/01DE-35' }).cnpj).toBe('12ABC34501DE35');
  });

  it('recusa CNPJ, CEP, código IBGE e CPF errados', () => {
    expect(() => dadosEmpresa({ ...base, cnpj: '11.222.333/0001-82' })).toThrow('CNPJ inválido');
    expect(() => dadosEmpresa({ ...base, cep: '1327' })).toThrow('CEP deve ter 8 números');
    expect(() => dadosEmpresa({ ...base, cod_municipio: '355' })).toThrow('IBGE');
    expect(() => dadosEmpresa({ ...base, responsavel_cpf: '111.111.111-11' })).toThrow('CPF do responsável inválido');
  });

  it('endereço em uma linha', () => {
    expect(
      enderecoEmUmaLinha({ logradouro: 'Rua das Flores', numero: '10', complemento: 'sala 2', bairro: 'Centro', cidade: 'Valinhos', uf: 'SP', cep: '13270000' }),
    ).toBe('Rua das Flores, 10 - sala 2 - Centro - Valinhos/SP - CEP 13270-000');
    expect(enderecoEmUmaLinha({ logradouro: null, numero: null, complemento: null, bairro: null, cidade: 'Valinhos', uf: 'SP', cep: null })).toBe('Valinhos/SP');
  });
});
