import { CrmEnvelope, CrmEventName, isSupportedEvent } from './envelope';

export type AdapterResult =
  | { kind: 'event'; event: CrmEnvelope }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; reason: string };

const KEYCLOAK_TYPES: Record<string, CrmEventName> = {
  REGISTER: 'account.registered',
  UPDATE_PROFILE: 'account.profile_updated',
  UPDATE_EMAIL: 'account.email_updated',
  DELETE_ACCOUNT: 'account.deleted',
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

/** Message RabbitMQ : `{ eventType, eventId, timestamp (ISO), data: { userId, … } }`. */
export function adaptRabbit(body: unknown): AdapterResult {
  if (!isRecord(body)) return invalid('message JSON attendu');

  if (typeof body.eventType !== 'string') return invalid('eventType manquant');
  if (!isSupportedEvent(body.eventType)) return { kind: 'ignored', reason: `événement non suivi : ${body.eventType}` };

  const eventId = nonEmptyString(body.eventId);
  if (!eventId) return invalid('eventId manquant');

  const occurredAt = toDate(body.timestamp);
  if (!occurredAt) return invalid('timestamp invalide');

  const data = isRecord(body.data) ? body.data : {};
  const userId = nonEmptyString(data.userId);
  if (!userId) return invalid('data.userId manquant');

  return {
    kind: 'event',
    event: { eventId: `rabbitmq:${eventId}`, eventName: body.eventType, occurredAt, userId, source: 'rabbitmq', data },
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
