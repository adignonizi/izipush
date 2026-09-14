import { Module } from '@nestjs/common';
import { AnalyticsService } from '@novu/application-generic';
import {
  CrmEngagementRepository,
  CrmProviderUsageRepository,
  DalService,
  ExecutionDetailsRepository,
  IntegrationRepository,
  MessageRepository,
  SubscriberRepository,
} from '@novu/dal';

// izipush-crm : SubscriberRepository pour marquer les adresses en bounce ou en plainte.
const DAL_MODELS = [
  ExecutionDetailsRepository,
  MessageRepository,
  IntegrationRepository,
  SubscriberRepository,
  CrmProviderUsageRepository,
  CrmEngagementRepository,
];

const dalService = new DalService();

const PROVIDERS = [
  {
    provide: DalService,
    useFactory: async () => {
      await dalService.connect(process.env.MONGO_URL);

      return dalService;
    },
  },
  ...DAL_MODELS,
  {
    provide: AnalyticsService,
    useFactory: async () => {
      const analyticsService = new AnalyticsService(process.env.SEGMENT_TOKEN);

      await analyticsService.initialize();

      return analyticsService;
    },
  },
];

@Module({
  imports: [],
  providers: [...PROVIDERS],
  exports: [...PROVIDERS],
})
export class SharedModule {}
