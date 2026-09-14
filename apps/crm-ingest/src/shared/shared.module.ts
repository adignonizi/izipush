import { Module } from '@nestjs/common';
import { cacheService, InvalidateCacheService } from '@novu/application-generic';
import {
  CrmActivityDailyRepository,
  CrmEventRepository,
  CrmProfileStateRepository,
  DalService,
  ensureCrmIndexes,
  SubscriberRepository,
} from '@novu/dal';

const DAL_MODELS = [CrmEventRepository, CrmActivityDailyRepository, CrmProfileStateRepository, SubscriberRepository];

const dalService = new DalService();

const PROVIDERS = [
  {
    provide: DalService,
    useFactory: async () => {
      await dalService.connect(process.env.MONGO_URL);
      // Avant tout événement : l'index unique sur eventId garantit le dédoublonnage.
      await ensureCrmIndexes();

      return dalService;
    },
  },
  ...DAL_MODELS,
  cacheService,
  InvalidateCacheService,
];

@Module({
  imports: [],
  providers: [...PROVIDERS],
  exports: [...PROVIDERS],
})
export class SharedModule {}
