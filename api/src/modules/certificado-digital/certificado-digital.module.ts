import { Module } from '@nestjs/common';
import { CADEIA_ICP, carregarCadeiaIcp } from './cadeia';
import { CertificadoDigitalController } from './certificado-digital.controller';
import { CertificadoDigitalService } from './certificado-digital.service';

@Module({
  controllers: [CertificadoDigitalController],
  providers: [CertificadoDigitalService, { provide: CADEIA_ICP, useFactory: carregarCadeiaIcp }],
})
export class CertificadoDigitalModule {}
