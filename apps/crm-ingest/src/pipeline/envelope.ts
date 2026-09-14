import type { CrmEventSource } from '@novu/dal';

/** Événements pris en compte. Tout autre nom est acquitté et ignoré (compatibilité avec de futurs événements). */
export const CRM_EVENT_NAMES = [
  'account.registered',
  'account.profile_updated',
  'account.email_updated',
  'account.deleted',
  'account.logged_in',
  'kyc.submitted',
  'kyc.approved',
  'kyc.rejected',
  'transaction.completed',
  'transaction.failed',
] as const;

export type CrmEventName = (typeof CRM_EVENT_NAMES)[number];

const SUPPORTED = new Set<string>(CRM_EVENT_NAMES);

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
