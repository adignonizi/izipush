import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import { registerCrmModel } from './crm-indexes';
import type { CrmProfileStateDBModel } from './crm-profile-state.entity';

const crmProfileStateSchema = new Schema<CrmProfileStateDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    subscriberId: { type: Schema.Types.String, required: true },
    fieldsAt: { type: Schema.Types.Mixed, default: {} },
  },
  { ...schemaOptions, collection: 'crm_profile_state', minimize: false }
);

crmProfileStateSchema.index(
  { _environmentId: 1, subscriberId: 1 },
  { name: 'crm_profile_state_unique_subscriber', unique: true }
);

export const CrmProfileState = registerCrmModel(
  (mongoose.models.CrmProfileState as mongoose.Model<CrmProfileStateDBModel>) ||
    mongoose.model<CrmProfileStateDBModel>('CrmProfileState', crmProfileStateSchema)
);
