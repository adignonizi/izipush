import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CrmAudienceError,
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmConditionGroup,
  CrmSegmentEntity,
  CrmSegmentRepository,
  compileAudience,
} from '@novu/dal';
import { UserSessionData } from '@novu/shared';

import { isDuplicateKey, optionalText, requiredName } from '../crm-http.utils';

export type CrmSegmentBody = {
  name?: unknown;
  description?: unknown;
  audience?: unknown;
  frozen?: unknown;
};

@Injectable()
export class CrmSegmentsService {
  constructor(
    private segments: CrmSegmentRepository,
    private campaigns: CrmCampaignRepository,
    private audience: CrmAudienceRepository
  ) {}

  list(user: UserSessionData): Promise<CrmSegmentEntity[]> {
    return this.segments.list(user.environmentId);
  }

  async get(user: UserSessionData, segmentId: string): Promise<CrmSegmentEntity> {
    const segment = await this.segments.findSegment(user.environmentId, segmentId);
    if (!segment || segment.status === 'deleting') throw new NotFoundException('Segment introuvable');

    return segment;
  }

  /** Figeage en échec : crm-ingest reprend la photographie (les membres déjà écrits le sont à nouveau, sans doublon). */
  async retryFreeze(user: UserSessionData, segmentId: string): Promise<CrmSegmentEntity> {
    const segment = await this.get(user, segmentId);
    if (!segment.frozen || segment.status !== 'failed') {
      throw new ConflictException('Seul un segment figé dont le figeage a échoué peut être relancé');
    }

    await this.segments.updateSegment(user.environmentId, segmentId, {
      status: 'freezing',
      error: '',
      lockedUntil: null,
    });

    return this.get(user, segmentId);
  }

  /** Un segment figé part en « freezing » : crm-ingest photographie la liste puis le passe en « ready ». */
  async create(user: UserSessionData, body: CrmSegmentBody): Promise<CrmSegmentEntity> {
    const name = requiredName(body.name);
    const frozen = body.frozen === true;

    try {
      return await this.segments.createSegment({
        _environmentId: user.environmentId,
        _organizationId: user.organizationId,
        name,
        description: optionalText(body.description),
        audience: this.validAudience(body.audience),
        frozen,
        status: frozen ? 'freezing' : 'ready',
        _createdBy: user._id,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Un segment « ${name} » existe déjà`);
      throw error;
    }
  }

  async preview(user: UserSessionData, audience: unknown): Promise<{ count: number }> {
    return { count: await this.audience.count(user.environmentId, this.validAudience(audience)) };
  }

  async update(user: UserSessionData, segmentId: string, body: CrmSegmentBody): Promise<CrmSegmentEntity> {
    const segment = await this.get(user, segmentId);
    const set: Partial<CrmSegmentEntity> = {};

    if (body.name !== undefined) set.name = requiredName(body.name);
    if (body.description !== undefined) set.description = optionalText(body.description);
    if (body.audience !== undefined) {
      if (segment.frozen) throw new BadRequestException('Un segment figé ne se modifie pas : créez-en un nouveau');
      set.audience = this.validAudience(body.audience);
    }

    try {
      const updated = await this.segments.updateSegment(user.environmentId, segmentId, set);
      if (!updated) throw new NotFoundException('Segment introuvable');

      return updated;
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Un segment « ${set.name} » existe déjà`);
      throw error;
    }
  }

  /** Un segment figé porte un topic : crm-ingest le supprime avant d'effacer le segment. */
  async remove(user: UserSessionData, segmentId: string): Promise<void> {
    const segment = await this.get(user, segmentId);

    if (await this.campaigns.countBySegment(user.environmentId, segmentId)) {
      throw new ConflictException("Ce segment est utilisé par une campagne : supprimez d'abord la campagne");
    }

    if (segment.frozen) {
      await this.segments.updateSegment(user.environmentId, segmentId, { status: 'deleting', lockedUntil: null });
    } else {
      await this.segments.deleteSegment(user.environmentId, segmentId);
    }
  }

  private validAudience(input: unknown): CrmConditionGroup {
    try {
      compileAudience(input as CrmConditionGroup, new Date());

      return input as CrmConditionGroup;
    } catch (error) {
      if (error instanceof CrmAudienceError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
