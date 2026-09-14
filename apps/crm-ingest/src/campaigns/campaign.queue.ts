import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmCampaignRunRepository, CrmSegmentRepository } from '@novu/dal';
import { Job, Queue, Worker } from 'bullmq';

import { redisConnection } from '../shared/redis-connection';
import { CampaignRunner } from './campaign-runner.service';
import { CampaignScheduler } from './campaign-scheduler.service';
import { SegmentFreezer } from './segment-freezer.service';

const QUEUE_NAME = 'crm-campaigns';
const TICK_JOB_ID = 'crm-campaigns-tick';
const MAX_CLAIMS_PER_TICK = 10;

type WorkJob = { id: string; environmentId?: string };

/**
 * File des traitements longs du CRM, séparée du recalcul client pour ne jamais le retarder.
 * Un balayage périodique (« tick ») prend les échéances, les segments à figer ou à supprimer,
 * les exécutions à faire avancer, et purge les listes expirées.
 */
@Injectable()
export class CampaignQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignQueue.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private scheduler: CampaignScheduler,
    private runner: CampaignRunner,
    private freezer: SegmentFreezer,
    private runs: CrmCampaignRunRepository,
    private segments: CrmSegmentRepository
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.handle(job), {
      connection,
      // +1 : le balayage ne doit jamais attendre derrière une longue exécution.
      concurrency: Number(process.env.CRM_CAMPAIGN_CONCURRENCY) + 1,
    });
    this.worker.on('failed', (job, error) => this.logger.warn(`Traitement ${job?.name} en échec : ${error.message}`));

    await this.queue.add(
      'tick',
      {},
      {
        jobId: TICK_JOB_ID,
        repeat: { every: Number(process.env.CRM_TICK_MS) },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async handle(job: Job): Promise<void> {
    const data = job.data as WorkJob;

    switch (job.name) {
      case 'tick':
        return this.tick();
      case 'run': {
        const run = await this.runs.findRun(data.id);
        if (run) await this.runner.process(run);

        return;
      }
      case 'freeze':
      case 'delete-segment': {
        const segment = await this.segments.findSegment(data.environmentId as string, data.id);
        if (!segment) return;

        return job.name === 'freeze' ? this.freezer.freeze(segment) : this.freezer.delete(segment);
      }
      default:
        this.logger.warn(`Traitement inconnu : ${job.name}`);
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();

    await this.scheduler.initRecurring(now);
    await this.scheduler.createDueRuns(now);

    for (let i = 0; i < MAX_CLAIMS_PER_TICK; i++) {
      const run = await this.runs.claimPending(now);
      if (!run) break;
      await this.enqueue('run', { id: run._id }, `run-${run._id}`);
    }

    for (const [status, jobName] of [
      ['freezing', 'freeze'],
      ['deleting', 'delete-segment'],
    ] as const) {
      for (let i = 0; i < MAX_CLAIMS_PER_TICK; i++) {
        const segment = await this.segments.claimWork(status, now);
        if (!segment) break;
        await this.enqueue(
          jobName,
          { id: segment._id, environmentId: String(segment._environmentId) },
          `${jobName}-${segment._id}`
        );
      }
    }

    await this.scheduler.purgeRunTopics(now);
  }

  private async enqueue(name: string, data: WorkJob, jobId: string): Promise<void> {
    await this.queue.add(name, data, { jobId, removeOnComplete: true, removeOnFail: true });
  }
}
