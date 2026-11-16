import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { EnviarCertificadoDto } from './certificado-digital.dto';
import { CertificadoDigitalService } from './certificado-digital.service';

/** Configurações → Certificado digital (A1). Só admin; o arquivo e a senha entram aqui e nunca voltam (só dados públicos do certificado). */
@ApiTags('Certificado digital')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/certificado-digital')
export class CertificadoDigitalController {
  constructor(private readonly svc: CertificadoDigitalService) {}

  @Get()
  status() {
    return this.svc.status();
  }

  /** Confere tudo antes de guardar; troca o certificado atual só se o novo passar. 400 com o motivo em `error.code`/`error.message`. */
  @Put()
  enviar(@CurrentUser() eu: AuthUser, @Body() dto: EnviarCertificadoDto) {
    return this.svc.enviar(dto.arquivo_base64, dto.senha, { id: eu.id, nome: eu.nome });
  }

  @Delete()
  remover(@CurrentUser() eu: AuthUser) {
    return this.svc.remover({ id: eu.id, nome: eu.nome });
  }
}
