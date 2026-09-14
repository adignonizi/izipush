import { StringifyEnv } from '@novu/shared';
import { bool, CleanedEnv, cleanEnv, num, port, str, url, ValidatorSpec } from 'envalid';

export function validateEnv() {
  const cleaned = cleanEnv(process.env, envValidators);

  // envalid ne réécrit pas process.env : on y reporte les valeurs par défaut pour que tout le code les voie.
  for (const [key, value] of Object.entries(cleaned)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = String(value);
  }

  return cleaned;
}

export type ValidatedEnv = StringifyEnv<CleanedEnv<typeof envValidators>>;

export const envValidators = {
  NODE_ENV: str({ choices: ['dev', 'test', 'production', 'ci', 'local'], default: 'local' }),
  PORT: port(),
  TZ: str({ default: 'UTC' }),
  SENTRY_DSN: str({ default: undefined }),

  MONGO_URL: str(),
  MONGO_AUTO_CREATE_INDEXES: bool({ default: false }),
  MONGO_MAX_IDLE_TIME_IN_MS: num({ default: 1000 * 30 }),
  MONGO_MAX_POOL_SIZE: num({ default: 50 }),
  MONGO_MIN_POOL_SIZE: num({ default: 10 }),

  /** Environnement et organisation Novu dans lesquels les profils sont tenus à jour. */
  CRM_ENVIRONMENT_ID: str(),
  CRM_ORGANIZATION_ID: str(),

  /** RabbitMQ d'Izichange : on lie notre propre file à leur exchange existant. */
  AMQP_URL: url(),
  AMQP_EXCHANGE: str({ default: 'mailwizz-topic' }),
  AMQP_QUEUE: str({ default: 'izipush.crm-ingest' }),
  AMQP_BINDINGS: str({ default: 'account.*,kyc.*,transaction.*' }),
  AMQP_PREFETCH: num({ default: 50 }),

  /** Redis des files BullMQ (recalcul des clients). */
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),
  REDIS_DB_INDEX: num({ default: 0 }),
  CRM_DERIVE_CONCURRENCY: num({ default: 20 }),

  /** Secret partagé avec Keycloak (signature HMAC-SHA256 du corps). Vide = pas de vérification. */
  KEYCLOAK_WEBHOOK_SECRET: str({ default: '' }),
  /** Jeton des routes d'administration (relecture de la file d'erreurs). Vide = routes désactivées. */
  CRM_ADMIN_TOKEN: str({ default: '' }),
} satisfies Record<string, ValidatorSpec<unknown>>;
