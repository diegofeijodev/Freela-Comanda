import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { validateEnv } from './common/config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { WireInterceptor } from './common/http/wire.interceptor';
import { flattenErrors } from './common/validation/flatten-errors';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // `trustProxy` é opção de construção do adaptador, que nasce antes do ConfigService: vale o mesmo schema do resto.
  const env = validateEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: { timestamp: () => `,"time":"${new Date().toISOString()}"` },
      // Importação de vendas chega no corpo já lida da planilha (um mês de PDV = milhares de linhas).
      bodyLimit: 16 * 1024 * 1024,
      trustProxy: env.TRUST_PROXY,
    }),
  );

  await app.register(helmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https:`, `'unsafe-inline'`],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // PDF da nota fiscal / do DDA para a leitura por IA: um arquivo, 10 MB (o próprio protótipo dizia "máx. 10 MB").
  await app.register(multipart as never, { limits: { fileSize: 10 * 1024 * 1024, files: 4 } });

  const config = app.get(ConfigService);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new WireInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({ code: 'VALIDATION_ERROR', message: flattenErrors(errors) }),
    }),
  );

  const allowedOrigins = config.get<string>('CORS_ORIGINS')?.split(',').filter(Boolean) ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const nodeEnv = config.get<string>('NODE_ENV');
  if (nodeEnv !== 'production' || config.get<string>('SWAGGER_ENABLED') === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Freela Comanda — API')
      .setDescription('Vendas, fichas técnicas, inventário, estoque, compras, notas, contas a pagar, caixa e DRE. Contrato em docs/api-contract.md.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    SwaggerModule.setup('docs', app as never, SwaggerModule.createDocument(app as never, swaggerConfig), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get<number>('PORT') ?? 3016;
  await app.listen(port, '0.0.0.0');
  logger.log(`🍢 Freela Comanda API: http://localhost:${port}`);
}

void bootstrap();
