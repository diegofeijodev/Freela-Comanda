import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { NotasModule } from '../notas/notas.module';
import { SefazModule } from '../sefaz/sefaz.module';
import { AgendadorSefaz } from './agendador';
import { CicloSefazService } from './ciclo.service';

/** Notas da SEFAZ (etapa 1, só leitura). Sem `SEFAZ_DFE_AMBIENTE` o agendador não cria timer e nenhuma conexão sai. */
@Module({
  imports: [CertificadoDigitalModule, SefazModule, NotasModule],
  providers: [CicloSefazService, AgendadorSefaz],
})
export class NotasSefazModule {}
