import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/database/prisma.service';
import { nomePadrao } from '../auth/auth.service';
import type { CriarUsuarioDto } from './dto/usuarios.dto';

const VISTA = { id: true, nome: true, email: true, perfil: true, created_at: true } as const;

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.users.findMany({ select: VISTA, orderBy: { nome: 'asc' } });
  }

  async criar(dto: CriarUsuarioDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.users.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'DUPLICADO', message: 'Já existe uma conta com este e-mail.' });
    }
    const u = await this.prisma.users.create({
      data: { email, nome: nomePadrao(dto.nome, email), password_hash: await bcrypt.hash(dto.senha, 10), perfil: dto.perfil },
      select: { id: true },
    });
    return { id: u.id };
  }

  async trocarPerfil(eu: string, id: string, perfil: 'admin' | 'loja') {
    // A tela já travava o próprio seletor; aqui vira regra (o último admin não se rebaixa por engano).
    if (id === eu) throw new BadRequestException({ code: 'PROPRIO', message: 'Você não pode alterar o próprio perfil' });
    await this.existe(id);
    return this.prisma.users.update({ where: { id }, data: { perfil }, select: VISTA });
  }

  /** Substitui o "esqueci minha senha" por e-mail do Supabase (spec, decisão 5). */
  async redefinirSenha(id: string, senha: string) {
    await this.existe(id);
    await this.prisma.users.update({ where: { id }, data: { password_hash: await bcrypt.hash(senha, 10) } });
    return { ok: true };
  }

  async excluir(eu: string, id: string) {
    if (id === eu) throw new BadRequestException({ code: 'PROPRIO', message: 'Você não pode excluir a si mesmo' });
    await this.existe(id);
    await this.prisma.users.delete({ where: { id } });
    return { ok: true };
  }

  private async existe(id: string) {
    if (!(await this.prisma.users.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado' });
    }
  }
}
