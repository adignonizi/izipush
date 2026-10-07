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

/** Reglages d'authentification Keycloak d'un environnement. */
export interface IKeycloakAuthSettings {
  /**
   * Emetteur ATTENDU, tel qu'il figure dans le claim `iss` du jeton — realm compris :
   * `https://keycloak.exemple.com/realms/izichange`.
   *
   * **Il vient d'ici et JAMAIS de la requete.** C'est le seul point qui fait tenir tout le
   * dispositif : un emetteur fourni par l'appelant lui permettrait de monter son propre
   * Keycloak, d'y emettre un jeton portant le `sub` de sa victime, et de le faire valider.
   */
  issuer: string;

  /**
   * Client Keycloak attendu, compare a `azp` puis a `aud`. FACULTATIF mais vivement conseille.
   *
   * Tous les clients d'un meme realm sont signes par la MEME cle : sans ce controle, un jeton
   * emis pour un autre client du realm — un outil interne, un service tiers — est accepte ici.
   * Et c'est `azp` qui porte le client dans un jeton Keycloak, `aud` valant souvent `account`.
   */
  audience?: string;

  /** Claim portant le subscriberId. `sub` par defaut, qui est l'identifiant utilisateur Keycloak. */
  subjectClaim?: string;
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

  /**
   * Authentification des abonnes par jeton Keycloak, pour l'enregistrement d'un jeton push.
   *
   * Presente avec un `issuer` : la route `PUT /v1/widgets/credentials` de cet environnement
   * exige un jeton d'acces Keycloak, et le subscriberId est lu dans son claim `sub` — jamais
   * dans le corps de la requete. Absente : la route garde son comportement d'avant, le JWT
   * d'abonne emis par `/session/initialize`.
   *
   * La migration se pilote donc par la configuration, environnement par environnement.
   */
  keycloakAuth?: IKeycloakAuthSettings;

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
