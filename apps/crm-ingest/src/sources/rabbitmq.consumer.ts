import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmOpsRepository } from '@novu/dal';
import { Channel, ChannelModel, ConsumeMessage, connect } from 'amqplib';

import { IngestCounters } from '../health/ingest-counters.service';
import { adaptRabbit } from '../pipeline/adapters';
import { IngestService } from '../pipeline/ingest.service';
import { CrmValidationError } from '../pipeline/validation';

const RECONNECT_DELAY_MS = 5000;
const TRANSIENT_RETRY_DELAY_MS = 2000;
const DEAD_LETTER_PREVIEW_CHARS = 2000;

/**
 * Consomme notre propre file, liée à l'exchange topic existant d'Izichange : les autres
 * consommateurs (MailWizz) continuent de recevoir les mêmes messages.
 * Invalide → file d'erreurs. Erreur transitoire (base indisponible) → remis en file après un délai.
 */
@Injectable()
export class RabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConsumer.name);
  private connection?: ChannelModel;
  private channel?: Channel;
  private stopping = false;

  constructor(
    private ingest: IngestService,
    private ops: CrmOpsRepository,
    private counters: IngestCounters
  ) {}

  async onModuleInit(): Promise<void> {
    void this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  isConnected(): boolean {
    return Boolean(this.channel);
  }

  /** État de nos files, pour la page « Suivi » (compte des messages en attente). */
  async stats(): Promise<{
    connected: boolean;
    queue: string;
    messages?: number;
    consumers?: number;
    deadLetters?: number;
  }> {
    if (!this.channel) return { connected: false, queue: this.queue };

    const [queue, deadLetters] = await Promise.all([
      this.channel.checkQueue(this.queue),
      this.channel.checkQueue(this.deadLetterQueue),
    ]);

    return {
      connected: true,
      queue: this.queue,
      messages: queue.messageCount,
      consumers: queue.consumerCount,
      deadLetters: deadLetters.messageCount,
    };
  }

  /** Remet dans notre file jusqu'à `limit` messages de la file d'erreurs. */
  async replayDeadLetters(limit: number): Promise<number> {
    if (!this.channel) throw new Error('RabbitMQ non connecté');

    let replayed = 0;
    while (replayed < limit) {
      const message = await this.channel.get(this.deadLetterQueue, { noAck: false });
      if (!message) break;

      this.channel.sendToQueue(this.queue, message.content, {
        persistent: true,
        contentType: message.properties.contentType,
        headers: { ...message.properties.headers, 'x-crm-replayed': true },
      });
      this.channel.ack(message);
      replayed++;
    }

    return replayed;
  }

  private async connectWithRetry(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.start();

        return;
      } catch (error) {
        this.logger.warn(`Connexion RabbitMQ impossible (${(error as Error).message}) — nouvel essai dans 5 s`);
        await sleep(RECONNECT_DELAY_MS);
      }
    }
  }

  private async start(): Promise<void> {
    const connection = await connect(process.env.AMQP_URL);
    const channel = await connection.createChannel();

    connection.on('close', () => {
      this.channel = undefined;
      if (!this.stopping) {
        this.logger.warn('Connexion RabbitMQ perdue — reconnexion');
        void this.connectWithRetry();
      }
    });
    connection.on('error', (error) => this.logger.warn(`Erreur RabbitMQ : ${error.message}`));

    const deadLetterExchange = `${this.queue}.dlx`;
    await channel.assertExchange(process.env.AMQP_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(deadLetterExchange, 'fanout', { durable: true });
    await channel.assertQueue(this.deadLetterQueue, { durable: true });
    await channel.bindQueue(this.deadLetterQueue, deadLetterExchange, '');
    await channel.assertQueue(this.queue, { durable: true, deadLetterExchange });

    for (const pattern of bindings()) {
      await channel.bindQueue(this.queue, process.env.AMQP_EXCHANGE, pattern);
    }

    await channel.prefetch(Number(process.env.AMQP_PREFETCH));
    await channel.consume(this.queue, (message) => {
      if (message) void this.handle(channel, message);
    });

    this.connection = connection;
    this.channel = channel;
    this.logger.log(`Consomme ${this.queue} ← ${process.env.AMQP_EXCHANGE} [${bindings().join(', ')}]`);
  }

  private async handle(channel: Channel, message: ConsumeMessage): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(message.content.toString('utf8'));
    } catch {
      return this.deadLetter(channel, message, 'message non JSON');
    }

    const adapted = adaptRabbit(body);
    if (adapted.kind === 'invalid') return this.deadLetter(channel, message, adapted.reason);
    if (adapted.kind === 'ignored') return channel.ack(message);

    try {
      await this.ingest.ingest(adapted.event);
      channel.ack(message);
    } catch (error) {
      if (error instanceof CrmValidationError) return this.deadLetter(channel, message, error.message);

      this.logger.warn(`Ingestion reportée (${(error as Error).message})`);
      setTimeout(() => channel.nack(message, false, true), TRANSIENT_RETRY_DELAY_MS);
    }
  }

  private deadLetter(channel: Channel, message: ConsumeMessage, reason: string): void {
    this.logger.warn(`Message rejeté vers la file d'erreurs : ${reason}`);
    channel.nack(message, false, false);

    const content = message.content.toString('utf8');
    const parsed = safeJson(content);
    this.counters.add('invalid', typeof parsed?.eventType === 'string' ? parsed.eventType : message.fields.routingKey);
    this.ops
      .recordDeadLetter({
        reason,
        routingKey: message.fields.routingKey,
        eventId: typeof parsed?.eventId === 'string' ? parsed.eventId : undefined,
        eventType: typeof parsed?.eventType === 'string' ? parsed.eventType : undefined,
        preview: content.slice(0, DEAD_LETTER_PREVIEW_CHARS),
      })
      .catch((error) => this.logger.warn(`Rejet non journalisé : ${(error as Error).message}`));
  }

  private get queue(): string {
    return process.env.AMQP_QUEUE;
  }

  private get deadLetterQueue(): string {
    return `${this.queue}.dlq`;
  }
}

function bindings(): string[] {
  return process.env.AMQP_BINDINGS.split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function safeJson(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(content);

    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
