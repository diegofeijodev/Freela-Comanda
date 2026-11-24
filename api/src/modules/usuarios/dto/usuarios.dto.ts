import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MODULOS } from '../../../common/decorators/permissao.decorator';

const PERFIS = ['admin', 'loja'] as const;

export class CriarUsuarioDto {
  @IsString()
  @MaxLength(120)
  nome!: string;

  @IsEmail({}, { message: 'Dados inválidos' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Dados inválidos' })
  @MaxLength(72)
  senha!: string;

  @IsIn(PERFIS, { message: 'Dados inválidos' })
  perfil!: (typeof PERFIS)[number];

  /** Telas do colaborador (perfil `loja`). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MODULOS.length)
  @IsIn(MODULOS, { each: true, message: 'Tela inválida' })
  modulos?: string[];

  /** Só o master cria outro master (vê todas as empresas). */
  @IsOptional()
  @IsBoolean()
  master?: boolean;
}

export class ModulosDto {
  @IsArray()
  @ArrayMaxSize(MODULOS.length)
  @IsIn(MODULOS, { each: true, message: 'Tela inválida' })
  modulos!: string[];
}

export class PerfilDto {
  @IsIn(PERFIS, { message: 'Perfil inválido' })
  perfil!: (typeof PERFIS)[number];
}

export class SenhaDto {
  @IsString()
  @MinLength(6, { message: 'A senha precisa de pelo menos 6 caracteres' })
  @MaxLength(72)
  senha!: string;
}
