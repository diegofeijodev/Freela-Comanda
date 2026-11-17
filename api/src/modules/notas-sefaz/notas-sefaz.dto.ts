import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MOTIVOS_IGNORAR, type MotivoIgnorar } from './situacao-nota';

export class ConfigurarBuscaDto {
  @IsBoolean() busca_ligada!: boolean;
}

export class IgnorarNotaSefazDto {
  @IsIn([...MOTIVOS_IGNORAR], { message: 'Escolha o motivo.' }) motivo!: MotivoIgnorar;
  @IsOptional() @IsString() @MaxLength(300) texto?: string | null;
}
