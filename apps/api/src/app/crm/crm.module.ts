import { Module } from '@nestjs/common';
import {
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmCampaignRunRepository,
  CrmSegmentRepository,
} from '@novu/dal';

import { SharedModule } from '../shared/shared.module';
import { CrmCampaignsController } from './campaigns/crm-campaigns.controller';
import { CrmCampaignsService } from './campaigns/crm-campaigns.service';
import { CrmFieldsController } from './fields/crm-fields.controller';
import { CrmSegmentsController } from './segments/crm-segments.controller';
import { CrmSegmentsService } from './segments/crm-segments.service';

/**
 * izipush-crm — segments et campagnes, pour le dashboard. L'exécution (figeage, lancements, envois)
 * est faite par crm-ingest ; ce module ne fait qu'enregistrer et valider.
 */
@Module({
  imports: [SharedModule],
  controllers: [CrmFieldsController, CrmSegmentsController, CrmCampaignsController],
  providers: [
    CrmSegmentRepository,
    CrmCampaignRepository,
    CrmCampaignRunRepository,
    CrmAudienceRepository,
    CrmSegmentsService,
    CrmCampaignsService,
  ],
})
export class CrmModule {}
