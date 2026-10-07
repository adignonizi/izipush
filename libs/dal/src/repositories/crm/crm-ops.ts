import mongoose, { Schema } from 'mongoose';

import { registerCrmModel } from './crm-indexes';

/**
 * izipush-crm — exploitation de crm-ingest, lue par la page « Suivi » du dashboard :
 * état du service (battement toutes les 30 s), événements rejetés, commandes (relecture de la file d'erreurs)
 * et compteurs quotidiens d'ingestion. Un seul crm-ingest par installation : pas de découpage par environnement.
 */
export type CrmQueueCounts = Partial<Record<'waiting' | 'active' | 'delayed' | 'failed' | 'prioritized', number>>;

export type CrmServiceStatus = {
  _id: string;
  updatedAt: Date;
  startedAt: Date;
  version?: string;
  hostname?: string;
  rabbit: { connected: boolean; queue: string; messages?: number; consumers?: number; deadLetters?: number };
  queues: Record<string, CrmQueueCounts>;
  lastMessageAt?: Date | null;
};

export type CrmDeadLetter = {
  _id: string;
  reason: string;
  routingKey?: string;
  eventId?: string;
  eventType?: string;
  /** Début du message, pour comprendre le rejet (tronqué). */
  preview: string;
  at: Date;
};

export type CrmOpsCommandStatus = 'pending' | 'running' | 'done' | 'failed';

export type CrmOpsCommand = {
  _id: string;
  type: 'replay_dead_letters';
  limit: number;
  status: CrmOpsCommandStatus;
  requestedBy?: string;
  requestedAt: Date;
  finishedAt?: Date;
  result?: string;
};

export type CrmIngestOutcome = 'accepted' | 'duplicate' | 'ignored' | 'invalid';

export type CrmIngestDaily = { day: string; eventName: string } & Partial<Record<CrmIngestOutcome, number>>;

const DEAD_LETTER_TTL_SECONDS = 30 * 24 * 3600;

const serviceStatusSchema = new Schema<CrmServiceStatus>(
  {
    _id: { type: Schema.Types.String, required: true },
    updatedAt: Date,
    startedAt: Date,
    version: String,
    hostname: String,
    rabbit: Schema.Types.Mixed,
    queues: Schema.Types.Mixed,
    lastMessageAt: Date,
  },
  { collection: 'crm_service_status', versionKey: false, minimize: false }
);

const deadLetterSchema = new Schema<Omit<CrmDeadLetter, '_id'>>(
  {
    reason: { type: String, required: true },
    routingKey: String,
    eventId: String,
    eventType: String,
    preview: String,
    at: { type: Date, required: true },
  },
  { collection: 'crm_dead_letters', versionKey: false }
);
deadLetterSchema.index({ at: 1 }, { name: 'crm_dead_letters_ttl', expireAfterSeconds: DEAD_LETTER_TTL_SECONDS });

const commandSchema = new Schema<Omit<CrmOpsCommand, '_id'>>(
  {
    type: { type: String, required: true },
    limit: Number,
    status: { type: String, required: true },
    requestedBy: String,
    requestedAt: { type: Date, required: true },
    finishedAt: Date,
    result: String,
  },
  { collection: 'crm_ops_commands', versionKey: false }
);
commandSchema.index({ status: 1, requestedAt: 1 }, { name: 'crm_ops_commands_pending' });

const ingestDailySchema = new Schema<CrmIngestDaily>(
  {
    day: { type: String, required: true },
    eventName: { type: String, required: true },
    accepted: Number,
    duplicate: Number,
    ignored: Number,
    invalid: Number,
  },
  { collection: 'crm_ingest_daily', versionKey: false }
);
ingestDailySchema.index({ day: 1, eventName: 1 }, { name: 'crm_ingest_daily_unique', unique: true });

// Typage volontairement lâche : l'inférence des types Mongoose sur ces schémas fait exploser la mémoire de tsc.
const model = <T>(name: string, schema: Schema<any>): mongoose.Model<T> =>
  registerCrmModel(
    (mongoose.models[name] as mongoose.Model<T>) || (mongoose.model(name, schema) as unknown as mongoose.Model<T>)
  );

export const CrmServiceStatusModel = model<CrmServiceStatus>('CrmServiceStatus', serviceStatusSchema);
export const CrmDeadLetterModel = model<CrmDeadLetter>('CrmDeadLetter', deadLetterSchema);
export const CrmOpsCommandModel = model<CrmOpsCommand>('CrmOpsCommand', commandSchema);
export const CrmIngestDailyModel = model<CrmIngestDaily>('CrmIngestDaily', ingestDailySchema);

const withStringId = <T>(doc: unknown): T => ({ ...(doc as object), _id: String((doc as { _id: unknown })._id) }) as T;

export class CrmOpsRepository {
  async reportStatus(status: Omit<CrmServiceStatus, 'updatedAt'>): Promise<void> {
    await CrmServiceStatusModel.updateOne(
      { _id: status._id },
      { $set: { ...status, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async getStatus(id: string): Promise<CrmServiceStatus | null> {
    return (await CrmServiceStatusModel.findById(id).lean()) as CrmServiceStatus | null;
  }

  async recordDeadLetter(deadLetter: Omit<CrmDeadLetter, '_id' | 'at'>): Promise<void> {
    await CrmDeadLetterModel.create({ ...deadLetter, at: new Date() });
  }

  async listDeadLetters(limit: number): Promise<CrmDeadLetter[]> {
    const docs = await CrmDeadLetterModel.find().sort({ at: -1 }).limit(limit).lean();

    return docs.map((doc) => withStringId<CrmDeadLetter>(doc));
  }

  async requestCommand(command: Pick<CrmOpsCommand, 'type' | 'limit' | 'requestedBy'>): Promise<CrmOpsCommand> {
    const doc = await CrmOpsCommandModel.create({ ...command, status: 'pending', requestedAt: new Date() });

    return withStringId<CrmOpsCommand>(doc.toObject());
  }

  async listCommands(limit: number): Promise<CrmOpsCommand[]> {
    const docs = await CrmOpsCommandModel.find().sort({ requestedAt: -1 }).limit(limit).lean();

    return docs.map((doc) => withStringId<CrmOpsCommand>(doc));
  }

  /** crm-ingest : prend la plus ancienne commande en attente. */
  async claimCommand(): Promise<CrmOpsCommand | null> {
    const doc = await CrmOpsCommandModel.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'running' } },
      { sort: { requestedAt: 1 }, new: true }
    ).lean();

    return doc ? withStringId<CrmOpsCommand>(doc) : null;
  }

  async finishCommand(id: string, status: Extract<CrmOpsCommandStatus, 'done' | 'failed'>, result: string) {
    await CrmOpsCommandModel.updateOne({ _id: id }, { $set: { status, result, finishedAt: new Date() } });
  }

  async addIngestCounts(counts: { day: string; eventName: string; outcome: CrmIngestOutcome; count: number }[]) {
    if (!counts.length) return;

    await CrmIngestDailyModel.bulkWrite(
      counts.map(({ day, eventName, outcome, count }) => ({
        updateOne: { filter: { day, eventName }, update: { $inc: { [outcome]: count } }, upsert: true },
      })),
      { ordered: false }
    );
  }

  async ingestDaily(fromDay: string): Promise<CrmIngestDaily[]> {
    return (await CrmIngestDailyModel.find({ day: { $gte: fromDay } }, { _id: 0 })
      .sort({ day: 1 })
      .lean()) as CrmIngestDaily[];
  }
}
