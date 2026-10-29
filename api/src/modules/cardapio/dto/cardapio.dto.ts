import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class NovoItemCardapioDto {
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
}

/** Cabeçalho + custos da Ficha Técnica Gerencial (botão Salvar). */
export class ItemCardapioDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nome?: string;
  @IsOptional() @IsString() @MaxLength(60) codigo?: string | null;
  @IsOptional() @IsString() @MaxLength(120) categoria?: string;
  @IsOptional() @IsString() @MaxLength(120) grupo?: string;
  @IsOptional() @IsString() @MaxLength(20) unidade_venda?: string;
  @IsOptional() @IsNumber() preco_venda?: number | null;
  @IsOptional() @IsNumber() mkup?: number | null;
  @IsOptional() @IsString() @MaxLength(20) ncm?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cfop?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cst?: string | null;
  @IsOptional() @IsNumber() aliquota?: number | null;
  @IsOptional() @IsString() @MaxLength(10000) observacoes?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class NovoIngredienteDto {
  @IsUUID() item_estoque_id!: string;
  @IsNumber() quantidade!: number;
  @IsOptional() @IsString() @MaxLength(20) unidade?: string | null;
  @IsOptional() @IsInt() ordem?: number;
}

export class IngredienteDto {
  @IsOptional() @IsNumber() quantidade?: number;
  @IsOptional() @IsNumber() rendimento?: number | null;
}
