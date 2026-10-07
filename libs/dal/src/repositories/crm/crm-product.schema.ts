import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import { registerCrmModel } from './crm-indexes';
import type { CrmProductDBModel } from './crm-product.entity';

const crmProductSchema = new Schema<CrmProductDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    productId: { type: Schema.Types.String, required: true },
    name: { type: Schema.Types.String, required: true },
    description: Schema.Types.String,
    active: { type: Schema.Types.Boolean, default: true },
    unnamed: { type: Schema.Types.Boolean, default: false },
    _createdBy: Schema.Types.String,
  },
  { ...schemaOptions, collection: 'crm_products', minimize: false }
);

crmProductSchema.index({ _environmentId: 1, productId: 1 }, { name: 'crm_products_unique_id', unique: true });
crmProductSchema.index({ _environmentId: 1, active: 1, name: 1 }, { name: 'crm_products_list' });

export const CrmProduct = registerCrmModel(
  (mongoose.models.CrmProduct as mongoose.Model<CrmProductDBModel>) ||
    mongoose.model<CrmProductDBModel>('CrmProduct', crmProductSchema)
);
