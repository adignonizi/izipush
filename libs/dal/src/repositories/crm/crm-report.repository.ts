import { PipelineStage, Types } from 'mongoose';

import { Message } from '../message/message.schema';
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
