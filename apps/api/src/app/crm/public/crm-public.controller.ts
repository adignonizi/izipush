import { Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { buildSubscriberKey, InvalidateCacheService } from '@novu/application-generic';
import { CrmProfileStateRepository, SubscriberRepository, verifyUnsubscribeToken } from '@novu/dal';
import type { Response } from 'express';

type Outcome = 'unsubscribed' | 'invalid' | 'unavailable';

/**
 * izipush-crm — désinscription marketing sans connexion, depuis le lien des emails.
 * GET : page de confirmation. POST : désinscription en un clic (RFC 8058, en-tête List-Unsubscribe-Post).
 */
@ApiExcludeController()
@Controller('/crm/public')
export class CrmPublicController {
  constructor(
    private subscribers: SubscriberRepository,
    private profileState: CrmProfileStateRepository,
    private invalidateCache: InvalidateCacheService
  ) {}

  @Get('/unsubscribe')
  async unsubscribePage(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const outcome = await this.unsubscribe(token);

    res
      .status(outcome === 'unsubscribed' ? HttpStatus.OK : HttpStatus.BAD_REQUEST)
      .type('html')
      .send(page(outcome));
  }

  @Post('/unsubscribe')
  async oneClick(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const outcome = await this.unsubscribe(token);

    res.status(outcome === 'unsubscribed' ? HttpStatus.OK : HttpStatus.BAD_REQUEST).json({ outcome });
  }

  private async unsubscribe(token: string): Promise<Outcome> {
    const secret = process.env.CRM_UNSUBSCRIBE_SECRET ?? '';
    if (!secret) return 'unavailable';

    const target = verifyUnsubscribeToken(secret, token);
    if (!target) return 'invalid';

    const subscriber = await this.subscribers.findBySubscriberId(target.environmentId, target.subscriberId);
    if (!subscriber) return 'invalid';

    const update = subscriber.data ? { 'data.marketing_optin': false } : { data: { marketing_optin: false } };
    await this.subscribers.update({ _environmentId: target.environmentId, _id: subscriber._id }, { $set: update });
    await this.invalidateCache.invalidateByKey({
      key: buildSubscriberKey({ subscriberId: target.subscriberId, _environmentId: target.environmentId }),
    });
    // Un événement de consentement plus ancien ne doit pas réinscrire le client.
    await this.profileState.setFieldsAt(target.environmentId, String(subscriber._organizationId), target.subscriberId, {
      'data.marketing_optin': new Date(),
    });

    return 'unsubscribed';
  }
}

function page(outcome: Outcome): string {
  const [title, text] =
    outcome === 'unsubscribed'
      ? [
          'Désinscription confirmée',
          'Vous ne recevrez plus nos emails promotionnels. Les messages liés à votre compte continueront.',
        ]
      : outcome === 'invalid'
        ? ['Lien invalide', "Ce lien de désinscription n'est pas valide. Utilisez le lien du dernier email reçu."]
        : ['Service indisponible', 'La désinscription est momentanément indisponible. Réessayez plus tard.'];

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6fa;color:#14171f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #dce0e6;border-radius:12px;padding:32px;max-width:440px}h1{font-size:20px;margin:0 0 8px}p{color:#5b6472;margin:0;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}
