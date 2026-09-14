import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmSegmentBody, CrmSegmentsService } from './crm-segments.service';

@ApiExcludeController()
@Controller('/crm/segments')
@RequireAuthentication()
export class CrmSegmentsController {
  constructor(private segments: CrmSegmentsService) {}

  @Get('')
  list(@UserSession() user: UserSessionData) {
    return this.segments.list(user);
  }

  @Post('')
  create(@UserSession() user: UserSessionData, @Body() body: CrmSegmentBody) {
    return this.segments.create(user, body);
  }

  /** Nombre de clients correspondant à des conditions, sans rien enregistrer. */
  @Post('/preview')
  @HttpCode(200)
  preview(@UserSession() user: UserSessionData, @Body() body: { audience?: unknown }) {
    return this.segments.preview(user, body.audience);
  }

  @Get('/:segmentId')
  get(@UserSession() user: UserSessionData, @Param('segmentId') segmentId: string) {
    return this.segments.get(user, segmentId);
  }

  @Patch('/:segmentId')
  update(@UserSession() user: UserSessionData, @Param('segmentId') segmentId: string, @Body() body: CrmSegmentBody) {
    return this.segments.update(user, segmentId, body);
  }

  @Delete('/:segmentId')
  @HttpCode(204)
  async remove(@UserSession() user: UserSessionData, @Param('segmentId') segmentId: string): Promise<void> {
    await this.segments.remove(user, segmentId);
  }
}
