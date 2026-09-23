import { CrmEnvelope, CrmEventName, carriesProduct, isSupportedEvent } from './envelope';

export type AdapterResult =
  | { kind: 'event'; event: CrmEnvelope }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; reason: string };

const KEYCLOAK_TYPES: Record<string, CrmEventName> = {
  REGISTER: 'account.registered',
  UPDATE_PROFILE: 'account.profile_updated',
  UPDATE_EMAIL: 'account.email_updated',
  LOGIN: 'account.logged_in',
};

/** Webhook Keycloak : `{ id, time (ms), type, userId, details }`. */
export function adaptKeycloak(body: unknown): AdapterResult {
  if (!isRecord(body)) return invalid('corps JSON attendu');

  if (typeof body.type !== 'string') return invalid('type manquant');
  const eventName = KEYCLOAK_TYPES[body.type];
  if (!eventName) return { kind: 'ignored', reason: `type Keycloak non suivi : ${body.type}` };

  const id = nonEmptyString(body.id);
  if (!id) return invalid('id manquant');

  const userId = nonEmptyString(body.userId);
  if (!userId) return invalid('userId manquant');

  const occurredAt = toDate(body.time);
  if (!occurredAt) return invalid('time invalide');

  return {
    kind: 'event',
    event: {
      eventId: `keycloak:${id}`,
      eventName,
      occurredAt,
      userId,
      source: 'keycloak',
      data: isRecord(body.details) ? body.details : {},
    },
  };
}

/**
 * Message RabbitMQ, enveloppe Izichange (`02_Contrat_Evenement`) :
 * `{ event_id, event_name, occurred_at, user_id, product_code, payload, … }`.
 *
 * Les champs de l'enveloppe qu'izipush n'exploite pas — `schema_version`, `published_at`, `tenant_id`,
 * `source`, `marketing_priority`, `dedup_key`, `correlation_id` — sont acceptés sans être lus.
 *
 * `test_flag` fait exception : un événement de recette est acquitté et **jamais** appliqué à un profil.
 * L'ingérer polluerait des profils de production avec des données fictives, et rien ensuite ne permettrait
 * de les distinguer.
 */
export function adaptRabbit(body: unknown): AdapterResult {
  if (!isRecord(body)) return invalid('message JSON attendu');

  if (body.test_flag === true) return { kind: 'ignored', reason: 'événement de test (test_flag)' };

  const eventName = nonEmptyString(body.event_name);
  if (!eventName) return invalid('event_name manquant');
  if (!isSupportedEvent(eventName)) return { kind: 'ignored', reason: `événement non suivi : ${eventName}` };

  const eventId = nonEmptyString(body.event_id);
  if (!eventId) return invalid('event_id manquant');

  const occurredAt = toDate(body.occurred_at);
  if (!occurredAt) return invalid('occurred_at invalide');

  const userId = nonEmptyString(body.user_id);
  if (!userId) return invalid('user_id manquant');

  const productCode = nonEmptyString(body.product_code);
  if (carriesProduct(eventName) && !productCode) return invalid(`product_code manquant pour ${eventName}`);

  return {
    kind: 'event',
    event: {
      eventId: `rabbitmq:${eventId}`,
      eventName,
      occurredAt,
      userId,
      source: 'rabbitmq',
      productCode,
      data: isRecord(body.payload) ? body.payload : {},
    },
  };
}

function invalid(reason: string): AdapterResult {
  return { kind: 'invalid', reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed || undefined;
}

/** Accepte un horodatage en millisecondes ou une date ISO 8601. */
function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}
