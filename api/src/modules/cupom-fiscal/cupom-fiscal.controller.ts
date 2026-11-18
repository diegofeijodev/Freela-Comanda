import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  type PipeTransform,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { CupomCadastroService, type Autor } from './cadastro.service';
import { CupomCancelamentoService } from './cancelamento.service';
import {
  AtualizarPerfilDto,
  CancelarCupomDto,
  DescartarCupomDto,
  EmitirCupomDto,
  LigarEmissaoDto,
  PerfilEmLoteDto,
  PerfilFiscalDto,
  SalvarAmbienteDto,
  SalvarEmitenteDto,
  SalvarProdutoDto,
} from './cupom-fiscal.dto';
import { CupomEmissaoService } from './emissao.service';
import { CupomLeituraService, filtroDaLista } from './leitura.service';

/** `:ambiente` só aceita os dois ambientes da SEFAZ; outro valor = 404, como o id malformado do `ParseUuidPipe`. */
class ParseAmbientePipeImpl implements PipeTransform<string, AmbienteSefaz> {
  transform(valor: string): AmbienteSefaz {
    if (valor !== 'homologacao' && valor !== 'producao') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    return valor;
  }
}
const ParseAmbientePipe = new ParseAmbientePipeImpl();

const autor = (eu: AuthUser): Autor => ({ id: eu.id, nome: eu.nome });

/**
 * Cupom fiscal (NFC-e): cadastro (situação, empresa no cupom, numeração e CSC de cada ambiente, perfis fiscais e dados do cupom dos
 * produtos), leitura (lista, cupom, DANFE, XML, zip do mês e vendas do período; com o servidor desligado também) e emissão (emitir,
 * enviar de novo, consultar, cancelar, descartar, lançar a venda, testar a conexão e ligar/desligar).
 * Só admin: o cupom mostra preço de venda, que a loja nunca vê. O cadastro não fala com a SEFAZ e funciona com o servidor desligado
 * (`NFCE_AMBIENTE` vazia); a emissão responde 503 `NFCE_DESLIGADA` com ele desligado (menos `lancar-venda`, que não fala com a SEFAZ).
 * Dinheiro no fio em centavos inteiros (`*_centavos`); o CSC só entra (a resposta traz `csc_dica`). Rotas estáticas antes das com parâmetro.
 */
@ApiTags('Cupom fiscal')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/cupom-fiscal')
export class CupomFiscalController {
  constructor(
    private readonly cadastro: CupomCadastroService,
    private readonly emissao: CupomEmissaoService,
    private readonly cancelamento: CupomCancelamentoService,
    private readonly leitura: CupomLeituraService,
  ) {}

  /** "Para ligar a emissão, falta:", certificado, numeração e a faixa de pendentes do ambiente do servidor. */
  @Get('situacao')
  situacao() {
    return this.cadastro.situacao(new Date());
  }

  @Get('emitente')
  emitente() {
    return this.cadastro.emitente();
  }

  /** Cada quadro salva só os seus campos (o que não vem fica). */
  @Put('emitente')
  salvarEmitente(@CurrentUser() eu: AuthUser, @Body() dto: SalvarEmitenteDto) {
    return this.cadastro.salvarEmitente(dto, autor(eu));
  }

  @Get('ambientes/:ambiente')
  ambiente(@Param('ambiente', ParseAmbientePipe) a: AmbienteSefaz) {
    return this.cadastro.ambiente(a);
  }

  @Put('ambientes/:ambiente')
  salvarAmbiente(@CurrentUser() eu: AuthUser, @Param('ambiente', ParseAmbientePipe) a: AmbienteSefaz, @Body() dto: SalvarAmbienteDto) {
    return this.cadastro.salvarAmbiente(a, dto, autor(eu));
  }

