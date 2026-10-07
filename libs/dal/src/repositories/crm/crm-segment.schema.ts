import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import { registerCrmModel } from './crm-indexes';
import type { CrmSegmentDBModel } from './crm-segment.entity';

const crmSegmentSchema = new Schema<CrmSegmentDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: Schema.Types.String, required: true },
    description: Schema.Types.String,
    audience: { type: Schema.Types.Mixed, required: true },
    frozen: { type: Schema.Types.Boolean, default: false },
    status: { type: Schema.Types.String, required: true },
    memberCount: Schema.Types.Number,
    frozenAt: Schema.Types.Date,
    topicKey: Schema.Types.String,
    error: Schema.Types.String,
    lockedUntil: { type: Schema.Types.Date, default: null },
    _createdBy: Schema.Types.String,
  },
  { ...schemaOptions, collection: 'crm_segments', minimize: false }
);

crmSegmentSchema.index({ _environmentId: 1, name: 1 }, { name: 'crm_segments_unique_name', unique: true });
crmSegmentSchema.index({ _environmentId: 1, createdAt: -1 }, { name: 'crm_segments_list' });
crmSegmentSchema.index({ status: 1, lockedUntil: 1 }, { name: 'crm_segments_work' });

export const CrmSegment = registerCrmModel(
  (mongoose.models.CrmSegment as mongoose.Model<CrmSegmentDBModel>) ||
    mongoose.model<CrmSegmentDBModel>('CrmSegment', crmSegmentSchema)
);
