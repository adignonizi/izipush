import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { buildSubscriberKey, InvalidateCacheService } from '@novu/application-generic';
import {
  CRM_TRACKING_PIXEL,
  CrmEngagementRepository,
  CrmProfileStateRepository,
  SubscriberRepository,
  verifyClickToken,
  verifyOpenToken,
  verifyUnsubscribeToken,
} from '@novu/dal';
import type { Response } from 'express';

type Outcome = 'unsubscribed' | 'invalid' | 'unavailable';

/**
 * izipush-crm — désinscription marketing sans connexion, depuis le lien des emails.
 * GET : page de confirmation. POST : désinscription en un clic (RFC 8058, en-tête List-Unsubscribe-Post).
 * Aussi : ouverture des notifications push (signalée par le SDK), et ouverture et clics des emails de
 * campagne (pixel et liens réécrits, voir crm-tracking dans le DAL).
 */
@ApiExcludeController()
@Controller('/crm/public')
export class CrmPublicController {
  constructor(
    private subscribers: SubscriberRepository,
    private profileState: CrmProfileStateRepository,
    private invalidateCache: InvalidateCacheService,
    private engagement: CrmEngagementRepository
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

  /** Toujours 204 : la réponse ne dit pas si le message existe. Seuls les push de campagne sont comptés. */
  @Post('/push-opened')
  @HttpCode(204)
  async pushOpened(@Body() body: { messageId?: unknown }): Promise<void> {
    if (typeof body?.messageId === 'string') await this.engagement.recordPushOpen(body.messageId);
  }

  /**
   * Pixel d'ouverture des emails de campagne.
   *
   * Répond toujours la même image, jeton valide ou non : une réponse qui varierait dirait à qui la sollicite
   * si un message existe. Jamais mise en cache, sinon une seule ouverture serait comptée par client.
   */
  @Get('/open.gif')
  async openPixel(@Query('t') token: string, @Res() res: Response): Promise<void> {
    const target = verifyOpenToken(this.secret, token);
    if (target) await this.engagement.recordEmailEngagement(target.environmentId, target.messageId, 'opened');

    res
      .status(HttpStatus.OK)
      .set({
        'content-type': 'image/gif',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
      })
      .send(CRM_TRACKING_PIXEL);
  }

  /**
   * Lien suivi des emails de campagne : compte le clic, puis renvoie vers la destination.
   *
   * La destination est **dans le jeton signé**, jamais dans un paramètre libre : la route ne peut donc pas
   * servir de redirection ouverte. Un échec d'enregistrement ne retient jamais la redirection — le clic de
   * l'utilisateur passe avant la statistique.
   */
  @Get('/click')
  async click(@Query('t') token: string, @Res() res: Response): Promise<void> {
    const target = verifyClickToken(this.secret, token);
    if (!target) {
      res.status(HttpStatus.BAD_REQUEST).type('html').send(brokenLinkPage());

      return;
    }

    try {
      await this.engagement.recordEmailEngagement(target.environmentId, target.messageId, 'clicked');
    } catch {
      // statistique perdue : la redirection a lieu quand même
    }

    res.redirect(HttpStatus.FOUND, target.url);
  }

  private get secret(): string {
    return process.env.CRM_UNSUBSCRIBE_SECRET ?? '';
  }

  private async unsubscribe(token: string): Promise<Outcome> {
    const secret = this.secret;
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

/** Lien de suivi illisible : on ne connaît pas la destination, on ne peut donc que le dire. */
function brokenLinkPage(): string {
  return html(
    'Lien expiré',
    "Ce lien n'est plus valide. Ouvrez le message d'origine depuis votre boîte mail pour réessayer."
  );
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

  return html(title, text);
}

function html(title: string, text: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6fa;color:#14171f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #dce0e6;border-radius:12px;padding:32px;max-width:440px}h1{font-size:20px;margin:0 0 8px}p{color:#5b6472;margin:0;line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}
