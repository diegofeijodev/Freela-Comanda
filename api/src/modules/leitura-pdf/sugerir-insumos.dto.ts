import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** Só o que a IA precisa por linha da nota: a descrição e a unidade (nada de valores, CNPJ nem chave). */
export class LinhaSugestaoDto {
  @IsString() @MinLength(1) @MaxLength(500) descricao!: string;
  @IsOptional() @IsString() @MaxLength(20) unidade?: string | null;
}

export class SugerirInsumosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LinhaSugestaoDto) itens!: LinhaSugestaoDto[];
}
