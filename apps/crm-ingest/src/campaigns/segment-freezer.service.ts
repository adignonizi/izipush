import { Injectable, Logger } from '@nestjs/common';
import { CrmAudienceRepository, CrmSegmentEntity, CrmSegmentRepository } from '@novu/dal';

import { TopicWriter } from './topic-writer.service';

const BATCH_SIZE = 1000;

export function segmentTopicKey(segment: Pick<CrmSegmentEntity, '_id' | 'topicKey'>): string {
  return segment.topicKey ?? `segment:${segment._id}`;
}

/** Photographie la liste d'un segment figé dans le topic segment:{id}, et la supprime avec le segment. */
@Injectable()
export class SegmentFreezer {
  private readonly logger = new Logger(SegmentFreezer.name);

  constructor(
    private segments: CrmSegmentRepository,
    private audience: CrmAudienceRepository,
    private topics: TopicWriter
  ) {}

  async freeze(segment: CrmSegmentEntity): Promise<void> {
    const environmentId = String(segment._environmentId);
    const topicKey = segmentTopicKey(segment);

    try {
      const topic = await this.topics.ensureTopic(
        environmentId,
        String(segment._organizationId),
        topicKey,
        `Segment figé — ${segment.name}`
      );

      let memberCount = 0;
      for await (const batch of this.audience.iterate(environmentId, segment.audience, { batchSize: BATCH_SIZE })) {
        await this.topics.addMembers(topic, batch);
        memberCount += batch.length;
      }

      await this.segments.updateSegment(environmentId, segment._id, {
        status: 'ready',
        memberCount,
        frozenAt: new Date(),
        topicKey,
        lockedUntil: null,
      });
      this.logger.log(`Segment « ${segment.name} » figé : ${memberCount} client(s)`);
    } catch (error) {
      const message = (error as Error).message;

      await this.segments.updateSegment(environmentId, segment._id, {
        status: 'failed',
        error: message,
        lockedUntil: null,
      });
      this.logger.warn(`Figeage du segment « ${segment.name} » en échec : ${message}`);
    }
  }

  async delete(segment: CrmSegmentEntity): Promise<void> {
    const environmentId = String(segment._environmentId);

    await this.topics.deleteTopic(environmentId, String(segment._organizationId), segmentTopicKey(segment));
    await this.segments.deleteSegment(environmentId, segment._id);
  }
}
