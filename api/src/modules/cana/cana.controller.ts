import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Staff } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { isDateString } from '../../common/time/dates';
import { CanaService, exigirModuloCana } from './cana.service';
import { AnularCanaDto, CorrigirCanaDto, LancamentoCanaDto, ParametrosCanaDto, ProdutoCanaDto } from './dto/cana.dto';
import { TIPOS_CANA, type TipoCana } from './regras';

/**
 * Controle da cana (docs/api-contract.md §22). A loja (colaborador com a tela `cana`) só lança e vê os PRÓPRIOS lançamentos, sem conta
 * nenhuma (contagem cega); configuração, lista completa, anular/corrigir e a apuração são só do admin (sem `@Modulos`: a tela `cana`
 * é de visão da loja e nunca abre rota de admin). Rotas estáticas antes das com :id.
 */
@ApiTags('Cana')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1/cana')
export class CanaController {
  constructor(private readonly svc: CanaService) {}

  @Get('parametros')
  parametros() {
    return this.svc.parametros();
  }

  @Put('parametros')
  salvarParametros(@CurrentUser() u: AuthUser, @Body() dto: ParametrosCanaDto) {
    return this.svc.salvarParametros(u, dto);
  }

  @Get('produtos')
  produtos() {
    return this.svc.produtos();
  }

  @Put('produtos/:itemCardapioId')
  salvarProduto(@CurrentUser() u: AuthUser, @Param('itemCardapioId', ParseUuidPipe) id: string, @Body() dto: ProdutoCanaDto) {
    return this.svc.salvarProduto(u, id, dto);
  }

  @Staff()
  @Get('lancamentos/recentes')
  recentes(@CurrentUser() u: AuthUser) {
    exigirModuloCana(u);
    return this.svc.recentes(u);
  }

  @Get('lancamentos')
  listar(@Query('ini') ini?: string, @Query('fim') fim?: string, @Query('tipo') tipo?: string) {
    if (!isDateString(ini) || !isDateString(fim) || fim < ini)
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Informe o período (ini e fim, AAAA-MM-DD)' });
    if ((Date.parse(fim) - Date.parse(ini)) / 864e5 > 400) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Período de no máximo 400 dias' });
    if (tipo !== undefined && !(TIPOS_CANA as readonly string[]).includes(tipo))
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Tipo de lançamento inválido' });
    return this.svc.listar(ini, fim, tipo as TipoCana | undefined);
  }

  /** 201 com o lançamento; a mesma chave de repetição (mesmo usuário e números) = 200 com o da 1ª vez (`repetido: true`). A loja recebe o recorte. */
  @Staff()
  @Post('lancamentos')
  async lancar(@CurrentUser() u: AuthUser, @Body() dto: LancamentoCanaDto, @Res({ passthrough: true }) res: FastifyReply) {
    exigirModuloCana(u);
    const { lancamento, repetido } = await this.svc.lancar(u, dto);
    if (repetido) res.status(200);
    // A loja recebe o mesmo recorte de `recentes` (contagem cega); o admin, a linha inteira.
    return { ...(u.perfil === 'admin' ? lancamento : await this.svc.recorteDaLoja(lancamento)), repetido };
  }

  @HttpCode(200)
  @Post('lancamentos/:id/anular')
  anular(@CurrentUser() u: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: AnularCanaDto) {
    return this.svc.anular(u, id, dto.motivo);
  }

  @Post('lancamentos/:id/corrigir')
  corrigir(@CurrentUser() u: AuthUser, @Param('id', ParseUuidPipe) id: string, @Body() dto: CorrigirCanaDto) {
    return this.svc.corrigir(u, id, dto);
  }

  @Get('semanas')
  semanas() {
    return this.svc.semanas();
  }

  @Get('semanas/atual')
  semanaAtual() {
    return this.svc.semanaAtual();
  }

  @Get('semanas/:contagemFinalId')
  semana(@Param('contagemFinalId', ParseUuidPipe) id: string) {
    return this.svc.semana(id);
  }
}
