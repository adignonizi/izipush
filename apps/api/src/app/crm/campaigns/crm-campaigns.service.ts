import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CrmCampaignEntity,
  CrmCampaignRepository,
  CrmCampaignRunEntity,
  CrmCampaignRunRepository,
  CrmProductRepository,
  CrmScheduleError,
  CrmSegmentRepository,
  firstRunAt,
  NotificationTemplateRepository,
  normalizeSchedule,
} from '@novu/dal';
import { UserSessionData } from '@novu/shared';

import { isDuplicateKey, optionalText, requiredName } from '../crm-http.utils';

export type CrmCampaignBody = {
  name?: unknown;
  description?: unknown;
  workflowKey?: unknown;
  segmentId?: unknown;
  productId?: unknown;
  excludeProductUsers?: unknown;
  payload?: unknown;
  schedule?: unknown;
};

const EDITABLE_STATUSES: CrmCampaignEntity['status'][] = ['draft', 'paused', 'completed'];

@Injectable()
export class CrmCampaignsService {
  constructor(
    private campaigns: CrmCampaignRepository,
    private runs: CrmCampaignRunRepository,
    private segments: CrmSegmentRepository,
    private products: CrmProductRepository,
    private workflows: NotificationTemplateRepository
  ) {}

  list(user: UserSessionData): Promise<CrmCampaignEntity[]> {
    return this.campaigns.list(user.environmentId);
  }

  async get(user: UserSessionData, campaignId: string): Promise<CrmCampaignEntity> {
    const campaign = await this.campaigns.findCampaign(user.environmentId, campaignId);
    if (!campaign) throw new NotFoundException('Campagne introuvable');

    return campaign;
  }

  /** Une campagne est créée en brouillon ; rien ne part avant son activation. */
  async create(user: UserSessionData, body: CrmCampaignBody): Promise<CrmCampaignEntity> {
    const name = requiredName(body.name);

    try {
      return await this.campaigns.createCampaign({
        _environmentId: user.environmentId,
        _organizationId: user.organizationId,
        name,
        description: optionalText(body.description),
        workflowKey: await this.validWorkflowKey(user, body.workflowKey),
        segmentId: await this.validSegmentId(user, body.segmentId),
        productId: await this.validProductId(user, body.productId),
        excludeProductUsers: body.excludeProductUsers === true,
        payload: this.validPayload(body.payload),
        schedule: this.validSchedule(body.schedule),
        status: 'draft',
        _createdBy: user._id,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Une campagne « ${name} » existe déjà`);
      throw error;
    }
  }

  async update(user: UserSessionData, campaignId: string, body: CrmCampaignBody): Promise<CrmCampaignEntity> {
    const campaign = await this.get(user, campaignId);
    if (!EDITABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException('Mettez la campagne en pause avant de la modifier');
    }

    const set: Partial<CrmCampaignEntity> = {};
    if (body.name !== undefined) set.name = requiredName(body.name);
    if (body.description !== undefined) set.description = optionalText(body.description);
    if (body.workflowKey !== undefined) set.workflowKey = await this.validWorkflowKey(user, body.workflowKey);
    if (body.segmentId !== undefined) set.segmentId = await this.validSegmentId(user, body.segmentId);
    if (body.productId !== undefined) set.productId = await this.validProductId(user, body.productId);
    if (body.excludeProductUsers !== undefined) set.excludeProductUsers = body.excludeProductUsers === true;
    if (body.payload !== undefined) set.payload = this.validPayload(body.payload);
    if (body.schedule !== undefined) set.schedule = this.validSchedule(body.schedule);

    try {
      const updated = await this.campaigns.updateCampaign(user.environmentId, campaignId, set);
      if (!updated) throw new NotFoundException('Campagne introuvable');

      return updated;
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Une campagne « ${set.name} » existe déjà`);
      throw error;
    }
  }

  /** Active la campagne : crm-ingest la lance à sa prochaine échéance. */
  async activate(user: UserSessionData, campaignId: string): Promise<CrmCampaignEntity> {
    const campaign = await this.get(user, campaignId);
    if (campaign.status === 'active') return campaign;

    const segment = await this.segments.findSegment(user.environmentId, campaign.segmentId);
    if (!segment || segment.status === 'deleting')
      throw new BadRequestException("Le segment de la campagne n'existe plus");
    if (segment.status !== 'ready') {
      throw new BadRequestException(
        segment.status === 'freezing'
          ? 'Le segment est en cours de figeage : réessayez dans quelques instants'
          : `Le segment n'a pas pu être figé : ${segment.error ?? 'erreur inconnue'}`
      );
    }

    const now = new Date();
    if (campaign.schedule.mode === 'scheduled' && (!campaign.schedule.at || new Date(campaign.schedule.at) <= now)) {
      throw new BadRequestException('La date de lancement est passée : modifiez la planification');
    }

    const updated = await this.campaigns.updateCampaign(user.environmentId, campaignId, {
      status: 'active',
      nextRunAt: firstRunAt({ ...campaign.schedule, at: campaign.schedule.at && new Date(campaign.schedule.at) }, now),
      error: undefined,
    });
    if (!updated) throw new NotFoundException('Campagne introuvable');

    return updated;
  }

  async pause(user: UserSessionData, campaignId: string): Promise<CrmCampaignEntity> {
    const campaign = await this.get(user, campaignId);
    if (campaign.status !== 'active')
      throw new BadRequestException('Seule une campagne active peut être mise en pause');

    const updated = await this.campaigns.updateCampaign(user.environmentId, campaignId, { status: 'paused' });
    if (!updated) throw new NotFoundException('Campagne introuvable');

    return updated;
  }

  async remove(user: UserSessionData, campaignId: string): Promise<void> {
    const campaign = await this.get(user, campaignId);
    if (campaign.status === 'active')
      throw new BadRequestException('Mettez la campagne en pause avant de la supprimer');

    await this.campaigns.deleteCampaign(user.environmentId, campaignId);
  }

  async listRuns(user: UserSessionData, campaignId: string): Promise<CrmCampaignRunEntity[]> {
    await this.get(user, campaignId);

    return this.runs.listByCampaign(user.environmentId, campaignId, 50);
  }

  private async validWorkflowKey(user: UserSessionData, value: unknown): Promise<string> {
    const key = requiredName(value, 'Le workflow');
    const workflow = await this.workflows.findByTriggerIdentifier(user.environmentId, key);
    if (!workflow) throw new BadRequestException(`Aucun workflow « ${key} » dans cet environnement`);

    return key;
  }

  /** Produit promu, facultatif. Il doit exister au catalogue : sinon la fiche produit ne la retrouverait pas. */
  private async validProductId(user: UserSessionData, value: unknown): Promise<string | undefined> {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new BadRequestException('Produit invalide');

    const product = await this.products.findByProductId(user.environmentId, value.trim());
    if (!product) throw new BadRequestException('Produit introuvable');

    return product.productId;
  }

  private async validSegmentId(user: UserSessionData, value: unknown): Promise<string> {
    if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value)) throw new BadRequestException('Segment invalide');

    const segment = await this.segments.findSegment(user.environmentId, value);
    if (!segment || segment.status === 'deleting') throw new BadRequestException('Segment introuvable');

    return value;
  }

  private validPayload(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Les données doivent être un objet');

    return value as Record<string, unknown>;
  }

  private validSchedule(value: unknown) {
    try {
      return normalizeSchedule(value, new Date());
    } catch (error) {
      if (error instanceof CrmScheduleError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
