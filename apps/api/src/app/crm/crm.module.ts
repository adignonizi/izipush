import { Module } from '@nestjs/common';
import {
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmCampaignRunRepository,
  CrmEmailTemplateRepository,
  CrmProfileStateRepository,
  CrmSegmentRepository,
} from '@novu/dal';

import { SharedModule } from '../shared/shared.module';
import { CrmCampaignsController } from './campaigns/crm-campaigns.controller';
import { CrmCampaignsService } from './campaigns/crm-campaigns.service';
import { CrmFieldsController } from './fields/crm-fields.controller';
import { CrmPublicController } from './public/crm-public.controller';
import { CrmSegmentsController } from './segments/crm-segments.controller';
import { CrmSegmentsService } from './segments/crm-segments.service';
import { CrmTemplatesController } from './templates/crm-templates.controller';
import { CrmTemplatesService } from './templates/crm-templates.service';

/**
 * izipush-crm — segments et campagnes, pour le dashboard. L'exécution (figeage, lancements, envois)
 * est faite par crm-ingest ; ce module ne fait qu'enregistrer et valider.
 */
@Module({
  imports: [SharedModule],
  controllers: [
    CrmFieldsController,
    CrmSegmentsController,
    CrmCampaignsController,
    CrmTemplatesController,
    CrmPublicController,
  ],
  providers: [
    CrmSegmentRepository,
    CrmCampaignRepository,
    CrmCampaignRunRepository,
    CrmAudienceRepository,
    CrmSegmentsService,
    CrmCampaignsService,
    CrmEmailTemplateRepository,
    CrmTemplatesService,
    CrmProfileStateRepository,
  ],
})
export class CrmModule {}
