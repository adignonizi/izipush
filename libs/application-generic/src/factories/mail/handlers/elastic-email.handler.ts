import { ElasticEmailProvider } from '@novu/providers';
import { ChannelTypeEnum, EmailProviderIdEnum, IConfigurations, ICredentials } from '@novu/shared';
import { BaseEmailHandler } from './base.handler';

export class ElasticEmailHandler extends BaseEmailHandler {
  constructor() {
    super(EmailProviderIdEnum.ElasticEmail, ChannelTypeEnum.EMAIL);
  }

  buildProvider(credentials: ICredentials & IConfigurations, from?: string) {
    this.provider = new ElasticEmailProvider({
      apiKey: credentials.apiKey as string,
      from: from as string,
      senderName: credentials.senderName,
    });
  }
}
