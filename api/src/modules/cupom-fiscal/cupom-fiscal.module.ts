import { Module } from '@nestjs/common';
import { CertificadoDigitalModule } from '../certificado-digital/certificado-digital.module';
import { SefazModule } from '../sefaz/sefaz.module';
import { CupomCadastroService } from './cadastro.service';
import { CupomCancelamentoService } from './cancelamento.service';
import { CupomFiscalController } from './cupom-fiscal.controller';
import { CupomEmissaoService } from './emissao.service';

/**
 * Cupom fiscal (NFC-e modelo 65). Tudo nasce desligado: sem `NFCE_AMBIENTE` (e o "Emitir cupons" de cada ambiente) nenhum cupom sai; o
 * cadastro (empresa, numeração, CSC, perfis e produtos) funciona antes, porque os dados do contador chegam antes da subida.
 * O certificado entra pela porta `CERTIFICADO_DIGITAL`; a SEFAZ, pela porta `SEFAZ_NFCE` (`SefazModule`), só na emissão.
 */
@Module({
  imports: [CertificadoDigitalModule, SefazModule],
  controllers: [CupomFiscalController],
  providers: [CupomCadastroService, CupomEmissaoService, CupomCancelamentoService],
})
export class CupomFiscalModule {}
