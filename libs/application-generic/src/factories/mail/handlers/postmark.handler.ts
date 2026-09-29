import { PostmarkEmailProvider } from '@novu/providers';
import { ChannelTypeEnum, EmailProviderIdEnum, ICredentials } from '@novu/shared';
import { BaseEmailHandler } from './base.handler';

export class PostmarkHandler extends BaseEmailHandler {
  constructor() {
    super(EmailProviderIdEnum.Postmark, ChannelTypeEnum.EMAIL);
  }
  buildProvider(credentials: ICredentials, from?: string) {
    const config: { apiKey: string; from: string; messageStream?: string } = {
      from: from as string,
      apiKey: credentials.apiKey as string,
      ...(credentials.messageStream ? { messageStream: credentials.messageStream } : {}),
    };

    this.provider = new PostmarkEmailProvider(config);
  }
}
