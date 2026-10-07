import './instrument';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getErrorInterceptor, Logger } from '@novu/application-generic';

import { AppModule } from './app.module';
import { validateEnv } from './config';

export async function bootstrap(): Promise<INestApplication> {
  validateEnv();

  // rawBody : la signature HMAC du webhook Keycloak se vérifie sur le corps brut.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.useGlobalInterceptors(getErrorInterceptor());
  app.enableShutdownHooks();

  await app.listen(process.env.PORT);

  return app;
}
