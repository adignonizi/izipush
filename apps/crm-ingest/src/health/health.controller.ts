import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { DalServiceHealthIndicator } from '@novu/application-generic';

import { version } from '../../package.json';
import { RabbitMqConsumer } from '../sources/rabbitmq.consumer';

@Controller('v1/health-check')
export class HealthController {
  constructor(
    private healthCheckService: HealthCheckService,
    private healthIndicatorService: HealthIndicatorService,
    private dalHealthIndicator: DalServiceHealthIndicator,
    private consumer: RabbitMqConsumer
  ) {}

  @Get()
  @HealthCheck()
  async healthCheck(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      async () => ({ apiVersion: { version, status: 'up' } }),
      () => this.dalHealthIndicator.isHealthy(),
      async () => {
        const indicator = this.healthIndicatorService.check('rabbitmq');

        return this.consumer.isConnected() ? indicator.up() : indicator.down({ message: 'non connecté' });
      },
    ]);
  }
}
