import { Module } from '@nestjs/common';
import { createNestLoggingModuleOptions, LoggerModule, TracingModule } from '@novu/application-generic';
import { SentryModule } from '@sentry/nestjs/setup';

import packageJson from '../package.json';
import { IngestModule } from './ingest.module';

const modules = [
  IngestModule,
  TracingModule.register(packageJson.name, packageJson.version),
  LoggerModule.forRoot(
    createNestLoggingModuleOptions({
      serviceName: packageJson.name,
      version: packageJson.version,
    })
  ),
];

if (process.env.SENTRY_DSN) {
  modules.unshift(SentryModule.forRoot());
}

@Module({
  imports: modules,
})
export class AppModule {}
