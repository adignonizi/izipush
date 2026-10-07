import { BadRequestException, Injectable, Logger, NotFoundException, Scope } from '@nestjs/common';
import { AnalyticsService, IMailHandler, ISmsHandler, MailFactory, SmsFactory } from '@novu/application-generic';
import {
  CrmEngagementRepository,
  CrmProviderUsageRepository,
  IntegrationEntity,
  IntegrationQuery,
  IntegrationRepository,
  MessageEntity,
  MessageRepository,
  SubscriberRepository,
} from '@novu/dal';
import { ChannelTypeEnum, providers } from '@novu/shared';
import { EmailEventStatusEnum, IEmailProvider, ISmsProvider } from '@novu/stateless';
import { IWebhookResult } from '../../dtos/webhooks-response.dto';
import { WebhookTypes } from '../../interfaces/webhook.interface';
import { CreateExecutionDetails } from '../execution-details/create-execution-details.usecase';
import { WebhookCommand } from './webhook.command';

@Injectable({ scope: Scope.REQUEST })
export class Webhook {
  public readonly mailFactory = new MailFactory();
  public readonly smsFactory = new SmsFactory();
  private provider: IEmailProvider | ISmsProvider;

  constructor(
    private createExecutionDetails: CreateExecutionDetails,
    private integrationRepository: IntegrationRepository,
    private messageRepository: MessageRepository,
    private analyticsService: AnalyticsService,
    private subscriberRepository: SubscriberRepository,
    private crmProviderUsage: CrmProviderUsageRepository,
    private crmEngagement: CrmEngagementRepository
  ) {}

  async execute(command: WebhookCommand): Promise<IWebhookResult[]> {
    const { providerOrIntegrationId } = command;
    const isProviderId = !!providers.find((el) => el.id === providerOrIntegrationId);
    const channel: ChannelTypeEnum = command.type === 'email' ? ChannelTypeEnum.EMAIL : ChannelTypeEnum.SMS;

    const query: IntegrationQuery = {
      ...(isProviderId
        ? { providerId: providerOrIntegrationId, credentials: { $exists: true }, channel }
        : { _id: providerOrIntegrationId }),
      _environmentId: command.environmentId,
      _organizationId: command.organizationId,
    };

    const integration: IntegrationEntity = await this.integrationRepository.findOne(query);
    if (!integration) {
      throw new NotFoundException(`Integration for ${providerOrIntegrationId} was not found`);
    }

    const hasNoCredentials = !integration.credentials || Object.keys(integration.credentials).length === 0;
    if (hasNoCredentials) {
      throw new BadRequestException(`Integration ${integration._id} doesn't have credentials set up`);
    }

    this.analyticsService.track('[Webhook] - Provider Webhook called', '', {
      _organization: command.organizationId,
      _environmentId: command.environmentId,
      providerId: integration.providerId,
      channel,
    });

    this.createProvider(integration, command.type);

    if (!this.provider.getMessageId || !this.provider.parseEventBody) {
      throw new NotFoundException(`Provider with ${integration.providerId} can not handle webhooks`);
    }

    const events = await this.parseEvents(command, integration.providerId, channel, String(integration._id));

    this.analyticsService.track('[Webhook] - Provider Webhook events parsed', '', {
      _organization: command.organizationId,
      _environmentId: command.environmentId,
      providerId: integration.providerId,
      channel,
      events,
    });

    return events;
  }

  private async parseEvents(
    command: WebhookCommand,
    providerId: string,
    channel: ChannelTypeEnum,
    integrationId: string
  ): Promise<IWebhookResult[]> {
    const { body } = command;
    const messageIdentifiers: string[] = this.provider.getMessageId(body);

    const events: IWebhookResult[] = [];

    for (let eventIndex = 0; eventIndex < messageIdentifiers.length; eventIndex++) {
      const messageIdentifier = messageIdentifiers[eventIndex];
      const event = await this.parseEvent(messageIdentifier, command, providerId, channel, eventIndex, integrationId);

      if (event === undefined) {
        continue;
      }

      events.push(event);
    }

    return events;
  }

