import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MOTIVOS_IGNORAR, type MotivoIgnorar } from './situacao-nota';

export class ConfigurarBuscaDto {
  @IsBoolean() busca_ligada!: boolean;
}

/** "Ligar as respostas" / "Desligar as respostas" (PUT /v1/notas-sefaz/respostas). */
export class ConfigurarRespostasDto {
  @IsBoolean() ligadas!: boolean;
}

/**
 * `texto` é a justificativa no motivo `compra_nao_aconteceu` (normalizada e conferida no serviço: 15 a 255 letras). `avisar_sefaz` pede o
 * evento do motivo à SEFAZ; ausente = o Ignorar da entrega 2 (nada sai).
 */
export class IgnorarNotaSefazDto {
  @IsIn([...MOTIVOS_IGNORAR], { message: 'Escolha o motivo.' }) motivo!: MotivoIgnorar;
  @IsOptional() @IsString() @MaxLength(300) texto?: string | null;
  @IsOptional() @IsBoolean() avisar_sefaz?: boolean;
}
