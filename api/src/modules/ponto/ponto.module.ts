import { Module } from '@nestjs/common';
import { EspelhoService } from './espelho.service';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';
import { TerminalService } from './terminal.service';

@Module({ controllers: [PontoController], providers: [PontoService, EspelhoService, TerminalService] })
export class PontoModule {}
