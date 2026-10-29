import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class ImportacaoDto {
  @IsOptional() @IsString() @MaxLength(300) arquivo?: string;
  @IsIn(['acrescentar', 'substituir']) modo!: 'acrescentar' | 'substituir';
  /** Linhas da planilha já lidas no navegador (cabeçalho em minúsculas → texto). */
  @IsArray() @ArrayMaxSize(100_000) @IsObject({ each: true }) linhas!: Record<string, string>[];
  /** Problemas que a pré-visualização apontou (vai para o histórico, como no protótipo). */
  @IsOptional() @IsInt() @Min(0) erros?: number;
}

export class DeParaDto {
  @IsString() @MinLength(1) @MaxLength(500) produto_relatorio!: string;
  @IsOptional() @IsUUID() item_cardapio_id?: string | null;
}
