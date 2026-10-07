// Imported via the deep path (not the package barrel) so hydrating secrets into
// process.env does not evaluate @novu/application-generic before OTEL instrumentation
// is installed in ./bootstrap (same as apps/webhook).
import { runWithHydratedSecrets } from '@novu/application-generic/build/main/services/secrets-manager';

void runWithHydratedSecrets(async () => {
  const { bootstrap } = await import('./bootstrap');
  await bootstrap();
});
