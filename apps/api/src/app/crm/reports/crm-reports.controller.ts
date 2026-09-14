import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmReportsService } from './crm-reports.service';

@ApiExcludeController()
@Controller('/crm/reports')
@RequireAuthentication()
export class CrmReportsController {
  constructor(private reports: CrmReportsService) {}

  @Get('/overview')
  overview(@UserSession() user: UserSessionData, @Query('days') days?: string) {
    return this.reports.overview(user, days);
  }

  @Get('/campaigns/:campaignId')
  campaign(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string) {
    return this.reports.campaignReport(user, campaignId);
  }
}
