import { IsString, MaxLength, MinLength } from 'class-validator';

/** O arquivo vai em base64 (poucos KB); a senha só serve para abrir o .pfx naquele pedido e não é gravada. */
export class EnviarCertificadoDto {
  @IsString({ message: 'Escolha o arquivo do certificado.' })
  @MinLength(1, { message: 'Escolha o arquivo do certificado.' })
  @MaxLength(90000, { message: 'Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).' })
  arquivo_base64!: string;

  @IsString({ message: 'Digite a senha do certificado.' })
  @MinLength(1, { message: 'Digite a senha do certificado.' })
  @MaxLength(128, { message: 'A senha do certificado tem no máximo 128 caracteres.' })
  senha!: string;
}
