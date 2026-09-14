import mongoose, { Schema, Types } from 'mongoose';

import { Message } from '../message/message.schema';
import { registerCrmModel } from './crm-indexes';

/**
 * izipush-crm — ouvertures et clics des messages de campagne, un document par message.
 * Email : événements du fournisseur (webhook). Push : appui sur la notification, signalé par le SDK mobile.
 */
export type CrmEngagementKind = 'opened' | 'clicked';

export type CrmEngagement = {
  _id: string;
  _environmentId: string;
  _messageId: string;
  _subscriberId: string;
  transactionId: string;
  channel: string;
  openedAt?: Date;
  clickedAt?: Date;
  createdAt: Date;
};

type EngagedMessage = {
  _id: unknown;
  _environmentId: unknown;
  _subscriberId: unknown;
  transactionId: string;
  channel: string;
};

/** Conservé 400 jours : les rapports couvrent au plus l'année écoulée. */
const ENGAGEMENT_TTL_SECONDS = 400 * 24 * 3600;

type CrmEngagementDBModel = Omit<CrmEngagement, '_id' | '_environmentId'> & { _environmentId: Types.ObjectId };

const engagementSchema = new Schema<CrmEngagementDBModel>(
  {
    _environmentId: { type: Schema.Types.ObjectId, required: true },
    _messageId: { type: String, required: true },
    _subscriberId: String,
    transactionId: String,
    channel: String,
    openedAt: Date,
    clickedAt: Date,
    createdAt: { type: Date, required: true },
  },
  { collection: 'crm_engagement', versionKey: false }
);
engagementSchema.index({ _environmentId: 1, _messageId: 1 }, { name: 'crm_engagement_unique_message', unique: true });
engagementSchema.index({ _environmentId: 1, transactionId: 1 }, { name: 'crm_engagement_transaction' });
engagementSchema.index({ createdAt: 1 }, { name: 'crm_engagement_ttl', expireAfterSeconds: ENGAGEMENT_TTL_SECONDS });

export const CrmEngagementModel = registerCrmModel(
  (mongoose.models.CrmEngagement as mongoose.Model<CrmEngagementDBModel>) ||
    mongoose.model<CrmEngagementDBModel>('CrmEngagement', engagementSchema)
);

export class CrmEngagementRepository {
  /** Idempotent : la première ouverture (ou le premier clic) est gardée ; un clic vaut ouverture. */
  async record(message: EngagedMessage, kind: CrmEngagementKind, at = new Date()): Promise<void> {
    const dates = kind === 'clicked' ? { openedAt: at, clickedAt: at } : { openedAt: at };

    await CrmEngagementModel.updateOne(
      { _environmentId: message._environmentId, _messageId: String(message._id) },
      {
        $min: dates,
        $setOnInsert: {
          _subscriberId: String(message._subscriberId),
          transactionId: message.transactionId,
          channel: message.channel,
          createdAt: at,
        },
      },
      { upsert: true }
    );
  }

  /** Push ouvert depuis l'app : seuls les messages de campagne sont suivis. Faux si le message est inconnu. */
  async recordPushOpen(messageId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(messageId)) return false;

    const message = (await Message.findOne(
      { _id: messageId, channel: 'push', 'payload.__crm': { $exists: true } },
      { _environmentId: 1, _subscriberId: 1, transactionId: 1, channel: 1 }
    ).lean()) as EngagedMessage | null;
    if (!message) return false;

    await this.record(message, 'opened');

    return true;
  }
}
