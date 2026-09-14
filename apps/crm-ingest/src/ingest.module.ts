import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DalServiceHealthIndicator } from '@novu/application-generic';

import { CampaignQueue } from './campaigns/campaign.queue';
import { CampaignRunner } from './campaigns/campaign-runner.service';
import { CampaignScheduler } from './campaigns/campaign-scheduler.service';
import { NovuTriggerClient } from './campaigns/novu-trigger.client';
import { OnEventCampaigns } from './campaigns/on-event-campaigns.service';
import { SegmentFreezer } from './campaigns/segment-freezer.service';
import { TopicWriter } from './campaigns/topic-writer.service';
import { DeriveQueue } from './derive/derive.queue';
import { DeriveService } from './derive/derive.service';
import { HealthController } from './health/health.controller';
import { IngestService } from './pipeline/ingest.service';
import { SharedModule } from './shared/shared.module';
import { DeadLetterController } from './sources/dead-letter.controller';
import { KeycloakWebhookController } from './sources/keycloak-webhook.controller';
import { RabbitMqConsumer } from './sources/rabbitmq.consumer';

@Module({
  imports: [SharedModule, TerminusModule],
  controllers: [KeycloakWebhookController, DeadLetterController, HealthController],
  providers: [
    IngestService,
    DeriveService,
    DeriveQueue,
    RabbitMqConsumer,
    DalServiceHealthIndicator,
    NovuTriggerClient,
    TopicWriter,
    SegmentFreezer,
    CampaignRunner,
    CampaignScheduler,
    CampaignQueue,
    OnEventCampaigns,
  ],
})
export class IngestModule {}
