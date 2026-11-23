import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';

export const REGIMES = ['mei', 'simples', 'simples_excesso', 'presumido', 'real'] as const;
export type Regime = (typeof REGIMES)[number];
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const vazioOuNulo = (o: unknown, v: unknown) => v !== null && v !== undefined && v !== '';

/** Cadastro completo (POST e PUT mandam o formulário inteiro). Campos opcionais vazios viram null. */
export class EmpresaDto {
  @IsString() @MinLength(2, { message: 'Informe a razão social' }) @MaxLength(150) razao_social!: string;
  @IsOptional() @IsString() @MaxLength(150) nome_fantasia?: string | null;
  @IsString() @MinLength(1, { message: 'Informe o CNPJ' }) @MaxLength(20) cnpj!: string;
  @IsOptional() @IsString() @MaxLength(20) inscricao_estadual?: string | null;
  @IsOptional() @IsString() @MaxLength(20) inscricao_municipal?: string | null;
  @IsOptional() @ValidateIf(vazioOuNulo) @IsIn(REGIMES, { message: 'Regime tributário inválido' }) regime_tributario?: Regime | '' | null;
  @IsOptional() @IsString() @MaxLength(12) cnae?: string | null;
  @IsOptional() @ValidateIf(vazioOuNulo) @IsDayString() data_abertura?: string | null;
  @IsOptional() @IsString() @MaxLength(10) cep?: string | null;
  @IsOptional() @IsString() @MaxLength(150) logradouro?: string | null;
  @IsOptional() @IsString() @MaxLength(20) numero?: string | null;
  @IsOptional() @IsString() @MaxLength(80) complemento?: string | null;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string | null;
  @IsOptional() @IsString() @MaxLength(80) cidade?: string | null;
  @IsOptional() @ValidateIf(vazioOuNulo) @IsIn(UFS, { message: 'UF inválida' }) uf?: string | null;
  @IsOptional() @IsString() @MaxLength(7) cod_municipio?: string | null;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string | null;
  @IsOptional() @IsString() @MaxLength(20) celular?: string | null;
  @IsOptional() @ValidateIf(vazioOuNulo) @IsEmail({}, { message: 'E-mail inválido' }) @MaxLength(150) email?: string | null;
  @IsOptional() @IsString() @MaxLength(150) site?: string | null;
  @IsOptional() @IsString() @MaxLength(120) responsavel_nome?: string | null;
  @IsOptional() @IsString() @MaxLength(14) responsavel_cpf?: string | null;
  @IsOptional() @IsString() @MaxLength(120) contador_nome?: string | null;
  @IsOptional() @ValidateIf(vazioOuNulo) @IsEmail({}, { message: 'E-mail do contador inválido' }) @MaxLength(150) contador_email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) contador_telefone?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) observacoes?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
