import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LISTA_PROVEDORES, type Provedor } from './ia-chave.service';

export class SalvarIaChaveDto {
  @IsIn(LISTA_PROVEDORES, { message: 'Escolha a IA' })
  provedor!: Provedor;

  @IsString()
  @MinLength(20, { message: 'Essa chave parece curta demais. Copie a chave inteira.' })
  @MaxLength(400, { message: 'Essa chave parece longa demais.' })
  @Matches(/^\s*\S+\s*$/, { message: 'A chave não pode ter espaços no meio.' })
  chave!: string;
}
