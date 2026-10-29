import { Module } from '@nestjs/common';
import { VendasController } from './vendas.controller';

@Module({ controllers: [VendasController] })
export class VendasModule {}
