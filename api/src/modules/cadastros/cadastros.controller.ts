import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminOnly, Staff } from '../../common/decorators/permissao.decorator';
import { ParseUuidPipe } from '../../common/ids/parse-uuid.pipe';
import { CadastrosService } from './cadastros.service';
import {
  CentroCustoDto,
  ConfiguracoesDto,
  DreMetaDto,
  DreSubgrupoDto,
  FornecedorDto,
  PlanoContaDto,
  PlanoContasLoteDto,
  SazonalidadeDto,
  SubgrupoDto,
} from './dto/cadastros.dto';

@ApiTags('Cadastros')
@ApiBearerAuth()
@AdminOnly()
@Controller('v1')
export class CadastrosController {
  constructor(private readonly svc: CadastrosService) {}

  // A loja lê as configurações (política "staff read config" do protótipo: o inventário precisa de loja_pode_abrir/dia).
  @Staff()
  @Get('configuracoes')
  config() {
    return this.svc.config();
  }

  @Patch('configuracoes')
  salvarConfig(@Body() dto: ConfiguracoesDto) {
    return this.svc.salvarConfig(dto);
  }

  @Get('sazonalidade')
  sazonalidade() {
    return this.svc.sazonalidade();
  }

  @Patch('sazonalidade/:mes')
  salvarSazonalidade(@Param('mes', ParseIntPipe) mes: number, @Body() dto: SazonalidadeDto) {
    return this.svc.salvarSazonalidade(mes, dto.fator_pct);
  }

  @Staff()
  @Get('subgrupos')
  subgrupos() {
    return this.svc.subgrupos();
  }

  @Post('subgrupos')
  criarSubgrupo(@Body() dto: SubgrupoDto) {
    return this.svc.criarSubgrupo(dto);
  }

  @Delete('subgrupos/:id')
  excluirSubgrupo(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirSubgrupo(id);
  }

  @Get('fornecedores')
  fornecedores() {
    return this.svc.fornecedores();
  }

  @Post('fornecedores')
  criarFornecedor(@Body() dto: FornecedorDto) {
    return this.svc.criarFornecedor(dto);
  }

  @Delete('fornecedores/:id')
  excluirFornecedor(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirFornecedor(id);
  }

  @Get('plano-contas')
  planoContas(@Query('ativo') ativo?: string) {
    return this.svc.planoContas(ativo === 'true');
  }

  @Post('plano-contas')
  criarPlanoConta(@Body() dto: PlanoContaDto) {
    return this.svc.criarPlanoConta(dto);
  }

  @Post('plano-contas/lote')
  importarPlanoContas(@Body() dto: PlanoContasLoteDto) {
    return this.svc.importarPlanoContas(dto.linhas);
  }

  @Delete('plano-contas/:id')
  excluirPlanoConta(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirPlanoConta(id);
  }

  @Get('centros-custo')
  centrosCusto(@Query('ativo') ativo?: string) {
    return this.svc.centrosCusto(ativo === 'true');
  }

  @Post('centros-custo')
  criarCentroCusto(@Body() dto: CentroCustoDto) {
    return this.svc.criarCentroCusto(dto);
  }

  @Delete('centros-custo/:id')
  excluirCentroCusto(@Param('id', ParseUuidPipe) id: string) {
    return this.svc.excluirCentroCusto(id);
  }

  @Get('dre-subgrupos')
  dreSubgrupos() {
    return this.svc.dreSubgrupos();
  }

  @Post('dre-subgrupos')
  criarDreSubgrupo(@Body() dto: DreSubgrupoDto) {
    return this.svc.criarDreSubgrupo(dto);
  }

  @Patch('dre-subgrupos/:id')
  salvarDreMeta(@Param('id', ParseUuidPipe) id: string, @Body() dto: DreMetaDto) {
    return this.svc.salvarDreMeta(id, dto.meta_pct ?? null);
  }
}
