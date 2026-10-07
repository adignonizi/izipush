import mongoose, { Schema } from 'mongoose';
import { registerCrmModel } from './crm-indexes';
import type { CrmProviderUsageDBModel } from './crm-provider-usage.entity';

const counter = { type: Schema.Types.Number, default: 0 };

const crmProviderUsageSchema = new Schema<CrmProviderUsageDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _integrationId: { type: Schema.Types.String, required: true },
    providerId: Schema.Types.String,
    day: { type: Schema.Types.String, required: true },
    sent: counter,
    failed: counter,
    bounced: counter,
    complaints: counter,
    postponed: counter,
  },
  { collection: 'crm_provider_usage', versionKey: false }
);

crmProviderUsageSchema.index(
  { _environmentId: 1, day: 1, _integrationId: 1 },
  { name: 'crm_provider_usage_unique_day', unique: true }
);

export const CrmProviderUsage = registerCrmModel(
  (mongoose.models.CrmProviderUsage as mongoose.Model<CrmProviderUsageDBModel>) ||
    mongoose.model<CrmProviderUsageDBModel>('CrmProviderUsage', crmProviderUsageSchema)
);
