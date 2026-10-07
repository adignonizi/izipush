import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { adaptKeycloak } from '../pipeline/adapters';
import { IngestService } from '../pipeline/ingest.service';
import { CrmValidationError } from '../pipeline/validation';
import { isValidSignature } from './signature';

/** Webhook Keycloak (inscription, profil, email, suppression, connexion). Même contrat que crm-update-service. */
@Controller('v1/webhooks')
export class KeycloakWebhookController {
  constructor(private ingest: IngestService) {}

  @Post('keycloak')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-keycloak-signature') signature?: string
  ): Promise<{ status: string } | undefined> {
    if (!isValidSignature(req.rawBody, signature, process.env.KEYCLOAK_WEBHOOK_SECRET)) {
      throw new UnauthorizedException('Signature invalide');
    }

    const adapted = adaptKeycloak(req.body);
    if (adapted.kind === 'invalid') throw new BadRequestException(adapted.reason);
    if (adapted.kind === 'ignored') {
      res.status(204);

      return undefined;
    }

    try {
      const outcome = await this.ingest.ingest(adapted.event);
      if (outcome !== 'accepted') {
        res.status(204);

        return undefined;
      }

      return { status: outcome };
    } catch (error) {
      if (error instanceof CrmValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
