import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmEventDBModel, CrmEventEntity } from './crm-event.entity';
import { CrmEvent } from './crm-event.schema';

const DUPLICATE_KEY = 11000;

export const CRM_TRANSACTION_COMPLETED = 'transaction.completed';

export type CrmJournalActivity = { tx: number; volUsd: number; txFailed: number; eventCount: number };

export type CrmPendingSubscriber = { environmentId: string; organizationId: string; subscriberId: string };

export class CrmEventRepository extends BaseRepositoryV2<CrmEventDBModel, CrmEventEntity, EnforceEnvId> {
  constructor() {
    super(CrmEvent, CrmEventEntity);
  }

  /** Journalise l'événement ; renvoie false s'il a déjà été reçu (même eventId). */
  async insertIfNew(event: Omit<CrmEventEntity, '_id' | 'derivedAt' | 'createdAt' | 'updatedAt'>): Promise<boolean> {
    try {
      await this.MongooseModel.create({ ...event, derivedAt: null });

      return true;
    } catch (error) {
      if ((error as { code?: number })?.code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  /** Événements pas encore pris en compte pour ce client, dans l'ordre où ils se sont produits. */
  async findPending(environmentId: string, subscriberId: string, limit: number): Promise<CrmEventEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId, subscriberId, derivedAt: null })
      .sort({ occurredAt: 1, _id: 1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => ({
      ...doc,
      _id: String(doc._id),
      _environmentId: String(doc._environmentId),
      _organizationId: String(doc._organizationId),
    })) as unknown as CrmEventEntity[];
  }

  async markDerived(environmentId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;

    await this.MongooseModel.updateMany(
      { _environmentId: environmentId, _id: { $in: ids } },
      { $set: { derivedAt: new Date() } }
    );
  }

  /** Totaux du journal pour une journée et un produit d'un client. */
  async sumActivity(
    environmentId: string,
    subscriberId: string,
    day: string,
    productId: string
  ): Promise<CrmJournalActivity> {
    const [result] = await this.MongooseModel.aggregate<CrmJournalActivity>([
      {
        $match: {
          _environmentId: this.convertStringToObjectId(environmentId),
          subscriberId,
          day,
          productId,
        },
      },
      {
        $group: {
          _id: null,
          tx: { $sum: { $cond: [{ $eq: ['$eventName', CRM_TRANSACTION_COMPLETED] }, 1, 0] } },
          volUsd: {
            $sum: { $cond: [{ $eq: ['$eventName', CRM_TRANSACTION_COMPLETED] }, { $toDouble: '$data.amount_usd' }, 0] },
          },
          txFailed: { $sum: 0 },
          eventCount: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ]);

    return result ?? { tx: 0, volUsd: 0, txFailed: 0, eventCount: 0 };
  }

  /** Clients dont des événements attendent depuis plus longtemps que `olderThan` (filet de sécurité). */
  async findSubscribersWithPending(olderThan: Date, limit: number): Promise<CrmPendingSubscriber[]> {
    const rows = await this.MongooseModel.aggregate<{
      _id: { environmentId: unknown; organizationId: unknown; subscriberId: string };
    }>([
      { $match: { derivedAt: null, receivedAt: { $lt: olderThan } } },
      {
        $group: {
          _id: { environmentId: '$_environmentId', organizationId: '$_organizationId', subscriberId: '$subscriberId' },
        },
      },
      { $limit: limit },
    ]);

    return rows.map(({ _id }) => ({
      environmentId: String(_id.environmentId),
      organizationId: String(_id.organizationId),
      subscriberId: _id.subscriberId,
    }));
  }
}
