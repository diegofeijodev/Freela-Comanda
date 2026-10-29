import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';
import { FORMAS_PGTO } from '../../leitura-pdf/schemas';

export class ItemNotaDto {
  @IsOptional() @IsString() @MaxLength(120) codigo?: string | null;
  @IsString() @MaxLength(500) descricao!: string;
  @IsOptional() @IsString() @MaxLength(20) unidade?: string | null;
  @IsNumber() quantidade!: number;
  @IsNumber() valor_unitario!: number;
  @IsOptional() @IsUUID() item_estoque_id?: string | null;
  @IsOptional() @IsNumber() fator?: number;
}

export class ParcelaDto {
  @IsDayString({ message: 'Informe o vencimento de cada parcela' }) vencimento!: string;
  @IsNumber() valor!: number;
}

/** "Dar entrada": tudo o que a tela tinha conferido, numa chamada só (spec, decisão 7). */
export class LancarNotaDto {
  @IsOptional() @IsString() @MaxLength(60) chave?: string | null;
  @IsOptional() @IsString() @MaxLength(30) numero?: string | null;
  @IsOptional() @IsString() @MaxLength(10) serie?: string | null;
  @IsString() @MaxLength(300) fornecedor_nome!: string;
  @IsOptional() @IsString() @MaxLength(20) fornecedor_cnpj?: string | null;
  @IsOptional() @IsDayString() data_emissao?: string | null;
  @IsDayString() data_entrada!: string;
  @IsNumber() valor_total!: number;
  @IsIn([...FORMAS_PGTO]) forma_pagamento!: (typeof FORMAS_PGTO)[number];
  @IsIn(['xml', 'pdf']) origem!: 'xml' | 'pdf';
  @IsBoolean() atualizar_preco!: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'Nenhum item encontrado na nota' })
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ItemNotaDto)
  itens!: ItemNotaDto[];

  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => ParcelaDto)
  parcelas!: ParcelaDto[];
}
