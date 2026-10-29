import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeLeitorPdf } from './claude-leitor-pdf';
import { LEITOR_PDF } from './leitor-pdf.port';
import { LeituraPdfController } from './leitura-pdf.controller';
import { LeituraPdfService } from './leitura-pdf.service';

@Module({
  controllers: [LeituraPdfController],
  providers: [
    LeituraPdfService,
    {
      provide: LEITOR_PDF,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ClaudeLeitorPdf(config.get<string>('ANTHROPIC_API_KEY') ?? '', config.get<string>('AI_PDF_MODEL') ?? 'claude-opus-5-5'),
    },
  ],
})
export class LeituraPdfModule {}
