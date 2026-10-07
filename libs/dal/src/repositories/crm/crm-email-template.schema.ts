import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmEmailTemplateDBModel } from './crm-email-template.entity';
import { registerCrmModel } from './crm-indexes';

const crmEmailTemplateSchema = new Schema<CrmEmailTemplateDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: Schema.Types.String, required: true },
    description: Schema.Types.String,
    subject: Schema.Types.String,
    design: Schema.Types.Mixed,
    html: Schema.Types.String,
    version: { type: Schema.Types.Number, default: 1 },
    _updatedBy: Schema.Types.String,
  },
  { ...schemaOptions, collection: 'crm_email_templates', minimize: false }
);

crmEmailTemplateSchema.index({ _environmentId: 1, name: 1 }, { name: 'crm_email_templates_unique_name', unique: true });

export const CrmEmailTemplate = registerCrmModel(
  (mongoose.models.CrmEmailTemplate as mongoose.Model<CrmEmailTemplateDBModel>) ||
    mongoose.model<CrmEmailTemplateDBModel>('CrmEmailTemplate', crmEmailTemplateSchema)
);
