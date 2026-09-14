import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { toCrmEntity } from './crm-entity.utils';
import { CrmSegmentDBModel, CrmSegmentEntity, CrmSegmentStatus } from './crm-segment.entity';
import { CrmSegment } from './crm-segment.schema';

const LOCK_MS = 10 * 60 * 1000;

export type CrmSegmentCreate = Pick<
  CrmSegmentEntity,
  '_environmentId' | '_organizationId' | 'name' | 'description' | 'audience' | 'frozen' | 'status' | '_createdBy'
>;

export class CrmSegmentRepository extends BaseRepositoryV2<CrmSegmentDBModel, CrmSegmentEntity, EnforceEnvId> {
  constructor() {
    super(CrmSegment, CrmSegmentEntity);
  }

  async list(environmentId: string): Promise<CrmSegmentEntity[]> {
    const docs = await this.MongooseModel.find({ _environmentId: environmentId, status: { $ne: 'deleting' } })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map((doc) => toCrmEntity<CrmSegmentEntity>(doc));
  }

  async findSegment(environmentId: string, id: string): Promise<CrmSegmentEntity | null> {
    const doc = await this.MongooseModel.findOne({ _environmentId: environmentId, _id: id }).lean();

    return doc ? toCrmEntity<CrmSegmentEntity>(doc) : null;
  }

  async createSegment(data: CrmSegmentCreate): Promise<CrmSegmentEntity> {
    const doc = await this.MongooseModel.create(data);

    return toCrmEntity<CrmSegmentEntity>(doc.toObject());
  }

  async updateSegment(
    environmentId: string,
    id: string,
    set: Partial<Omit<CrmSegmentEntity, '_id' | '_environmentId' | '_organizationId'>>
  ): Promise<CrmSegmentEntity | null> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      { _environmentId: environmentId, _id: id },
      { $set: set },
      { new: true }
    ).lean();

    return doc ? toCrmEntity<CrmSegmentEntity>(doc) : null;
  }

  /** crm-ingest : réserve un segment à traiter (figeage ou suppression) pour 10 minutes. */
  async claimWork(
    status: Extract<CrmSegmentStatus, 'freezing' | 'deleting'>,
    now: Date
  ): Promise<CrmSegmentEntity | null> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      { status, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } },
      { new: true }
    ).lean();

    return doc ? toCrmEntity<CrmSegmentEntity>(doc) : null;
  }

  async deleteSegment(environmentId: string, id: string): Promise<void> {
    await this.MongooseModel.deleteOne({ _environmentId: environmentId, _id: id });
  }
}
