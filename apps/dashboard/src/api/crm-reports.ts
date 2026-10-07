import { IEnvironment } from '@novu/shared';
import { get } from './api.client';
import type { CrmCampaignRun, CrmCampaignStatus, CrmScheduleMode } from './crm';

// izipush-crm — rapports de campagnes (routes /v1/crm/reports du fork).

export type CrmChannelStats = {
  channel: string;
  sent: number;
  errors: number;
  skipped: number;
  opened: number;
  clicked: number;
};

export type CrmRunReport = CrmCampaignRun & { stats: CrmChannelStats[] };

export type CrmCampaignReport = {
  campaignId: string;
  name: string;
  runs: CrmRunReport[];
  onEvent: { days: number; stats: CrmChannelStats[] } | null;
};

export type CrmReportRow = {
  campaignId: string;
  name: string;
  productId?: string;
  mode: CrmScheduleMode;
  status: CrmCampaignStatus;
  runs: number;
  audience: number;
  stats: CrmChannelStats[];
};

export type CrmRecipientFilter = 'all' | 'sent' | 'unopened' | 'opened' | 'clicked' | 'error' | 'skipped';

/** Un message d'une exécution, client par client. */
export type CrmRecipient = {
  messageId: string;
  subscriberId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  channel: string;
  status: 'sent' | 'error' | 'warning';
  errorText?: string;
  createdAt: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  seen?: boolean;
  read?: boolean;
};

export type CrmRecipientsPage = {
  run: CrmRunReport | null;
  onEvent: { days: number; stats: CrmChannelStats[] } | null;
  rows: CrmRecipient[];
  nextCursor: string | null;
};

export type CrmReportOverview = { from: string; days: number; truncated: boolean; rows: CrmReportRow[] };

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmCampaignReport({
  environment,
  campaignId,
  signal,
}: WithEnvironment & { campaignId: string }): Promise<CrmCampaignReport> {
  return (await get<{ data: CrmCampaignReport }>(`/crm/reports/campaigns/${campaignId}`, { environment, signal })).data;
}

/** `runId` = « events » : envois d'une campagne « sur événement » sur les 30 derniers jours. */
export async function getCrmRunRecipients({
  environment,
  campaignId,
  runId,
  filter,
  search,
  cursor,
  limit,
  signal,
}: WithEnvironment & {
  campaignId: string;
  runId: string;
  filter: CrmRecipientFilter;
  search?: string;
  cursor?: string;
  limit: number;
}): Promise<CrmRecipientsPage> {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  if (search) params.set('search', search);
  if (cursor) params.set('cursor', cursor);

  return (
    await get<{ data: CrmRecipientsPage }>(
      `/crm/reports/campaigns/${campaignId}/runs/${runId}/recipients?${params.toString()}`,
      { environment, signal }
    )
  ).data;
}

export async function getCrmReportOverview({
  environment,
  days,
  signal,
}: WithEnvironment & { days: number }): Promise<CrmReportOverview> {
  return (await get<{ data: CrmReportOverview }>(`/crm/reports/overview?days=${days}`, { environment, signal })).data;
}
