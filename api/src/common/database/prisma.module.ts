import { Global, Module } from '@nestjs/common';
import { EmpresasBancoService } from './empresas-banco.service';
import { NucleoService, PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [NucleoService, PrismaService, EmpresasBancoService],
  exports: [NucleoService, PrismaService, EmpresasBancoService],
})
export class PrismaModule {}
