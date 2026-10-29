import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';

/** Fechamento do dia: salvar de novo na mesma data substitui (upsert por data, como no protótipo). */
export class CaixaDto {
  @IsDayString() data!: string;
  @IsNumber() dinheiro!: number;
  @IsNumber() debito!: number;
  @IsNumber() credito!: number;
  @IsNumber() pix!: number;
  @IsNumber() ifood!: number;
  @IsNumber() delivery_proprio!: number;
  @IsNumber() cartao_alimentacao!: number;
  @IsNumber() sangria!: number;
  @IsNumber() sangria_cofre!: number;
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string | null;
}
