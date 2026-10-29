import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Tela Configurações → aba Geral (todos opcionais: o PATCH grava só o que veio). */
export class ConfiguracoesDto {
  @IsOptional() @IsString() @MaxLength(200) razao_social?: string;
  @IsOptional() @IsString() @MaxLength(200) nome_fantasia?: string;
  @IsOptional() @IsString() @MaxLength(40) cnpj?: string;
  @IsOptional() @IsString() @MaxLength(300) endereco?: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) dia_inventario?: number;
  @IsOptional() @IsBoolean() loja_pode_abrir?: boolean;
  @IsOptional() @IsNumber() @Min(0) tolerancia_pct?: number;
  @IsOptional() @IsNumber() @Min(0) tolerancia_abs_kg?: number;
  @IsOptional() @IsNumber() @Min(0) tolerancia_abs_un?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) max_recontagens?: number;
  @IsOptional() @IsNumber() custo_preparo_pct?: number;
  @IsOptional() @IsNumber() margem_seguranca_pct?: number;
  @IsOptional() @IsNumber() mkup_padrao?: number;
  @IsOptional() @IsNumber() estoque_seguranca_pct?: number;
  @IsOptional() @IsInt() @Min(1) @Max(104) semanas_media?: number;
}

export class SazonalidadeDto {
  @IsNumber() fator_pct!: number;
}

export class SubgrupoDto {
  @IsString() @MinLength(1) @MaxLength(120) nome!: string;
  @IsIn(['Insumos', 'Produtos de venda']) grupo!: string;
  @IsOptional() @IsInt() ordem?: number;
}

export class FornecedorDto {
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
  @IsOptional() @IsString() @MaxLength(60) telefone?: string;
  @IsOptional() @IsString() @MaxLength(200) contato?: string;
  @IsOptional() @IsString() @MaxLength(20) cnpj?: string;
}

export class PlanoContaDto {
  @IsString() @MinLength(1) @MaxLength(200) grupo!: string;
  @IsOptional() @IsString() @MaxLength(200) subgrupo?: string;
  @IsString() @MinLength(1) @MaxLength(200) conta!: string;
}

export class PlanoContasLoteDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => PlanoContaDto)
  linhas!: PlanoContaDto[];
}

export class CentroCustoDto {
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
}

export class DreSubgrupoDto {
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
  @IsOptional() @IsString() @MaxLength(40) sigla?: string;
  @IsOptional() @IsNumber() meta_pct?: number | null;
  @IsOptional() @IsInt() ordem?: number;
}

export class DreMetaDto {
  @IsOptional() @IsNumber() meta_pct?: number | null;
}
