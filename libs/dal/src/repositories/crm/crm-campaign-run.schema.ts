import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmCampaignRunDBModel } from './crm-campaign-run.entity';
import { registerCrmModel } from './crm-indexes';

const crmCampaignRunSchema = new Schema<CrmCampaignRunDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    campaignId: { type: Schema.Types.String, required: true },
    scheduledFor: { type: Schema.Types.Date, required: true },
    status: { type: Schema.Types.String, required: true },
    audienceSize: Schema.Types.Number,
    excludedCount: Schema.Types.Number,
    topicKey: Schema.Types.String,
    transactionId: Schema.Types.String,
    error: Schema.Types.String,
    attempts: { type: Schema.Types.Number, default: 0 },
    lockedUntil: { type: Schema.Types.Date, default: null },
    startedAt: Schema.Types.Date,
    triggeredAt: Schema.Types.Date,
    topicPurgedAt: Schema.Types.Date,
  },
  { ...schemaOptions, collection: 'crm_campaign_runs' }
);

crmCampaignRunSchema.index({ campaignId: 1, scheduledFor: 1 }, { name: 'crm_runs_unique_schedule', unique: true });
crmCampaignRunSchema.index({ _environmentId: 1, campaignId: 1, scheduledFor: -1 }, { name: 'crm_runs_list' });
crmCampaignRunSchema.index({ status: 1, lockedUntil: 1 }, { name: 'crm_runs_work' });
crmCampaignRunSchema.index({ status: 1, triggeredAt: 1, topicPurgedAt: 1 }, { name: 'crm_runs_purge' });

export const CrmCampaignRun = registerCrmModel(
  (mongoose.models.CrmCampaignRun as mongoose.Model<CrmCampaignRunDBModel>) ||
    mongoose.model<CrmCampaignRunDBModel>('CrmCampaignRun', crmCampaignRunSchema)
);
