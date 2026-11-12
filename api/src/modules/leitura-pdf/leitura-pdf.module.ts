import { Module } from '@nestjs/common';
import { HTTP_IA, type HttpIa } from './ia/http-ia';
import { IaChaveController } from './ia/ia-chave.controller';
import { IaChaveService, LeitorPorIa } from './ia/ia-chave.service';
import { LEITOR_PDF } from './leitor-pdf.port';
import { LeituraPdfController } from './leitura-pdf.controller';
import { LeituraPdfService } from './leitura-pdf.service';

@Module({
  controllers: [LeituraPdfController, IaChaveController],
  providers: [
    LeituraPdfService,
    IaChaveService,
    { provide: HTTP_IA, useValue: ((url, init) => fetch(url, init)) satisfies HttpIa },
    // A chave é escolhida a cada leitura (a da tela de Configurações ou, sem ela, a ANTHROPIC_API_KEY do servidor).
    { provide: LEITOR_PDF, inject: [IaChaveService], useFactory: (chaves: IaChaveService) => new LeitorPorIa(chaves) },
  ],
})
export class LeituraPdfModule {}