  /** "Ligar a emissão de cupons" / "Desligar a emissão" (só o ambiente do servidor) → a situação. Valendo, ligar pede `confirmado`. */
  @Put('ambientes/:ambiente/emissao')
  ligarEmissao(@CurrentUser() eu: AuthUser, @Param('ambiente', ParseAmbientePipe) a: AmbienteSefaz, @Body() dto: LigarEmissaoDto) {
    return this.emissao.ligarEmissao(a, dto.ligada, dto.confirmado === true, autor(eu));
  }

  /** Status do serviço da SEFAZ (no máximo 1 a cada 5 min). */
  @Post('testar-conexao')
  @HttpCode(200)
  testarConexao(@CurrentUser() eu: AuthUser) {
    return this.emissao.testarConexao(autor(eu));
  }

  // ---------------------------------------------------------------------------------------------------- leitura (servidor desligado ok)

  /** O aviso da importação de vendas (desenho §3.4): cupons valendo com a venda no estoque entre `ini` e `fim` (dias de Brasília). */
  @Get('vendas-no-periodo')
  vendasNoPeriodo(@Query('ini') ini?: string, @Query('fim') fim?: string) {
    return this.leitura.vendasNoPeriodo(ini ?? '', fim ?? '');
  }

  /**
   * O zip do mês para o contador (`?mes=AAAA-MM&ambiente=`; sem ambiente, o do servidor). Os cabeçalhos só vão DEPOIS de o arquivo
   * existir: com `@Header` eles ficariam também nas respostas de erro (JSON).
   */
  @Get('xml-do-mes')
  async xmlDoMes(
    @Query('mes') mes: string | undefined,
    @Query('ambiente') ambiente: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<Buffer> {
    if (ambiente !== undefined && ambiente !== 'homologacao' && ambiente !== 'producao') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Filtro inválido.' });
    }
    const r = await this.leitura.xmlDoMes(mes ?? '', ambiente);
    void res.header('content-type', 'application/zip');
    void res.header('content-disposition', `attachment; filename="${r.nome}"`);
    return r.zip;
  }

  /** Emitidos: `ambiente`, `ini`/`fim`, `situacao=a,b`, `atencao=true`, `chave_idempotencia` (só lê: `[]` ou o cupom) e `limite`. */
  @Get('cupons')
  cupons(
    @Query('ambiente') ambiente?: string,
    @Query('ini') ini?: string,
    @Query('fim') fim?: string,
    @Query('situacao') situacao?: string | string[],
    @Query('atencao') atencao?: string,
    @Query('chave_idempotencia') chave_idempotencia?: string,
    @Query('limite') limite?: string,
  ) {
    return this.leitura.listar(filtroDaLista({ ambiente, ini, fim, situacao, atencao, chave_idempotencia, limite }));
  }

  /** O cupom, com as horas e as ações calculadas no servidor (o mesmo formato do POST); sem XML. */
  @Get('cupons/:id')
  cupom(@Param('id', ParseUuidPipe) id: string) {
    return this.leitura.detalhe(id);
  }

  /** Os dados do DANFE, só do XML autorizado guardado (valores como texto do XML). Só do cupom autorizado. */
  @Get('cupons/:id/danfe')
  danfe(@Param('id', ParseUuidPipe) id: string) {
    return this.leitura.danfe(id);
  }

