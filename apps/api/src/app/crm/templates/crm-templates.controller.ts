import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmTemplateBody, CrmTemplatesService } from './crm-templates.service';

@ApiExcludeController()
@Controller('/crm/templates')
@RequireAuthentication()
export class CrmTemplatesController {
  constructor(private templates: CrmTemplatesService) {}

  @Get('')
  list(@UserSession() user: UserSessionData) {
    return this.templates.list(user);
  }

  @Post('')
  create(@UserSession() user: UserSessionData, @Body() body: CrmTemplateBody) {
    return this.templates.create(user, body);
  }

  @Get('/:templateId')
  get(@UserSession() user: UserSessionData, @Param('templateId') templateId: string) {
    return this.templates.get(user, templateId);
  }

  @Patch('/:templateId')
  update(@UserSession() user: UserSessionData, @Param('templateId') templateId: string, @Body() body: CrmTemplateBody) {
    return this.templates.update(user, templateId, body);
  }

  @Delete('/:templateId')
  @HttpCode(204)
  async remove(@UserSession() user: UserSessionData, @Param('templateId') templateId: string): Promise<void> {
    await this.templates.remove(user, templateId);
  }
}
