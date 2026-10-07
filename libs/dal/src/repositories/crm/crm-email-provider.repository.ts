import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmEmailProviderDBModel, CrmEmailProviderEntity } from './crm-email-provider.entity';
import { CrmEmailProvider } from './crm-email-provider.schema';
import { toCrmEntity } from './crm-entity.utils';

export type CrmEmailProviderSettings = Pick<
  CrmEmailProviderEntity,
  'routingEnabled' | 'order' | 'perMinute' | 'perHour' | 'perDay'
>;

export class CrmEmailProviderRepository extends BaseRepositoryV2<
  CrmEmailProviderDBModel,
  CrmEmailProviderEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmEmailProvider, CrmEmailProviderEntity);
  }

  async listForEnvironment(environmentId: string): Promise<CrmEmailProviderEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId }).sort({ order: 1 }).lean();

    return docs.map((doc) => toCrmEntity<CrmEmailProviderEntity>(doc));
  }

  async saveSettings(
    environmentId: string,
    organizationId: string,
    integrationId: string,
    settings: CrmEmailProviderSettings
  ): Promise<CrmEmailProviderEntity> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      { _environmentId: environmentId, _integrationId: integrationId },
      { $set: settings, $setOnInsert: { _organizationId: organizationId } },
      { new: true, upsert: true }
    ).lean();

    return toCrmEntity<CrmEmailProviderEntity>(doc);
  }
}
