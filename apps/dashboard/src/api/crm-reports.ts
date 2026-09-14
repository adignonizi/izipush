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
  mode: CrmScheduleMode;
  status: CrmCampaignStatus;
  runs: number;
  audience: number;
  stats: CrmChannelStats[];
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

export async function getCrmReportOverview({
  environment,
  days,
  signal,
}: WithEnvironment & { days: number }): Promise<CrmReportOverview> {
  return (await get<{ data: CrmReportOverview }>(`/crm/reports/overview?days=${days}`, { environment, signal })).data;
}
