import { Types } from 'mongoose';

import { Subscriber } from '../subscriber/subscriber.schema';
import { CrmActivityDaily } from './crm-activity-daily.schema';
import { compileActivityPipeline, compileAudience } from './crm-audience.compiler';
import type { CrmActivityCondition, CrmAudienceMember, CrmConditionGroup } from './crm-audience.types';

/** Jamais ciblés, quelles que soient les conditions (supprimés côté Izichange). */
const ALWAYS_EXCLUDED = { 'data.isDeleted': { $ne: true } };

export type CrmAudienceOptions = {
  now?: Date;
  batchSize?: number;
  /** Filtre supplémentaire sur les subscribers (ex. un seul client pour une campagne « sur événement »). */
  extraFilter?: Record<string, unknown>;
  /** Un seul client : restreint aussi l'agrégation d'activité (pas de lecture de toute la fenêtre). */
  subscriberId?: string;
};

type SubscriberRow = { _id: unknown; subscriberId: string };

/**
 * izipush-crm — résout l'audience d'un segment. Les membres sont lus en flux et rendus par lots :
 * jamais chargés en mémoire d'un bloc, même pour 1 M de clients.
 */
export class CrmAudienceRepository {
  async count(environmentId: string, audience: CrmConditionGroup, options: CrmAudienceOptions = {}): Promise<number> {
    const now = options.now ?? new Date();
    const compiled = compileAudience(audience, now);

    if (!compiled.activityConditions.length && !compiled.exclusionConditions.length) {
      return Subscriber.countDocuments(this.subscriberFilter(environmentId, compiled.profileFilter, options));
    }

    let total = 0;
    for await (const batch of this.iterate(environmentId, audience, { ...options, now })) total += batch.length;

    return total;
  }

  async *iterate(
    environmentId: string,
    audience: CrmConditionGroup,
    options: CrmAudienceOptions = {}
  ): AsyncGenerator<CrmAudienceMember[]> {
    const now = options.now ?? new Date();
    const batchSize = options.batchSize ?? 1000;
    const compiled = compileAudience(audience, now);
    const filter = this.subscriberFilter(environmentId, compiled.profileFilter, options);

    if (compiled.exclusionConditions.length) {
      yield* this.iterateExcluding(environmentId, compiled.exclusionConditions, filter, now, batchSize, options);

      return;
    }

    if (!compiled.activityConditions.length) {
      const cursor = Subscriber.find(filter, { _id: 1, subscriberId: 1 }).lean<SubscriberRow[]>().cursor({ batchSize });

      for await (const rows of batchesOf<SubscriberRow>(cursor, batchSize)) yield rows.map(toMember);

      return;
    }

    const pipeline = compileActivityPipeline(new Types.ObjectId(environmentId), compiled.activityConditions, now);
    restrictToOne(pipeline, options.subscriberId);
    const activeIds = CrmActivityDaily.aggregate<{ _id: string }>(pipeline as never[])
      .allowDiskUse(true)
      .cursor({ batchSize });

    for await (const ids of batchesOf<{ _id: string }>(activeIds, batchSize)) {
      const rows = await Subscriber.find(
        { ...filter, subscriberId: { $in: ids.map((row) => row._id) } },
        { _id: 1, subscriberId: 1 }
      ).lean<SubscriberRow[]>();

      if (rows.length) yield rows.map(toMember);
    }
  }

  /**
   * Inactifs et seuils bas (« = 0 », « ≤ 5 ») : les clients du profil, triés par identifiant, moins ceux dont
   * l'activité ne remplit pas la condition, triés de la même façon. Fusion au fil de l'eau : mémoire constante.
   * Les identifiants clients sont ASCII : l'ordre binaire de Mongo et celui des chaînes JavaScript coïncident.
   */
  private async *iterateExcluding(
    environmentId: string,
    conditions: CrmActivityCondition[],
    filter: Record<string, unknown>,
    now: Date,
    batchSize: number,
    options: CrmAudienceOptions
  ): AsyncGenerator<CrmAudienceMember[]> {
    const pipeline = compileActivityPipeline(new Types.ObjectId(environmentId), conditions, now, 'exclude');
    restrictToOne(pipeline, options.subscriberId);

    const excluded = CrmActivityDaily.aggregate<{ _id: string }>(pipeline as never[])
      .allowDiskUse(true)
      .cursor({ batchSize });
    const excludedIds = excluded[Symbol.asyncIterator]();
    const subscribers = Subscriber.find(filter, { _id: 1, subscriberId: 1 })
      .sort({ subscriberId: 1 })
      .lean<SubscriberRow[]>()
      .cursor({ batchSize });

    let next = await excludedIds.next();
    let batch: CrmAudienceMember[] = [];

    try {
      for await (const row of subscribers as AsyncIterable<SubscriberRow>) {
        while (!next.done && next.value._id < row.subscriberId) next = await excludedIds.next();
        if (!next.done && next.value._id === row.subscriberId) continue;

        batch.push(toMember(row));
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }

      if (batch.length) yield batch;
    } finally {
      await excluded.close().catch(() => undefined);
    }
  }

  private subscriberFilter(
    environmentId: string,
    profileFilter: Record<string, unknown>,
    options: CrmAudienceOptions
  ): Record<string, unknown> {
    const onlyOne = options.subscriberId ? { subscriberId: options.subscriberId } : {};
    const parts = [profileFilter, ALWAYS_EXCLUDED, options.extraFilter ?? {}, onlyOne].filter(
      (part) => Object.keys(part).length
    );

    return { _environmentId: environmentId, $and: parts };
  }
}

function restrictToOne(pipeline: Record<string, unknown>[], subscriberId?: string): void {
  if (subscriberId) (pipeline[0] as { $match: Record<string, unknown> }).$match.subscriberId = subscriberId;
}

async function* batchesOf<T>(source: AsyncIterable<unknown>, size: number): AsyncGenerator<T[]> {
  let batch: T[] = [];

  for await (const item of source) {
    batch.push(item as T);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length) yield batch;
}

function toMember(row: SubscriberRow): CrmAudienceMember {
  return { _id: String(row._id), subscriberId: row.subscriberId };
}
