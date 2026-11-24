import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './common/config/env.validation';
import { EmpresaInterceptor } from './common/database/empresa.interceptor';
import { PrismaModule } from './common/database/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CadastrosModule } from './modules/cadastros/cadastros.module';
import { CaixaModule } from './modules/caixa/caixa.module';
import { CardapioModule } from './modules/cardapio/cardapio.module';
import { ComprasModule } from './modules/compras/compras.module';
import { ContasModule } from './modules/contas/contas.module';
import { CupomFiscalModule } from './modules/cupom-fiscal/cupom-fiscal.module';
import { EmpresasModule } from './modules/empresas/empresas.module';
import { EstoqueModule } from './modules/estoque/estoque.module';
import { CanaModule } from './modules/cana/cana.module';
import { ImportacoesModule } from './modules/importacoes/importacoes.module';
import { InventariosModule } from './modules/inventarios/inventarios.module';
import { LeituraPdfModule } from './modules/leitura-pdf/leitura-pdf.module';
import { CertificadoDigitalModule } from './modules/certificado-digital/certificado-digital.module';
import { NotasModule } from './modules/notas/notas.module';
import { NotasSefazModule } from './modules/notas-sefaz/notas-sefaz.module';
import { PontoModule } from './modules/ponto/ponto.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { VendasModule } from './modules/vendas/vendas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsuariosModule,
    CadastrosModule,
    EstoqueModule,
    CardapioModule,
    VendasModule,
    InventariosModule,
    ComprasModule,
    LeituraPdfModule,
    CertificadoDigitalModule,
    NotasModule,
    NotasSefazModule,
    CupomFiscalModule,
    ContasModule,
    CaixaModule,
    ImportacoesModule,
    PontoModule,
    CanaModule,
    EmpresasModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Depois do Throttler: barra abuso antes de gastar CPU verificando token. Rotas fechadas por padrão.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Multiempresa: o handler roda no schema da empresa que o guard escolheu.
    { provide: APP_INTERCEPTOR, useClass: EmpresaInterceptor },
  ],
})
export class AppModule {}
