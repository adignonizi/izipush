import { Types } from 'mongoose';

import { Subscriber } from '../subscriber/subscriber.schema';
import { CrmActivityDaily } from './crm-activity-daily.schema';
import { compileActivityPipeline, compileAudience } from './crm-audience.compiler';
import type { CrmAudienceMember, CrmConditionGroup } from './crm-audience.types';

/** Jamais ciblés, quelles que soient les conditions (supprimés côté Izichange). */
const ALWAYS_EXCLUDED = { 'data.isDeleted': { $ne: true } };

export type CrmAudienceOptions = {
  now?: Date;
  batchSize?: number;
  /** Filtre supplémentaire sur les subscribers (ex. un seul client pour une campagne « sur événement »). */
  extraFilter?: Record<string, unknown>;
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

    if (!compiled.activityConditions.length) {
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

    if (!compiled.activityConditions.length) {
      const cursor = Subscriber.find(filter, { _id: 1, subscriberId: 1 }).lean<SubscriberRow[]>().cursor({ batchSize });

      for await (const rows of batchesOf<SubscriberRow>(cursor, batchSize)) yield rows.map(toMember);

      return;
    }

    const pipeline = compileActivityPipeline(new Types.ObjectId(environmentId), compiled.activityConditions, now);
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

  private subscriberFilter(
    environmentId: string,
    profileFilter: Record<string, unknown>,
    options: CrmAudienceOptions
  ): Record<string, unknown> {
    const parts = [profileFilter, ALWAYS_EXCLUDED, options.extraFilter ?? {}].filter(
      (part) => Object.keys(part).length
    );

    return { _environmentId: environmentId, $and: parts };
  }
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
