import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { AuthUser } from '../../common/auth/auth-user';
import { NucleoService } from '../../common/database/prisma.service';
import { nomePadrao } from '../auth/auth.service';
import type { CriarUsuarioDto } from './dto/usuarios.dto';

const VISTA = { id: true, nome: true, email: true, perfil: true, master: true, modulos: true, created_at: true } as const;

/**
 * Usuários da EMPRESA da requisição (cadastro em `public.users`). O admin da loja cadastra admins e colaboradores dela e libera
 * as telas do colaborador; o master também vê (e cria) masters. Ninguém além do master enxerga ou mexe num master.
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: NucleoService) {}

  listar(eu: AuthUser) {
    const daEmpresa: Prisma.usersWhereInput = { empresa_id: eu.empresaId, master: false };
    return this.prisma.users.findMany({ where: eu.master ? { OR: [daEmpresa, { master: true }] } : daEmpresa, select: VISTA, orderBy: [{ master: 'desc' }, { nome: 'asc' }] });
  }

  async criar(eu: AuthUser, dto: CriarUsuarioDto) {
    const email = dto.email.trim().toLowerCase();
    if (dto.master && !eu.master) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    if (await this.prisma.users.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'DUPLICADO', message: 'Já existe uma conta com este e-mail.' });
    }
    const master = !!dto.master;
    const u = await this.prisma.users.create({
      data: {
        email,
        nome: nomePadrao(dto.nome, email),
        password_hash: await bcrypt.hash(dto.senha, 10),
        perfil: master ? 'admin' : dto.perfil,
        master,
        empresa_id: master ? null : eu.empresaId,
        modulos: master || dto.perfil === 'admin' ? [] : [...new Set(dto.modulos ?? [])],
      },
      select: { id: true },
    });
    return { id: u.id };
  }

  async trocarPerfil(eu: AuthUser, id: string, perfil: 'admin' | 'loja') {
    // A tela já travava o próprio seletor; aqui vira regra (o último admin não se rebaixa por engano).
    if (id === eu.id) throw new BadRequestException({ code: 'PROPRIO', message: 'Você não pode alterar o próprio perfil' });
    const alvo = await this.alcancavel(eu, id);
    if (alvo.master) throw new BadRequestException({ code: 'MASTER', message: 'O usuário master é administrador em todas as empresas' });
    return this.prisma.users.update({ where: { id }, data: { perfil }, select: VISTA });
  }

  /** Telas liberadas ao colaborador (o admin vê todas; a lista fica guardada se ele voltar a colaborador). */
  async trocarModulos(eu: AuthUser, id: string, modulos: string[]) {
    const alvo = await this.alcancavel(eu, id);
    if (alvo.master) throw new BadRequestException({ code: 'MASTER', message: 'O usuário master é administrador em todas as empresas' });
    return this.prisma.users.update({ where: { id }, data: { modulos: [...new Set(modulos)] }, select: VISTA });
  }

  /** Substitui o "esqueci minha senha" por e-mail do Supabase (spec, decisão 5). */
  async redefinirSenha(eu: AuthUser, id: string, senha: string) {
    await this.alcancavel(eu, id);
    await this.prisma.users.update({ where: { id }, data: { password_hash: await bcrypt.hash(senha, 10) } });
    return { ok: true };
  }

  async excluir(eu: AuthUser, id: string) {
    if (id === eu.id) throw new BadRequestException({ code: 'PROPRIO', message: 'Você não pode excluir a si mesmo' });
    await this.alcancavel(eu, id);
    await this.prisma.users.delete({ where: { id } });
    return { ok: true };
  }

  /** O master alcança qualquer conta; o admin da loja, só as da empresa dele (outra empresa ou master = "não encontrado"). */
  private async alcancavel(eu: AuthUser, id: string) {
    const u = await this.prisma.users.findUnique({ where: { id }, select: { id: true, master: true, empresa_id: true } });
    const ok = u && (eu.master || (!u.master && u.empresa_id === eu.empresaId));
    if (!u || !ok) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado' });
    return u;
  }
}
