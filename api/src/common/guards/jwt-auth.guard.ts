import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from '../auth/auth-user';
import { EmpresaContexto, SCHEMA_PADRAO } from '../database/empresa-contexto';
import { EmpresasBancoService } from '../database/empresas-banco.service';
import { NucleoService } from '../database/prisma.service';
import { MODULOS_KEY, PERMISSAO_KEY, type Modulo, type Permissao } from '../decorators/permissao.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { isUuid } from '../ids/uuid';

/** Cabeçalho com a empresa escolhida pelo master no seletor da barra lateral (o usuário comum fica sempre na dele). */
export const CABECALHO_EMPRESA = 'x-empresa-id';

const semEmpresa = () => new ForbiddenException({ code: 'EMPRESA', message: 'Empresa não encontrada ou sem acesso. Escolha outra empresa.' });

/**
 * Guard global (APP_GUARD): rota fechada por padrão, `@Public()` é a exceção. Faz o papel das políticas RLS do Supabase:
 * o perfil vem do BANCO a cada request (um admin rebaixado vira colaborador no próximo clique, sem esperar o token expirar).
 * Também decide a EMPRESA da requisição (o schema dos dados) e a deixa em `request.empresaContexto` para o `EmpresaInterceptor`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly nucleo: NucleoService,
    private readonly banco: EmpresasBancoService,
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
    const user = await this.nucleo.users.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, nome: true, perfil: true, master: true, empresa_id: true, modulos: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Conta não encontrada' });

    const permissao = this.reflector.getAllAndOverride<Permissao | undefined>(PERMISSAO_KEY, alvos);
    // Sem marca = erro de programação; fecha em vez de abrir (o teste de proteção pega antes de chegar aqui).
    if (!permissao) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    if (permissao === 'master' && !user.master) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    const perfil = user.master ? 'admin' : user.perfil;
    if (permissao === 'admin' && perfil !== 'admin') {
      const daRota = this.reflector.getAllAndOverride<Modulo[] | undefined>(MODULOS_KEY, alvos) ?? [];
      if (!daRota.some((m) => user.modulos.includes(m))) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
    }

    const ctx = await this.empresa(user, request.headers?.[CABECALHO_EMPRESA]);
    request.empresaContexto = ctx;
    request.user = {
      id: user.id,
      email: user.email,
      nome: user.nome,
      perfil,
      master: user.master,
      modulos: user.master || perfil === 'admin' ? [] : user.modulos,
      empresaId: ctx.empresaId,
    } satisfies AuthUser;
    return true;
  }

  /** Master: a empresa do cabeçalho (sem ele, a dona do `public`). Usuário comum: sempre a dele, e só se estiver ativa. */
  private async empresa(user: { master: boolean; empresa_id: string | null }, cabecalho: unknown): Promise<EmpresaContexto> {
    const sel = { id: true, schema_banco: true, ativo: true } as const;
    if (user.master) {
      if (typeof cabecalho === 'string' && cabecalho !== '') {
        if (!isUuid(cabecalho)) throw semEmpresa();
        const e = await this.nucleo.empresas.findUnique({ where: { id: cabecalho }, select: sel });
        if (!e) throw semEmpresa();
        return this.banco.contextoDe(e);
      }
      return this.donaDoPublic();
    }
    // Conta comum sem empresa (anterior ao cadastro de empresas): os dados dela são os do `public`.
    if (!user.empresa_id) return this.donaDoPublic();
    const e = await this.nucleo.empresas.findUnique({ where: { id: user.empresa_id }, select: sel });
    if (!e) throw semEmpresa();
    if (!e.ativo) throw new ForbiddenException({ code: 'EMPRESA_INATIVA', message: 'Sua empresa está desativada. Fale com o administrador.' });
    return this.banco.contextoDe(e);
  }

  private async donaDoPublic(): Promise<EmpresaContexto> {
    const dona = await this.nucleo.empresas.findFirst({ where: { schema_banco: SCHEMA_PADRAO }, select: { id: true, schema_banco: true } });
    return dona ? { schema: SCHEMA_PADRAO, empresaId: dona.id } : { schema: SCHEMA_PADRAO, empresaId: null };
  }
}
