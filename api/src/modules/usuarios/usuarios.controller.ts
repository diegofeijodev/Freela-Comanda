import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { CriarUsuarioDto, PerfilDto, SenhaDto } from './dto/usuarios.dto';
import { UsuariosService } from './usuarios.service';

@ApiTags('Usuários')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/usuarios')
export class UsuariosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Post()
  criar(@Body() dto: CriarUsuarioDto) {
    return this.svc.criar(dto);
  }

  @Patch(':id/perfil')
  perfil(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: PerfilDto) {
    return this.svc.trocarPerfil(eu.id, id, dto.perfil);
  }

  @Put(':id/senha')
  senha(@Param('id', ParseUuidPipe) id: string, @Body() dto: SenhaDto) {
    return this.svc.redefinirSenha(id, dto.senha);
  }

  @Delete(':id')
  excluir(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluir(eu.id, id);
  }
}
