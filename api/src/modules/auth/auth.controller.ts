import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Staff } from '../../common/decorators/permissao.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, PrimeiroAcessoDto, TrocarSenhaDto } from './dto/auth.dto';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  /** A tela de entrada mostra "Primeiro acesso?" só quando ainda não há admin (rpc existe_admin do protótipo). */
  @Public()
  @Get('existe-admin')
  existeAdmin() {
    return this.auth.existeAdmin();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('primeiro-acesso')
  primeiroAcesso(@Body() dto: PrimeiroAcessoDto) {
    return this.auth.primeiroAcesso(dto.nome, dto.email, dto.senha);
  }

  @Staff()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Staff()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('trocar-senha')
  trocarSenha(@CurrentUser() user: AuthUser, @Body() dto: TrocarSenhaDto) {
    return this.auth.trocarSenha(user.id, dto.senha_atual, dto.senha_nova);
  }
}
