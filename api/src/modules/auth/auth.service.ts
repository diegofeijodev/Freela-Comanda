import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { users } from '@prisma/client';
import { senhaConfere } from '../../common/auth/senha-falsa';
import { PrismaService } from '../../common/database/prisma.service';

export interface UserView {
  id: string;
  email: string;
  nome: string;
  perfil: 'admin' | 'loja';
}

export const toUserView = (u: Pick<users, 'id' | 'email' | 'nome' | 'perfil'>): UserView => ({
  id: u.id,
  email: u.email,
  nome: u.nome,
  perfil: u.perfil,
});

/** Nome padrão igual ao gatilho handle_new_user do protótipo: a parte antes do @. */
export const nomePadrao = (nome: string | undefined, email: string) => (nome?.trim() ? nome.trim() : email.split('@')[0] ?? email);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async sessao(u: users) {
    const user = toUserView(u);
    return { access_token: await this.jwt.signAsync({ sub: u.id }), user };
  }

  async login(email: string, senha: string) {
    const user = await this.prisma.users.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Conta inexistente compara com o hash fixo: e-mail inexistente e senha errada levam o mesmo tempo.
    if (!(await senhaConfere(senha, user?.password_hash)) || !user) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos' });
    }
    return this.sessao(user);
  }

  async existeAdmin(): Promise<{ existe: boolean }> {
    return { existe: (await this.prisma.users.count({ where: { perfil: 'admin' } })) > 0 };
  }

  /**
   * "Primeiro acesso? Criar conta de administrador" (gatilho handle_new_user do protótipo: o primeiro vira admin).
   * Só enquanto não existe admin; o trinco consultivo serializa dois cliques simultâneos.
   */
  async primeiroAcesso(nome: string, email: string, senha: string) {
    const emailNorm = email.trim().toLowerCase();
    const hash = await bcrypt.hash(senha, 10);
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('erp-primeiro-acesso'))`;
      if ((await tx.users.count({ where: { perfil: 'admin' } })) > 0) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Novos usuários são cadastrados pelo administrador.' });
      }
      return tx.users.create({ data: { email: emailNorm, nome: nomePadrao(nome, emailNorm), password_hash: hash, perfil: 'admin' } });
    });
    return this.sessao(user);
  }

  async me(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Conta não encontrada' });
    return { user: toUserView(user) };
  }

  /** A PRÓPRIA senha, pedindo a atual. Erros 400 (nunca 401: o web trata 401 como sessão morta). */
  async trocarSenha(userId: string, atual: string, nova: string): Promise<{ ok: true }> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Conta não encontrada' });
    if (!(await bcrypt.compare(atual, user.password_hash))) {
      throw new BadRequestException({ code: 'WRONG_PASSWORD', message: 'A senha atual não confere.' });
    }
    await this.prisma.users.update({ where: { id: userId }, data: { password_hash: await bcrypt.hash(nova, 10) } });
    return { ok: true };
  }
}
