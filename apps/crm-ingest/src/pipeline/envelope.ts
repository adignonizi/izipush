import { CRM_EVENT_NAMES, type CrmEventName, type CrmEventSource } from '@novu/dal';

export { CRM_EVENT_NAMES, type CrmEventName };

const SUPPORTED = new Set<string>(CRM_EVENT_NAMES);

/** Tout événement hors de CRM_EVENT_NAMES est acquitté et ignoré (compatibilité avec de futurs événements). */
export function isSupportedEvent(eventName: string): eventName is CrmEventName {
  return SUPPORTED.has(eventName);
}

export function isTransactionEvent(eventName: string): boolean {
  return eventName === 'transaction.completed';
}

/** Les événements qui portent un produit : le code vient de l'enveloppe, jamais du payload. */
export function carriesProduct(eventName: string): boolean {
  return isTransactionEvent(eventName) || eventName === 'product.activated';
}

/** Enveloppe interne unique, quelle que soit la source. */
export type CrmEnvelope = {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  userId: string;
  source: CrmEventSource;
  /** Code produit de l'enveloppe Izichange, pour les événements qui en portent un. */
  productCode?: string;
  /**
   * Identifiant public de l'environnement Novu visé (Settings > API Keys).
   * Absent : l'événement est rangé dans l'environnement configuré.
   */
  applicationId?: string;
  data: Record<string, unknown>;
};
