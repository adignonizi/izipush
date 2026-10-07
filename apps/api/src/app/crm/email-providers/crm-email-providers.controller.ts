import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmEmailProviderBody, CrmEmailProvidersService } from './crm-email-providers.service';

@ApiExcludeController()
@Controller('/crm/email-providers')
@RequireAuthentication()
export class CrmEmailProvidersController {
  constructor(private emailProviders: CrmEmailProvidersService) {}

  @Get('')
  list(@UserSession() user: UserSessionData) {
    return this.emailProviders.list(user);
  }

  @Get('/usage')
  usage(@UserSession() user: UserSessionData, @Query('days') days?: string) {
    return this.emailProviders.dailyUsage(user, days);
  }

  @Put('/:integrationId')
  save(
    @UserSession() user: UserSessionData,
    @Param('integrationId') integrationId: string,
    @Body() body: CrmEmailProviderBody
  ) {
    return this.emailProviders.save(user, integrationId, body);
  }
}
