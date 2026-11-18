// Corpos das rotas /v1/cupom-fiscal. O DTO barra só o tipo e o tamanho bruto (400 VALIDATION_ERROR); as faixas e os formatos fiscais
// (série 0–889, CSC 16–36, NCM, CSOSN × CFOP…) são do serviço, com 422 e a frase da UX — assim a tela recebe sempre a mesma frase, venha
// o valor torto como texto ou como número. Dinheiro do cupom vai em centavos inteiros (`*_centavos`).

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { FRASE_ERRO, FRASES_EMISSAO, FRASES_VALIDACAO } from './frases';
import { FRASES_CADASTRO } from './frases-cadastro';
import { quantidadeValida, type TPag } from './totais';

/** Alíquota (%) aceita como número ou texto; segue como texto ("18.5") para a validação fiscal, que confere as casas. */
const DecimalComoTexto = () => Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value));

/** Empresa no cupom (PUT emitente). Tudo opcional: cada quadro da tela salva só os seus campos; `null` ou "" apaga o que é opcional. */
export class SalvarEmitenteDto {
  @IsOptional() @IsString() @MaxLength(40) ie?: string | null;
  @IsOptional() @IsIn([1, 2, 3, 4], { message: FRASES_CADASTRO.crt }) crt?: number | null;
  @IsOptional() @IsString() @MaxLength(200) logradouro?: string | null;
  @IsOptional() @IsString() @MaxLength(200) numero?: string | null;
  @IsOptional() @IsString() @MaxLength(200) complemento?: string | null;
  @IsOptional() @IsString() @MaxLength(200) bairro?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cep?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cod_municipio?: string | null;
  @IsOptional() @IsString() @MaxLength(200) municipio?: string | null;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string | null;
  @IsOptional() @IsString() @MaxLength(200) nat_op?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) inf_cpl?: string | null;
  @IsOptional() @IsString() @MaxLength(40) resp_tec_cnpj?: string | null;
  @IsOptional() @IsString() @MaxLength(200) resp_tec_contato?: string | null;
  @IsOptional() @IsString() @MaxLength(200) resp_tec_email?: string | null;
  @IsOptional() @IsString() @MaxLength(40) resp_tec_fone?: string | null;
  @IsOptional()
  @IsArray({ message: FRASES_CADASTRO.serieOutroSistema })
  @ArrayMaxSize(50, { message: FRASES_CADASTRO.serieOutroSistema })
  @IsInt({ each: true, message: FRASES_CADASTRO.serieOutroSistema })
  series_outro_sistema?: number[] | null;
  @IsOptional() @IsBoolean() sem_outro_sistema?: boolean | null;
  /** "Quem conta no estoque as vendas emitidas aqui?" (UX 5.4): true = o Comanda, pelo cupom; false = a importação do caixa de hoje. */
  @IsOptional() @IsBoolean() cupom_lanca_venda?: boolean | null;
  @IsOptional() @IsInt({ message: FRASES_CADASTRO.tpRegimeIbscbs }) tp_regime_ibscbs?: number | null;
}

/** Numeração e código de segurança de um ambiente (PUT ambientes/:ambiente). `csc` só entra (a resposta traz só `csc_dica`). */
export class SalvarAmbienteDto {
  @IsOptional() @IsNumber({}, { message: FRASE_ERRO.NFCE_SERIE_INVALIDA }) serie?: number | null;
  @IsOptional() @IsNumber({}, { message: FRASES_CADASTRO.numeroForaDaFaixa }) proximo_numero?: number | null;
  @IsOptional() @IsNumber({}, { message: FRASE_ERRO.NFCE_CSC_INVALIDO('id_csc') }) id_csc?: number | null;
  @IsOptional()
  @IsString({ message: FRASE_ERRO.NFCE_CSC_INVALIDO('csc') })
  @MaxLength(100, { message: FRASE_ERRO.NFCE_CSC_INVALIDO('csc') })
  csc?: string | null;
}

