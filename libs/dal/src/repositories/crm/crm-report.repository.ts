import { PipelineStage, Types } from 'mongoose';

import { Message } from '../message/message.schema';
import { Subscriber } from '../subscriber/subscriber.schema';
import { CrmEngagementModel } from './crm-engagement';

/** izipush-crm — résultats d'envoi d'une campagne, par canal. */
export type CrmChannelStats = {
  channel: string;
  /** Remis au fournisseur. */
  sent: number;
  errors: number;
  /** Écartés (adresse exclue, préférences…). */
  skipped: number;
  opened: number;
  clicked: number;
};

export const CRM_RECIPIENT_FILTERS = ['all', 'sent', 'unopened', 'opened', 'clicked', 'error', 'skipped'] as const;
export type CrmRecipientFilter = (typeof CRM_RECIPIENT_FILTERS)[number];

/** Messages d'une exécution (son transactionId), ou d'une campagne « sur événement » sur une période. */
export type CrmRecipientScope = { transactionId: string } | { prefix: string; since: Date };

/** Un message envoyé à un client, avec ce que le client en a fait. */
export type CrmRecipientRow = {
  messageId: string;
  subscriberId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  channel: string;
  status: 'sent' | 'error' | 'warning';
  errorText?: string;
  createdAt: Date;
  deliveredAt?: string;
  openedAt?: Date;
  clickedAt?: Date;
  /** In-app : vu et lu, suivis par Novu lui-même. */
  seen?: boolean;
  read?: boolean;
};

const STATUS_OF: Partial<Record<CrmRecipientFilter, string>> = {
  sent: 'sent',
  unopened: 'sent',
  error: 'error',
  skipped: 'warning',
};

/** Filtres qui dépendent des ouvertures et clics : ils demandent la jointure sur crm_engagement avant la pagination. */
const ENGAGEMENT_MATCH: Partial<Record<CrmRecipientFilter, Match>> = {
  opened: { 'engagement.openedAt': { $exists: true } },
  unopened: { 'engagement.openedAt': { $exists: false } },
  clicked: { 'engagement.clickedAt': { $exists: true } },
};

type RecipientDoc = {
  _id: Types.ObjectId;
  _subscriberId: Types.ObjectId;
  channel: string;
  status: CrmRecipientRow['status'];
  errorText?: string;
  createdAt: Date;
  deliveredAt?: string[];
  seen?: boolean;
  read?: boolean;
  engagement?: { openedAt?: Date; clickedAt?: Date }[];
};

