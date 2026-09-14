import { Injectable } from '@nestjs/common';
import { CrmOpsRepository } from '@novu/dal';
import { UserSessionData } from '@novu/shared';

/** crm-ingest bat toutes les 30 s : au-delà de 90 s sans nouvelles, il est signalé comme arrêté. */
const STALE_AFTER_MS = 90_000;
const CRM_INGEST_SERVICE_ID = 'crm-ingest';

@Injectable()
export class CrmMonitoringService {
  constructor(private ops: CrmOpsRepository) {}

  async ingestion(days: unknown) {
    const span = Math.min(30, Math.max(1, Math.floor(Number(days) || 14)));
    const from = new Date(Date.now() - (span - 1) * 86_400_000).toISOString().slice(0, 10);

    const [status, daily, deadLetters, commands] = await Promise.all([
      this.ops.getStatus(CRM_INGEST_SERVICE_ID),
      this.ops.ingestDaily(from),
      this.ops.listDeadLetters(50),
      this.ops.listCommands(10),
    ]);
    const silentForMs = status ? Date.now() - new Date(status.updatedAt).getTime() : null;

    return {
      status: status ? { ...status, stale: (silentForMs ?? 0) > STALE_AFTER_MS } : null,
      from,
      daily,
      deadLetters,
      commands,
    };
  }

  /** Demande à crm-ingest de remettre des messages de la file d'erreurs dans la file (exécuté sous 30 s). */
  replayDeadLetters(user: UserSessionData, limit: unknown) {
    const count = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 100)));

    return this.ops.requestCommand({ type: 'replay_dead_letters', limit: count, requestedBy: user._id });
  }
}
