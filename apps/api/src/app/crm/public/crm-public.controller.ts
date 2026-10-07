import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  buildSubscriberKey,
  CreateExecutionDetails,
  CreateExecutionDetailsCommand,
  DetailEnum,
  InvalidateCacheService,
} from '@novu/application-generic';
import {
  CRM_TRACKING_PIXEL,
  CrmEngagementRepository,
  CrmProfileStateRepository,
  SubscriberRepository,
  type TrackedPushMessage,
  verifyClickToken,
  verifyOpenToken,
  verifyUnsubscribeToken,
} from '@novu/dal';
import { ExecutionDetailsSourceEnum, ExecutionDetailsStatusEnum, StepTypeEnum } from '@novu/shared';
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
    private engagement: CrmEngagementRepository,
    private createExecutionDetails: CreateExecutionDetails
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

  /**
   * Remise d'un push sur l'appareil, signalée par le SDK dès la réception.
   *
   * C'est le maillon qui manquait au suivi : le worker ne sait que « accepté par FCM », ce qui ne dit
   * rien de la remise réelle. Le tableau de bord affiche désormais la différence.
   *
   * Toujours 204, jeton ou message inconnu compris : une réponse qui varierait révélerait à qui la
   * sollicite l'existence d'un message.
   */
  @Post('/push-delivered')
  @HttpCode(204)
  async pushDelivered(@Body() body: { messageId?: unknown; source?: unknown }): Promise<void> {
    const message = await this.trackedPush(body?.messageId);
    if (!message) return;

    // Seule la PREMIÈRE remise écrit une ligne : un service worker qui signale deux fois ne doit pas
    // remplir le journal d'activité de doublons.
    if (await this.engagement.markPushDelivered(message)) {
      await this.trace(message, DetailEnum.MESSAGE_DELIVERED, deliverySource(body?.source));
    }
  }

  /**
   * Ouverture d'un push : appui sur la notification, signalé par le SDK.
   *
   * Compté pour TOUT push, campagne ou non — un push d'essai déclenché depuis le tableau de bord doit
   * rendre le même retour d'information, sans quoi rien n'est éprouvable avant une vraie campagne. Les
   * rapports CRM, eux, restent réservés aux messages de campagne.
   */
  @Post('/push-opened')
  @HttpCode(204)
  async pushOpened(@Body() body: { messageId?: unknown }): Promise<void> {
    const message = await this.trackedPush(body?.messageId);
    if (!message) return;

    if (await this.engagement.markPushOpened(message)) {
      await this.trace(message, DetailEnum.MESSAGE_SEEN);
    }
  }

  private async trackedPush(messageId: unknown): Promise<TrackedPushMessage | null> {
    return typeof messageId === 'string' ? this.engagement.findPushMessage(messageId) : null;
  }

  /**
   * Écrit la ligne du journal d'activité.
   *
   * `source: WEBHOOK` : la valeur que Novu réserve aux signaux venus de l'extérieur — ici l'appareil du
   * destinataire, comme les ouvertures d'emails rapportées par les fournisseurs. Ce n'est pas une
   * décision de Novu, et le journal doit le dire.
   * Une trace perdue ne doit jamais faire échouer la route — le signal du terminal a déjà été enregistré
   * sur le message, qui reste la source de vérité.
   */
  private async trace(message: TrackedPushMessage, detail: DetailEnum, raw?: string): Promise<void> {
    try {
      await this.createExecutionDetails.execute(
        CreateExecutionDetailsCommand.create({
          environmentId: String(message._environmentId),
          organizationId: String(message._organizationId),
          subscriberId: String(message._subscriberId),
          _subscriberId: String(message._subscriberId),
          workflowRunIdentifier: message.transactionId,
          jobId: String(message._jobId),
          notificationId: String(message._notificationId),
          notificationTemplateId: String(message._templateId),
          messageId: String(message._id),
          providerId: message.providerId,
          transactionId: message.transactionId,
          channel: StepTypeEnum.PUSH,
          detail,
          source: ExecutionDetailsSourceEnum.WEBHOOK,
          status: ExecutionDetailsStatusEnum.SUCCESS,
          isTest: false,
          isRetry: false,
          ...(raw ? { raw } : {}),
        })
      );
    } catch {
      // journal d'activité indisponible : le message porte déjà l'information
    }
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

/**
 * Provenance déclarée par le SDK, reprise telle quelle dans le journal d'activité.
 *
 * `foreground` — l'application ou l'onglet était au premier plan et a reçu le message lui-même.
 * `background` — le message a été pris par le gestionnaire d'arrière-plan, application fermée comprise.
 *
 * La distinction est ce qui sépare « tout va bien » de « cet abonné ne reçoit que lorsqu'il regarde »,
 * deux situations que « Message delivered » seul confond. Toute autre valeur est ignorée : ce corps de
 * requête n'est pas authentifié, il ne doit rien pouvoir écrire de libre dans le journal.
 */
function deliverySource(value: unknown): string | undefined {
  return value === 'foreground' || value === 'background' ? JSON.stringify({ source: value }) : undefined;
}
