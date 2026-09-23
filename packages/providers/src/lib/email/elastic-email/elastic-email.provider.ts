import { EmailProviderIdEnum } from '@novu/shared';
import {
  ChannelTypeEnum,
  CheckIntegrationResponseEnum,
  ICheckIntegrationResponse,
  IEmailOptions,
  IEmailProvider,
  ISendMessageSuccessResponse,
} from '@novu/stateless';

import axios from 'axios';

import { BaseProvider, CasingEnum } from '../../../base.provider';
import { WithPassthrough } from '../../../utils/types';
import { IElasticEmailErrorResponse, IElasticEmailSendResponse } from './elastic-email.interface';

const API_BASE = 'https://api.elasticemail.com/v4';

/**
 * Elastic Email, API v4.
 *
 * Pas de SDK officiel maintenu pour Node : l'API REST est appelee directement, avec axios comme les
 * autres fournisseurs du paquet (mailgun, brevo). Elle tient en un seul appel.
 */
export class ElasticEmailProvider extends BaseProvider implements IEmailProvider {
  id = EmailProviderIdEnum.ElasticEmail;
  protected casing: CasingEnum = CasingEnum.PASCAL_CASE;
  channelType = ChannelTypeEnum.EMAIL as ChannelTypeEnum.EMAIL;

  constructor(
    private config: {
      apiKey: string;
      from: string;
      senderName?: string;
    }
  ) {
    super();
  }

  async sendMessage(
    options: IEmailOptions,
    bridgeProviderData: WithPassthrough<Record<string, unknown>> = {}
  ): Promise<ISendMessageSuccessResponse> {
    const corps = this.transform(bridgeProviderData, this.payload(options)).body;
    const reponse = await this.appel(corps);

    return {
      // Elastic Email rend un identifiant de message et un de transaction ; le premier identifie
      // l'envoi unitaire, c'est lui qui remonte ensuite dans les webhooks.
      id: reponse.MessageID ?? reponse.TransactionID ?? '',
      date: new Date().toISOString(),
    };
  }

  async checkIntegration(options: IEmailOptions): Promise<ICheckIntegrationResponse> {
    try {
      await this.appel(this.payload(options));

      return {
        success: true,
        message: 'Integrated successfully!',
        code: CheckIntegrationResponseEnum.SUCCESS,
      };
    } catch (error) {
      return {
        success: false,
        message: error?.message,
        code: CheckIntegrationResponseEnum.FAILED,
      };
    }
  }

  /**
   * L'expediteur porte le nom d'affichage sous la forme « Nom <adresse> », seule facon de le
   * transmettre : l'API v4 n'a pas de champ dedie.
   */
  private payload(options: IEmailOptions): Record<string, unknown> {
    const expediteur = options.from || this.config.from;
    const nom = options.senderName || this.config.senderName;

    return {
      Recipients: [
        ...this.destinataires(options.to),
        ...this.destinataires(options.cc, 'CC'),
        ...this.destinataires(options.bcc, 'BCC'),
      ],
      Content: {
        From: nom ? `${nom} <${expediteur}>` : expediteur,
        ReplyTo: options.replyTo,
        Subject: options.subject,
        Body: [
          ...(options.html ? [{ ContentType: 'HTML', Charset: 'utf-8', Content: options.html }] : []),
          ...(options.text ? [{ ContentType: 'PlainText', Charset: 'utf-8', Content: options.text }] : []),
        ],
        Attachments: (options.attachments ?? []).map((piece) => ({
          Name: piece.name,
          ContentType: piece.mime,
          BinaryContent: Buffer.from(piece.file).toString('base64'),
        })),
        Headers: options.headers,
      },
    };
  }

  private destinataires(adresses: string | string[] | undefined, champ?: 'CC' | 'BCC') {
    const liste = Array.isArray(adresses) ? adresses : adresses ? [adresses] : [];

    return liste.map((Email) => (champ ? { Email, Fields: { [champ]: 'true' } } : { Email }));
  }

  private async appel(corps: unknown): Promise<IElasticEmailSendResponse> {
    try {
      const { data } = await axios.post<IElasticEmailSendResponse>(`${API_BASE}/emails`, corps, {
        headers: { 'content-type': 'application/json', 'X-ElasticEmail-ApiKey': this.config.apiKey },
      });

      return data ?? {};
    } catch (error) {
      // Le message d'erreur d'Elastic Email est remonte tel quel : c'est lui qui distingue une cle
      // invalide d'un domaine non verifie, et cette distinction est ce qu'on veut voir dans le suivi.
      const reponse = (error as { response?: { status?: number; data?: IElasticEmailErrorResponse | string } })
        .response;
      const donnees = reponse?.data;
      const detail =
        typeof donnees === 'string'
          ? donnees.slice(0, 200)
          : (donnees?.Error ?? donnees?.error ?? (error as Error).message);

      throw new Error(`Elastic Email (${reponse?.status ?? '?'}) : ${detail || 'erreur inconnue'}`);
    }
  }
}
