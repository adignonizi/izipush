import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmEmailProviderDBModel } from './crm-email-provider.entity';
import { registerCrmModel } from './crm-indexes';

const crmEmailProviderSchema = new Schema<CrmEmailProviderDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    _integrationId: { type: Schema.Types.String, required: true },
    routingEnabled: { type: Schema.Types.Boolean, default: false },
    order: { type: Schema.Types.Number, default: 0 },
    perMinute: Schema.Types.Number,
    perHour: Schema.Types.Number,
    perDay: Schema.Types.Number,
  },
  { ...schemaOptions, collection: 'crm_email_providers' }
);

crmEmailProviderSchema.index(
  { _environmentId: 1, _integrationId: 1 },
  { name: 'crm_email_providers_unique_integration', unique: true }
);

export const CrmEmailProvider = registerCrmModel(
  (mongoose.models.CrmEmailProvider as mongoose.Model<CrmEmailProviderDBModel>) ||
    mongoose.model<CrmEmailProviderDBModel>('CrmEmailProvider', crmEmailProviderSchema)
);
