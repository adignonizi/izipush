import { Injectable } from '@nestjs/common';
import { CrmEventRepository } from '@novu/dal';

import { DeriveQueue } from '../derive/derive.queue';
import { CrmEnvelope, isSupportedEvent, isTransactionEvent } from './envelope';
import { activityDay, activityProduct, validateEventData } from './validation';

export type IngestOutcome = 'accepted' | 'duplicate' | 'ignored';

@Injectable()
export class IngestService {
  constructor(
    private events: CrmEventRepository,
    private deriveQueue: DeriveQueue
  ) {}

  /**
   * Valide, dédoublonne et journalise l'événement, puis demande le recalcul du client.
   * Lève CrmValidationError si les données sont inexploitables ; toute autre erreur est transitoire.
   */
  async ingest(envelope: CrmEnvelope): Promise<IngestOutcome> {
    if (!isSupportedEvent(envelope.eventName)) return 'ignored';

    const data = validateEventData(envelope.eventName, envelope.data);
    const activityKeys = isTransactionEvent(envelope.eventName)
      ? { day: activityDay(envelope.occurredAt), product: activityProduct(data) }
      : {};

    const inserted = await this.events.insertIfNew({
      _environmentId: process.env.CRM_ENVIRONMENT_ID,
      _organizationId: process.env.CRM_ORGANIZATION_ID,
      eventId: envelope.eventId,
      eventName: envelope.eventName,
      subscriberId: envelope.userId,
      occurredAt: envelope.occurredAt,
      receivedAt: new Date(),
      source: envelope.source,
      data,
      ...activityKeys,
    });

    // Même pour un doublon : si le premier passage a échoué avant la mise en file, l'événement attend encore.
    await this.deriveQueue.enqueue(envelope.userId);

    return inserted ? 'accepted' : 'duplicate';
  }
}
