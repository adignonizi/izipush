import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmProfileStateDBModel, CrmProfileStateEntity } from './crm-profile-state.entity';
import { CrmProfileState } from './crm-profile-state.schema';

export class CrmProfileStateRepository extends BaseRepositoryV2<
  CrmProfileStateDBModel,
  CrmProfileStateEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmProfileState, CrmProfileStateEntity);
  }

  async getFieldsAt(environmentId: string, subscriberId: string): Promise<Record<string, Date>> {
    const doc = await this.MongooseModel.findOne(
      { _environmentId: environmentId, subscriberId },
      { fieldsAt: 1 }
    ).lean();

    const stored = (doc?.fieldsAt as Record<string, Date>) ?? {};

    return Object.fromEntries(Object.entries(stored).map(([key, at]) => [decodeFieldKey(key), at]));
  }

  async setFieldsAt(
    environmentId: string,
    organizationId: string,
    subscriberId: string,
    fieldsAt: Record<string, Date>
  ): Promise<void> {
    const entries = Object.entries(fieldsAt);
    if (!entries.length) return;

    // Les chemins de champs contiennent des points (« data.kyc_status ») : on les encode pour la clé Mongo.
    const set = Object.fromEntries(entries.map(([field, at]) => [`fieldsAt.${encodeFieldKey(field)}`, at]));

    await this.MongooseModel.updateOne(
      { _environmentId: environmentId, subscriberId },
      { $set: set, $setOnInsert: { _organizationId: organizationId } },
      { upsert: true }
    );
  }
}

/** « data.kyc_status » → « data:kyc_status » (un point créerait un sous-objet dans Mongo). */
export function encodeFieldKey(field: string): string {
  return field.replace(/\./g, ':');
}

export function decodeFieldKey(key: string): string {
  return key.replace(/:/g, '.');
}
