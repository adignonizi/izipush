import { CRM_EVENT_NAMES, type CrmEventName, type CrmEventSource } from '@novu/dal';

export { CRM_EVENT_NAMES, type CrmEventName };

const SUPPORTED = new Set<string>(CRM_EVENT_NAMES);

/** Tout événement hors de CRM_EVENT_NAMES est acquitté et ignoré (compatibilité avec de futurs événements). */
export function isSupportedEvent(eventName: string): eventName is CrmEventName {
  return SUPPORTED.has(eventName);
}

export function isTransactionEvent(eventName: string): boolean {
  return eventName === 'transaction.completed' || eventName === 'transaction.failed';
}

/** Enveloppe interne unique, quelle que soit la source. */
export type CrmEnvelope = {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  userId: string;
  source: CrmEventSource;
  data: Record<string, unknown>;
};