/** Novo perfil fiscal (POST perfis). Os códigos chegam como texto; espaço nas pontas é aparado e "" vira NULL no serviço. */
export class PerfilFiscalDto {
  @IsString({ message: FRASES_CADASTRO.perfilSemNome }) @MaxLength(60, { message: FRASES_CADASTRO.perfilNomeLongo }) nome!: string;
  @IsString({ message: FRASES_VALIDACAO.semCfop }) @MaxLength(10, { message: FRASES_VALIDACAO.semCfop }) cfop!: string;
  @IsOptional() @IsString() @MaxLength(10) csosn?: string | null;
  @IsOptional() @IsString() @MaxLength(10) cst_icms?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.aliqIcms }) @MaxLength(20) aliq_icms?: string | null;
  @IsOptional() @IsString() @MaxLength(10) pis_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) cofins_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) c_ativ_sn?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.ibsSnAliq }) @MaxLength(20) ibs_sn_aliq?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.cbsSnAliq }) @MaxLength(20) cbs_sn_aliq?: string | null;
  @IsOptional() @IsString() @MaxLength(10) ibscbs_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) ibscbs_cclass_trib?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/** Mudar um perfil (PATCH perfis/:id): os mesmos campos, todos opcionais. Desativar = `{ ativo: false }` (perfil em uso nunca é apagado). */
export class AtualizarPerfilDto {
  @IsOptional()
  @IsString({ message: FRASES_CADASTRO.perfilSemNome })
  @MaxLength(60, { message: FRASES_CADASTRO.perfilNomeLongo })
  nome?: string;
  @IsOptional() @IsString({ message: FRASES_VALIDACAO.semCfop }) @MaxLength(10, { message: FRASES_VALIDACAO.semCfop }) cfop?: string;
  @IsOptional() @IsString() @MaxLength(10) csosn?: string | null;
  @IsOptional() @IsString() @MaxLength(10) cst_icms?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.aliqIcms }) @MaxLength(20) aliq_icms?: string | null;
  @IsOptional() @IsString() @MaxLength(10) pis_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) cofins_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) c_ativ_sn?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.ibsSnAliq }) @MaxLength(20) ibs_sn_aliq?: string | null;
  @IsOptional() @DecimalComoTexto() @IsString({ message: FRASES_VALIDACAO.cbsSnAliq }) @MaxLength(20) cbs_sn_aliq?: string | null;
  @IsOptional() @IsString() @MaxLength(10) ibscbs_cst?: string | null;
  @IsOptional() @IsString() @MaxLength(10) ibscbs_cclass_trib?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/** Dados do cupom de um produto (PUT produtos/:itemCardapioId). NCM, CEST e GTIN podem vir com máscara; `perfil_fiscal_id: null` tira o perfil. */
export class SalvarProdutoDto {
  @IsOptional() @IsString() @MaxLength(30) ncm?: string | null;
  @IsOptional() @IsString() @MaxLength(30) cest?: string | null;
  @IsOptional() @IsString() @MaxLength(30) gtin?: string | null;
  @IsOptional() @IsInt({ message: FRASES_VALIDACAO.origem }) origem?: number | null;
  @IsOptional() @IsString() @MaxLength(500) descricao_cupom?: string | null;
  @IsOptional() @IsString() @MaxLength(60) unidade?: string | null;
  @IsOptional() @IsUUID('all', { message: FRASES_CADASTRO.semPerfil }) perfil_fiscal_id?: string | null;
}

/** "Aplicar perfil…" em vários produtos (PUT produtos/perfil), numa transação só (UX 10.10). */
export class PerfilEmLoteDto {
  @IsArray({ message: FRASES_CADASTRO.loteTamanho })
  @ArrayMinSize(1, { message: FRASES_CADASTRO.loteTamanho })
  @ArrayMaxSize(500, { message: FRASES_CADASTRO.loteTamanho })
  @IsUUID('all', { each: true, message: FRASES_CADASTRO.produtoSumiu })
  itens!: string[];
  @IsUUID('all', { message: FRASES_CADASTRO.semPerfil }) perfil_fiscal_id!: string;
}

