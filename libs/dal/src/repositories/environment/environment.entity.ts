import { EncryptedSecret, EnvironmentTypeEnum, IApiRateLimitMaximum } from '@novu/shared';
import { Types } from 'mongoose';

import type { ChangePropsValueType } from '../../types/helpers';
import type { OrganizationId } from '../organization';

export interface IApiKey {
  /*
   * backward compatibility -
   * remove `string` type after encrypt-api-keys-migration run
   * remove the optional from hash
   */
  key: EncryptedSecret | string;
  hash?: string;
  _userId: string;
}

export interface IWidgetSettings {
  notificationCenterEncryption: boolean;
}

export interface IDnsSettings {
  mxRecordConfigured: boolean;
  inboundParseDomain: string;
}

export class EnvironmentEntity {
  _id: string;

  name: string;

  _organizationId: OrganizationId;

  identifier: string;

  apiKeys: IApiKey[];

  apiRateLimits?: IApiRateLimitMaximum;

  /**
   * Adresses autorisees a utiliser les cles API de cet environnement, en notation
   * simple ou CIDR.
   *
   * **Vide ou absent : aucune restriction.** La fonctionnalite est une option, et un
   * environnement cree avant son introduction ne doit pas se retrouver coupe.
   *
   * Ne porte QUE sur les appels authentifies par cle API — serveur a serveur. Les
   * routes des appareils (`/v1/widgets/*`, `/v1/crm/public/*`) et l'acces au tableau
   * de bord n'en dependent pas : une liste mal saisie ne peut donc ni couper les
   * clients, ni enfermer dehors celui qui l'a saisie.
   */
  apiIpAllowList?: string[];

  widget: IWidgetSettings;

  dns?: IDnsSettings;

  _parentId: string;

  color?: string;

  type: EnvironmentTypeEnum;

  echo: {
    url: string;
  };
  bridge: {
    url: string;
  };

  webhookAppId?: string;

  createdAt?: string;

  updatedAt?: string;
}

export type EnvironmentDBModel = ChangePropsValueType<
  Omit<EnvironmentEntity, 'apiKeys'>,
  '_organizationId' | '_parentId'
> & {
  apiKeys: IApiKey & { _userId: Types.ObjectId }[];
};
