import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';

export class NovoItemEstoqueDto {
  @IsString() @MinLength(1) @MaxLength(200) nome!: string;
}

/** Edição célula a célula da tela Estoque Objetivo (cada PATCH leva um ou poucos campos). */
export class ItemEstoqueDto {
  @IsOptional() @IsString() @MaxLength(60) codigo?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nome?: string;
  @IsOptional() @IsIn(['Insumo', 'Produto de venda']) tipo?: string;
  @IsOptional() @IsString() @MaxLength(120) subgrupo?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) unidade?: string;
  @IsOptional() @IsNumber() preco_unitario?: number | null;
  @IsOptional() @IsString() @MaxLength(120) embalagem_compra?: string | null;
  @IsOptional() @IsNumber() qtd_por_embalagem?: number;
  @IsOptional() @IsString() @MaxLength(200) fornecedor?: string | null;
  @IsOptional() @IsNumber() consumo_semanal_manual?: number | null;
  @IsOptional() @IsBoolean() usar_manual?: boolean;
  @IsOptional() @IsNumber() estoque_seguranca_pct?: number | null;
  @IsOptional() @IsNumber() objetivo_manual?: number | null;
  @IsOptional() @IsNumber() tolerancia_pct?: number | null;
  @IsOptional() @IsNumber() tolerancia_abs?: number | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/** Lançamento manual do diálogo do Estoque: perda (sempre baixa) ou ajuste (±). */
export class MovimentacaoDto {
  @IsUUID() item_estoque_id!: string;
  @IsIn(['perda', 'ajuste_manual']) tipo!: 'perda' | 'ajuste_manual';
  @IsDayString() data!: string;
  @IsNumber() quantidade!: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string | null;
}
