import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CRM_ACTIVITY_METRICS, CRM_EVENT_NAMES, CRM_OPERATORS_BY_TYPE, CRM_PROFILE_FIELDS } from '@novu/dal';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';

/** Ce que le constructeur de segments et de campagnes peut proposer. */
@ApiExcludeController()
@Controller('/crm/fields')
@RequireAuthentication()
export class CrmFieldsController {
  @Get('')
  list() {
    return {
      profile: CRM_PROFILE_FIELDS.map((field) => ({ ...field, operators: CRM_OPERATORS_BY_TYPE[field.type] })),
      activity: { metrics: CRM_ACTIVITY_METRICS, operators: ['gt', 'gte'] },
      events: CRM_EVENT_NAMES,
    };
  }
}
