import { IEnvironment } from '@novu/shared';
import { get, post } from './api.client';

// izipush-crm — suivi de l'ingestion (routes /v1/crm/monitoring du fork).

export type CrmQueueCounts = Partial<Record<'waiting' | 'active' | 'delayed' | 'failed', number>>;

export type CrmServiceStatus = {
  updatedAt: string;
  startedAt: string;
  version?: string;
  hostname?: string;
  stale: boolean;
  rabbit: { connected: boolean; queue: string; messages?: number; consumers?: number; deadLetters?: number };
  queues: Record<string, CrmQueueCounts>;
  lastMessageAt?: string | null;
};

export type CrmIngestDaily = {
  day: string;
  eventName: string;
  accepted?: number;
  duplicate?: number;
  ignored?: number;
  invalid?: number;
};

export type CrmDeadLetter = {
  _id: string;
  reason: string;
  routingKey?: string;
  eventId?: string;
  eventType?: string;
  preview: string;
  at: string;
};

export type CrmOpsCommand = {
  _id: string;
  type: 'replay_dead_letters';
  limit: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  requestedAt: string;
  finishedAt?: string;
  result?: string;
};

export type CrmIngestion = {
  status: CrmServiceStatus | null;
  from: string;
  daily: CrmIngestDaily[];
  deadLetters: CrmDeadLetter[];
  commands: CrmOpsCommand[];
};

type WithEnvironment = { environment: IEnvironment; signal?: AbortSignal };

export async function getCrmIngestion({
  environment,
  days,
  signal,
}: WithEnvironment & { days: number }): Promise<CrmIngestion> {
  return (await get<{ data: CrmIngestion }>(`/crm/monitoring/ingestion?days=${days}`, { environment, signal })).data;
}

export async function replayCrmDeadLetters({ environment, limit }: WithEnvironment & { limit: number }) {
  return (await post<{ data: CrmOpsCommand }>('/crm/monitoring/dead-letters/replay', { environment, body: { limit } }))
    .data;
}
