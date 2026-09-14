import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmEventRepository } from '@novu/dal';
import { Job, Queue, Worker } from 'bullmq';

import { redisConnection } from '../shared/redis-connection';
import { DeriveService } from './derive.service';

const QUEUE_NAME = 'crm-derive';
const SWEEP_JOB_ID = 'crm-derive-sweep';
const SWEEP_EVERY_MS = 60_000;
const SWEEP_BATCH = 1000;

type DeriveJobData = { subscriberId: string };

/**
 * File BullMQ du recalcul client. Un seul job par client à la fois (jobId dérivé du client) :
 * les recalculs d'un même client ne se chevauchent jamais. Un balayage périodique rattrape
 * les événements restés en attente (job en échec, événement arrivé pendant un recalcul en cours).
 */
@Injectable()
export class DeriveQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeriveQueue.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private derive: DeriveService,
    private events: CrmEventRepository
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.handle(job), {
      connection,
      concurrency: Number(process.env.CRM_DERIVE_CONCURRENCY),
    });
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Recalcul en échec (${job?.name} ${JSON.stringify(job?.data)}) : ${error.message}`)
    );

    await this.queue.add(
      'sweep',
      {},
      { jobId: SWEEP_JOB_ID, repeat: { every: SWEEP_EVERY_MS }, removeOnComplete: true, removeOnFail: true }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(subscriberId: string): Promise<void> {
    await this.queue.add('derive', { subscriberId } satisfies DeriveJobData, {
      jobId: jobIdFor(subscriberId),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  private async handle(job: Job): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweep();

      return;
    }

    await this.derive.process((job.data as DeriveJobData).subscriberId);
  }

  private async sweep(): Promise<void> {
    const olderThan = new Date(Date.now() - SWEEP_EVERY_MS);
    const pending = await this.events.findSubscribersWithPending(olderThan, SWEEP_BATCH);
    const ours = pending.filter((row) => row.environmentId === process.env.CRM_ENVIRONMENT_ID);

    for (const { subscriberId } of ours) await this.enqueue(subscriberId);

    if (ours.length) this.logger.log(`Balayage : ${ours.length} client(s) remis en recalcul`);
  }
}

/** BullMQ refuse certains caractères dans un jobId : on utilise une empreinte du client. */
function jobIdFor(subscriberId: string): string {
  const digest = createHash('sha1').update(`${process.env.CRM_ENVIRONMENT_ID}|${subscriberId}`).digest('hex');

  return `sub-${digest}`;
}
