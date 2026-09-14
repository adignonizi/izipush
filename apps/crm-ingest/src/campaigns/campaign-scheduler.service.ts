import { Injectable, Logger } from '@nestjs/common';
import { CrmCampaignRepository, CrmCampaignRunRepository } from '@novu/dal';

import { nextCronRun } from './next-run';
import { TopicWriter } from './topic-writer.service';

const BATCH = 50;
const DAY_MS = 24 * 3600 * 1000;

/** Échéances des campagnes et purge des listes d'exécution. */
@Injectable()
export class CampaignScheduler {
  private readonly logger = new Logger(CampaignScheduler.name);

  constructor(
    private campaigns: CrmCampaignRepository,
    private runs: CrmCampaignRunRepository,
    private topics: TopicWriter
  ) {}

  /** Campagnes récurrentes activées : calcule leur première échéance (l'API n'a pas l'expression cron). */
  async initRecurring(now: Date): Promise<void> {
    for (const campaign of await this.campaigns.findRecurringWithoutNextRun(BATCH)) {
      const environmentId = String(campaign._environmentId);

      try {
        const nextRunAt = nextCronRun(campaign.schedule.cron as string, campaign.schedule.timezone as string, now);
        await this.campaigns.updateCampaign(environmentId, campaign._id, { nextRunAt });
      } catch (error) {
        await this.campaigns.updateCampaign(environmentId, campaign._id, {
          status: 'paused',
          error: `Expression cron invalide : ${(error as Error).message}`,
        });
      }
    }
  }

  /**
   * Crée l'exécution de chaque campagne arrivée à échéance. L'échéance est prise par comparer-puis-écrire :
   * deux balayages simultanés ne lancent jamais deux fois la même.
   */
  async createDueRuns(now: Date): Promise<number> {
    let created = 0;

    for (const campaign of await this.campaigns.findDue(now, BATCH)) {
      const scheduledFor = campaign.nextRunAt as Date;
      const recurring = campaign.schedule.mode === 'recurring';

      let nextRunAt: Date | null = null;
      if (recurring) {
        try {
          nextRunAt = nextCronRun(campaign.schedule.cron as string, campaign.schedule.timezone as string, now);
        } catch {
          nextRunAt = null;
        }
      }

      const claimed = await this.campaigns.claimDueRun(campaign._id, scheduledFor, {
        nextRunAt,
        lastRunAt: now,
        status: recurring && nextRunAt ? 'active' : 'completed',
      });
      if (!claimed) continue;

      await this.runs.createForSchedule({
        _environmentId: String(campaign._environmentId),
        _organizationId: String(campaign._organizationId),
        campaignId: campaign._id,
        scheduledFor,
      });
      created++;
      this.logger.log(`Campagne « ${campaign.name} » : exécution du ${scheduledFor.toISOString()} créée`);
    }

    return created;
  }

  /** Listes d'exécution supprimées après la durée de rétention ; l'historique reste dans l'exécution et Novu. */
  async purgeRunTopics(now: Date): Promise<void> {
    const retentionDays = Number(process.env.CRM_RUN_TOPIC_RETENTION_DAYS);
    const before = new Date(now.getTime() - retentionDays * DAY_MS);

    for (const run of await this.runs.findTopicsToPurge(before, BATCH)) {
      await this.topics.deleteTopic(String(run._environmentId), String(run._organizationId), run.topicKey as string);
      await this.runs.updateRun(run._id, { topicPurgedAt: now });
    }
  }
}
