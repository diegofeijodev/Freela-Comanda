import { problemasDaSenha } from '../definir-senha';

describe('definir-senha: mesmas regras da tela de Usuários (SenhaDto)', () => {
  it('6 a 72 caracteres', async () => {
    expect(await problemasDaSenha('12345')).toEqual(['A senha precisa de pelo menos 6 caracteres']);
    expect(await problemasDaSenha('x'.repeat(73))).toHaveLength(1);
    expect(await problemasDaSenha('Senha nova 6')).toEqual([]);
    expect(await problemasDaSenha('x'.repeat(72))).toEqual([]);
  });
});
