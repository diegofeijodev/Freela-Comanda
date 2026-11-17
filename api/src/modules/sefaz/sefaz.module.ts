import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { SefazDfeAdapter } from './distribuicao.adapter';
import { SEFAZ_DFE } from './distribuicao.port';
import { SefazEventosAdapter } from './eventos.adapter';
import { SEFAZ_EVENTOS } from './eventos.port';
import { SefazNfceAdapter } from './nfce.adapter';
import { SEFAZ_NFCE } from './nfce.port';
import { CHAMAR_SOAP12, chamarSoap12 } from './transporte-soap12';

@Module({
  imports: [CertificadoDigitalModule],
  providers: [
    { provide: CHAMAR_SOAP12, useValue: (c: Parameters<typeof chamarSoap12>[0]) => chamarSoap12(c) },
    SefazDfeAdapter,
    { provide: SEFAZ_DFE, useExisting: SefazDfeAdapter },
    SefazEventosAdapter,
    { provide: SEFAZ_EVENTOS, useExisting: SefazEventosAdapter },
    SefazNfceAdapter,
    { provide: SEFAZ_NFCE, useExisting: SefazNfceAdapter },
  ],
  exports: [SEFAZ_DFE, SEFAZ_EVENTOS, SEFAZ_NFCE],
})
export class SefazModule {}
