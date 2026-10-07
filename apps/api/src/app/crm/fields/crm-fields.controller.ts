import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  CRM_ACTIVITY_METRICS,
  CRM_ACTIVITY_OPERATORS,
  CRM_EVENT_NAMES,
  CRM_OPERATORS_BY_TYPE,
  CRM_PROFILE_FIELDS,
  CrmProductRepository,
} from '@novu/dal';

import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';

/** Ce que le constructeur de segments et de campagnes peut proposer. */
@ApiExcludeController()
@Controller('/crm/fields')
@RequireAuthentication()
export class CrmFieldsController {
  constructor(private products: CrmProductRepository) {}

  @Get('')
  async list(@UserSession() user: UserSessionData) {
    // Les produits archivés ne se proposent plus : les segments qui les citent continuent de fonctionner.
    const catalogue = await this.products.list(user.environmentId, { activeOnly: true });

    return {
      profile: CRM_PROFILE_FIELDS.map((field) => ({ ...field, operators: CRM_OPERATORS_BY_TYPE[field.type] })),
      activity: { metrics: CRM_ACTIVITY_METRICS, operators: CRM_ACTIVITY_OPERATORS },
      events: CRM_EVENT_NAMES,
      products: catalogue.map((product) => ({ value: product.productId, label: product.name })),
    };
  }
}
