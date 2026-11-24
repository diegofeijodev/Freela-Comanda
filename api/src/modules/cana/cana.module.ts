import { Module } from '@nestjs/common';
import { CanaController } from './cana.controller';
import { CanaService } from './cana.service';

@Module({ controllers: [CanaController], providers: [CanaService] })
export class CanaModule {}
