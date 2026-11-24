import { Module } from '@nestjs/common';
import { ImportacoesVendasService } from './importacoes-vendas.service';
import { ImportacoesController } from './importacoes.controller';
import { ImportacoesService } from './importacoes.service';

@Module({ controllers: [ImportacoesController], providers: [ImportacoesService, ImportacoesVendasService] })
export class ImportacoesModule {}
