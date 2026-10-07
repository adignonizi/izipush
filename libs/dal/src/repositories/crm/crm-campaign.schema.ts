import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmCampaignDBModel } from './crm-campaign.entity';
import { registerCrmModel } from './crm-indexes';

const crmCampaignSchema = new Schema<CrmCampaignDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: Schema.Types.String, required: true },
    description: Schema.Types.String,
    workflowKey: { type: Schema.Types.String, required: true },
    segmentId: { type: Schema.Types.String, required: true },
    productId: Schema.Types.String,
    excludeProductUsers: { type: Schema.Types.Boolean, default: false },
    payload: { type: Schema.Types.Mixed, default: {} },
    schedule: {
      mode: { type: Schema.Types.String, required: true },
      at: Schema.Types.Date,
      cron: Schema.Types.String,
      timezone: Schema.Types.String,
      eventName: Schema.Types.String,
    },
    status: { type: Schema.Types.String, required: true },
    nextRunAt: { type: Schema.Types.Date, default: null },
    lastRunAt: Schema.Types.Date,
    runCount: { type: Schema.Types.Number, default: 0 },
    error: Schema.Types.String,
    _createdBy: Schema.Types.String,
  },
  { ...schemaOptions, collection: 'crm_campaigns', minimize: false }
);

crmCampaignSchema.index({ _environmentId: 1, name: 1 }, { name: 'crm_campaigns_unique_name', unique: true });
crmCampaignSchema.index({ _environmentId: 1, createdAt: -1 }, { name: 'crm_campaigns_list' });
crmCampaignSchema.index(
  { _environmentId: 1, productId: 1 },
  { name: 'crm_campaigns_product', partialFilterExpression: { productId: { $exists: true } } }
);
crmCampaignSchema.index({ status: 1, nextRunAt: 1 }, { name: 'crm_campaigns_due' });
crmCampaignSchema.index(
  { _environmentId: 1, status: 1, 'schedule.mode': 1, 'schedule.eventName': 1 },
  { name: 'crm_campaigns_on_event' }
);
crmCampaignSchema.index({ _environmentId: 1, segmentId: 1 }, { name: 'crm_campaigns_segment' });

export const CrmCampaign = registerCrmModel(
  (mongoose.models.CrmCampaign as mongoose.Model<CrmCampaignDBModel>) ||
    mongoose.model<CrmCampaignDBModel>('CrmCampaign', crmCampaignSchema)
);