  private async parseEvent(
    messageIdentifier: string,
    command: WebhookCommand,
    providerId: string,
    channel: ChannelTypeEnum,
    eventIndex: number,
    integrationId: string
  ): Promise<IWebhookResult | undefined> {
    const message = await this.messageRepository.findOne({
      identifier: messageIdentifier,
      _environmentId: command.environmentId,
      _organizationId: command.organizationId,
    });

    if (!message) {
      Logger.error(`Message with ${messageIdentifier} as identifier was not found`);

      return;
    }

    const event = this.provider.parseEventBody(
      command.body,
      messageIdentifier,
      Array.isArray(command.body) ? eventIndex : undefined
    );

    if (event === undefined) {
      return undefined;
    }

    const parsedEvent = {
      id: messageIdentifier,
      event,
    };

    /**
     * TODO: Individually performing the creation of the execution details because here we can pass message that contains
     * most of the __foreign keys__ we need. But we can't take advantage of a bulk write of all events. Besides the writing
     * being hiding inside auxiliary methods of the use case.
     */
    await this.createExecutionDetails.execute({
      message,
      webhook: {
        ...command,
        providerId,
      },
      webhookEvent: parsedEvent,
      channel,
    });

    await this.applyCrmSuppression(message, String(event.status), integrationId);
    await this.recordCrmEngagement(message, String(event.status));

    return parsedEvent;
  }

  /**
   * izipush-crm — bounce, plainte ou spam : l'adresse n'est plus visée par les emails de campagne.
   * Désabonnement signalé par le fournisseur : le client ne reçoit plus de marketing.
   */
  /** izipush-crm — ouvertures et clics des emails de campagne, pour les rapports. */
  private async recordCrmEngagement(message: MessageEntity, status: string): Promise<void> {
    if (message.channel !== ChannelTypeEnum.EMAIL || !message.payload?.__crm) return;

    const kind =
      status === EmailEventStatusEnum.OPENED ? 'opened' : status === EmailEventStatusEnum.CLICKED ? 'clicked' : null;
    if (!kind) return;

    await this.crmEngagement
      .record(message, kind)
      .catch((error) => Logger.warn(`Engagement email non enregistré : ${error?.message}`));
  }

  private async applyCrmSuppression(message: MessageEntity, status: string, integrationId: string): Promise<void> {
    if (message.channel !== ChannelTypeEnum.EMAIL) return;

    const counter =
      status === EmailEventStatusEnum.BOUNCED
        ? 'bounced'
        : status === EmailEventStatusEnum.COMPLAINT || status === EmailEventStatusEnum.SPAM
          ? 'complaints'
          : undefined;
    if (counter) {
      await this.crmProviderUsage
        .increment(message._environmentId, integrationId, counter, message.providerId)
        .catch((error) => Logger.warn(`Compteur fournisseur email non mis à jour : ${error?.message}`));
    }

    const suppressing: string[] = [
      EmailEventStatusEnum.BOUNCED,
      EmailEventStatusEnum.COMPLAINT,
      EmailEventStatusEnum.SPAM,
    ];
    const set = suppressing.includes(status)
      ? { email_suppressed: true }
      : status === EmailEventStatusEnum.UNSUBSCRIBED
        ? { marketing_optin: false }
        : undefined;
    if (!set) return;

    const target = { _environmentId: message._environmentId, _id: message._subscriberId };
    const dotted = Object.fromEntries(Object.entries(set).map(([key, value]) => [`data.${key}`, value]));
    const withData = await this.subscriberRepository.update(
      { ...target, data: { $type: 'object' } } as Parameters<SubscriberRepository['update']>[0],
      { $set: dotted }
    );

    // Subscriber sans objet data : écrire « data.x » échouerait, on crée l'objet d'un bloc.
    if (!withData.matched) {
      await this.subscriberRepository.update(
        { ...target, data: { $in: [null] } } as Parameters<SubscriberRepository['update']>[0],
        { $set: { data: set } }
      );
    }
  }

  private getHandler(integration: IntegrationEntity, type: WebhookTypes): ISmsHandler | IMailHandler | null {
    switch (type) {
      case 'sms':
        return this.smsFactory.getHandler(integration);
      default:
        return this.mailFactory.getHandler(integration);
    }
  }

  private createProvider(integration: IntegrationEntity, type: 'sms' | 'email') {
    const handler = this.getHandler(integration, type);
    if (!handler) {
      throw new NotFoundException(`Handler for integration of ${integration.providerId} was not found`);
    }
    handler.buildProvider(integration.credentials);

    this.provider = handler.getProvider();
  }
}