// ---------------------------------------------------------------------------------------------- corpo da emissão (Tarefa 11)
// O pagamento > 0 e o `tPag` da lista, e a quantidade conferida por `quantidadeValida` ANTES de `calcularTotais` (nota 4 do controlador da
// Tarefa 10). O serviço confere o mesmo (a frase é a mesma); o DTO barra antes, com `whitelist + forbidNonWhitelisted` (um campo
// `entrega`, UX 10.9, é recusado).

/** Formas de pagamento aceitas (o CHECK de `nfce_cupom_pagamentos.t_pag`): dinheiro, crédito, débito, vale-alimentação, vale-refeição e Pix. */
export const T_PAG_ACEITOS: readonly TPag[] = ['01', '03', '04', '10', '11', '17'];

/** Quantidade em texto ("0.350"): ponto, até 4 casas, maior que zero. Uma frase só, venha número, vírgula ou zero. */
const IsQuantidadeDoCupom = () =>
  ValidateBy(
    { name: 'quantidadeDoCupom', validator: { validate: (v: unknown) => typeof v === 'string' && quantidadeValida(v) } },
    { message: FRASES_CADASTRO.quantidade },
  );

export class ItemDoCupomDto {
  @IsUUID('all', { message: FRASES_CADASTRO.produtoSumiu }) item_cardapio_id!: string;
  @IsQuantidadeDoCupom() quantidade!: string;
}

export class PagamentoDoCupomDto {
  @IsIn([...T_PAG_ACEITOS], { message: FRASES_CADASTRO.tPag }) t_pag!: TPag;
  @IsInt({ message: FRASES_CADASTRO.valorPagamento }) @Min(1, { message: FRASES_CADASTRO.valorPagamento }) valor_centavos!: number;
}

/** POST cupons (desenho §8.2): dinheiro em centavos inteiros; os preços são do servidor (a tela manda só o total que mostrou). */
export class EmitirCupomDto {
  @IsUUID('all', { message: FRASES_EMISSAO.chaveDaVenda }) chave_idempotencia!: string;
  /** Lista vazia passa daqui: o serviço responde 400 `NFCE_SEM_ITENS` (o código do desenho, não o VALIDATION_ERROR do DTO). */
  @IsArray({ message: FRASE_ERRO.NFCE_SEM_ITENS })
  @ArrayMaxSize(990)
  @ValidateNested({ each: true })
  @Type(() => ItemDoCupomDto)
  itens!: ItemDoCupomDto[];
  @IsOptional()
  @IsInt({ message: FRASES_EMISSAO.valorEmCentavos })
  @Min(0, { message: FRASES_EMISSAO.valorEmCentavos })
  desconto_centavos?: number;
  @IsArray({ message: FRASES_CADASTRO.tPag })
  @ArrayMinSize(1, { message: FRASES_CADASTRO.tPag })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PagamentoDoCupomDto)
  pagamentos!: PagamentoDoCupomDto[];
  /** CPF ou CNPJ, com ou sem máscara; o DV é do serviço (400 `NFCE_DOC_INVALIDO`, com a frase do tipo). */
  @IsOptional() @IsString() @MaxLength(30) consumidor_doc?: string | null;
  @IsInt({ message: FRASES_EMISSAO.valorEmCentavos })
  @Min(0, { message: FRASES_EMISSAO.valorEmCentavos })
  total_esperado_centavos!: number;
}

/** POST cupons/:id/descartar. Ausente ou fora de 3 a 255 depois de aparar: o serviço responde 400 `NFCE_MOTIVO` com a frase da UX. */
export class DescartarCupomDto {
  @IsOptional()
  @IsString({ message: FRASE_ERRO.NFCE_MOTIVO('descartar') })
  @MaxLength(1000, { message: FRASE_ERRO.NFCE_MOTIVO('descartar') })
  motivo?: string | null;
}

/** PUT ambientes/:ambiente/emissao: ligar ou desligar; valendo, ligar pede `confirmado` (as três marcações da UX 5.1). */
export class LigarEmissaoDto {
  @IsBoolean() ligada!: boolean;
  @IsOptional() @IsBoolean() confirmado?: boolean;
}
