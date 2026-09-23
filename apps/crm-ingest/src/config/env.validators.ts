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
  AMQP_BINDINGS: str({ default: 'account.*,kyc.*,transaction.*,product.*' }),
  AMQP_PREFETCH: num({ default: 50 }),

  /** Redis des files BullMQ (recalcul des clients). */
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),
  REDIS_DB_INDEX: num({ default: 0 }),
  CRM_DERIVE_CONCURRENCY: num({ default: 20 }),

  /** API Novu et clé secrète de l'environnement : les campagnes déclenchent les workflows par l'API publique. */
  NOVU_API_URL: url({ default: 'http://localhost:3000' }),
  NOVU_SECRET_KEY: str({ default: '' }),
  /** Exécutions de campagne et figeages de segments menés en parallèle. */
  CRM_CAMPAIGN_CONCURRENCY: num({ default: 2 }),
  /** Fréquence du planificateur (échéances, figeages, reprises, purge). */
  CRM_TICK_MS: num({ default: 15_000 }),
  /** Durée de conservation de la liste d'une exécution après son déclenchement. */
  CRM_RUN_TOPIC_RETENTION_DAYS: num({ default: 30 }),

  /** Lien de désinscription posé sur chaque profil : URL publique de l'API et secret partagé avec elle. */
  CRM_PUBLIC_API_URL: url({ default: 'http://localhost:3000' }),
  CRM_UNSUBSCRIBE_SECRET: str({ default: '' }),

  /** Secret partagé avec Keycloak (signature HMAC-SHA256 du corps). Vide = pas de vérification. */
  KEYCLOAK_WEBHOOK_SECRET: str({ default: '' }),
  /** Jeton des routes d'administration (relecture de la file d'erreurs). Vide = routes désactivées. */
  CRM_ADMIN_TOKEN: str({ default: '' }),
} satisfies Record<string, ValidatorSpec<unknown>>;
