import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmActivityDailyDBModel } from './crm-activity-daily.entity';
import { registerCrmModel } from './crm-indexes';

const totalsSchema = {
  tx: { type: Schema.Types.Number, default: 0 },
  volUsd: { type: Schema.Types.Number, default: 0 },
  txFailed: { type: Schema.Types.Number, default: 0 },
};

const crmActivityDailySchema = new Schema<CrmActivityDailyDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    subscriberId: { type: Schema.Types.String, required: true },
    day: { type: Schema.Types.String, required: true },
    productId: { type: Schema.Types.String, required: true },
    ...totalsSchema,
    base: totalsSchema,
    journal: { ...totalsSchema, eventCount: { type: Schema.Types.Number, default: 0 } },
  },
  { ...schemaOptions, collection: 'crm_activity_daily' }
);

crmActivityDailySchema.index(
  { _environmentId: 1, subscriberId: 1, day: 1, productId: 1 },
  { name: 'crm_activity_unique_day', unique: true }
);
crmActivityDailySchema.index({ _environmentId: 1, day: 1 }, { name: 'crm_activity_window' });

export const CrmActivityDaily = registerCrmModel(
  (mongoose.models.CrmActivityDaily as mongoose.Model<CrmActivityDailyDBModel>) ||
    mongoose.model<CrmActivityDailyDBModel>('CrmActivityDaily', crmActivityDailySchema)
);
