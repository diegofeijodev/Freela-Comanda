import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { CupomCadastroService } from './cadastro.service';
import { CupomFiscalController } from './cupom-fiscal.controller';

/**
 * Cupom fiscal (NFC-e modelo 65). Tudo nasce desligado: sem `NFCE_AMBIENTE` (e o "Emitir cupons" de cada ambiente) nenhum cupom sai; o
 * cadastro (empresa, numeração, CSC, perfis e produtos) funciona antes, porque os dados do contador chegam antes da subida.
 * O certificado entra pela porta `CERTIFICADO_DIGITAL` (só para conferir se há um em uso, do mesmo CNPJ).
 */
@Module({
  imports: [CertificadoDigitalModule],
  controllers: [CupomFiscalController],
  providers: [CupomCadastroService],
})
export class CupomFiscalModule {}
