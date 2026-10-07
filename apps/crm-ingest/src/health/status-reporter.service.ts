import { hostname } from 'node:os';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmOpsRepository } from '@novu/dal';

import { version } from '../../package.json';
import { CampaignQueue } from '../campaigns/campaign.queue';
import { DeriveQueue } from '../derive/derive.queue';
import { RabbitMqConsumer } from '../sources/rabbitmq.consumer';
import { IngestCounters } from './ingest-counters.service';

const REPORT_INTERVAL_MS = 30_000;
export const CRM_INGEST_SERVICE_ID = 'crm-ingest';

/**
 * Battement de crm-ingest pour la page « Suivi » : état RabbitMQ et des files, compteurs d'ingestion ;
 * exécute aussi les commandes demandées depuis le dashboard (relecture de la file d'erreurs).
 */
@Injectable()
export class StatusReporter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusReporter.name);
  private readonly startedAt = new Date();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private ops: CrmOpsRepository,
    private counters: IngestCounters,
    private consumer: RabbitMqConsumer,
    private deriveQueue: DeriveQueue,
    private campaignQueue: CampaignQueue
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), REPORT_INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flushCounts();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.flushCounts();
      await this.report();
      await this.runCommands();
    } catch (error) {
      this.logger.warn(`Battement non enregistré : ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async flushCounts(): Promise<void> {
    const counts = this.counters.drain();

    try {
      await this.ops.addIngestCounts(counts);
    } catch (error) {
      this.counters.restore(counts);
      throw error;
    }
  }

  private async report(): Promise<void> {
    const [rabbit, derive, campaigns] = await Promise.all([
      this.consumer.stats(),
      this.deriveQueue.counts().catch(() => ({})),
      this.campaignQueue.counts().catch(() => ({})),
    ]);

    await this.ops.reportStatus({
      _id: CRM_INGEST_SERVICE_ID,
      startedAt: this.startedAt,
      version,
      hostname: hostname(),
      rabbit,
      queues: { derive, campaigns },
      lastMessageAt: this.counters.lastMessageAt,
    });
  }

  private async runCommands(): Promise<void> {
    for (let command = await this.ops.claimCommand(); command; command = await this.ops.claimCommand()) {
      try {
        const replayed = await this.consumer.replayDeadLetters(command.limit);
        await this.ops.finishCommand(command._id, 'done', `${replayed} message(s) remis dans la file`);
        this.logger.log(`File d'erreurs : ${replayed} message(s) rejoué(s) (demande du dashboard)`);
      } catch (error) {
        await this.ops.finishCommand(command._id, 'failed', (error as Error).message);
      }
    }
  }
}
