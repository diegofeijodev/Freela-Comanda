import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { SefazDfeAdapter } from './distribuicao.adapter';
import { SEFAZ_DFE } from './distribuicao.port';
import { CHAMAR_SOAP12, chamarSoap12 } from './transporte-soap12';

@Module({
  imports: [CertificadoDigitalModule],
  providers: [
    { provide: CHAMAR_SOAP12, useValue: (c: Parameters<typeof chamarSoap12>[0]) => chamarSoap12(c) },
    SefazDfeAdapter,
    { provide: SEFAZ_DFE, useExisting: SefazDfeAdapter },
  ],
  exports: [SEFAZ_DFE],
})
export class SefazModule {}
