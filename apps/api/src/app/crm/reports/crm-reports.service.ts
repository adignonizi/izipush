import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CrmCampaignEntity,
  CrmCampaignRepository,
  CrmCampaignRunEntity,
  CrmCampaignRunRepository,
  CrmChannelStats,
  CrmReportRepository,
} from '@novu/dal';
import { UserSessionData } from '@novu/shared';

/** Après 48 h, ouvertures et clics n'évoluent presque plus : les résultats d'une exécution sont gardés tels quels. */
const FINAL_AFTER_MS = 48 * 3600 * 1000;
const ON_EVENT_DAYS = 30;
const OVERVIEW_MAX_RUNS = 1000;

export type CrmRunReport = CrmCampaignRunEntity & { stats: CrmChannelStats[] };

@Injectable()
export class CrmReportsService {
  constructor(
    private campaigns: CrmCampaignRepository,
    private runs: CrmCampaignRunRepository,
    private reports: CrmReportRepository
  ) {}

  /** Résultats d'une campagne : chaque exécution, et pour une campagne « sur événement » les 30 derniers jours. */
  async campaignReport(user: UserSessionData, campaignId: string) {
    const campaign = await this.campaigns.findCampaign(user.environmentId, campaignId);
    if (!campaign) throw new NotFoundException('Campagne introuvable');

    const runs = await this.withStats(
      user.environmentId,
      await this.runs.listByCampaign(user.environmentId, campaignId, 50)
    );
    const onEvent =
      campaign.schedule.mode === 'on_event'
        ? { days: ON_EVENT_DAYS, stats: await this.onEventStats(user.environmentId, campaign, daysAgo(ON_EVENT_DAYS)) }
        : null;

    return { campaignId: campaign._id, name: campaign.name, runs, onEvent };
  }

  /** Rapport client : par campagne, sur la période (exécutions déclenchées et envois « sur événement »). */
  async overview(user: UserSessionData, days: unknown) {
    const span = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
    const since = daysAgo(span);
    const [campaigns, runs] = await Promise.all([
      this.campaigns.list(user.environmentId),
      this.runs.listTriggeredSince(user.environmentId, since, OVERVIEW_MAX_RUNS),
    ]);
    const reported = await this.withStats(user.environmentId, runs);

    const rows = await Promise.all(
      campaigns.map(async (campaign) => {
        const own = reported.filter((run) => run.campaignId === campaign._id);
        const stats = sumStats([
          ...own.map((run) => run.stats),
          campaign.schedule.mode === 'on_event' ? await this.onEventStats(user.environmentId, campaign, since) : [],
        ]);

        return {
          campaignId: campaign._id,
          name: campaign.name,
          mode: campaign.schedule.mode,
          status: campaign.status,
          runs: own.length,
          audience: own.reduce((total, run) => total + (run.audienceSize ?? 0), 0),
          stats,
        };
      })
    );

    return {
      from: since.toISOString(),
      days: span,
      truncated: runs.length === OVERVIEW_MAX_RUNS,
      rows: rows.filter((row) => row.runs > 0 || row.stats.length > 0),
    };
  }

  private onEventStats(environmentId: string, campaign: CrmCampaignEntity, since: Date) {
    return this.reports.statsByPrefix(environmentId, `crm-${campaign._id}-`, since);
  }

  private async withStats(environmentId: string, runs: CrmCampaignRunEntity[]): Promise<CrmRunReport[]> {
    const transactionOf = (run: CrmCampaignRunEntity) => run.transactionId ?? run._id;
    const pending = runs.filter((run) => run.status === 'triggered' && !run.statsFinalAt);
    const computed = await this.reports.statsByTransaction(environmentId, pending.map(transactionOf));
    const now = Date.now();

    await Promise.all(
      pending
        .filter((run) => run.triggeredAt && now - new Date(run.triggeredAt).getTime() > FINAL_AFTER_MS)
        .map((run) =>
          this.runs.updateRun(run._id, { stats: computed[transactionOf(run)] ?? [], statsFinalAt: new Date() })
        )
    );

    return runs.map((run) => ({
      ...run,
      stats: run.statsFinalAt ? (run.stats ?? []) : (computed[transactionOf(run)] ?? []),
    }));
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function sumStats(lists: CrmChannelStats[][]): CrmChannelStats[] {
  const byChannel = new Map<string, CrmChannelStats>();

  for (const stats of lists.flat()) {
    const total = byChannel.get(stats.channel) ?? {
      channel: stats.channel,
      sent: 0,
      errors: 0,
      skipped: 0,
      opened: 0,
      clicked: 0,
    };
    total.sent += stats.sent;
    total.errors += stats.errors;
    total.skipped += stats.skipped;
    total.opened += stats.opened;
    total.clicked += stats.clicked;
    byChannel.set(stats.channel, total);
  }

  return [...byChannel.values()];
}
