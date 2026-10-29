import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Edição de célula: embalagens (lista gerada) ou recebimento (quantidade/preço pago). */
export class ItemListaDto {
  @IsOptional() @IsNumber() embalagens?: number;
  @IsOptional() @IsNumber() qtd_recebida?: number | null;
  @IsOptional() @IsNumber() preco_pago?: number | null;
}

export class ItemAvulsoDto {
  @IsString() @MinLength(1) @MaxLength(300) descricao!: string;
  @IsNumber() quantidade!: number;
}

export class ReceberDto {
  @IsBoolean() atualizar_preco!: boolean;
}
