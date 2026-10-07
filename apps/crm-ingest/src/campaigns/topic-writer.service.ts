import { Injectable } from '@nestjs/common';
import { buildDefaultSubscriptionIdentifier } from '@novu/application-generic';
import { CrmAudienceMember, TopicEntity, TopicRepository, TopicSubscribersRepository } from '@novu/dal';

const DUPLICATE_KEY = 11000;

type SubscriptionRow = { _subscriberId: unknown; externalSubscriberId: string };

/**
 * Écrit et lit les listes du CRM dans les topics Novu, directement en base et par lots
 * (l'API Novu n'accepte que 100 membres par appel).
 */
@Injectable()
export class TopicWriter {
  constructor(
    private topics: TopicRepository,
    private subscriptions: TopicSubscribersRepository
  ) {}

  async ensureTopic(environmentId: string, organizationId: string, key: string, name: string): Promise<TopicEntity> {
    const existing = await this.topics.findTopicByKey(key, organizationId, environmentId);
    if (existing) return existing;

    try {
      return await this.topics.createTopic({
        _environmentId: environmentId,
        _organizationId: organizationId,
        key,
        name,
      });
    } catch (error) {
      if ((error as { code?: number })?.code !== DUPLICATE_KEY) throw error;

      const created = await this.topics.findTopicByKey(key, organizationId, environmentId);
      if (!created) throw error;

      return created;
    }
  }

  /** Upsert : réécrire les mêmes membres (reprise après un arrêt) ne crée pas de doublon. */
  async addMembers(topic: TopicEntity, members: CrmAudienceMember[]): Promise<void> {
    if (!members.length) return;

    const result = await this.subscriptions.createSubscriptions(
      members.map((member) => ({
        _environmentId: topic._environmentId,
        _organizationId: topic._organizationId,
        _subscriberId: member._id,
        _topicId: topic._id,
        topicKey: topic.key,
        externalSubscriberId: member.subscriberId,
        identifier: buildDefaultSubscriptionIdentifier(topic.key, member.subscriberId),
      }))
    );

    if (result.failed.length) {
      throw new Error(`${result.failed.length} membre(s) non écrits dans ${topic.key} : ${result.failed[0].message}`);
    }
  }

  async *members(environmentId: string, topicKey: string, batchSize: number): AsyncGenerator<CrmAudienceMember[]> {
    const cursor = this.subscriptions._model
      .find({ _environmentId: environmentId, topicKey }, { _subscriberId: 1, externalSubscriberId: 1 })
      .lean<SubscriptionRow[]>()
      .cursor({ batchSize });

    let batch: CrmAudienceMember[] = [];
    for await (const row of cursor as AsyncIterable<SubscriptionRow>) {
      batch.push({ _id: String(row._subscriberId), subscriberId: row.externalSubscriberId });
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }

    if (batch.length) yield batch;
  }

  async isMember(environmentId: string, topicKey: string, subscriberId: string): Promise<boolean> {
    const found = await this.subscriptions._model.exists({
      _environmentId: environmentId,
      topicKey,
      externalSubscriberId: subscriberId,
    });

    return Boolean(found);
  }

  async deleteTopic(environmentId: string, organizationId: string, key: string): Promise<void> {
    await this.subscriptions._model.deleteMany({ _environmentId: environmentId, topicKey: key });
    await this.topics.deleteTopic(key, environmentId, organizationId);
  }
}
