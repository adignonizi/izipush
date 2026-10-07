import { Injectable, Logger } from '@nestjs/common';
import {
  CrmAudienceError,
  CrmAudienceMember,
  CrmAudienceRepository,
  CrmCampaignEntity,
  CrmCampaignRepository,
  CrmCampaignRunEntity,
  CrmCampaignRunRepository,
  CrmSegmentRepository,
  SubscriberRepository,
} from '@novu/dal';

import { CrmPermanentError, NovuTriggerClient } from './novu-trigger.client';
import { segmentTopicKey } from './segment-freezer.service';
import { TopicWriter } from './topic-writer.service';

const BATCH_SIZE = 1000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;

type SubscriberRow = { _id: unknown; subscriberId: string };

/**
 * Fait avancer une exécution : resolving (liste du run) → triggering (un seul déclenchement sur le topic)
 * → triggered. Chaque étape est rejouable : membres écrits par upsert, transactionId = identifiant du run.
 */
@Injectable()
export class CampaignRunner {
  private readonly logger = new Logger(CampaignRunner.name);

  constructor(
    private runs: CrmCampaignRunRepository,
    private campaigns: CrmCampaignRepository,
    private segments: CrmSegmentRepository,
    private audience: CrmAudienceRepository,
    private subscribers: SubscriberRepository,
    private topics: TopicWriter,
    private novu: NovuTriggerClient
  ) {}

  async process(run: CrmCampaignRunEntity): Promise<void> {
    const environmentId = String(run._environmentId);
    const campaign = await this.campaigns.findCampaign(environmentId, run.campaignId);
    if (!campaign) return this.fail(run, 'Campagne supprimée');

    try {
      const current = run.status === 'resolving' ? await this.resolve(run, campaign) : run;
      if (current.status === 'triggering') await this.trigger(current, campaign);
    } catch (error) {
      const message = (error as Error).message;
      const permanent =
        error instanceof CrmPermanentError || error instanceof CrmAudienceError || (run.attempts ?? 0) >= MAX_ATTEMPTS;

      if (permanent) {
        await this.fail(run, message);
        await this.campaigns.updateCampaign(environmentId, campaign._id, { error: message });

        return;
      }

      this.logger.warn(`Exécution ${run._id} reportée (tentative ${run.attempts}) : ${message}`);
      await this.runs.updateRun(run._id, { error: message, lockedUntil: new Date(Date.now() + RETRY_DELAY_MS) });
    }
  }

  private async resolve(run: CrmCampaignRunEntity, campaign: CrmCampaignEntity): Promise<CrmCampaignRunEntity> {
    const environmentId = String(run._environmentId);
    const segment = await this.segments.findSegment(environmentId, campaign.segmentId);
    if (!segment || segment.status !== 'ready') {
      throw new CrmPermanentError(segment ? `Segment non utilisable (${segment.status})` : 'Segment supprimé');
    }

    const topicKey = `campaign:${campaign._id}:${run._id}`;
    const topic = await this.topics.ensureTopic(
      environmentId,
      String(run._organizationId),
      topicKey,
      `Exécution — ${campaign.name}`
    );

    const source = segment.frozen
      ? this.topics.members(environmentId, segmentTopicKey(segment), BATCH_SIZE)
      : this.audience.iterate(environmentId, segment.audience, { batchSize: BATCH_SIZE });

    let audienceSize = 0;
    let excludedCount = 0;
    for await (const batch of source) {
      const eligible = await this.eligible(environmentId, batch, campaign);

      await this.topics.addMembers(topic, eligible);
      audienceSize += eligible.length;
      excludedCount += batch.length - eligible.length;
    }

    const resolved = { status: 'triggering' as const, topicKey, audienceSize, excludedCount, transactionId: run._id };
    await this.runs.updateRun(run._id, resolved);

    return { ...run, ...resolved };
  }

  private async trigger(run: CrmCampaignRunEntity, campaign: CrmCampaignEntity): Promise<void> {
    if (run.audienceSize) {
      await this.novu.trigger({
        environmentId: String(campaign._environmentId),
        workflowKey: campaign.workflowKey,
        to: [{ type: 'Topic', topicKey: run.topicKey as string }],
        payload: { ...(campaign.payload ?? {}), __crm: { campaignId: campaign._id, runId: run._id } },
        transactionId: run.transactionId ?? run._id,
      });
    }

    const now = new Date();
    await this.runs.updateRun(run._id, {
      status: 'triggered',
      triggeredAt: now,
      lockedUntil: null,
      ...(run.audienceSize ? {} : { error: 'Aucun client éligible : rien à envoyer' }),
    });
    // Envoi réussi : l'erreur d'une exécution précédente ne s'affiche plus sur la campagne.
    await this.campaigns.updateCampaign(String(run._environmentId), campaign._id, { lastRunAt: now, error: undefined });
    this.logger.log(
      `Campagne « ${campaign.name} » : ${run.audienceSize} client(s) visé(s), ${run.excludedCount} exclu(s)`
    );
  }

  /**
   * Au lancement, même pour un segment figé : clients supprimés et refus du marketing écartés.
   * Campagne de recrutement (`excludeProductUsers`) : ceux qui utilisent déjà le produit promu le sont aussi —
   * un client peut avoir adopté le produit entre le figeage du segment et l'envoi.
   */
  private async eligible(
    environmentId: string,
    batch: CrmAudienceMember[],
    campaign: CrmCampaignEntity
  ): Promise<CrmAudienceMember[]> {
    if (!batch.length) return [];

    const promoted = campaign.excludeProductUsers && campaign.productId ? campaign.productId : undefined;

    const rows = await this.subscribers._model
      .find(
        {
          _environmentId: environmentId,
          _id: { $in: batch.map((member) => member._id) },
          'data.isDeleted': { $ne: true },
          'data.marketing_optin': { $ne: false },
          ...(promoted ? { 'data.products': { $ne: promoted } } : {}),
        },
        { _id: 1, subscriberId: 1 }
      )
      .lean<SubscriberRow[]>();

    return rows.map((row) => ({ _id: String(row._id), subscriberId: row.subscriberId }));
  }

  private async fail(run: CrmCampaignRunEntity, message: string): Promise<void> {
    await this.runs.updateRun(run._id, { status: 'failed', error: message, lockedUntil: null });
    this.logger.warn(`Exécution ${run._id} en échec : ${message}`);
  }
}
