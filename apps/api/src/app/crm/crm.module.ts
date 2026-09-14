import { Module } from '@nestjs/common';
import {
  CrmAudienceRepository,
  CrmCampaignRepository,
  CrmCampaignRunRepository,
  CrmEmailProviderRepository,
  CrmEmailTemplateRepository,
  CrmEngagementRepository,
  CrmOpsRepository,
  CrmProfileStateRepository,
  CrmProviderUsageRepository,
  CrmReportRepository,
  CrmSegmentRepository,
} from '@novu/dal';

import { SharedModule } from '../shared/shared.module';
import { CrmCampaignsController } from './campaigns/crm-campaigns.controller';
import { CrmCampaignsService } from './campaigns/crm-campaigns.service';
import { CrmEmailProvidersController } from './email-providers/crm-email-providers.controller';
import { CrmEmailProvidersService } from './email-providers/crm-email-providers.service';
import { CrmFieldsController } from './fields/crm-fields.controller';
import { CrmMonitoringController } from './monitoring/crm-monitoring.controller';
import { CrmMonitoringService } from './monitoring/crm-monitoring.service';
import { CrmPublicController } from './public/crm-public.controller';
import { CrmReportsController } from './reports/crm-reports.controller';
import { CrmReportsService } from './reports/crm-reports.service';
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
    CrmEmailProvidersController,
    CrmMonitoringController,
    CrmReportsController,
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
    CrmEmailProviderRepository,
    CrmProviderUsageRepository,
    CrmEmailProvidersService,
    CrmEngagementRepository,
    CrmOpsRepository,
    CrmReportRepository,
    CrmMonitoringService,
    CrmReportsService,
  ],
})
export class CrmModule {}
