import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserSessionData } from '@novu/shared';

import { RequireAuthentication } from '../../auth/framework/auth.decorator';
import { UserSession } from '../../shared/framework/user.decorator';
import { CrmProductBody, CrmProductsService } from './crm-products.service';

@ApiExcludeController()
@Controller('/crm/products')
@RequireAuthentication()
export class CrmProductsController {
  constructor(private products: CrmProductsService) {}

  @Get('')
  list(@UserSession() user: UserSessionData) {
    return this.products.list(user);
  }

  @Post('')
  create(@UserSession() user: UserSessionData, @Body() body: CrmProductBody) {
    return this.products.create(user, body);
  }

  /** Fiche d'un produit : son poids et les campagnes qui en font la promotion. */
  @Get('/:productId')
  detail(@UserSession() user: UserSessionData, @Param('productId') productId: string, @Query('days') days?: string) {
    return this.products.detail(user, productId, days);
  }

  @Patch('/:productId')
  update(@UserSession() user: UserSessionData, @Param('productId') productId: string, @Body() body: CrmProductBody) {
    return this.products.update(user, productId, body);
  }

  @Delete('/:productId')
  @HttpCode(204)
  async remove(@UserSession() user: UserSessionData, @Param('productId') productId: string): Promise<void> {
    await this.products.remove(user, productId);
  }
}
