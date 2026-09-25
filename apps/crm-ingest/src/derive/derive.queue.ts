import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmEventRepository } from '@novu/dal';
import { Job, Queue, Worker } from 'bullmq';

import { redisConnection } from '../shared/redis-connection';
import { CrmTenant, currentTenant } from '../pipeline/tenant';
import { DeriveService } from './derive.service';

const QUEUE_NAME = 'crm-derive';
const SWEEP_JOB_ID = 'crm-derive-sweep';
const SWEEP_EVERY_MS = 60_000;
const SWEEP_BATCH = 1000;

/**
 * Le locataire voyage AVEC la tâche.
 *
 * Il ne peut pas être relu de la configuration au moment du traitement : depuis
 * que l'enveloppe peut porter un `application_id`, deux tâches de la file
 * peuvent appartenir à deux environnements différents.
 *
 * Facultatif, pour que les tâches déjà en file au moment du déploiement
 * restent traitables : `currentTenant()` retombera alors sur la configuration.
 */
type DeriveJobData = { subscriberId: string; tenant?: CrmTenant };

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

  /** Jobs en attente, en cours, retardés, en échec : pour la page « Suivi ». */
  counts(): Promise<Record<string, number>> {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(subscriberId: string, tenant: CrmTenant = currentTenant()): Promise<void> {
    await this.queue.add('derive', { subscriberId, tenant } satisfies DeriveJobData, {
      jobId: jobIdFor(subscriberId, tenant),
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

    const { subscriberId, tenant } = job.data as DeriveJobData;
    await this.derive.process(subscriberId, tenant ?? currentTenant());
  }

  private async sweep(): Promise<void> {
    const olderThan = new Date(Date.now() - SWEEP_EVERY_MS);
    const pending = await this.events.findSubscribersWithPending(olderThan, SWEEP_BATCH);

    // Plus de filtre sur l'environnement configuré : le balayage remet en file
    // TOUT ce qui traîne, chaque ligne avec le sien. Filtrer laisserait les
    // événements des autres environnements en attente indéfiniment.
    for (const row of pending) {
      await this.enqueue(row.subscriberId, {
        environmentId: String(row.environmentId),
        organizationId: String(row.organizationId),
      });
    }

    if (pending.length) this.logger.log(`Balayage : ${pending.length} client(s) remis en recalcul`);
  }
}

/** BullMQ refuse certains caractères dans un jobId : on utilise une empreinte du client. */
function jobIdFor(subscriberId: string, tenant: CrmTenant): string {
  const digest = createHash('sha1').update(`${tenant.environmentId}|${subscriberId}`).digest('hex');

  return `sub-${digest}`;
}
