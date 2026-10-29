import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';

/** Conta manual (sem nota) ou "Lançar conta" de um boleto que só existia no DDA. */
export class NovaContaDto {
  @IsString() @MinLength(1, { message: 'Preencha descrição, valor e vencimento' }) @MaxLength(300) descricao!: string;
  @IsOptional() @IsString() @MaxLength(300) fornecedor_nome?: string | null;
  @IsNumber() valor!: number;
  @IsDayString({ message: 'Preencha descrição, valor e vencimento' }) vencimento!: string;
  @IsOptional() @IsString() @MaxLength(40) forma_pagamento?: string;
  @IsOptional() @IsString() @MaxLength(60) categoria?: string;
  @IsOptional() @IsString() @MaxLength(80) linha_digitavel?: string | null;
  @IsOptional() @IsBoolean() origem_dda?: boolean;
}

export class LiquidarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids!: string[];
  @IsDayString() pago_em!: string;
  @IsUUID('all', { message: 'Escolha a classe e o centro de custo' }) plano_conta_id!: string;
  @IsUUID('all', { message: 'Escolha a classe e o centro de custo' }) centro_custo_id!: string;
}