  /** O arquivo do cupom (`tipo=nota`, o padrão) ou do cancelamento, em `text/xml`, com o cabeçalho posto depois das checagens. */
  @Get('cupons/:id/xml')
  async xml(
    @Param('id', ParseUuidPipe) id: string,
    @Query('tipo') tipo: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    if (tipo !== undefined && tipo !== 'nota' && tipo !== 'cancelamento') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Filtro inválido.' });
    }
    const r = await this.leitura.xml(id, tipo ?? 'nota');
    void res.header('content-type', 'text/xml; charset=utf-8');
    void res.header('content-disposition', `attachment; filename="${r.nome}"`);
    return r.xml;
  }

  // ---------------------------------------------------------------------------------------------------- emissão

  /** Emite: 201 com o cupom em qualquer situação final desta tentativa; 200 com o cupom já emitido pela mesma chave e o mesmo corpo. */
  @Post('cupons')
  async emitir(@CurrentUser() eu: AuthUser, @Body() dto: EmitirCupomDto, @Res({ passthrough: true }) res: FastifyReply) {
    const r = await this.emissao.emitir(
      {
        chave_idempotencia: dto.chave_idempotencia,
        itens: dto.itens.map((i) => ({ item_cardapio_id: i.item_cardapio_id, quantidade: i.quantidade })),
        desconto_centavos: dto.desconto_centavos ?? 0,
        pagamentos: dto.pagamentos.map((p) => ({ t_pag: p.t_pag, valor_centavos: p.valor_centavos })),
        consumidor_doc: dto.consumidor_doc ?? null,
        total_esperado_centavos: dto.total_esperado_centavos,
      },
      autor(eu),
    );
    void res.status(r.status);
    return r.cupom;
  }

  /** "Enviar de novo": o mesmo número, a hora nova (até 3 envios). */
  @Post('cupons/:id/reenviar')
  @HttpCode(200)
  reenviar(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.emissao.reenviar(id, autor(eu));
  }

  /** "Consultar na SEFAZ" pela chave (nunca reenvia). */
  @Post('cupons/:id/consultar')
  @HttpCode(200)
  consultar(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string) {
    return this.emissao.consultar(id, autor(eu));
  }

  /** "Cancelar o cupom" na SEFAZ (evento 110111) até a autorização + 29 min: 200 com o cupom (cancelado, cancelando ou a recusa). */
  @Post('cupons/:id/cancelar')
  @HttpCode(200)
  cancelar(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: CancelarCupomDto) {
    return this.cancelamento.cancelar(id, dto.motivo ?? '', autor(eu));
  }

  @Post('cupons/:id/descartar')
  @HttpCode(200)
  descartar(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: DescartarCupomDto) {
    return this.emissao.descartar(id, dto.motivo ?? '', autor(eu));
  }

  /** Refaz a venda no estoque (lançar ou tirar). Não fala com a SEFAZ: funciona com o servidor desligado. */
  @Post('cupons/:id/lancar-venda')
  @HttpCode(200)
  lancarVenda(@Param('id', ParseUuidPipe) id: string) {
    return this.emissao.lancarVenda(id);
  }

  @Get('perfis')
  perfis() {
    return this.cadastro.perfis();
  }

  @Post('perfis')
  criarPerfil(@CurrentUser() eu: AuthUser, @Body() dto: PerfilFiscalDto) {
    return this.cadastro.criarPerfil(dto, autor(eu));
  }

  @Patch('perfis/:id')
  atualizarPerfil(@CurrentUser() eu: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: AtualizarPerfilDto) {
    return this.cadastro.atualizarPerfil(id, dto, autor(eu));
  }

  /** `prontos=true` só os prontos para o cupom (busca da aba Emitir); `false` só os que faltam dados; sem o filtro, todos. */
  @Get('produtos')
  produtos(@Query('prontos') prontos?: string) {
    if (prontos !== undefined && prontos !== 'true' && prontos !== 'false') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Filtro inválido.' });
    }
    return this.cadastro.produtos(prontos === undefined ? undefined : prontos === 'true');
  }

  /** "Aplicar perfil…" em 1 a 500 produtos, numa transação. Antes de `produtos/:itemCardapioId`. */
  @Put('produtos/perfil')
  perfilEmLote(@CurrentUser() eu: AuthUser, @Body() dto: PerfilEmLoteDto) {
    return this.cadastro.perfilEmLote(dto, autor(eu));
  }

  @Put('produtos/:itemCardapioId')
  salvarProduto(@CurrentUser() eu: AuthUser, @Param('itemCardapioId', ParseUuidPipe) id: string, @Body() dto: SalvarProdutoDto) {
    return this.cadastro.salvarProduto(id, dto, autor(eu));
  }
}
