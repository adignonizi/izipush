import { Injectable } from '@nestjs/common';
import { CrmEventRepository } from '@novu/dal';

import { DeriveQueue } from '../derive/derive.queue';
import { IngestCounters } from '../health/ingest-counters.service';
import { CrmEnvelope, carriesProduct, isSupportedEvent, isTransactionEvent } from './envelope';
import { TenantResolver } from './tenant.resolver';
import { activityDay, activityProductId, validateEventData } from './validation';

export type IngestOutcome = 'accepted' | 'duplicate' | 'ignored';

@Injectable()
export class IngestService {
  constructor(
    private events: CrmEventRepository,
    private deriveQueue: DeriveQueue,
    private counters: IngestCounters,
    private tenants: TenantResolver
  ) {}

  /**
   * Valide, dédoublonne et journalise l'événement, puis demande le recalcul du client.
   * Lève CrmValidationError si les données sont inexploitables ; toute autre erreur est transitoire.
   */
  async ingest(envelope: CrmEnvelope): Promise<IngestOutcome> {
    if (!isSupportedEvent(envelope.eventName)) {
      this.counters.add('ignored', envelope.eventName);

      return 'ignored';
    }

    // Résolu AVANT toute écriture : un application_id inconnu lève, et l'événement
    // part en file d'erreurs plutôt que d'être rangé au mauvais endroit.
    const tenant = await this.tenants.resolve(envelope.applicationId);

    // Données invalides : CrmValidationError, compté comme rejet par la source (file d'erreurs RabbitMQ).
    const data = validateEventData(envelope.eventName, envelope.data);
    // Le produit vient de l'enveloppe, pas du payload : une seule place où le chercher, quelle que soit la source.
    const productId = carriesProduct(envelope.eventName) ? activityProductId(envelope.productCode) : undefined;
    const activityKeys = isTransactionEvent(envelope.eventName)
      ? { day: activityDay(envelope.occurredAt), productId }
      : productId
        ? { productId }
        : {};

    const inserted = await this.events.insertIfNew({
      _environmentId: tenant.environmentId,
      _organizationId: tenant.organizationId,
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
    await this.deriveQueue.enqueue(envelope.userId, tenant);

    const outcome = inserted ? 'accepted' : 'duplicate';
    this.counters.add(outcome, envelope.eventName);

    return outcome;
  }
}
