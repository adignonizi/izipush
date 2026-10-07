import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmProviderUsageCounter, CrmProviderUsageDBModel, CrmProviderUsageEntity } from './crm-provider-usage.entity';
import { CrmProviderUsage } from './crm-provider-usage.schema';

export function crmUsageDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export class CrmProviderUsageRepository extends BaseRepositoryV2<
  CrmProviderUsageDBModel,
  CrmProviderUsageEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmProviderUsage, CrmProviderUsageEntity);
  }

  async increment(
    environmentId: string,
    integrationId: string,
    counter: CrmProviderUsageCounter,
    providerId?: string,
    by = 1
  ): Promise<void> {
    await this.MongooseModel.updateOne(
      { _environmentId: environmentId, day: crmUsageDay(), _integrationId: integrationId },
      { $inc: { [counter]: by }, ...(providerId ? { $set: { providerId } } : {}) },
      { upsert: true }
    );
  }

  async listSince(environmentId: string, fromDay: string): Promise<CrmProviderUsageEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId, day: { $gte: fromDay } })
      .sort({ day: 1 })
      .lean();

    return docs.map(
      (doc) => ({ ...doc, _id: String(doc._id), _environmentId: String(doc._environmentId) }) as CrmProviderUsageEntity
    );
  }
}
