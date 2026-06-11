import 'reflect-metadata';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet());
  app.set('trust proxy', 1); // hinter Traefik (X-Forwarded-For)
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: process.env.APP_BASE_URL ?? true, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Forecast-Portal BU Brachytherapie — API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API läuft auf http://localhost:${port}/api (Swagger: /api/docs)`);
}

void bootstrap();
