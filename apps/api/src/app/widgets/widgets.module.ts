import { forwardRef, Module } from '@nestjs/common';

import { CommunityOrganizationRepository } from '@novu/dal';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integrations/integrations.module';
import { OutboundWebhooksModule } from '../outbound-webhooks/outbound-webhooks.module';
import { SharedModule } from '../shared/shared.module';
import { SubscribersV1Module } from '../subscribers/subscribersV1.module';
import { JwksService } from '../auth/services/keycloak/jwks.service';
import { WidgetSubscriberGuard } from '../auth/services/keycloak/widget-subscriber.guard';
import { USE_CASES } from './usecases';
import { WidgetsController } from './widgets.controller';

@Module({
  imports: [
    SharedModule,
    forwardRef(() => SubscribersV1Module),
    AuthModule,
    IntegrationModule,
    OutboundWebhooksModule.forRoot(),
  ],
  // JwksService est fourni ici et non globalement : son cache de cles n'a de sens que pour
  // cette garde, et le garder local evite un singleton partage dont personne ne se sert.
  providers: [...USE_CASES, CommunityOrganizationRepository, JwksService, WidgetSubscriberGuard],
  exports: [...USE_CASES],
  controllers: [WidgetsController],
})
export class WidgetsModule {}
