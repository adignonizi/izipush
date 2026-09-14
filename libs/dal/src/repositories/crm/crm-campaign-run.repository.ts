import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmCampaignRunDBModel, CrmCampaignRunEntity } from './crm-campaign-run.entity';
import { CrmCampaignRun } from './crm-campaign-run.schema';
import { toCrmEntity } from './crm-entity.utils';

const LOCK_MS = 15 * 60 * 1000;

type RunSet = Partial<Omit<CrmCampaignRunEntity, '_id' | '_environmentId' | '_organizationId' | 'campaignId'>>;

export class CrmCampaignRunRepository extends BaseRepositoryV2<
  CrmCampaignRunDBModel,
  CrmCampaignRunEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmCampaignRun, CrmCampaignRunEntity);
  }

  /** Crée l'exécution d'une échéance si elle n'existe pas déjà (index unique campagne + échéance). */
  async createForSchedule(data: {
    _environmentId: string;
    _organizationId: string;
    campaignId: string;
    scheduledFor: Date;
  }): Promise<CrmCampaignRunEntity> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      { campaignId: data.campaignId, scheduledFor: data.scheduledFor },
      { $setOnInsert: { ...data, status: 'resolving', startedAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return toCrmEntity<CrmCampaignRunEntity>(doc);
  }

  async findRun(id: string): Promise<CrmCampaignRunEntity | null> {
    const doc = await this.MongooseModel.findById(id).lean();

    return doc ? toCrmEntity<CrmCampaignRunEntity>(doc) : null;
  }

  async listByCampaign(environmentId: string, campaignId: string, limit: number): Promise<CrmCampaignRunEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId, campaignId })
      .sort({ scheduledFor: -1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignRunEntity>(doc));
  }

  async updateRun(id: string, set: RunSet): Promise<void> {
    await this.MongooseModel.updateOne({ _id: id }, { $set: set });
  }

  /** crm-ingest : réserve une exécution à faire avancer (nouvelle, ou reprise après un arrêt). */
  async claimPending(now: Date): Promise<CrmCampaignRunEntity | null> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      {
        status: { $in: ['resolving', 'triggering'] },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
      },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
      { new: true, sort: { scheduledFor: 1 } }
    ).lean();

    return doc ? toCrmEntity<CrmCampaignRunEntity>(doc) : null;
  }

  /** crm-ingest : exécutions déclenchées avant `before` dont le topic n'a pas encore été supprimé. */
  async findTopicsToPurge(before: Date, limit: number): Promise<CrmCampaignRunEntity[]> {
    const docs = await this.MongooseModel.find({
      status: 'triggered',
      triggeredAt: { $lt: before },
      topicPurgedAt: null,
      topicKey: { $exists: true },
    })
      .limit(limit)
      .lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignRunEntity>(doc));
  }
}
