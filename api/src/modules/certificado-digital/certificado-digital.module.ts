import { Module } from '@nestjs/common';
import { CADEIA_ICP, carregarCadeiaIcp } from './cadeia';
import { CertificadoDigitalController } from './certificado-digital.controller';
import { CERTIFICADO_DIGITAL } from './certificado-digital.port';
import { CertificadoDigitalService } from './certificado-digital.service';

@Module({
  controllers: [CertificadoDigitalController],
  providers: [
    CertificadoDigitalService,
    { provide: CERTIFICADO_DIGITAL, useExisting: CertificadoDigitalService },
    { provide: CADEIA_ICP, useFactory: carregarCadeiaIcp },
  ],
  exports: [CERTIFICADO_DIGITAL, CADEIA_ICP],
})
export class CertificadoDigitalModule {}