type Match = Record<string, unknown>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class CrmReportRepository {
  /** Une ligne par exécution (transactionId) et par canal. */
  async statsByTransaction(
    environmentId: string,
    transactionIds: string[]
  ): Promise<Record<string, CrmChannelStats[]>> {
    if (!transactionIds.length) return {};

    const environment = new Types.ObjectId(environmentId);
    const match = { _environmentId: environment, transactionId: { $in: transactionIds } };
    const [messages, engagement] = await Promise.all([
      this.groupMessages(match, '$transactionId'),
      this.groupEngagement(match, '$transactionId'),
    ]);

    const result: Record<string, CrmChannelStats[]> = {};
    for (const transactionId of transactionIds) {
      result[transactionId] = mergeStats(messages, engagement, transactionId);
    }

    return result;
  }

  /** Campagne « sur événement » : un transactionId par événement, tous préfixés par la campagne. */
  async statsByPrefix(environmentId: string, prefix: string, since: Date): Promise<CrmChannelStats[]> {
    const environment = new Types.ObjectId(environmentId);
    const transactionId = { $regex: `^${escapeRegex(prefix)}` };
    const [messages, engagement] = await Promise.all([
      this.groupMessages({ _environmentId: environment, transactionId, createdAt: { $gte: since } }, null),
      this.groupEngagement({ _environmentId: environment, transactionId, createdAt: { $gte: since } }, null),
    ]);

    return mergeStats(messages, engagement, null);
  }

  /**
   * Messages d'une exécution, un par client et par canal, paginés par curseur (_id croissant).
   * Les filtres d'engagement joignent crm_engagement sur tout le périmètre (index _environmentId + _messageId) ;
   * les autres ne joignent que la page affichée.
   */
  async recipients(
    environmentId: string,
    scope: CrmRecipientScope,
    options: { filter: CrmRecipientFilter; limit: number; cursor?: string; subscriberIds?: string[] }
  ): Promise<{ rows: CrmRecipientRow[]; nextCursor: string | null }> {
    const environment = new Types.ObjectId(environmentId);
    const match: Match = {
      _environmentId: environment,
      ...('transactionId' in scope
        ? { transactionId: scope.transactionId }
        : { transactionId: { $regex: `^${escapeRegex(scope.prefix)}` }, createdAt: { $gte: scope.since } }),
    };
    const status = STATUS_OF[options.filter];
    if (status) match.status = status;
    if (options.subscriberIds) match._subscriberId = { $in: options.subscriberIds.map((id) => new Types.ObjectId(id)) };
    if (options.cursor && Types.ObjectId.isValid(options.cursor)) match._id = { $gt: new Types.ObjectId(options.cursor) };

    const engagementMatch = ENGAGEMENT_MATCH[options.filter];
    const pipeline: PipelineStage[] = [{ $match: match }, { $sort: { _id: 1 } }];
    if (engagementMatch) pipeline.push(lookupEngagement(environment), { $match: engagementMatch });
    pipeline.push(
      { $limit: options.limit + 1 },
      {
        $project: {
          _subscriberId: 1,
          channel: 1,
          status: 1,
          errorText: 1,
          createdAt: 1,
          deliveredAt: 1,
          seen: 1,
          read: 1,
          engagement: 1,
        },
      }
    );

    const docs = (await Message.aggregate(pipeline)) as RecipientDoc[];
    const page = docs.slice(0, options.limit);
    const [engagementById, subscriberById] = await Promise.all([
      engagementMatch ? null : this.engagementOf(environment, page),
      this.subscribersOf(environment, page),
    ]);

    return {
      rows: page.map((doc) => {
        const engagement = engagementById ? engagementById.get(String(doc._id)) : doc.engagement?.[0];
        const subscriber = subscriberById.get(String(doc._subscriberId));

        return {
          messageId: String(doc._id),
          subscriberId: subscriber?.subscriberId,
          firstName: subscriber?.firstName,
          lastName: subscriber?.lastName,
          email: subscriber?.email,
          channel: doc.channel,
          status: doc.status,
          errorText: doc.errorText,
          createdAt: doc.createdAt,
          deliveredAt: doc.deliveredAt?.[0],
          openedAt: engagement?.openedAt,
          clickedAt: engagement?.clickedAt,
          seen: doc.seen,
          read: doc.read,
        };
      }),
      nextCursor: docs.length > options.limit ? String(page[page.length - 1]._id) : null,
    };
  }

  /** Recherche exacte d'un client par identifiant ou email (au plus 20 résultats). */
  async findSubscriberIds(environmentId: string, search: string): Promise<string[]> {
    const value = search.trim();
    if (!value) return [];

    const found = await Subscriber.find(
      {
        _environmentId: new Types.ObjectId(environmentId),
        $or: [{ subscriberId: value }, { email: value }, { email: value.toLowerCase() }],
      },
      { _id: 1 }
    )
      .limit(20)
      .lean();

    return found.map((subscriber) => String(subscriber._id));
  }

  private async engagementOf(environment: Types.ObjectId, page: RecipientDoc[]) {
    const rows = await CrmEngagementModel.find(
      { _environmentId: environment, _messageId: { $in: page.map((doc) => String(doc._id)) } },
      { _messageId: 1, openedAt: 1, clickedAt: 1 }
    ).lean();

    return new Map(rows.map((row) => [row._messageId, row]));
  }

  private async subscribersOf(environment: Types.ObjectId, page: RecipientDoc[]) {
    const ids = [...new Set(page.map((doc) => String(doc._subscriberId)))].map((id) => new Types.ObjectId(id));
    const rows = await Subscriber.find(
      { _environmentId: environment, _id: { $in: ids } },
      { subscriberId: 1, firstName: 1, lastName: 1, email: 1 }
    ).lean();

    return new Map(
      rows.map((row) => [
        String(row._id),
        row as { subscriberId?: string; firstName?: string; lastName?: string; email?: string },
      ])
    );
  }

  private async groupMessages(match: Match, key: string | null) {
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: { key, channel: '$channel' },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ['$status', 'warning'] }, 1, 0] } },
        },
      },
    ];

    return (await Message.aggregate(pipeline)) as GroupRow[];
  }

  private async groupEngagement(match: Match, key: string | null) {
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: { key, channel: '$channel' },
          opened: { $sum: { $cond: [{ $ifNull: ['$openedAt', false] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $ifNull: ['$clickedAt', false] }, 1, 0] } },
        },
      },
    ];

    return (await CrmEngagementModel.aggregate(pipeline)) as GroupRow[];
  }
}

/** Ouverture et clic du message, par l'index unique (_environmentId, _messageId). */
function lookupEngagement(environment: Types.ObjectId): PipelineStage.Lookup {
  return {
    $lookup: {
      from: CrmEngagementModel.collection.name,
      let: { messageId: { $toString: '$_id' } },
      pipeline: [
        { $match: { _environmentId: environment, $expr: { $eq: ['$_messageId', '$$messageId'] } } },
        { $project: { _id: 0, openedAt: 1, clickedAt: 1 } },
      ],
      as: 'engagement',
    },
  };
}

type GroupRow = {
  _id: { key: string | null; channel: string };
  sent?: number;
  errors?: number;
  skipped?: number;
  opened?: number;
  clicked?: number;
};

function mergeStats(messages: GroupRow[], engagement: GroupRow[], key: string | null): CrmChannelStats[] {
  const byChannel = new Map<string, CrmChannelStats>();
  const entry = (channel: string) => {
    const existing = byChannel.get(channel);
    if (existing) return existing;

    const created = { channel, sent: 0, errors: 0, skipped: 0, opened: 0, clicked: 0 };
    byChannel.set(channel, created);

    return created;
  };

  for (const row of messages) {
    if (key !== null && row._id.key !== key) continue;
    const stats = entry(row._id.channel);
    stats.sent += row.sent ?? 0;
    stats.errors += row.errors ?? 0;
    stats.skipped += row.skipped ?? 0;
  }

  for (const row of engagement) {
    if (key !== null && row._id.key !== key) continue;
    const stats = entry(row._id.channel);
    stats.opened += row.opened ?? 0;
    stats.clicked += row.clicked ?? 0;
  }

  return [...byChannel.values()].sort((a, b) => a.channel.localeCompare(b.channel));
}
