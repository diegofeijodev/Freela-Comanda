import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './common/config/env.validation';
import { PrismaModule } from './common/database/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthModule } from './common/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CadastrosModule } from './modules/cadastros/cadastros.module';
import { CaixaModule } from './modules/caixa/caixa.module';
import { CardapioModule } from './modules/cardapio/cardapio.module';
import { ComprasModule } from './modules/compras/compras.module';
import { ContasModule } from './modules/contas/contas.module';
import { EstoqueModule } from './modules/estoque/estoque.module';
import { ImportacoesModule } from './modules/importacoes/importacoes.module';
import { InventariosModule } from './modules/inventarios/inventarios.module';
import { LeituraPdfModule } from './modules/leitura-pdf/leitura-pdf.module';
import { NotasModule } from './modules/notas/notas.module';
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
    NotasModule,
    ContasModule,
    CaixaModule,
    ImportacoesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Depois do Throttler: barra abuso antes de gastar CPU verificando token. Rotas fechadas por padrão.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
