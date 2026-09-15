import type { CrmChannelStats } from '@/api/crm-reports';
import { formatNumber, t, tMaybe } from './crm-i18n';

// izipush-crm — cumuls et taux affichés dans les rapports.

export function channelLabel(channel: string): string {
  return tMaybe(`channel.${channel}`) ?? channel;
}

/** @deprecated utiliser channelLabel. */
export const CHANNEL_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, channel: string) => channelLabel(channel),
});

export type StatsTotal = Omit<CrmChannelStats, 'channel'>;

export function totalStats(stats: CrmChannelStats[]): StatsTotal {
  return stats.reduce(
    (total, row) => ({
      sent: total.sent + row.sent,
      errors: total.errors + row.errors,
      skipped: total.skipped + row.skipped,
      opened: total.opened + row.opened,
      clicked: total.clicked + row.clicked,
    }),
    { sent: 0, errors: 0, skipped: 0, opened: 0, clicked: 0 }
  );
}

export function rate(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)} %` : '—';
}

export const formatCount = formatNumber;

/** « Email 1 200 · Push 800 » : envoyés par canal, pour une cellule de tableau. */
export function describeChannels(stats: CrmChannelStats[]): string {
  return stats.length ? stats.map((row) => `${channelLabel(row.channel)} ${formatNumber(row.sent)}`).join(' · ') : '—';
}

/** Canaux d'un workflow (types d'étapes), sans les étapes d'action (délai, digest…). */
export function workflowChannels(stepTypes: string[] = []): string[] {
  return [...new Set(stepTypes)].map((type) => tMaybe(`channel.${type}`)).filter((label): label is string => !!label);
}

export { t };
