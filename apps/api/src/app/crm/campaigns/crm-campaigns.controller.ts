import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmCampaignBody, CrmCampaignsService } from './crm-campaigns.service';

@ApiExcludeController()
@Controller('/crm/campaigns')
@RequireAuthentication()
export class CrmCampaignsController {
  constructor(private campaigns: CrmCampaignsService) {}

  @Get('')
  list(@UserSession() user: UserSessionData) {
    return this.campaigns.list(user);
  }

  @Post('')
  create(@UserSession() user: UserSessionData, @Body() body: CrmCampaignBody) {
    return this.campaigns.create(user, body);
  }

  @Get('/:campaignId')
  get(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string) {
    return this.campaigns.get(user, campaignId);
  }

  @Patch('/:campaignId')
  update(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string, @Body() body: CrmCampaignBody) {
    return this.campaigns.update(user, campaignId, body);
  }

  @Post('/:campaignId/activate')
  @HttpCode(200)
  activate(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string) {
    return this.campaigns.activate(user, campaignId);
  }

  @Post('/:campaignId/pause')
  @HttpCode(200)
  pause(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string) {
    return this.campaigns.pause(user, campaignId);
  }

  @Delete('/:campaignId')
  @HttpCode(204)
  async remove(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string): Promise<void> {
    await this.campaigns.remove(user, campaignId);
  }

  @Get('/:campaignId/runs')
  listRuns(@UserSession() user: UserSessionData, @Param('campaignId') campaignId: string) {
    return this.campaigns.listRuns(user, campaignId);
  }
}
