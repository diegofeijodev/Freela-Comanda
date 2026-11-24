import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { users } from '@prisma/client';
import { senhaConfere } from '../../common/auth/senha-falsa';
import type { AuthUser } from '../../common/auth/auth-user';
import { SCHEMA_PADRAO } from '../../common/database/empresa-contexto';
import { NucleoService } from '../../common/database/prisma.service';

export interface UserView {
  id: string;
  email: string;
  nome: string;
  /** Perfil na empresa (o master é sempre `admin`). */
  perfil: 'admin' | 'loja';
  master: boolean;
  empresa_id: string | null;
  /** Telas liberadas ao colaborador; vazio para admin/master (veem tudo). */
  modulos: string[];
}

export const toUserView = (u: Pick<users, 'id' | 'email' | 'nome' | 'perfil' | 'master' | 'empresa_id' | 'modulos'>): UserView => {
  const perfil = u.master ? 'admin' : u.perfil;
  return { id: u.id, email: u.email, nome: u.nome, perfil, master: u.master, empresa_id: u.empresa_id, modulos: perfil === 'admin' ? [] : u.modulos };
};

const EMPRESA_RESUMO = { id: true, razao_social: true, nome_fantasia: true, cnpj: true, ativo: true, schema_banco: true } as const;
export const resumoEmpresa = (e: { id: string; razao_social: string; nome_fantasia: string | null; cnpj: string; ativo: boolean; schema_banco: string | null }) => ({
  id: e.id,
  razao_social: e.razao_social,
  nome_fantasia: e.nome_fantasia,
  cnpj: e.cnpj,
  ativo: e.ativo,
  principal: e.schema_banco === SCHEMA_PADRAO,
});

/** Nome padrão igual ao gatilho handle_new_user do protótipo: a parte antes do @. */
export const nomePadrao = (nome: string | undefined, email: string) => (nome?.trim() ? nome.trim() : email.split('@')[0] ?? email);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: NucleoService,
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
   * "Primeiro acesso? Criar conta de administrador" (gatilho handle_new_user do protótipo: o primeiro vira admin — e master).
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
      return tx.users.create({ data: { email: emailNorm, nome: nomePadrao(nome, emailNorm), password_hash: hash, perfil: 'admin', master: true } });
    });
    return this.sessao(user);
  }

  /** A conta e a empresa da requisição (a escolhida pelo master, ou a do usuário). */
  async me(eu: AuthUser) {
    const user = await this.prisma.users.findUnique({ where: { id: eu.id } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Conta não encontrada' });
    const empresa = eu.empresaId ? await this.prisma.empresas.findUnique({ where: { id: eu.empresaId }, select: EMPRESA_RESUMO }) : null;
    return { user: toUserView(user), empresa: empresa ? resumoEmpresa(empresa) : null };
  }

  /** Empresas do seletor da barra lateral: o master vê todas; o usuário comum, só a dele. */
  async empresas(eu: AuthUser) {
    const es = await this.prisma.empresas.findMany({
      where: eu.master ? {} : { id: eu.empresaId ?? '00000000-0000-0000-0000-000000000000' },
      orderBy: [{ ativo: 'desc' }, { razao_social: 'asc' }],
      select: EMPRESA_RESUMO,
    });
    return es.map(resumoEmpresa).sort((a, b) => Number(b.principal) - Number(a.principal));
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
