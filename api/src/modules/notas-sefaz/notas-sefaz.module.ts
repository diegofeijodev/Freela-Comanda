import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { NotasModule } from '../notas/notas.module';
import { SefazModule } from '../sefaz/sefaz.module';
import { AgendadorSefaz } from './agendador';
import { CaixaSefazService } from './caixa.service';
import { CicloSefazService } from './ciclo.service';
import { NotasSefazController } from './notas-sefaz.controller';
import { RespostasSefazService } from './respostas.service';

/**
 * Notas da SEFAZ (etapa 1, só leitura) e respostas à SEFAZ (etapa 2). Sem `SEFAZ_DFE_AMBIENTE` o agendador não cria timer e nenhuma
 * conexão sai; sem `SEFAZ_MANIFESTACAO=ligada` (e o "Ligar as respostas" na tela) nenhum evento sai.
 */
@Module({
  imports: [CertificadoDigitalModule, SefazModule, NotasModule],
  controllers: [NotasSefazController],
  providers: [CicloSefazService, CaixaSefazService, RespostasSefazService, AgendadorSefaz],
})
export class NotasSefazModule {}
