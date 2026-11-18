import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, type PipeTransform } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import type { AmbienteSefaz } from '../sefaz/distribuicao.port';
import { CupomCadastroService, type Autor } from './cadastro.service';
import {
  AtualizarPerfilDto,
  PerfilEmLoteDto,
  PerfilFiscalDto,
  SalvarAmbienteDto,
  SalvarEmitenteDto,
  SalvarProdutoDto,
} from './cupom-fiscal.dto';

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
 * produtos). Só admin: o cupom mostra preço de venda, que a loja nunca vê. Estas rotas não falam com a SEFAZ e funcionam com o servidor
 * desligado (`NFCE_AMBIENTE` vazia). Dinheiro no fio em centavos inteiros (`*_centavos`); o CSC só entra (a resposta traz `csc_dica`).
 * Rotas estáticas antes das com parâmetro (`produtos/perfil` antes de `produtos/:itemCardapioId`).
 */
@ApiTags('Cupom fiscal')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/cupom-fiscal')
export class CupomFiscalController {
  constructor(private readonly cadastro: CupomCadastroService) {}

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
