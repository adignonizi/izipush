import { Controller, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';

import { RabbitMqConsumer } from './rabbitmq.consumer';

const MAX_REPLAY = 1000;

/** Relecture de la file d'erreurs, une fois la cause corrigée. Protégée par CRM_ADMIN_TOKEN. */
@Controller('v1/crm-ingest/dead-letters')
export class DeadLetterController {
  constructor(private consumer: RabbitMqConsumer) {}

  @Post('replay')
  @HttpCode(200)
  async replay(
    @Headers('x-crm-admin-token') token?: string,
    @Query('limit') limit = '100'
  ): Promise<{ replayed: number }> {
    if (!process.env.CRM_ADMIN_TOKEN || token !== process.env.CRM_ADMIN_TOKEN) {
      throw new UnauthorizedException();
    }

    const requested = Math.min(Math.max(Number.parseInt(limit, 10) || 0, 0), MAX_REPLAY);

    return { replayed: await this.consumer.replayDeadLetters(requested) };
  }
}
