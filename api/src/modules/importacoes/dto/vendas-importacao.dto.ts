import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Corpo raso de propósito (desenho A.8): as linhas, os documentos e o mapeamento são conferidos campo a campo nas funções puras
// (planilha.ts, documentos.ts), que dão 400 com a frase certa e nunca 500 por um tipo inesperado.

export const FORMATOS = ['planilha', 'xml', 'pdf'] as const;
export type Formato = (typeof FORMATOS)[number];

export class VendasImportacaoDto {
  @IsIn(FORMATOS) formato!: Formato;
  /** null = "Planilha padrão do Comanda" (só planilha). */
  @IsOptional() @IsUUID() origem_id?: string | null;
  @IsString() @MaxLength(300) arquivo!: string;
  @IsOptional() @Matches(/^[0-9a-f]{64}$/, { message: 'arquivo_sha256 inválido' }) arquivo_sha256?: string;
  @IsIn(['acrescentar', 'substituir']) modo!: 'acrescentar' | 'substituir';

  // planilha: as linhas como o navegador leu (coluna → texto) + o mapeamento escolhido
  @IsOptional() @IsArray() @ArrayMaxSize(100_000) @IsObject({ each: true }) linhas_brutas?: Record<string, unknown>[];
  @IsOptional() @IsObject() mapeamento?: Record<string, unknown>;
  @IsOptional() @IsIn(['virgula', 'ponto']) separador_decimal?: 'virgula' | 'ponto';
  @IsOptional() @IsBoolean() salvar_mapeamento?: boolean;
  /** Linha do arquivo da 1ª linha de dados (o cabeçalho pode não estar na 1ª linha; padrão 2). */
  @IsOptional() @IsInt() @Min(2) @Max(1_000_000) primeira_linha?: number;

  // pdf (já conferido na tela): { pedido|null, data|null, hora|null, produto_relatorio, quantidade, valor_total, desconto? } com ponto decimal
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsObject({ each: true }) linhas?: Record<string, unknown>[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'data_padrao deve ser AAAA-MM-DD' }) data_padrao?: string;

  // xml (lido no navegador)
  @IsOptional() @IsInt() @Min(0) @Max(100_000) arquivos_lidos?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5000) documentos?: unknown[];
  @IsOptional() @IsArray() @ArrayMaxSize(5000) cancelamentos?: unknown[];
  @IsOptional() @IsArray() @ArrayMaxSize(5000) ignorados?: unknown[];
  /** CNPJs de Empresas marcados na prévia ("Incluir os N cupons de …"). */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) cnpjs_incluidos?: string[];
  /** Chaves das NF-e (modelo 55) marcadas na prévia: fora daqui, a NF-e não entra. */
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) nfe_incluidas?: string[];
}

export class VendasConfirmarDto extends VendasImportacaoDto {
  /** uuid gerado pelo navegador quando a prévia aparece (R8). */
  @IsUUID() chave_idempotencia!: string;
  @IsOptional() @IsBoolean() confirmar_sobreposicao?: boolean;
  /** Escolha da prévia para os produtos novos: { produto_relatorio, item_cardapio_id|null }. */
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsObject({ each: true }) de_para_novos?: Record<string, unknown>[];
}

export class OrigemDto {
  @IsString() @MinLength(1) @MaxLength(60) nome!: string;
  @IsIn(FORMATOS) formato_padrao!: Formato;
  @IsOptional() @IsIn(['virgula', 'ponto']) separador_decimal?: 'virgula' | 'ponto';
  @IsOptional() @IsString() @MaxLength(10) prefixo_pedido?: string;
}

export class OrigemEdicaoDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) nome?: string;
  @IsOptional() @IsIn(FORMATOS) formato_padrao?: Formato;
  @IsOptional() @IsIn(['virgula', 'ponto']) separador_decimal?: 'virgula' | 'ponto';
  @IsOptional() @IsString() @MaxLength(10) prefixo_pedido?: string;
  /** null = esquecer as colunas lembradas. */
  @IsOptional() @IsObject() mapeamento?: Record<string, unknown> | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
