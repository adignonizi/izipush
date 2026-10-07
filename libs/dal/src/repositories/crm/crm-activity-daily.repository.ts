import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmActivityDailyDBModel, CrmActivityDailyEntity } from './crm-activity-daily.entity';
import { CrmActivityDaily } from './crm-activity-daily.schema';
import type { CrmJournalActivity } from './crm-event.repository';

export type CrmLifetimeActivity = { tx: number; volUsd: number };

/** Cumul à vie d'un client sur un produit. */
export type CrmProductActivity = CrmLifetimeActivity & { productId: string; txFailed: number };

/** Cumul à vie tous produits confondus, et son détail produit par produit. */
export type CrmLifetimeBreakdown = CrmLifetimeActivity & { byProduct: CrmProductActivity[] };

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
    productId: string,
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
        productId,
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

  /**
   * Volume porté par chaque produit sur l'environnement, depuis `since` s'il est donné.
   * Alimente la liste et la fiche d'un produit ; lit l'index {_environmentId, day}.
   */
  async totalsByProduct(environmentId: string, since?: string): Promise<CrmProductActivity[]> {
    const match: Record<string, unknown> = { _environmentId: this.convertStringToObjectId(environmentId) };
    if (since) match.day = { $gte: since };

    return this.MongooseModel.aggregate<CrmProductActivity>([
      { $match: match },
      {
        $group: {
          _id: '$productId',
          tx: { $sum: '$tx' },
          volUsd: { $sum: '$volUsd' },
          txFailed: { $sum: '$txFailed' },
        },
      },
      { $project: { _id: 0, productId: '$_id', tx: 1, volUsd: 1, txFailed: 1 } },
      { $sort: { volUsd: -1 } },
    ]);
  }

  /**
   * Cumul à vie d'un client : total tous produits, et détail par produit. Une seule lecture alimente
   * `data.lifetime_*`, `data.products`, `data.product_count` et `data.product_state.*`.
   */
  async sumLifetime(environmentId: string, subscriberId: string): Promise<CrmLifetimeBreakdown> {
    const rows = await this.MongooseModel.aggregate<CrmProductActivity>([
      { $match: { _environmentId: this.convertStringToObjectId(environmentId), subscriberId } },
      {
        $group: {
          _id: '$productId',
          tx: { $sum: '$tx' },
          volUsd: { $sum: '$volUsd' },
          txFailed: { $sum: '$txFailed' },
        },
      },
      { $project: { _id: 0, productId: '$_id', tx: 1, volUsd: 1, txFailed: 1 } },
      { $sort: { productId: 1 } },
    ]);

    return {
      tx: rows.reduce((sum, row) => sum + row.tx, 0),
      volUsd: rows.reduce((sum, row) => sum + row.volUsd, 0),
      byProduct: rows,
    };
  }
}
