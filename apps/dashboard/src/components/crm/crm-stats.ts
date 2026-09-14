import type { CrmChannelStats } from '@/api/crm-reports';

// izipush-crm — cumuls et taux affichés dans les rapports.

export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  push: 'Push',
  in_app: 'In-app',
  sms: 'SMS',
  chat: 'Chat',
};

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

export function formatCount(value?: number): string {
  return (value ?? 0).toLocaleString('fr-FR');
}

/** « Email 1 200 · Push 800 » : envoyés par canal, pour une cellule de tableau. */
export function describeChannels(stats: CrmChannelStats[]): string {
  return stats.length
    ? stats.map((row) => `${CHANNEL_LABELS[row.channel] ?? row.channel} ${formatCount(row.sent)}`).join(' · ')
    : '—';
}
