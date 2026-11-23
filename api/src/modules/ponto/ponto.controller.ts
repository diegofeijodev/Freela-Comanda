import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminOnly, Staff } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { isDateString, monthRange } from '../../common/time/dates';
import { isUuid } from '../../common/ids/uuid';
import {
  AnularMarcacaoDto,
  AtualizarColaboradorDto,
  CorrigirMarcacaoDto,
  EscalaDto,
  IdentificarDto,
  JustificarDto,
  JustificativaAdminDto,
  MarcacaoManualDto,
  MarcarDto,
  NovaFolgaDto,
  NovoColaboradorDto,
  NovoTerminalDto,
  ResponderJustificativaDto,
} from './dto/ponto.dto';
import { EspelhoService } from './espelho.service';
import { PontoService } from './ponto.service';
import { TERMINAL_HEADER, TerminalService } from './terminal.service';

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?mes=AAAA-MM` ou `?ini=&fim=` (até 62 dias). */
function periodo(mes?: string, ini?: string, fim?: string): { ini: string; fim: string } {
  if (mes) {
    if (!MES_RE.test(mes)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'mes deve ser AAAA-MM' });
    const r = monthRange(mes);
    return { ini: r.from, fim: r.to };
  }
  if (!isDateString(ini) || !isDateString(fim) || fim < ini)
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Informe o mês (AAAA-MM) ou o período (ini e fim)' });
  if ((Date.parse(fim) - Date.parse(ini)) / 864e5 > 62) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Período de no máximo 62 dias' });
  return { ini, fim };
}

@ApiTags('Ponto')
@ApiBearerAuth()
@Controller('v1/ponto')
export class PontoController {
  constructor(
    private readonly svc: PontoService,
    private readonly espelho: EspelhoService,
    private readonly terminal: TerminalService,
  ) {}

  // ---------- terminal (computador da loja: login da loja + token do terminal + PIN do colaborador)
  @Staff()
  @Get('terminal')
  inicio(@Headers(TERMINAL_HEADER) token?: string) {
    return this.terminal.inicio(token);
  }

  @Staff()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('terminal/identificar')
  identificar(@Headers(TERMINAL_HEADER) token: string | undefined, @Body() dto: IdentificarDto) {
    return this.terminal.identificar(token, dto);
  }

  @Staff()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('terminal/marcar')
  marcar(@Headers(TERMINAL_HEADER) token: string | undefined, @Body() dto: MarcarDto) {
    return this.terminal.marcar(token, dto);
  }

  @Staff()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('terminal/justificar')
  justificar(@Headers(TERMINAL_HEADER) token: string | undefined, @Body() dto: JustificarDto) {
    return this.terminal.justificar(token, dto);
  }

  // ---------- espelho / cálculo
  @AdminOnly()
  @Get('espelho')
  espelhoGeral(@Query('mes') mes?: string, @Query('ini') ini?: string, @Query('fim') fim?: string) {
    const p = periodo(mes, ini, fim);
    return this.espelho.geral(p.ini, p.fim);
  }

  @AdminOnly()
  @Get('espelho/:colaboradorId')
  espelhoColaborador(
    @Param('colaboradorId', ParseUuidPipe) id: string,
    @Query('mes') mes?: string,
    @Query('ini') ini?: string,
    @Query('fim') fim?: string,
  ) {
    const p = periodo(mes, ini, fim);
    return this.espelho.espelho(id, p.ini, p.fim);
  }

  // ---------- colaboradores
  @AdminOnly()
  @Get('colaboradores')
  listarColaboradores() {
    return this.svc.listarColaboradores();
  }

  @AdminOnly()
  @Post('colaboradores')
  criarColaborador(@Body() dto: NovoColaboradorDto) {
    return this.svc.criarColaborador(dto);
  }

  @AdminOnly()
  @Patch('colaboradores/:id')
  atualizarColaborador(@Param('id', ParseUuidPipe) id: string, @Body() dto: AtualizarColaboradorDto) {
    return this.svc.atualizarColaborador(id, dto);
  }

  @AdminOnly()
  @Delete('colaboradores/:id')
  excluirColaborador(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirColaborador(id);
  }

  // ---------- escalas
  @AdminOnly()
  @Get('escalas')
  listarEscalas() {
    return this.svc.listarEscalas();
  }

  @AdminOnly()
  @Post('escalas')
  criarEscala(@Body() dto: EscalaDto) {
    return this.svc.criarEscala(dto);
  }

  @AdminOnly()
  @Put('escalas/:id')
  atualizarEscala(@Param('id', ParseUuidPipe) id: string, @Body() dto: EscalaDto) {
    return this.svc.atualizarEscala(id, dto);
  }

  @AdminOnly()
  @Delete('escalas/:id')
  excluirEscala(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirEscala(id);
  }

  // ---------- folgas e feriados
  @AdminOnly()
  @Get('folgas')
  listarFolgas(@Query('mes') mes?: string, @Query('ini') ini?: string, @Query('fim') fim?: string) {
    const p = periodo(mes, ini, fim);
    return this.svc.listarFolgas(p.ini, p.fim);
  }

  @AdminOnly()
  @Post('folgas')
  criarFolga(@Body() dto: NovaFolgaDto) {
    return this.svc.criarFolga(dto);
  }

  @AdminOnly()
  @Delete('folgas/:id')
  excluirFolga(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirFolga(id);
  }

  // ---------- marcações (ajustes e correções)
  @AdminOnly()
  @Get('marcacoes')
  listarMarcacoes(
    @Query('colaborador_id') colaboradorId: string,
    @Query('mes') mes?: string,
    @Query('ini') ini?: string,
    @Query('fim') fim?: string,
  ) {
    if (!isUuid(colaboradorId)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Escolha o colaborador' });
    const p = periodo(mes, ini, fim);
    return this.svc.listarMarcacoes(colaboradorId, p.ini, p.fim);
  }

  @AdminOnly()
  @Post('marcacoes')
  marcacaoManual(@Body() dto: MarcacaoManualDto, @CurrentUser() user: AuthUser) {
    return this.svc.marcacaoManual(dto, user.id);
  }

  @AdminOnly()
  @HttpCode(200)
  @Post('marcacoes/:id/corrigir')
  corrigirMarcacao(@Param('id', ParseUuidPipe) id: string, @Body() dto: CorrigirMarcacaoDto, @CurrentUser() user: AuthUser) {
    return this.svc.corrigirMarcacao(id, dto, user.id);
  }

  @AdminOnly()
  @HttpCode(200)
  @Post('marcacoes/:id/anular')
  anularMarcacao(@Param('id', ParseUuidPipe) id: string, @Body() dto: AnularMarcacaoDto, @CurrentUser() user: AuthUser) {
    return this.svc.anularMarcacao(id, dto, user.id);
  }

  // ---------- justificativas
  @AdminOnly()
  @Get('justificativas')
  listarJustificativas(@Query('status') status?: string) {
    if (status && !['pendente', 'aceita', 'recusada'].includes(status))
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'status deve ser pendente, aceita ou recusada' });
    return this.svc.listarJustificativas(status);
  }

  @AdminOnly()
  @Post('justificativas')
  justificarPeloAdmin(@Body() dto: JustificativaAdminDto, @CurrentUser() user: AuthUser) {
    return this.svc.justificarPeloAdmin(dto, user.id);
  }

  @AdminOnly()
  @HttpCode(200)
  @Post('justificativas/:id/responder')
  responderJustificativa(@Param('id', ParseUuidPipe) id: string, @Body() dto: ResponderJustificativaDto, @CurrentUser() user: AuthUser) {
    return this.svc.responderJustificativa(id, dto, user.id);
  }

  // ---------- terminais
  @AdminOnly()
  @Get('terminais')
  listarTerminais() {
    return this.svc.listarTerminais();
  }

  @AdminOnly()
  @Post('terminais')
  criarTerminal(@Body() dto: NovoTerminalDto, @CurrentUser() user: AuthUser) {
    return this.svc.criarTerminal(dto, user.id);
  }

  @AdminOnly()
  @Delete('terminais/:id')
  revogarTerminal(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.revogarTerminal(id);
  }
}
