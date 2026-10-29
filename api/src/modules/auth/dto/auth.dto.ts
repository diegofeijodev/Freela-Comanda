import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  senha!: string;
}

/** Primeiro acesso (só enquanto não existe admin): cria a conta de administrador. */
export class PrimeiroAcessoDto {
  @IsString()
  @MinLength(1, { message: 'Informe o nome' })
  @MaxLength(120)
  nome!: string;

  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'A senha precisa de pelo menos 6 caracteres' })
  @MaxLength(72)
  senha!: string;
}

export class TrocarSenhaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  senha_atual!: string;

  @IsString()
  @MinLength(6, { message: 'A senha precisa de pelo menos 6 caracteres' })
  @MaxLength(72)
  senha_nova!: string;
}
