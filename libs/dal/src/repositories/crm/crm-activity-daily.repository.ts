import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmActivityDailyDBModel, CrmActivityDailyEntity } from './crm-activity-daily.entity';
import { CrmActivityDaily } from './crm-activity-daily.schema';
import type { CrmJournalActivity } from './crm-event.repository';

export type CrmLifetimeActivity = { tx: number; volUsd: number };

export class CrmActivityDailyRepository extends BaseRepositoryV2<
  CrmActivityDailyDBModel,
  CrmActivityDailyEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmActivityDaily, CrmActivityDailyEntity);
  }

  /**
   * Écrase la part « journal » d'une journée et recalcule les totaux (base + journal).
   * Rejouable : le résultat ne dépend que du journal, jamais de l'état précédent.
   */
  async setFromJournal(
    environmentId: string,
    organizationId: string,
    subscriberId: string,
    day: string,
    product: string,
    journal: CrmJournalActivity
  ): Promise<void> {
    const plus = (field: 'tx' | 'volUsd' | 'txFailed') => ({
      $add: [{ $ifNull: [`$base.${field}`, 0] }, journal[field]],
    });

    await this.MongooseModel.collection.updateOne(
      {
        _environmentId: this.convertStringToObjectId(environmentId),
        subscriberId,
        day,
        product,
      },
      [
        {
          $set: {
            _organizationId: this.convertStringToObjectId(organizationId),
            journal,
            tx: plus('tx'),
            volUsd: plus('volUsd'),
            txFailed: plus('txFailed'),
            createdAt: { $ifNull: ['$createdAt', '$$NOW'] },
            updatedAt: '$$NOW',
          },
        },
      ],
      { upsert: true }
    );
  }

  /** Cumul à vie d'un client, tous produits confondus. */
  async sumLifetime(environmentId: string, subscriberId: string): Promise<CrmLifetimeActivity> {
    const [result] = await this.MongooseModel.aggregate<CrmLifetimeActivity>([
      { $match: { _environmentId: this.convertStringToObjectId(environmentId), subscriberId } },
      { $group: { _id: null, tx: { $sum: '$tx' }, volUsd: { $sum: '$volUsd' } } },
      { $project: { _id: 0 } },
    ]);

    return result ?? { tx: 0, volUsd: 0 };
  }
}
