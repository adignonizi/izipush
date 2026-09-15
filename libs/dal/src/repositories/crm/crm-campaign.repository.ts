import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmCampaignDBModel, CrmCampaignEntity } from './crm-campaign.entity';
import { CrmCampaign } from './crm-campaign.schema';
import { toCrmEntity } from './crm-entity.utils';

export type CrmCampaignCreate = Pick<
  CrmCampaignEntity,
  | '_environmentId'
  | '_organizationId'
  | 'name'
  | 'description'
  | 'workflowKey'
  | 'segmentId'
  | 'payload'
  | 'schedule'
  | 'status'
  | '_createdBy'
>;

type CampaignSet = Partial<Omit<CrmCampaignEntity, '_id' | '_environmentId' | '_organizationId'>>;

export class CrmCampaignRepository extends BaseRepositoryV2<CrmCampaignDBModel, CrmCampaignEntity, EnforceEnvId> {
  constructor() {
    super(CrmCampaign, CrmCampaignEntity);
  }

  async list(environmentId: string): Promise<CrmCampaignEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId }).sort({ createdAt: -1 }).lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignEntity>(doc));
  }

  async findCampaign(environmentId: string, id: string): Promise<CrmCampaignEntity | null> {
    const doc = await this.MongooseModel.findOne({ _environmentId: environmentId, _id: id }).lean();

    return doc ? toCrmEntity<CrmCampaignEntity>(doc) : null;
  }

  async createCampaign(data: CrmCampaignCreate): Promise<CrmCampaignEntity> {
    const doc = await this.MongooseModel.create(data);

    return toCrmEntity<CrmCampaignEntity>(doc.toObject());
  }

  /** Un champ passé à `undefined` est supprimé ($unset) : Mongoose ignorerait sinon la clé (ex. effacer `error`). */
  async updateCampaign(environmentId: string, id: string, set: CampaignSet): Promise<CrmCampaignEntity | null> {
    const cleared = Object.keys(set).filter((key) => set[key as keyof CampaignSet] === undefined);
    const doc = await this.MongooseModel.findOneAndUpdate(
      { _environmentId: environmentId, _id: id },
      {
        $set: set,
        ...(cleared.length ? { $unset: Object.fromEntries(cleared.map((key) => [key, 1])) } : {}),
      },
      { new: true }
    ).lean();

    return doc ? toCrmEntity<CrmCampaignEntity>(doc) : null;
  }

  async deleteCampaign(environmentId: string, id: string): Promise<void> {
    await this.MongooseModel.deleteOne({ _environmentId: environmentId, _id: id });
  }

  async countBySegment(environmentId: string, segmentId: string): Promise<number> {
    return this.MongooseModel.countDocuments({ _environmentId: environmentId, segmentId });
  }

  /** crm-ingest : campagnes actives dont l'échéance est passée. */
  async findDue(now: Date, limit: number): Promise<CrmCampaignEntity[]> {
    const docs = await this.MongooseModel.find({ status: 'active', nextRunAt: { $ne: null, $lte: now } })
      .sort({ nextRunAt: 1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignEntity>(doc));
  }

  /** crm-ingest : campagnes récurrentes actives dont la prochaine échéance reste à calculer. */
  async findRecurringWithoutNextRun(limit: number): Promise<CrmCampaignEntity[]> {
    const docs = await this.MongooseModel.find({ status: 'active', 'schedule.mode': 'recurring', nextRunAt: null })
      .limit(limit)
      .lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignEntity>(doc));
  }

  /**
   * crm-ingest : prend l'échéance `expectedNextRunAt` (comparer-puis-écrire). Un seul processus y parvient,
   * même si plusieurs balayages voient la même campagne.
   */
  async claimDueRun(id: string, expectedNextRunAt: Date, set: CampaignSet): Promise<boolean> {
    const result = await this.MongooseModel.updateOne(
      { _id: id, status: 'active', nextRunAt: expectedNextRunAt },
      { $set: set, $inc: { runCount: 1 } }
    );

    return result.modifiedCount === 1;
  }

  /** crm-ingest : campagnes « sur événement » actives abonnées à l'un de ces événements. */
  async findOnEvent(environmentId: string, eventNames: string[]): Promise<CrmCampaignEntity[]> {
    const docs = await this.MongooseModel.find({
      _environmentId: environmentId,
      status: 'active',
      'schedule.mode': 'on_event',
      'schedule.eventName': { $in: eventNames },
    }).lean();

    return docs.map((doc) => toCrmEntity<CrmCampaignEntity>(doc));
  }
}
