import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const LOG_CONTEXT = 'CrmQuotaRedis';

/**
 * izipush-crm — lecture des compteurs de quotas email, sur le Redis des files (REDIS_HOST), comme le worker.
 * Indépendante du cache Novu, souvent désactivé en auto-hébergé.
 */
@Injectable()
export class CrmQuotaRedis implements OnModuleDestroy {
  private client = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB_INDEX ?? 0),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  constructor() {
    this.client.on('error', (error) => Logger.warn(`Redis des quotas : ${error.message}`, LOG_CONTEXT));
  }

  isReady(): boolean {
    return this.client.status === 'ready';
  }

  async eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
    return (await this.client.eval(script, keys.length, ...keys, ...args)) as T;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
