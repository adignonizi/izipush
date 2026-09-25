import { Injectable, Logger } from '@nestjs/common';
import { buildSubscriberKey, InvalidateCacheService } from '@novu/application-generic';
import {
  buildUnsubscribeUrl,
  CrmActivityDailyRepository,
  CrmEventEntity,
  CrmEventRepository,
  CrmProductRepository,
  CrmProfileStateRepository,
  SubscriberEntity,
  SubscriberRepository,
} from '@novu/dal';

import { CrmTenant, currentTenant, runInTenant } from '../pipeline/tenant';
import { OnEventCampaigns } from '../campaigns/on-event-campaigns.service';
import { computeProfileUpdate, computeTransactionFacts, zeroActivityDefaults } from './profile-rules';

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_JOB = 50;
const DUPLICATE_KEY = 11000;

/**
 * Recalcule un client à partir de ses événements en attente : profil, activité du jour, cumuls.
 * Toujours appelé pour un seul client à la fois (job BullMQ unique par client) et rejouable sans effet de bord.
 */
@Injectable()
export class DeriveService {
  private readonly logger = new Logger(DeriveService.name);

  constructor(
    private events: CrmEventRepository,
    private activity: CrmActivityDailyRepository,
    private products: CrmProductRepository,
    private profileState: CrmProfileStateRepository,
    private subscribers: SubscriberRepository,
    private invalidateCache: InvalidateCacheService,
    private onEvent: OnEventCampaigns
  ) {}

  /**
   * Recalcule le profil d'un client à partir de ses événements en attente.
   *
   * Le locataire est posé pour toute la durée du traitement : les dix-sept
   * lectures d'environnement qui suivent, y compris dans les méthodes privées
   * et les campagnes déclenchées, le liront depuis ce contexte. Sans lui,
   * elles retomberaient sur la configuration et rangeraient le résultat dans
   * le mauvais environnement.
   */
  async process(subscriberId: string, tenant: CrmTenant = currentTenant()): Promise<void> {
    await runInTenant(tenant, async () => {
      for (let batch = 0; batch < MAX_BATCHES_PER_JOB; batch++) {
        const pending = await this.events.findPending(this.environmentId, subscriberId, BATCH_SIZE);
        if (!pending.length) return;

        await this.applyBatch(subscriberId, pending);
      }
    });
  }

  private async applyBatch(subscriberId: string, pending: CrmEventEntity[]): Promise<void> {
    const subscriber = await this.ensureSubscriber(subscriberId);
    const fieldsAt = await this.profileState.getFieldsAt(this.environmentId, subscriberId);
    const profile = computeProfileUpdate(pending, fieldsAt);
    const set: Record<string, unknown> = { ...profile.set };

    const unsubscribeUrl = this.unsubscribeUrlFor(subscriber);
    if (unsubscribeUrl) set['data.unsubscribe_url'] = unsubscribeUrl;

    const activityKeys = uniqueActivityKeys(pending);
    // Une activation de produit n'a pas de ligne d'activité mais doit quand même être reportée au profil.
    const hasProductEvent = activityKeys.length > 0 || pending.some((event) => event.eventName === 'product.activated');
    for (const { day, productId } of activityKeys) {
      const journal = await this.events.sumActivity(this.environmentId, subscriberId, day, productId);
      await this.activity.setFromJournal(
        this.environmentId,
        this.organizationId,
        subscriberId,
        day,
        productId,
        journal
      );
    }

    // Avant toute activité : les compteurs existent, à zéro, pour que « = 0 » puisse les trouver.
    Object.assign(set, zeroActivityDefaults(subscriber.data ?? {}));

    if (hasProductEvent) {
      // Un produit encore absent du catalogue y entre avec son identifiant pour libellé : la transaction
      // n'est jamais perdue, et la page Produits signale qu'il reste à nommer.
      await this.products.ensureProducts(
        this.environmentId,
        this.organizationId,
        pending.map((event) => event.productId).filter((productId): productId is string => !!productId)
      );

      const lifetime = await this.activity.sumLifetime(this.environmentId, subscriberId);
      Object.assign(set, computeTransactionFacts(pending, subscriber.data ?? {}, lifetime));
    }

    if (profile.clearPushCredentials) set.channels = [];

    if (Object.keys(set).length) await this.writeSubscriber(subscriber, set);

    // Avant de marquer les événements traités : un échec relance le recalcul, sans double envoi (transactionId).
    await this.onEvent.handle(subscriberId, pending);

    await this.profileState.setFieldsAt(this.environmentId, this.organizationId, subscriberId, profile.fieldsAt);
    await this.events.markDerived(
      this.environmentId,
      pending.map((event) => event._id)
    );

    this.logger.debug(`Client ${subscriberId} : ${pending.length} événement(s) pris en compte`);
  }

  private async writeSubscriber(subscriber: SubscriberEntity, set: Record<string, unknown>): Promise<void> {
    // Écrire « data.x » sur un subscriber sans objet data échouerait : on crée l'objet d'un bloc.
    const update = subscriber.data ? set : withDataObject(set);

    await this.subscribers.update({ _environmentId: this.environmentId, _id: subscriber._id }, { $set: update });
    await this.invalidateCache.invalidateByKey({
      key: buildSubscriberKey({ subscriberId: subscriber.subscriberId, _environmentId: this.environmentId }),
    });
  }

  /** Une transaction peut arriver avant l'inscription : on crée un profil minimal, complété ensuite. */
  private async ensureSubscriber(subscriberId: string): Promise<SubscriberEntity> {
    const existing = await this.subscribers.findBySubscriberId(this.environmentId, subscriberId);
    if (existing) return existing;

    try {
      await this.subscribers.create({
        _environmentId: this.environmentId,
        _organizationId: this.organizationId,
        subscriberId,
        data: {},
      });
    } catch (error) {
      // Créé entre-temps par un autre chemin (SDK, API Novu) : on reprend celui-là.
      if ((error as { code?: number })?.code !== DUPLICATE_KEY) throw error;
    }

    await this.invalidateCache.invalidateByKey({
      key: buildSubscriberKey({ subscriberId, _environmentId: this.environmentId }),
    });

    return this.subscribers.findBySubscriberId(this.environmentId, subscriberId);
  }

  /** Lien de désinscription marketing, posé une fois sur le profil (variable {{subscriber.data.unsubscribe_url}}). */
  private unsubscribeUrlFor(subscriber: SubscriberEntity): string | undefined {
    const secret = process.env.CRM_UNSUBSCRIBE_SECRET;
    if (!secret) return undefined;

    const url = buildUnsubscribeUrl(process.env.CRM_PUBLIC_API_URL, secret, {
      environmentId: this.environmentId,
      subscriberId: subscriber.subscriberId,
    });

    return subscriber.data?.unsubscribe_url === url ? undefined : url;
  }

  private get environmentId(): string {
    return currentTenant().environmentId;
  }

  private get organizationId(): string {
    return currentTenant().organizationId;
  }
}

function uniqueActivityKeys(events: CrmEventEntity[]): { day: string; productId: string }[] {
  const keys = new Map<string, { day: string; productId: string }>();

  for (const event of events) {
    if (event.day && event.productId)
      keys.set(`${event.day}|${event.productId}`, { day: event.day, productId: event.productId });
  }

  return [...keys.values()];
}

function withDataObject(set: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(set)) {
    if (path.startsWith('data.')) data[path.slice('data.'.length)] = value;
    else result[path] = value;
  }

  if (Object.keys(data).length) result.data = data;

  return result;
}
