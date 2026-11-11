import { PrismaClient } from '@prisma/client';
import { validate } from 'class-validator';
import { SenhaDto } from '../../modules/usuarios/dto/usuarios.dto';
import { UsuariosService } from '../../modules/usuarios/usuarios.service';
import { conferirBanco } from '../import-lovable/banco';
import { mascararEmail } from '../import-lovable/contas';

/** Mesmas regras da tela/rota PUT /v1/usuarios/:id/senha (SenhaDto): texto de 6 a 72 caracteres. */
export async function problemasDaSenha(senha: string): Promise<string[]> {
  const dto = Object.assign(new SenhaDto(), { senha });
  return (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));
}

/**
 * Define a senha de uma conta EXISTENTE pelo mesmo caminho da tela de Usuários (UsuariosService.redefinirSenha: bcrypt custo 10).
 * Uso: depois da migração do Lovable (que não traz senha), o dono define a do admin pelo terminal. Recusa banco errado e e-mail que não existe.
 */
export async function definirSenha(prisma: PrismaClient, expectDb: string, email: string, senha: string): Promise<string> {
  await conferirBanco(prisma, expectDb);
  const problemas = await problemasDaSenha(senha);
  if (problemas.length) throw new Error(`senha recusada: ${problemas.join('; ')}`);
  const e = email.trim().toLowerCase();
  const user = await prisma.users.findUnique({ where: { email: e }, select: { id: true } });
  if (!user) throw new Error(`não existe conta com o e-mail ${mascararEmail(e)} no banco "${expectDb}"`);
  await new UsuariosService(prisma as never).redefinirSenha(user.id, senha);
  return `senha definida para ${mascararEmail(e)}`;
}
