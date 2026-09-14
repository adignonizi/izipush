import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmConditionGroup,
  CrmEventEntity,
  CrmSegmentEntity,
  CrmSegmentRepository,
} from '@novu/dal';

import { CrmPermanentError, NovuTriggerClient } from './novu-trigger.client';
import { segmentTopicKey } from './segment-freezer.service';
import { TopicWriter } from './topic-writer.service';

/** Au-delà, un événement est un rattrapage (import, relecture) : il met le profil à jour mais ne déclenche rien. */
const MAX_EVENT_AGE_MS = 24 * 3600 * 1000;

const EVERYONE: CrmConditionGroup = { type: 'group', combinator: 'and', conditions: [] };

/**
 * Campagnes « sur événement » : à chaque événement d'un client, déclenche le workflow des campagnes abonnées
 * à cet événement, pour ce seul client, s'il appartient au segment et accepte le marketing.
 */
@Injectable()
export class OnEventCampaigns {
  private readonly logger = new Logger(OnEventCampaigns.name);

  constructor(
    private campaigns: CrmCampaignRepository,
    private segments: CrmSegmentRepository,
    private audience: CrmAudienceRepository,
    private topics: TopicWriter,
    private novu: NovuTriggerClient
  ) {}

  async handle(subscriberId: string, events: CrmEventEntity[], now = new Date()): Promise<void> {
    // L'import initial (scripts/import-izichange.mjs) rejoue l'historique : il ne déclenche jamais de campagne.
    const recent = events.filter(
      (event) =>
        now.getTime() - new Date(event.occurredAt).getTime() <= MAX_EVENT_AGE_MS && event.data?.imported !== true
    );
    if (!recent.length) return;

    const environmentId = process.env.CRM_ENVIRONMENT_ID;
    const eventNames = [...new Set(recent.map((event) => event.eventName))];

    for (const campaign of await this.campaigns.findOnEvent(environmentId, eventNames)) {
      const segment = await this.segments.findSegment(environmentId, campaign.segmentId);
      if (!segment || segment.status !== 'ready' || !(await this.isEligible(segment, subscriberId))) continue;

      for (const event of recent.filter((candidate) => candidate.eventName === campaign.schedule.eventName)) {
        try {
          await this.novu.trigger({
            workflowKey: campaign.workflowKey,
            to: [subscriberId],
            payload: {
              ...(campaign.payload ?? {}),
              event: { name: event.eventName, occurredAt: new Date(event.occurredAt).toISOString(), data: event.data },
              __crm: { campaignId: campaign._id, eventId: event.eventId },
            },
            // Rejouable : un même événement ne déclenche la même campagne qu'une fois.
            transactionId: `crm-${campaign._id}-${createHash('sha1').update(event.eventId).digest('hex').slice(0, 20)}`,
          });
        } catch (error) {
          // Erreur de configuration : on la signale sans bloquer la mise à jour du profil. Sinon, le recalcul est retenté.
          if (!(error instanceof CrmPermanentError)) throw error;

          await this.campaigns.updateCampaign(environmentId, campaign._id, { error: error.message });
          this.logger.warn(`Campagne « ${campaign.name} » non déclenchée : ${error.message}`);
        }
      }
    }
  }

  private async isEligible(segment: CrmSegmentEntity, subscriberId: string): Promise<boolean> {
    const environmentId = String(segment._environmentId);
    const options = { subscriberId, extraFilter: { 'data.marketing_optin': { $ne: false } } };

    if (segment.frozen) {
      if (!(await this.topics.isMember(environmentId, segmentTopicKey(segment), subscriberId))) return false;

      return (await this.audience.count(environmentId, EVERYONE, options)) > 0;
    }

    return (await this.audience.count(environmentId, segment.audience, options)) > 0;
  }
}
