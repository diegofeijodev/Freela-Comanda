import { IsIn, IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';

export class AbrirInventarioDto {
  @IsDayString() data!: string;
  @IsIn(['diario', 'semanal', 'mensal'], { message: 'Periodicidade inválida' }) periodicidade!: string;
}

export class ContagemDto {
  @IsNumber({}, { message: 'Quantidade inválida' })
  @Min(0, { message: 'Quantidade inválida' })
  quantidade!: number;
}

/** Admin define a quantidade final na mão (com justificativa obrigatória). */
export class FinalDto {
  @IsNumber({}, { message: 'Quantidade inválida' }) final!: number;
  @IsString() @MinLength(1, { message: 'Informe a justificativa' }) @MaxLength(1000) justificativa!: string;
}
