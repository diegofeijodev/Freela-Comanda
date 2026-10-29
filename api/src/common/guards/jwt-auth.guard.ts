import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../database/prisma.service';
import { PERMISSAO_KEY, type Permissao } from '../decorators/permissao.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global (APP_GUARD): rota fechada por padrão, `@Public()` é a exceção. Faz o papel das políticas RLS do Supabase:
 * o perfil vem do BANCO a cada request (um admin rebaixado vira loja no próximo clique, sem esperar o token expirar).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const alvos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvos)) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token ausente' });

    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token inválido ou expirado' });
    }

    // Conta excluída depois do token emitido: o token morre junto.
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, nome: true, perfil: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Conta não encontrada' });

    const permissao = this.reflector.getAllAndOverride<Permissao | undefined>(PERMISSAO_KEY, alvos);
    // Sem marca = erro de programação; fecha em vez de abrir (o teste de proteção pega antes de chegar aqui).
    if (!permissao) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    if (permissao === 'admin' && user.perfil !== 'admin') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    }

    request.user = { id: user.id, email: user.email, nome: user.nome, perfil: user.perfil } satisfies AuthUser;
    return true;
  }
}
