import mongoose, { Schema } from 'mongoose';

import { schemaOptions } from '../schema-default.options';
import type { CrmEventDBModel } from './crm-event.entity';
import { registerCrmModel } from './crm-indexes';

/** Durée de conservation du journal : au-delà, les journées d'activité sont définitives. */
export const CRM_EVENTS_TTL_SECONDS = 180 * 24 * 3600;

const crmEventSchema = new Schema<CrmEventDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, ref: 'Environment', required: true },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    eventId: { type: Schema.Types.String, required: true },
    eventName: { type: Schema.Types.String, required: true },
    subscriberId: { type: Schema.Types.String, required: true },
    occurredAt: { type: Schema.Types.Date, required: true },
    receivedAt: { type: Schema.Types.Date, required: true },
    source: { type: Schema.Types.String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    day: Schema.Types.String,
    productId: Schema.Types.String,
    derivedAt: { type: Schema.Types.Date, default: null },
  },
  { ...schemaOptions, collection: 'crm_events', minimize: false }
);

crmEventSchema.index({ _environmentId: 1, eventId: 1 }, { name: 'crm_events_unique_event', unique: true });
crmEventSchema.index({ _environmentId: 1, subscriberId: 1, derivedAt: 1 }, { name: 'crm_events_pending' });
crmEventSchema.index(
  { _environmentId: 1, subscriberId: 1, day: 1, productId: 1 },
  { name: 'crm_events_activity', partialFilterExpression: { day: { $exists: true } } }
);
crmEventSchema.index({ derivedAt: 1, receivedAt: 1 }, { name: 'crm_events_sweep' });
crmEventSchema.index({ receivedAt: 1 }, { name: 'crm_events_ttl', expireAfterSeconds: CRM_EVENTS_TTL_SECONDS });

export const CrmEvent = registerCrmModel(
  (mongoose.models.CrmEvent as mongoose.Model<CrmEventDBModel>) ||
    mongoose.model<CrmEventDBModel>('CrmEvent', crmEventSchema)
);
