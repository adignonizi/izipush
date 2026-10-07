import './config/env.config';

// Tracing subpath, not the barrel: keeps pino/mongoose/ioredis out of require.cache
// until the OTEL instrumentations are installed (same as apps/webhook).
import { startOtel } from '@novu/application-generic/build/main/tracing/otel-init';
import { name, version } from '../package.json';

startOtel(name, version);

// biome-ignore lint: lazy require so @sentry/nestjs loads after OTEL instrumentations are installed
const { init } = require('@sentry/nestjs');

if (process.env.SENTRY_DSN) {
  init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: `v${version}`,
    ignoreErrors: ['Non-Error exception captured'],
  });
}
