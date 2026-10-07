import { EnforceEnvId } from '../../types';
import { BaseRepositoryV2 } from '../base-repository-v2';
import { CrmEmailTemplateDBModel, CrmEmailTemplateEntity } from './crm-email-template.entity';
import { CrmEmailTemplate } from './crm-email-template.schema';
import { toCrmEntity } from './crm-entity.utils';

export type CrmEmailTemplateSummary = Pick<
  CrmEmailTemplateEntity,
  '_id' | 'name' | 'description' | 'subject' | 'version' | 'createdAt' | 'updatedAt'
>;

type TemplateSet = Partial<
  Pick<CrmEmailTemplateEntity, 'name' | 'description' | 'subject' | 'design' | 'html' | '_updatedBy'>
>;

export class CrmEmailTemplateRepository extends BaseRepositoryV2<
  CrmEmailTemplateDBModel,
  CrmEmailTemplateEntity,
  EnforceEnvId
> {
  constructor() {
    super(CrmEmailTemplate, CrmEmailTemplateEntity);
  }

  /** Liste légère (sans le JSON ni le HTML, qui peuvent peser lourd). */
  async list(environmentId: string): Promise<CrmEmailTemplateSummary[]> {
    const docs = await this.MongooseModel.find(
      { _environmentId: environmentId },
      {
        name: 1,
        description: 1,
        subject: 1,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        _environmentId: 1,
        _organizationId: 1,
      }
    )
      .sort({ updatedAt: -1 })
      .lean();

    return docs.map((doc) => toCrmEntity<CrmEmailTemplateSummary>(doc));
  }

  async findTemplate(environmentId: string, id: string): Promise<CrmEmailTemplateEntity | null> {
    const doc = await this.MongooseModel.findOne({ _environmentId: environmentId, _id: id }).lean();

    return doc ? toCrmEntity<CrmEmailTemplateEntity>(doc) : null;
  }

  async createTemplate(
    data: Pick<
      CrmEmailTemplateEntity,
      '_environmentId' | '_organizationId' | 'name' | 'description' | 'subject' | 'design' | 'html' | '_updatedBy'
    >
  ): Promise<CrmEmailTemplateEntity> {
    const doc = await this.MongooseModel.create({ ...data, version: 1 });

    return toCrmEntity<CrmEmailTemplateEntity>(doc.toObject());
  }

  async updateTemplate(environmentId: string, id: string, set: TemplateSet): Promise<CrmEmailTemplateEntity | null> {
    const doc = await this.MongooseModel.findOneAndUpdate(
      { _environmentId: environmentId, _id: id },
      { $set: set, $inc: { version: 1 } },
      { new: true }
    ).lean();

    return doc ? toCrmEntity<CrmEmailTemplateEntity>(doc) : null;
  }

  async deleteTemplate(environmentId: string, id: string): Promise<void> {
    await this.MongooseModel.deleteOne({ _environmentId: environmentId, _id: id });
  }
}
