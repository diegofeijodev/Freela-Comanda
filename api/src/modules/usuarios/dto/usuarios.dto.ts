import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

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
