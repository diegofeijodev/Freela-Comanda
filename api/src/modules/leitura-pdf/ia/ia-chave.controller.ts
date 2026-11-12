import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../../common/decorators/permissao.decorator';
import { SalvarIaChaveDto } from './ia-chave.dto';
import { IaChaveService } from './ia-chave.service';

/** Configurações → Leitura de PDF por IA. Só admin; a chave entra aqui e nunca volta (só provedor + 4 últimos caracteres). */
@ApiTags('Leitura de PDF (IA)')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/ia-chave')
export class IaChaveController {
  constructor(private readonly svc: IaChaveService) {}

  @Get()
  status() {
    return this.svc.status();
  }

  /** Testa com uma leitura real de um PDF pequeno e só grava se der certo (400 CHAVE_IA_INVALIDA com o motivo). */
  @Put()
  salvar(@CurrentUser() eu: AuthUser, @Body() dto: SalvarIaChaveDto) {
    return this.svc.salvar(dto.provedor, dto.chave, eu.id);
  }

  @Delete()
  remover() {
    return this.svc.remover();
  }
}
