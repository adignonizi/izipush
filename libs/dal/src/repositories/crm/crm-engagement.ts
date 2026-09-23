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

/**
 * Message push retrouvé pour le suivi de livraison et d'ouverture.
 *
 * Porte tout ce qu'il faut pour écrire un détail d'exécution — c'est lui qui fait apparaître la ligne
 * dans le journal d'activité du tableau de bord. Sans ces identifiants, le retour d'information resterait
 * enfermé dans les collections du CRM, invisible depuis Novu.
 */
export type TrackedPushMessage = EngagedMessage & {
  _organizationId: unknown;
  _templateId: unknown;
  _notificationId: unknown;
  _jobId: unknown;
  providerId?: string;
  /** Vrai pour les messages émis par le pipeline de campagne, seuls comptés dans les rapports CRM. */
  isCampaign: boolean;
};

/** Projection commune aux deux routes de suivi. */
const TRACKED_FIELDS = {
  _environmentId: 1,
  _organizationId: 1,
  _subscriberId: 1,
  _templateId: 1,
  _notificationId: 1,
  _jobId: 1,
  transactionId: 1,
  channel: 1,
  providerId: 1,
  payload: 1,
} as const;

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

  /**
   * Ouverture ou clic d'un email de campagne, depuis le pixel ou un lien réécrit.
   *
   * Le message est relu pour deux raisons : vérifier qu'il s'agit bien d'un email de campagne — un jeton
   * ne doit rien pouvoir compter d'autre — et retrouver le client et l'exécution auxquels le rattacher.
   * Faux si le message est inconnu, sans que l'appelant en tire quoi que ce soit : les deux routes
   * répondent la même chose dans tous les cas.
   */
  async recordEmailEngagement(environmentId: string, messageId: string, kind: CrmEngagementKind): Promise<boolean> {
    if (!Types.ObjectId.isValid(messageId) || !Types.ObjectId.isValid(environmentId)) return false;

    const message = (await Message.findOne(
      {
        _id: messageId,
        _environmentId: environmentId,
        channel: 'email',
        'payload.__crm': { $exists: true },
      },
      { _environmentId: 1, _subscriberId: 1, transactionId: 1, channel: 1 }
    ).lean()) as EngagedMessage | null;
    if (!message) return false;

    await this.record(message, kind);

    return true;
  }

  /**
   * Retrouve un message push par son identifiant, campagne ou non.
   *
   * Volontairement NON restreint aux messages de campagne, contrairement aux rapports CRM : un push
   * déclenché depuis le tableau de bord doit rendre le même retour d'information qu'un push de campagne,
   * sans quoi on ne peut rien éprouver avant de lancer une campagne.
   */
  async findPushMessage(messageId: string): Promise<TrackedPushMessage | null> {
    if (!Types.ObjectId.isValid(messageId)) return null;

    const message = (await Message.findOne({ _id: messageId, channel: 'push' }, TRACKED_FIELDS).lean()) as
      | (EngagedMessage & Record<string, unknown>)
      | null;
    if (!message) return null;

    const payload = (message.payload ?? {}) as Record<string, unknown>;

    return { ...message, isCampaign: payload.__crm !== undefined } as TrackedPushMessage;
  }

  /**
   * Note la remise du push sur l'appareil, signalée par le SDK à la réception.
   *
   * Novu ne sait jusqu'ici que « accepté par FCM », ce qui ne garantit rien de la suite : sans ce signal,
   * « jamais arrivé » et « arrivé mais pas affiché » sont indiscernables.
   *
   * Un message push vaut pour UN jeton — le worker en crée un par appareil — donc une seule date suffit
   * et la condition `$exists: false` rend l'appel idempotent : un service worker qui signale deux fois
   * n'écrase pas l'heure d'origine. Faux si la remise était déjà notée.
   */
  async markPushDelivered(message: TrackedPushMessage, at = new Date()): Promise<boolean> {
    const res = await Message.updateOne(
      { _id: message._id, _environmentId: message._environmentId, deliveredAt: { $exists: false } },
      { $set: { deliveredAt: [at] } }
    );

    return res.modifiedCount > 0;
  }

  /**
   * Note l'ouverture du push : appui sur la notification.
   *
   * Écrit `seen` et `read` sur le message Novu lui-même, et pas seulement dans les collections du CRM,
   * afin que le retour d'information apparaisse là où les utilisateurs le cherchent. `read` accompagne
   * `seen` : sur un push, l'appui EST la lecture — il n'existe pas d'état intermédiaire comme dans
   * l'inbox, où l'on peut voir une notification sans l'ouvrir.
   *
   * Faux si l'ouverture était déjà notée, ce qui garde la première heure.
   */
  async markPushOpened(message: TrackedPushMessage, at = new Date()): Promise<boolean> {
    const res = await Message.updateOne(
      { _id: message._id, _environmentId: message._environmentId, seen: { $ne: true } },
      { $set: { seen: true, read: true, lastSeenDate: at, lastReadDate: at } }
    );

    // Une ouverture prouve la remise. Un appareil en veille prolongée peut n'avoir jamais signalé la
    // réception ; sans cela, le message resterait « ouvert mais jamais livré ».
    await this.markPushDelivered(message, at);

    if (message.isCampaign) await this.record(message, 'opened', at);

    return res.modifiedCount > 0;
  }
}
