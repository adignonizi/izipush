import { PushProviderIdEnum } from '@novu/shared';
import { ChannelTypeEnum, IPushOptions, IPushProvider, ISendMessageSuccessResponse } from '@novu/stateless';
import crypto from 'crypto';
import { cert, deleteApp, getApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging, MulticastMessage, TopicMessage } from 'firebase-admin/messaging';
import { BaseProvider, CasingEnum } from '../../../base.provider';
import { WithPassthrough } from '../../../utils/types';

export class FcmPushProvider extends BaseProvider implements IPushProvider {
  id = PushProviderIdEnum.FCM;
  channelType = ChannelTypeEnum.PUSH as ChannelTypeEnum.PUSH;
  protected casing: CasingEnum = CasingEnum.SNAKE_CASE;

  /**
   * Messages d'erreur FCM qui désignent un jeton DÉFINITIVEMENT mort, et non une panne passagère.
   *
   * `NotRegistered` manquait, alors que c'est de loin le cas le plus fréquent : FCM le renvoie dès
   * qu'une application est désinstallée, ses données effacées, ou son jeton simplement renouvelé.
   * Sans lui, un jeton périmé restait attaché à l'abonné indéfiniment et faisait échouer un envoi sur
   * deux — l'exécution restant marquée « réussie » puisqu'un autre jeton passait.
   *
   * N'y mettre que de l'irrécupérable : un jeton retiré à tort ne revient qu'à la prochaine ouverture
   * de l'application. Les pannes réseau et les quotas n'ont rien à faire ici.
   */
  private readonly INVALID_TOKEN_ERRORS = [
    'Requested entity was not found',
    'NotRegistered',
    'Unregistered',
    'InvalidRegistration',
    'MismatchSenderId',
    'SenderId mismatch',
    'The registration token is not a valid FCM registration token',
  ];

  private appName: string;
  private messaging: Messaging;
  constructor(
    private config: {
      projectId: string;
      email: string;
      secretKey: string;
    }
  ) {
    super();
    this.config = config;
    this.appName = crypto.randomBytes(32).toString();
    const firebase = initializeApp(
      {
        credential: cert({
          projectId: this.config.projectId,
          clientEmail: this.config.email,
          privateKey: this.config.secretKey,
        }),
      },
      this.appName
    );
    this.messaging = getMessaging(firebase);
  }

  async sendMessage(
    options: IPushOptions,
    bridgeProviderData: WithPassthrough<Record<string, unknown>> = {}
  ): Promise<ISendMessageSuccessResponse> {
    const {
      deviceTokens: _,
      type,
      android,
      apns,
      fcmOptions,
      webPush: webpush,
      data,
      ...overridesData
    } = (options.overrides as IPushOptions['overrides'] & {
      deviceTokens?: string[];
      webPush: { [key: string]: { [key: string]: string } | string };
    }) || {};

    const payload = this.cleanPayload(options.payload);
    const novuData = payload.__nvMessageId ? { __nvMessageId: payload.__nvMessageId } : {};
    const transformedBase = this.transform<MulticastMessage | TopicMessage>(bridgeProviderData, {});

    const commonProps: Partial<MulticastMessage & TopicMessage> = {
      android,
      apns,
      fcmOptions,
      webpush,
    };

    let res;

    if ((transformedBase?.body as TopicMessage).topic) {
      const topicMessage = this.transform<TopicMessage>(bridgeProviderData, {
        topic: (transformedBase.body as TopicMessage).topic,
        notification: {
          title: options.title,
          body: options.content,
        },
        data: { ...novuData, ...data },
        ...commonProps,
      }).body;

      res = await this.messaging.send(topicMessage);
    } else {
      const multicastConfig: Partial<MulticastMessage> = {
        tokens: options.target,
        ...commonProps,
      };

      // Add either data or notification based on type
      if (type === 'data') {
        multicastConfig.data = {
          ...payload,
          title: options.title,
          body: options.content,
          message: options.content,
        };
      } else {
        multicastConfig.notification = {
          title: options.title,
          body: options.content,
          ...overridesData,
        };
        multicastConfig.data = { ...novuData, ...data };
      }

      const multicastMessage = this.transform<MulticastMessage>(
        bridgeProviderData,
        multicastConfig as Record<string, unknown>
      ).body;

      res = await this.messaging.sendEachForMulticast(multicastMessage);
    }

    const app = getApp(this.appName);
    await deleteApp(app);

    if (res.successCount === 0) {
      throw new Error(
        `Sending message failed due to "${res.responses.find((i) => i.success === false).error.message}"`
      );
    }

    return {
      ids:
        typeof res === 'string'
          ? [res]
          : res?.responses?.map((response, index) =>
              response.success
                ? response.messageId
                : `${response.error.message}. Invalid token:- ${options.target[index]}`
            ),
      date: new Date().toISOString(),
    };
  }

  isTokenInvalid(errorMessage: string): boolean {
    return this.INVALID_TOKEN_ERRORS.some((error) => errorMessage?.includes(error));
  }

  private cleanPayload(payload: object): Record<string, string> {
    const cleanedPayload: Record<string, string> = {};

    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') {
        cleanedPayload[key] = payload[key];
      } else {
        cleanedPayload[key] = JSON.stringify(payload[key]);
      }
    });

    return cleanedPayload;
  }
}
