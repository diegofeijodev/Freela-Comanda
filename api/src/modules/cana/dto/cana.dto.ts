import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';
import { TIPOS_CANA, type TipoCana } from '../regras';

/** O formato. O que cada tipo pede (e os sinais) fica em `camposDoLancamento`, com as frases da tela. */
const MAX = 100_000;
const duzias = (rotulo: string) => [
  IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: `${rotulo} com até 2 casas` }),
  Min(0, { message: `${rotulo} não podem ser negativas` }),
  Max(MAX, { message: `${rotulo}: no máximo 100.000` }),
];
const litros = (rotulo: string) => [
  IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false }, { message: `${rotulo} com até 3 casas` }),
  Min(0, { message: `${rotulo} não podem ser negativos` }),
  Max(MAX, { message: `${rotulo}: no máximo 100.000` }),
];
const aplicar =
  (ds: PropertyDecorator[]): PropertyDecorator =>
  (alvo, campo) =>
    ds.forEach((d) => d(alvo, campo));

class CamposCanaDto {
  @IsDayString({ message: 'deve ser uma data AAAA-MM-DD' }) data!: string;
  @IsOptional() @aplicar(duzias('Dúzias')) duzias?: number | null;
  @IsOptional() @aplicar(litros('Litros de caldo')) litros_caldo?: number | null;
  @IsOptional() @aplicar(litros('Litros de frozen')) litros_frozen?: number | null;
  @IsOptional() @IsString() @MaxLength(120, { message: 'O fornecedor tem no máximo 120 letras.' }) fornecedor?: string | null;
  @IsOptional() @IsString() @MaxLength(200, { message: 'A observação tem no máximo 200 letras.' }) observacao?: string | null;
}

export class LancamentoCanaDto extends CamposCanaDto {
  @IsIn(TIPOS_CANA, { message: 'Tipo de lançamento inválido' }) tipo!: TipoCana;
  /** Nasce no navegador ao abrir o formulário: tocar de novo em "Lançar" depois de uma ida que chegou não lança duas vezes. */
  @IsOptional() @IsUUID('all', { message: 'chave_idempotencia deve ser um uuid' }) chave_idempotencia?: string;
}

export class AnularCanaDto {
  /** Mínimo de 3 letras = regra (400 CANA_MOTIVO_OBRIGATORIO), não formato. */
  @IsOptional() @IsString() @MaxLength(300, { message: 'O motivo tem no máximo 300 letras.' }) motivo?: string;
}

/** Corrigir = anular o lançamento e lançar o novo (do mesmo tipo) numa transação só. */
export class CorrigirCanaDto extends CamposCanaDto {
  @IsOptional() @IsString() @MaxLength(300, { message: 'O motivo tem no máximo 300 letras.' }) motivo?: string;
}

const positivoOuNulo = [
  IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }, { message: 'Use um número com até 4 casas.' }),
  Min(0.0001, { message: 'Use um número maior que zero (ex.: 5,5).' }),
  Max(1000, { message: 'Use um número até 1.000.' }),
];

export class ParametrosCanaDto {
  @ValidateIf((_, v) => v !== null) @aplicar(positivoOuNulo) litros_por_duzia_esperado!: number | null;
  @ValidateIf((_, v) => v !== null) @aplicar(positivoOuNulo) rendimento_frozen!: number | null;
}

export class ProdutoCanaDto {
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'Digite os ml (maior que zero).' })
  @Min(0.01, { message: 'Digite os ml (maior que zero).' })
  @Max(20_000, { message: 'No máximo 20.000 ml.' })
  ml_por_unidade!: number;
  @IsBoolean() frozen!: boolean;
  @IsBoolean() ativo!: boolean;
}
