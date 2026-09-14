import type { ConnectionOptions } from 'bullmq';

/** Connexion Redis des files BullMQ du CRM. */
export function redisConnection(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB_INDEX),
    maxRetriesPerRequest: null,
  };
}
