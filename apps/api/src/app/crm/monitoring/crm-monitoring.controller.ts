import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmMonitoringService } from './crm-monitoring.service';

@ApiExcludeController()
@Controller('/crm/monitoring')
@RequireAuthentication()
export class CrmMonitoringController {
  constructor(private monitoring: CrmMonitoringService) {}

  @Get('/ingestion')
  ingestion(@Query('days') days?: string) {
    return this.monitoring.ingestion(days);
  }

  @Post('/dead-letters/replay')
  @HttpCode(200)
  replay(@UserSession() user: UserSessionData, @Body() body: { limit?: unknown }) {
    return this.monitoring.replayDeadLetters(user, body?.limit);
  }
}
