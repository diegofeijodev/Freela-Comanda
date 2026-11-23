import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsDayString } from '../../../common/validation/is-day.decorator';
import { TIPOS_FOLGA, TIPOS_MARCACAO, TIPOS_OCORRENCIA, type TipoFolga, type TipoMarcacao, type TipoOcorrencia } from '../calculo';

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const PIN = /^\d{4,6}$/;
const MSG_PIN = 'O PIN deve ter de 4 a 6 números';

// ---------- escalas
export class DiaEscalaDto {
  @IsInt() @Min(0) @Max(6) dia_semana!: number;
  @IsBoolean() folga!: boolean;
  @IsOptional() @Matches(HHMM, { message: 'Horário deve ser HH:MM' }) entrada?: string | null;
  @IsOptional() @Matches(HHMM, { message: 'Horário deve ser HH:MM' }) saida?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(600) intervalo_min?: number;
}

export class EscalaDto {
  @IsString() @MinLength(1, { message: 'Dê um nome para a escala' }) @MaxLength(80) nome!: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) tolerancia_min?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => DiaEscalaDto) dias!: DiaEscalaDto[];
}

// ---------- colaboradores
export class NovoColaboradorDto {
  @IsString() @MinLength(1, { message: 'Informe o nome' }) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) cpf?: string | null;
  @IsOptional() @IsString() @MaxLength(80) cargo?: string | null;
  @IsOptional() @IsDayString() admissao?: string | null;
  @IsOptional() @IsUUID('all') escala_id?: string | null;
  @IsOptional() @IsUUID('all') empresa_id?: string | null;
  @Matches(PIN, { message: MSG_PIN }) pin!: string;
}

export class AtualizarColaboradorDto {
  @IsOptional() @IsString() @MinLength(1, { message: 'Informe o nome' }) @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(20) cpf?: string | null;
  @IsOptional() @IsString() @MaxLength(80) cargo?: string | null;
  @IsOptional() @IsDayString() admissao?: string | null;
  @IsOptional() @IsUUID('all') escala_id?: string | null;
  @IsOptional() @IsUUID('all') empresa_id?: string | null;
  @IsOptional() @Matches(PIN, { message: MSG_PIN }) pin?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

// ---------- folgas / feriados
export class NovaFolgaDto {
  @IsOptional() @IsUUID('all') colaborador_id?: string | null; // nulo = todos (feriado da loja)
  @IsDayString() data!: string;
  @IsOptional() @IsDayString() ate?: string; // período (férias): de `data` até `ate`
  @IsIn(TIPOS_FOLGA, { message: 'Tipo deve ser folga, feriado, ferias ou atestado' }) tipo!: TipoFolga;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string | null;
}

// ---------- marcações (ajuste do admin)
export class MarcacaoManualDto {
  @IsUUID('all') colaborador_id!: string;
  @IsDayString() data!: string;
  @Matches(HHMM, { message: 'Horário deve ser HH:MM' }) hora!: string;
  /** A batida é no dia seguinte ao da jornada (saída de turno que vira a noite). */
  @IsOptional() @IsBoolean() dia_seguinte?: boolean;
  @IsIn(TIPOS_MARCACAO) tipo!: TipoMarcacao;
  @IsString() @MinLength(3, { message: 'Explique o motivo do ajuste' }) @MaxLength(300) motivo!: string;
}

export class CorrigirMarcacaoDto {
  @Matches(HHMM, { message: 'Horário deve ser HH:MM' }) hora!: string;
  @IsOptional() @IsBoolean() dia_seguinte?: boolean;
  @IsIn(TIPOS_MARCACAO) tipo!: TipoMarcacao;
  @IsString() @MinLength(3, { message: 'Explique o motivo da correção' }) @MaxLength(300) motivo!: string;
}

export class AnularMarcacaoDto {
  @IsString() @MinLength(3, { message: 'Explique o motivo' }) @MaxLength(300) motivo!: string;
}

// ---------- justificativas
export class JustificativaAdminDto {
  @IsUUID('all') colaborador_id!: string;
  @IsDayString() data!: string;
  @IsIn(TIPOS_OCORRENCIA) tipo!: TipoOcorrencia;
  @IsString() @MinLength(3, { message: 'Escreva a justificativa' }) @MaxLength(500) texto!: string;
  @IsOptional() @IsBoolean() abonar?: boolean;
}

export class ResponderJustificativaDto {
  @IsBoolean() aceita!: boolean;
  @IsOptional() @IsBoolean() abonar?: boolean;
  @IsOptional() @IsString() @MaxLength(300) resposta?: string | null;
}

// ---------- terminais
export class NovoTerminalDto {
  @IsString() @MinLength(1, { message: 'Dê um nome ao computador' }) @MaxLength(60) nome!: string;
}

// ---------- terminal (loja)
export class IdentificarDto {
  @IsUUID('all') colaborador_id!: string;
  @Matches(PIN, { message: 'PIN incorreto' }) pin!: string;
}

export class MarcarDto extends IdentificarDto {
  @IsIn(TIPOS_MARCACAO) tipo!: TipoMarcacao;
}

export class JustificarDto extends IdentificarDto {
  @IsDayString() data!: string;
  @IsIn(TIPOS_OCORRENCIA) tipo!: TipoOcorrencia;
  @IsString() @MinLength(3, { message: 'Escreva a justificativa' }) @MaxLength(500) texto!: string;
}
