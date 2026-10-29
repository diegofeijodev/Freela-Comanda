import { Module } from '@nestjs/common';
import { CaixaController } from './caixa.controller';

@Module({ controllers: [CaixaController] })
export class CaixaModule {}
